/**
 * Token Bundle Routes
 * Purchase and manage token bundles for usage beyond rate limits
 */

import { FastifyInstance } from 'fastify';
import { query, queryOne } from '@substrate/database';
import { ulid } from 'ulid';
import {
  TOKEN_PACKAGES,
  getPackages,
  getPackage,
  getBundleBalance,
  getBundleHistory,
  purchaseBundle,
  grantTokens,
  PackageId,
} from '../services/billing.js';
import { requireAuth } from '../middleware/tenant.js';

// Cookie settings (same as auth)
const SESSION_COOKIE_NAME = 'substrate_session';

// Helper to hash session token
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper to get authenticated user
async function getAuthenticatedUser(
  request: { cookies: Record<string, string> | undefined }
): Promise<{ user_id: string; tenant_id: string; is_admin: boolean } | null> {
  const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string }>(
    `SELECT s.user_id FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.status = 'active'`,
    [tokenHash]
  );

  if (!session) return null;

  const user = await queryOne<{ id: string; tenant_id: string; role: string }>(
    'SELECT id, tenant_id, role FROM users WHERE id = $1',
    [session.user_id]
  );

  return user
    ? { user_id: user.id, tenant_id: user.tenant_id, is_admin: user.role === 'admin' }
    : null;
}

export async function bundleRoutes(app: FastifyInstance): Promise<void> {
  // ============================================
  // PUBLIC: Package Information
  // ============================================

  /**
   * GET /api/v1/bundles/packages
   * List available token packages
   */
  app.get('/api/v1/bundles/packages', async () => {
    return { packages: getPackages() };
  });

  // ============================================
  // AUTHENTICATED: User Bundle Management
  // ============================================

  /**
   * GET /api/v1/bundles/balance
   * Get user's token balance (legacy)
   */
  app.get('/api/v1/bundles/balance', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const balance = await getBundleBalance(auth.tenant_id);

    return {
      balance: balance.totalRemaining,
      bundles: balance.bundles,
      packages: getPackages(), // Include packages for upsell
    };
  });

  /**
   * GET /api/v1/credits/status
   * Get user's full credit status (daily + bundles)
   */
  app.get('/api/v1/credits/status', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Use the database function for accurate credit status
    const result = await queryOne<{
      daily_used: number;
      daily_limit: number;
      daily_remaining: number;
      banked_credits: number;
      bundle_credits: number;
      total_credits: number;
      messages_sent: number;
      user_tier: string;
      byok_enabled: boolean;
      has_keys: boolean;
      rollover_enabled: boolean;
      max_banked: number;
      resets_at: string;
    }>(
      `SELECT * FROM get_credit_status($1)`,
      [auth.tenant_id]
    );

    if (!result) {
      return reply.code(500).send({ error: 'Failed to get credit status' });
    }

    // Calculate reset time (midnight UTC)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    return {
      credits: {
        daily: {
          used: result.daily_used,
          limit: result.daily_limit,
          remaining: result.daily_remaining,
        },
        banked: result.banked_credits,
        bundle: result.bundle_credits,
        total: result.total_credits,
      },
      messages: result.messages_sent,
      tier: result.user_tier,
      byok: {
        enabled: result.byok_enabled,
        hasKeys: result.has_keys,
        unlimited: result.byok_enabled && result.has_keys,
      },
      rolloverEnabled: result.rollover_enabled,
      maxBanked: result.max_banked,
      resetsAt: tomorrow.toISOString(),
      packages: getPackages(),
    };
  });

  /**
   * GET /api/v1/bundles/history
   * Get user's bundle purchase history
   */
  app.get('/api/v1/bundles/history', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const history = await getBundleHistory(auth.tenant_id);
    return { bundles: history };
  });

  /**
   * POST /api/v1/bundles/purchase
   * Purchase a token bundle
   * In production, this integrates with Stripe
   */
  app.post('/api/v1/bundles/purchase', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const body = request.body as { packageId: string; paymentMethodId?: string };

    if (!body.packageId) {
      return reply.code(400).send({ error: 'packageId is required' });
    }

    const pkg = getPackage(body.packageId as PackageId);
    if (!pkg) {
      return reply.code(400).send({ error: 'Invalid package' });
    }

    try {
      // Real Stripe Integration
      const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];

      if (!stripeSecretKey) {
        // Fallback for development/testing without Stripe
        console.warn('STRIPE_SECRET_KEY not configured - using simulated payment');
        const stripePaymentId = `pi_dev_${Date.now()}`;
        const bundle = await purchaseBundle(auth.tenant_id, body.packageId as PackageId, {
          stripePaymentId,
        });

        // Audit log
        await query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, details, success, created_at)
           VALUES ($1, $2, $3, 'bundle.purchase', 'token_bundle', $4, $5, true, NOW())`,
          [
            `audit_${ulid()}`,
            auth.tenant_id,
            auth.user_id,
            bundle.id,
            JSON.stringify({ package: body.packageId, tokens: pkg.tokens, price: pkg.price, mode: 'development' }),
          ]
        );

        return {
          success: true,
          bundle: {
            id: bundle.id,
            tokens: bundle.tokensPurchased,
            price: bundle.priceUsd,
            expiresAt: bundle.expiresAt,
          },
          message: `Successfully purchased ${pkg.name}! (Development mode)`,
        };
      }

      // Production Stripe flow
      if (!body.paymentMethodId) {
        return reply.code(400).send({ error: 'paymentMethodId is required for production purchases' });
      }

      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' as any });

      // Get user email for customer
      const user = await queryOne<{ email: string; name?: string }>(
        'SELECT email, name FROM users WHERE id = $1',
        [auth.user_id]
      );

      if (!user) {
        return reply.code(400).send({ error: 'User not found' });
      }

      // Get or create Stripe customer
      let customerId: string;
      const existingCustomer = await queryOne<{ stripe_customer_id: string }>(
        'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 AND stripe_customer_id IS NOT NULL',
        [auth.tenant_id]
      );

      if (existingCustomer?.stripe_customer_id) {
        customerId = existingCustomer.stripe_customer_id;
      } else {
        const customerParams: { email: string; name?: string; metadata: Record<string, string> } = {
          email: user.email,
          metadata: { tenant_id: auth.tenant_id },
        };
        if (user.name) {
          customerParams.name = user.name;
        }
        const customer = await stripe.customers.create(customerParams);
        customerId = customer.id;

        // Save customer ID
        await query(
          `UPDATE subscriptions SET stripe_customer_id = $1 WHERE tenant_id = $2`,
          [customerId, auth.tenant_id]
        );
      }

      // Create PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(pkg.price * 100), // Convert to cents
        currency: 'usd',
        customer: customerId,
        payment_method: body.paymentMethodId,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          package_id: body.packageId,
          tokens: pkg.tokens.toString(),
        },
      });

      if (paymentIntent.status !== 'succeeded') {
        return reply.code(402).send({
          error: 'Payment failed',
          status: paymentIntent.status,
          message: 'Payment could not be completed. Please try again.',
        });
      }

      // Payment succeeded - create bundle
      const bundle = await purchaseBundle(auth.tenant_id, body.packageId as PackageId, {
        stripePaymentId: paymentIntent.id,
      });

      // Audit log
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, details, success, created_at)
         VALUES ($1, $2, $3, 'bundle.purchase', 'token_bundle', $4, $5, true, NOW())`,
        [
          `audit_${ulid()}`,
          auth.tenant_id,
          auth.user_id,
          bundle.id,
          JSON.stringify({ package: body.packageId, tokens: pkg.tokens, price: pkg.price }),
        ]
      );

      return {
        success: true,
        bundle: {
          id: bundle.id,
          tokens: bundle.tokensPurchased,
          price: bundle.priceUsd,
          expiresAt: bundle.expiresAt,
        },
        message: `Successfully purchased ${pkg.name}!`,
      };
    } catch (error) {
      console.error('Bundle purchase failed:', error);
      return reply.code(500).send({
        error: 'Purchase failed',
        message: 'Unable to process payment. Please try again.',
      });
    }
  });

  /**
   * POST /api/v1/bundles/redeem
   * Redeem a gift/promo code
   */
  app.post('/api/v1/bundles/redeem', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const body = request.body as { code: string };

    if (!body.code || body.code.length < 6) {
      return reply.code(400).send({ error: 'Invalid promo code' });
    }

    // Use database function for atomic redemption
    const result = await queryOne<{
      success: boolean;
      message: string;
      tokens_granted: number;
      bundle_id: string | null;
    }>(
      `SELECT * FROM redeem_promo_code($1, $2, $3)`,
      [body.code.toUpperCase().trim(), auth.tenant_id, auth.user_id]
    );

    if (!result) {
      return reply.code(500).send({ error: 'Failed to process promo code' });
    }

    if (!result.success) {
      return reply.code(400).send({
        error: 'Invalid code',
        message: result.message,
      });
    }

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, details, success, created_at)
       VALUES ($1, $2, $3, 'bundle.promo_redeem', 'promo_code', $4, $5, true, NOW())`,
      [
        `audit_${ulid()}`,
        auth.tenant_id,
        auth.user_id,
        result.bundle_id,
        JSON.stringify({ code: body.code, tokens: result.tokens_granted }),
      ]
    );

    return {
      success: true,
      message: result.message,
      tokens: result.tokens_granted,
      bundleId: result.bundle_id,
    };
  });

  // ============================================
  // ADMIN ROUTES
  // ============================================

  /**
   * GET /api/v1/bundles/admin/stats
   * Get bundle statistics (admin only)
   */
  app.get('/api/v1/bundles/admin/stats', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!auth.is_admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const result = await query<{
      bundle_type: string;
      count: string;
      tokens_sold: string;
      tokens_remaining: string;
      revenue: string;
      active_count: string;
    }>(
      `SELECT
        bundle_type,
        COUNT(*) as count,
        SUM(tokens_purchased) as tokens_sold,
        SUM(tokens_remaining) as tokens_remaining,
        SUM(price_usd) as revenue,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
       FROM token_bundles
       GROUP BY bundle_type`
    );

    const byType: Record<string, { count: number; tokens: number; revenue: number }> = {};
    let totalBundles = 0;
    let activeBundles = 0;
    let totalTokensSold = 0;
    let totalTokensRemaining = 0;
    let totalRevenue = 0;

    for (const row of result) {
      byType[row.bundle_type] = {
        count: parseInt(row.count),
        tokens: parseInt(row.tokens_sold) || 0,
        revenue: parseFloat(row.revenue) || 0,
      };
      totalBundles += parseInt(row.count);
      activeBundles += parseInt(row.active_count) || 0;
      totalTokensSold += parseInt(row.tokens_sold) || 0;
      totalTokensRemaining += parseInt(row.tokens_remaining) || 0;
      totalRevenue += parseFloat(row.revenue) || 0;
    }

    return {
      stats: {
        totalBundles,
        activeBundles,
        totalTokensSold,
        totalTokensRemaining,
        totalRevenue,
        byType,
      },
    };
  });

  /**
   * POST /api/v1/bundles/admin/grant
   * Grant free tokens to a user (admin only)
   */
  app.post('/api/v1/bundles/admin/grant', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!auth.is_admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const body = request.body as {
      userId: string;
      tokens: number;
      reason: string;
      expiresInDays?: number;
    };

    if (!body.userId || !body.tokens || !body.reason) {
      return reply.code(400).send({ error: 'userId, tokens, and reason are required' });
    }

    if (body.tokens < 1000) {
      return reply.code(400).send({ error: 'Minimum grant is 1000 tokens' });
    }

    // Get target user's tenant
    const targetUser = await queryOne<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE id = $1',
      [body.userId]
    );

    if (!targetUser) {
      return reply.code(404).send({ error: 'User not found' });
    }

    try {
      const bundle = await grantTokens(
        targetUser.tenant_id,
        body.tokens,
        body.reason,
        body.expiresInDays || 30
      );

      // Audit log
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, details, success, created_at)
         VALUES ($1, $2, $3, 'bundle.admin_grant', 'token_bundle', $4, $5, true, NOW())`,
        [
          `audit_${ulid()}`,
          auth.tenant_id,
          auth.user_id,
          bundle.id,
          JSON.stringify({
            target_user: body.userId,
            tokens: body.tokens,
            reason: body.reason,
          }),
        ]
      );

      return {
        success: true,
        bundle: {
          id: bundle.id,
          tokens: bundle.tokensPurchased,
          expiresAt: bundle.expiresAt,
        },
        message: `Granted ${body.tokens.toLocaleString()} tokens to user`,
      };
    } catch (error) {
      console.error('Token grant failed:', error);
      return reply.code(500).send({ error: 'Failed to grant tokens' });
    }
  });

  /**
   * GET /api/v1/bundles/admin/user/:userId
   * Get a specific user's bundle info (admin only)
   */
  app.get('/api/v1/bundles/admin/user/:userId', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    if (!auth.is_admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const { userId } = request.params as { userId: string };

    // Get target user's tenant
    const targetUser = await queryOne<{ tenant_id: string; email: string }>(
      'SELECT tenant_id, email FROM users WHERE id = $1',
      [userId]
    );

    if (!targetUser) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const balance = await getBundleBalance(targetUser.tenant_id);
    const history = await getBundleHistory(targetUser.tenant_id);

    return {
      user: {
        id: userId,
        email: targetUser.email,
      },
      balance: balance.totalRemaining,
      bundles: balance.bundles,
      history,
    };
  });
}

export default bundleRoutes;
