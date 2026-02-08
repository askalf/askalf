/**
 * SUBSTRATE v1: Billing & Subscription Routes
 *
 * API endpoints for plans, subscriptions, usage, billing management,
 * and Stripe integration (checkout, portal, webhooks).
 */

import { FastifyInstance } from 'fastify';
import { query, queryOne } from '@substrate/database';
import { ulid } from 'ulid';
import {
  constructWebhookEvent,
  handleWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  getCustomerInvoices,
  getUpcomingInvoice,
  CreateCheckoutOptions,
} from '@substrate/stripe';
import { requireAuth, AuthenticatedRequest } from '../middleware/tenant.js';

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
): Promise<{ user_id: string; tenant_id: string } | null> {
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

  const user = await queryOne<{ id: string; tenant_id: string }>(
    'SELECT id, tenant_id FROM users WHERE id = $1',
    [session.user_id]
  );

  return user ? { user_id: user.id, tenant_id: user.tenant_id } : null;
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // ============================================
  // PUBLIC: Plans
  // ============================================

  /**
   * Get all available plans
   */
  app.get('/api/v1/plans', async () => {
    const plans = await query<Record<string, unknown>>(
      `SELECT id, name, display_name, description, price_monthly, price_yearly,
              limits, features, sort_order, is_featured
       FROM plans
       WHERE is_active = true
       ORDER BY sort_order ASC`
    );

    const stripeEnabled = !!(process.env['STRIPE_SECRET_KEY']);

    return {
      stripeEnabled,
      plans: plans.map((p) => ({
        id: p['id'],
        name: p['name'],
        display_name: p['display_name'],
        description: p['description'],
        price_monthly: p['price_monthly'],
        price_yearly: p['price_yearly'],
        price_monthly_formatted: p['price_monthly']
          ? `$${((p['price_monthly'] as number) / 100).toFixed(2)}/mo`
          : p['name'] === 'enterprise'
          ? 'Contact us'
          : 'Free',
        price_yearly_formatted: p['price_yearly']
          ? `$${((p['price_yearly'] as number) / 100).toFixed(2)}/yr`
          : p['name'] === 'enterprise'
          ? 'Contact us'
          : 'Free',
        limits: p['limits'],
        features: p['features'],
        is_featured: p['is_featured'],
      })),
    };
  });

  /**
   * Get a specific plan
   */
  app.get('/api/v1/plans/:planId', async (request, reply) => {
    const { planId } = request.params as { planId: string };

    const plan = await queryOne<Record<string, unknown>>(
      `SELECT id, name, display_name, description, price_monthly, price_yearly,
              limits, features, sort_order, is_featured
       FROM plans WHERE id = $1 AND is_active = true`,
      [planId]
    );

    if (!plan) {
      return reply.code(404).send({ error: 'Plan not found' });
    }

    return {
      plan: {
        id: plan['id'],
        name: plan['name'],
        display_name: plan['display_name'],
        description: plan['description'],
        price_monthly: plan['price_monthly'],
        price_yearly: plan['price_yearly'],
        limits: plan['limits'],
        features: plan['features'],
        is_featured: plan['is_featured'],
      },
    };
  });

  // ============================================
  // AUTHENTICATED: Subscription Management
  // ============================================

  /**
   * Get current subscription
   */
  app.get('/api/v1/subscription', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const subscription = await queryOne<Record<string, unknown>>(
      `SELECT s.*, p.name as plan_name, p.display_name as plan_display_name,
              p.limits as plan_limits, p.features as plan_features
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1 AND s.status IN ('active', 'trialing')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [auth.tenant_id]
    );

    if (!subscription) {
      // Return free plan info if no subscription
      const freePlan = await queryOne<Record<string, unknown>>(
        'SELECT * FROM plans WHERE name = $1',
        ['free']
      );

      return {
        subscription: null,
        effective_plan: {
          name: 'free',
          display_name: freePlan?.['display_name'] ?? 'Free',
          limits: freePlan?.['limits'] ?? {},
          features: freePlan?.['features'] ?? {},
        },
      };
    }

    return {
      subscription: {
        id: subscription['id'],
        plan_id: subscription['plan_id'],
        status: subscription['status'],
        trial_end: subscription['trial_end'],
        current_period_start: subscription['current_period_start'],
        current_period_end: subscription['current_period_end'],
        cancel_at_period_end: subscription['cancel_at_period_end'],
        created_at: subscription['created_at'],
        // Include Stripe IDs so frontend knows if Stripe is connected
        stripe_subscription_id: subscription['stripe_subscription_id'] || null,
        stripe_customer_id: subscription['stripe_customer_id'] || null,
      },
      effective_plan: {
        name: subscription['plan_name'],
        display_name: subscription['plan_display_name'],
        limits: subscription['plan_limits'],
        features: subscription['plan_features'],
      },
    };
  });

  /**
   * Get subscription history
   */
  app.get('/api/v1/subscription/history', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const subscriptions = await query<Record<string, unknown>>(
      `SELECT s.id, s.plan_id, s.status, s.created_at, s.canceled_at,
              s.cancellation_reason, p.display_name as plan_name
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC
       LIMIT 10`,
      [auth.tenant_id]
    );

    return {
      history: subscriptions.map((s) => ({
        id: s['id'],
        plan_id: s['plan_id'],
        plan_name: s['plan_name'],
        status: s['status'],
        created_at: s['created_at'],
        canceled_at: s['canceled_at'],
        cancellation_reason: s['cancellation_reason'],
      })),
    };
  });

  /**
   * Cancel subscription (schedule cancellation at period end)
   */
  app.post('/api/v1/subscription/cancel', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const body = request.body as { reason?: string; immediate?: boolean };

    const subscription = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM subscriptions
       WHERE tenant_id = $1 AND status IN ('active', 'trialing')
       ORDER BY created_at DESC LIMIT 1`,
      [auth.tenant_id]
    );

    if (!subscription) {
      return reply.code(404).send({ error: 'No active subscription found' });
    }

    if (body.immediate) {
      // Immediate cancellation
      await query(
        `UPDATE subscriptions
         SET status = 'canceled', canceled_at = NOW(), cancellation_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [body.reason ?? 'user_requested', subscription.id]
      );
    } else {
      // Cancel at period end
      await query(
        `UPDATE subscriptions
         SET cancel_at_period_end = true, cancellation_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [body.reason ?? 'user_requested', subscription.id]
      );
    }

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, details, success, created_at)
       VALUES ($1, $2, $3, 'subscription.cancel', 'subscription', $4, $5, true, NOW())`,
      [
        `audit_${ulid()}`,
        auth.tenant_id,
        auth.user_id,
        subscription.id,
        JSON.stringify({ reason: body.reason, immediate: body.immediate ?? false }),
      ]
    );

    return {
      success: true,
      message: body.immediate
        ? 'Subscription canceled immediately'
        : 'Subscription will be canceled at the end of the billing period',
    };
  });

  /**
   * Reactivate canceled subscription
   */
  app.post('/api/v1/subscription/reactivate', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const result = await query<{ id: string }>(
      `UPDATE subscriptions
       SET cancel_at_period_end = false, cancellation_reason = NULL, updated_at = NOW()
       WHERE tenant_id = $1 AND cancel_at_period_end = true AND status IN ('active', 'trialing')
       RETURNING id`,
      [auth.tenant_id]
    );

    if (result.length === 0) {
      return reply.code(404).send({ error: 'No subscription pending cancellation' });
    }

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, success, created_at)
       VALUES ($1, $2, $3, 'subscription.reactivate', 'subscription', $4, true, NOW())`,
      [`audit_${ulid()}`, auth.tenant_id, auth.user_id, result[0]?.id]
    );

    return { success: true, message: 'Subscription reactivated' };
  });

  // ============================================
  // AUTHENTICATED: Usage & Limits
  // ============================================

  /**
   * Get current usage
   */
  app.get('/api/v1/usage', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Get today's usage
    const today = new Date().toISOString().split('T')[0];
    const usage = await queryOne<Record<string, unknown>>(
      `SELECT * FROM usage_records WHERE tenant_id = $1 AND date = $2`,
      [auth.tenant_id, today]
    );

    // Get limits from subscription
    const limits = await queryOne<{ limits: Record<string, number> }>(
      'SELECT get_tenant_limits($1) as limits',
      [auth.tenant_id]
    );

    const planLimits = limits?.limits ?? {};
    const currentUsage = {
      executions: (usage?.['executions'] as number) ?? 0,
      traces_ingested: (usage?.['traces_ingested'] as number) ?? 0,
      api_requests: (usage?.['api_requests'] as number) ?? 0,
      mcp_requests: (usage?.['mcp_requests'] as number) ?? 0,
      tokens_saved: (usage?.['tokens_saved'] as number) ?? 0,
      storage_used_mb: parseFloat((usage?.['storage_used_mb'] as string) ?? '0'),
    };

    const calcPercentage = (used: number, limit: number): number => {
      if (limit === -1) return 0;
      if (limit === 0) return used > 0 ? 100 : 0;
      return Math.min(100, Math.round((used / limit) * 100));
    };

    return {
      usage: {
        executions: {
          used: currentUsage.executions,
          limit: planLimits['executions_per_day'] ?? 50,
          percentage: calcPercentage(
            currentUsage.executions,
            planLimits['executions_per_day'] ?? 50
          ),
        },
        traces: {
          used: currentUsage.traces_ingested,
          limit: planLimits['traces_per_day'] ?? 10,
          percentage: calcPercentage(
            currentUsage.traces_ingested,
            planLimits['traces_per_day'] ?? 10
          ),
        },
        api_requests: {
          used: currentUsage.api_requests,
          limit: planLimits['api_requests_per_day'] ?? 100,
          percentage: calcPercentage(
            currentUsage.api_requests,
            planLimits['api_requests_per_day'] ?? 100
          ),
        },
        storage_mb: {
          used: currentUsage.storage_used_mb,
          limit: planLimits['storage_mb'] ?? 100,
          percentage: calcPercentage(currentUsage.storage_used_mb, planLimits['storage_mb'] ?? 100),
        },
      },
      reset_at: 'Daily limits reset at midnight UTC',
    };
  });

  /**
   * Get usage history
   */
  app.get('/api/v1/usage/history', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const queryParams = request.query as { days?: string };
    const days = Math.min(90, parseInt(queryParams.days ?? '30', 10));

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const records = await query<Record<string, unknown>>(
      `SELECT date, executions, traces_ingested, api_requests, mcp_requests, tokens_saved, storage_used_mb
       FROM usage_records
       WHERE tenant_id = $1 AND date >= $2
       ORDER BY date ASC`,
      [auth.tenant_id, startDate.toISOString().split('T')[0]]
    );

    return {
      history: records.map((r) => ({
        date: r['date'],
        executions: r['executions'],
        traces_ingested: r['traces_ingested'],
        api_requests: r['api_requests'],
        mcp_requests: r['mcp_requests'],
        tokens_saved: r['tokens_saved'],
        storage_used_mb: parseFloat((r['storage_used_mb'] as string) ?? '0'),
      })),
    };
  });

  /**
   * Get aggregated usage stats
   */
  app.get('/api/v1/usage/stats', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const queryParams = request.query as { days?: string };
    const days = Math.min(90, parseInt(queryParams.days ?? '30', 10));

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await queryOne<Record<string, unknown>>(
      `SELECT
        COALESCE(SUM(executions), 0) as total_executions,
        COALESCE(SUM(traces_ingested), 0) as total_traces,
        COALESCE(SUM(api_requests), 0) as total_api_requests,
        COALESCE(SUM(tokens_saved), 0) as total_tokens_saved,
        COALESCE(AVG(executions), 0) as avg_daily_executions,
        COALESCE(AVG(api_requests), 0) as avg_daily_api_requests,
        COUNT(*) as days_with_activity
       FROM usage_records
       WHERE tenant_id = $1 AND date >= $2`,
      [auth.tenant_id, startDate.toISOString().split('T')[0]]
    );

    return {
      stats: {
        period_days: days,
        total_executions: parseInt(String(stats?.['total_executions'] ?? 0), 10),
        total_traces: parseInt(String(stats?.['total_traces'] ?? 0), 10),
        total_api_requests: parseInt(String(stats?.['total_api_requests'] ?? 0), 10),
        total_tokens_saved: parseInt(String(stats?.['total_tokens_saved'] ?? 0), 10),
        avg_daily_executions: parseFloat(String(stats?.['avg_daily_executions'] ?? 0)).toFixed(1),
        avg_daily_api_requests: parseFloat(String(stats?.['avg_daily_api_requests'] ?? 0)).toFixed(
          1
        ),
        days_with_activity: parseInt(String(stats?.['days_with_activity'] ?? 0), 10),
      },
    };
  });

  // ============================================
  // AUTHENTICATED: Invoices
  // ============================================

  /**
   * Get invoices
   */
  app.get('/api/v1/invoices', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const invoices = await query<Record<string, unknown>>(
      `SELECT id, amount_due, amount_paid, currency, status, period_start, period_end,
              due_date, paid_at, invoice_pdf_url, hosted_invoice_url, created_at
       FROM invoices
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 24`,
      [auth.tenant_id]
    );

    return {
      invoices: invoices.map((inv) => ({
        id: inv['id'],
        amount_due: inv['amount_due'],
        amount_paid: inv['amount_paid'],
        currency: inv['currency'],
        status: inv['status'],
        period_start: inv['period_start'],
        period_end: inv['period_end'],
        due_date: inv['due_date'],
        paid_at: inv['paid_at'],
        invoice_pdf_url: inv['invoice_pdf_url'],
        hosted_invoice_url: inv['hosted_invoice_url'],
        created_at: inv['created_at'],
        amount_formatted: `$${((inv['amount_due'] as number) / 100).toFixed(2)}`,
      })),
    };
  });

  // ============================================
  // AUTHENTICATED: Features Check
  // ============================================

  /**
   * Check if tenant has specific feature
   */
  app.get('/api/v1/features/:feature', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const { feature } = request.params as { feature: string };

    const result = await queryOne<{ has_feature: boolean }>(
      'SELECT tenant_has_feature($1, $2) as has_feature',
      [auth.tenant_id, feature]
    );

    return {
      feature,
      has_access: result?.has_feature ?? false,
    };
  });

  /**
   * Get all features for tenant
   */
  app.get('/api/v1/features', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const result = await queryOne<{ features: Record<string, boolean> }>(
      'SELECT get_tenant_features($1) as features',
      [auth.tenant_id]
    );

    return {
      features: result?.features ?? {},
    };
  });

  // ============================================
  // STRIPE: Webhook Handler
  // ============================================

  /**
   * Stripe webhook endpoint
   * Raw body is preserved by custom content-type parser in main app
   */
  app.post('/api/v1/stripe/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (!signature || typeof signature !== 'string') {
      return reply.code(400).send({ error: 'Missing Stripe signature' });
    }

    try {
      // Get raw body for signature verification
      const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;

      if (!rawBody) {
        return reply.code(400).send({ error: 'Missing raw body' });
      }

      // Construct and verify webhook event
      const event = constructWebhookEvent(rawBody, signature);

      // Handle the event
      await handleWebhookEvent(event);

      return { received: true, type: event.type };
    } catch (err) {
      console.error('Webhook error:', err);
      return reply.code(400).send({
        error: 'Webhook signature verification failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ============================================
  // STRIPE: Checkout Sessions
  // ============================================

  /**
   * Create a Stripe checkout session for subscription
   */
  app.post('/api/v1/billing/checkout', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const body = request.body as {
      planName: string;
      successUrl?: string;
      cancelUrl?: string;
      trialDays?: number;
    };

    if (!body.planName) {
      return reply.code(400).send({ error: 'planName is required' });
    }

    // Get user email
    const user = await queryOne<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [auth.user_id]
    );

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    try {
      const baseUrl = process.env['APP_URL'] ?? 'http://localhost:3000';

      const options: CreateCheckoutOptions = {
        tenantId: auth.tenant_id,
        email: user.email,
        planName: body.planName,
        successUrl: body.successUrl ?? `${baseUrl}/dashboard/billing?success=true`,
        cancelUrl: body.cancelUrl ?? `${baseUrl}/dashboard/billing?canceled=true`,
      };

      // Only add trialDays if provided
      if (body.trialDays !== undefined) {
        options.trialDays = body.trialDays;
      }

      const session = await createCheckoutSession(options);

      // Audit log
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, details, success, created_at)
         VALUES ($1, $2, $3, 'stripe.checkout.created', 'checkout_session', $4, $5, true, NOW())`,
        [
          `audit_${ulid()}`,
          auth.tenant_id,
          auth.user_id,
          session.id,
          JSON.stringify({ plan: body.planName }),
        ]
      );

      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (err) {
      console.error('Checkout session error:', err);
      return reply.code(500).send({
        error: 'Failed to create checkout session',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ============================================
  // STRIPE: Customer Portal
  // ============================================

  /**
   * Create a Stripe customer portal session
   */
  app.post('/api/v1/billing/portal', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const body = request.body as {
      returnUrl?: string;
    };

    try {
      const baseUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
      const returnUrl = body.returnUrl ?? `${baseUrl}/dashboard/billing`;

      const session = await createPortalSession(auth.tenant_id, returnUrl);

      // Audit log
      await query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, success, created_at)
         VALUES ($1, $2, $3, 'stripe.portal.created', 'portal_session', true, NOW())`,
        [`audit_${ulid()}`, auth.tenant_id, auth.user_id]
      );

      return {
        url: session.url,
      };
    } catch (err) {
      console.error('Portal session error:', err);
      return reply.code(500).send({
        error: 'Failed to create portal session',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ============================================
  // STRIPE: Invoice Access
  // ============================================

  /**
   * Get Stripe invoices from Stripe API (real-time data)
   */
  app.get('/api/v1/billing/stripe-invoices', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const queryParams = request.query as { limit?: string };
    const limit = Math.min(50, parseInt(queryParams.limit ?? '10', 10));

    // Get Stripe customer ID
    const subscription = await queryOne<{ stripe_customer_id: string }>(
      'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = $1 AND stripe_customer_id IS NOT NULL',
      [auth.tenant_id]
    );

    if (!subscription?.stripe_customer_id) {
      return { invoices: [], message: 'No Stripe customer found' };
    }

    try {
      const invoices = await getCustomerInvoices(subscription.stripe_customer_id, limit);

      return {
        invoices: invoices.map((inv) => ({
          id: inv.id,
          number: inv.number,
          amount_due: inv.amount_due,
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          status: inv.status,
          period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
          period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
          created: new Date(inv.created * 1000).toISOString(),
          invoice_pdf: inv.invoice_pdf,
          hosted_invoice_url: inv.hosted_invoice_url,
          amount_formatted: `$${(inv.amount_due / 100).toFixed(2)}`,
        })),
      };
    } catch (err) {
      console.error('Stripe invoices error:', err);
      return reply.code(500).send({
        error: 'Failed to fetch invoices',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * Get upcoming invoice (preview of next charge)
   */
  app.get('/api/v1/billing/upcoming-invoice', async (request, reply) => {
    const auth = await getAuthenticatedUser({
      cookies: request.cookies as Record<string, string> | undefined,
    });

    if (!auth) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Get Stripe customer and subscription IDs
    const subscription = await queryOne<{
      stripe_customer_id: string;
      stripe_subscription_id: string;
    }>(
      `SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions
       WHERE tenant_id = $1 AND stripe_customer_id IS NOT NULL`,
      [auth.tenant_id]
    );

    if (!subscription?.stripe_customer_id) {
      return { upcoming: null, message: 'No Stripe customer found' };
    }

    try {
      const upcoming = await getUpcomingInvoice(
        subscription.stripe_customer_id,
        subscription.stripe_subscription_id
      );

      if (!upcoming) {
        return { upcoming: null, message: 'No upcoming invoice' };
      }

      return {
        upcoming: {
          amount_due: upcoming.amount_due,
          currency: upcoming.currency,
          period_start: upcoming.period_start ? new Date(upcoming.period_start * 1000).toISOString() : null,
          period_end: upcoming.period_end ? new Date(upcoming.period_end * 1000).toISOString() : null,
          next_payment_attempt: upcoming.next_payment_attempt
            ? new Date(upcoming.next_payment_attempt * 1000).toISOString()
            : null,
          amount_formatted: `$${(upcoming.amount_due / 100).toFixed(2)}`,
          lines: upcoming.lines.data.map((line) => ({
            description: line.description,
            amount: line.amount,
            amount_formatted: `$${(line.amount / 100).toFixed(2)}`,
          })),
        },
      };
    } catch (err) {
      console.error('Upcoming invoice error:', err);
      return reply.code(500).send({
        error: 'Failed to fetch upcoming invoice',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
