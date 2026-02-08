/**
 * Unified Billing Service
 * Handles subscription limits, token bundles, and BYOK
 *
 * Flow:
 * 1. Check if user has BYOK configured → unlimited
 * 2. Check daily message limit from subscription
 * 3. If limit exceeded, check bundle tokens
 * 4. Deduct from appropriate source
 */

import { query, queryOne } from '@substrate/database';

// Credit bundle package definitions (matches pricing page)
export const TOKEN_PACKAGES = {
  starter: {
    id: 'starter',
    name: '100 Credits',
    tokens: 100,
    price: 2.0,
    priceFormatted: '$2',
    description: '100 credits at $0.02 each',
    rate: '$0.02/credit',
    popular: false,
  },
  small: {
    id: 'small',
    name: '500 Credits',
    tokens: 500,
    price: 5.0,
    priceFormatted: '$5',
    description: '500 credits at $0.01 each',
    rate: '$0.01/credit',
    popular: false,
  },
  medium: {
    id: 'medium',
    name: '2,500 Credits',
    tokens: 2500,
    price: 20.0,
    priceFormatted: '$20',
    description: '2,500 credits at $0.008 each',
    rate: '$0.008/credit',
    popular: true,
  },
  large: {
    id: 'large',
    name: '10,000 Credits',
    tokens: 10000,
    price: 60.0,
    priceFormatted: '$60',
    description: '10,000 credits at $0.006 each',
    rate: '$0.006/credit',
    popular: false,
  },
  xlarge: {
    id: 'xlarge',
    name: '50,000 Credits',
    tokens: 50000,
    price: 250.0,
    priceFormatted: '$250',
    description: '50,000 credits at $0.005 each',
    rate: '$0.005/credit',
    popular: false,
  },
} as const;

export type PackageId = keyof typeof TOKEN_PACKAGES;

export interface UsageCheckResult {
  canProceed: boolean;
  source: 'subscription' | 'bundle' | 'byok' | 'none';
  reason: string;
  usage: {
    dailyUsed: number;
    dailyLimit: number;
    bundleTokens: number;
    hasByok: boolean;
  };
  suggestUpgrade: boolean;
  suggestBundle: boolean;
}

export interface TokenBundle {
  id: string;
  tenantId: string;
  tokensPurchased: number;
  tokensRemaining: number;
  priceUsd: number;
  bundleType: string;
  status: 'active' | 'depleted' | 'expired' | 'refunded';
  purchasedAt: Date;
  expiresAt: Date | null;
  stripePaymentId: string | null;
}

/**
 * Check if user can send a message and determine billing source
 */
export async function checkUsageAndBilling(
  tenantId: string,
  provider: string,
  estimatedTokens: number = 1000
): Promise<UsageCheckResult> {
  // 1. Check if user has BYOK for this provider
  const byokKey = await queryOne<{ id: string }>(
    `SELECT id FROM user_ai_connectors
     WHERE tenant_id = $1 AND provider = $2 AND is_enabled = TRUE
     AND api_key_encrypted IS NOT NULL`,
    [tenantId, provider]
  );

  if (byokKey) {
    return {
      canProceed: true,
      source: 'byok',
      reason: 'Using your own API key',
      usage: {
        dailyUsed: 0,
        dailyLimit: -1,
        bundleTokens: 0,
        hasByok: true,
      },
      suggestUpgrade: false,
      suggestBundle: false,
    };
  }

  // 2. Get daily usage (use credits for paid plans, messages for free)
  const usageResult = await queryOne<{
    messages_sent: number;
    messages_limit: number;
    credits_used: number;
    credits_limit: number;
  }>(
    `SELECT messages_sent, messages_limit, credits_used, credits_limit
     FROM get_or_create_daily_usage($1)`,
    [tenantId]
  );

  // Use credits if credits_limit > 0 (paid plans), otherwise use messages (free tier)
  const useCredits = (usageResult?.credits_limit ?? 0) > 0;
  const dailyUsed = useCredits ? (usageResult?.credits_used ?? 0) : (usageResult?.messages_sent ?? 0);
  const dailyLimit = useCredits ? (usageResult?.credits_limit ?? 0) : (usageResult?.messages_limit ?? 20);

  // 3. Get bundle balance
  const bundleResult = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(tokens_remaining), 0) as total
     FROM token_bundles
     WHERE tenant_id = $1
       AND status = 'active'
       AND tokens_remaining > 0
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [tenantId]
  );

  const bundleTokens = bundleResult?.total ?? 0;

  // 4. Check if within daily limit
  if (dailyLimit === -1 || dailyUsed < dailyLimit) {
    return {
      canProceed: true,
      source: 'subscription',
      reason: 'Within daily limit',
      usage: {
        dailyUsed,
        dailyLimit,
        bundleTokens,
        hasByok: false,
      },
      suggestUpgrade: dailyUsed >= dailyLimit * 0.8, // Suggest at 80%
      suggestBundle: false,
    };
  }

  // 5. Daily limit exceeded - check bundles
  if (bundleTokens >= estimatedTokens) {
    return {
      canProceed: true,
      source: 'bundle',
      reason: 'Using token bundle (daily limit exceeded)',
      usage: {
        dailyUsed,
        dailyLimit,
        bundleTokens,
        hasByok: false,
      },
      suggestUpgrade: true,
      suggestBundle: bundleTokens < estimatedTokens * 5, // Suggest if low
    };
  }

  // 6. No tokens available
  return {
    canProceed: false,
    source: 'none',
    reason:
      bundleTokens > 0
        ? `Daily limit reached. You have ${bundleTokens.toLocaleString()} bundle tokens but need ~${estimatedTokens.toLocaleString()}.`
        : 'Daily limit reached and no token bundles available.',
    usage: {
      dailyUsed,
      dailyLimit,
      bundleTokens,
      hasByok: false,
    },
    suggestUpgrade: true,
    suggestBundle: true,
  };
}

/**
 * Record usage after successful message
 */
export async function recordUsage(
  tenantId: string,
  source: 'subscription' | 'bundle' | 'byok',
  tokensUsed: number,
  usedPlatformKey: boolean = false,
  routingTier?: string
): Promise<void> {
  if (source === 'byok') {
    // BYOK usage - just track for analytics, no limits
    await query(
      `INSERT INTO usage_analytics (tenant_id, source, tokens_used, created_at)
       VALUES ($1, 'byok', $2, NOW())
       ON CONFLICT DO NOTHING`,
      [tenantId, tokensUsed]
    ).catch(() => {
      // Analytics table might not exist yet, ignore
    });
    return;
  }

  if (source === 'subscription') {
    // Increment daily usage counter (messages_sent, credits_used, tokens_consumed)
    // Credit cost determined by routing tier: nano=1, pro=2, reasoning=10
    await query(`SELECT increment_usage($1, $2, $3, $4)`, [tenantId, tokensUsed, usedPlatformKey, routingTier || 'nano']);
    return;
  }

  if (source === 'bundle') {
    // Deduct from bundles (FIFO - oldest first)
    await query(`SELECT * FROM deduct_tokens($1, $2)`, [tenantId, tokensUsed]);
    return;
  }
}

/**
 * Get user's token bundle balance
 */
export async function getBundleBalance(tenantId: string): Promise<{
  totalRemaining: number;
  bundles: Array<{
    id: string;
    tokensRemaining: number;
    expiresAt: Date | null;
    bundleType: string;
  }>;
}> {
  const result = await query<{
    id: string;
    tokens_remaining: number;
    expires_at: string | null;
    bundle_type: string;
  }>(
    `SELECT id, tokens_remaining, expires_at, bundle_type
     FROM token_bundles
     WHERE tenant_id = $1
       AND status = 'active'
       AND tokens_remaining > 0
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at ASC`,
    [tenantId]
  );

  const bundles = result.map((row) => ({
    id: row.id,
    tokensRemaining: row.tokens_remaining,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    bundleType: row.bundle_type,
  }));

  const totalRemaining = bundles.reduce((sum, b) => sum + b.tokensRemaining, 0);

  return { totalRemaining, bundles };
}

/**
 * Purchase a token bundle
 */
export async function purchaseBundle(
  tenantId: string,
  packageId: PackageId,
  options?: {
    stripePaymentId?: string;
    expiresInDays?: number;
    bundleType?: 'standard' | 'promotional' | 'gift';
  }
): Promise<TokenBundle> {
  const pkg = TOKEN_PACKAGES[packageId];
  if (!pkg) {
    throw new Error(`Invalid package: ${packageId}`);
  }

  const expiresAt = options?.expiresInDays
    ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const result = await queryOne<{
    id: string;
    tenant_id: string;
    tokens_purchased: number;
    tokens_remaining: number;
    price_usd: string;
    bundle_type: string;
    status: string;
    created_at: string;
    expires_at: string | null;
    stripe_payment_id: string | null;
  }>(
    `INSERT INTO token_bundles (
      id, tenant_id, tokens_purchased, tokens_remaining, price_usd,
      bundle_type, expires_at, stripe_payment_id, status
    ) VALUES (
      gen_random_uuid()::text, $1, $2, $2, $3, $4, $5, $6, 'active'
    ) RETURNING *`,
    [
      tenantId,
      pkg.tokens,
      pkg.price,
      options?.bundleType || 'standard',
      expiresAt,
      options?.stripePaymentId || null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create bundle');
  }

  return {
    id: result.id,
    tenantId: result.tenant_id,
    tokensPurchased: result.tokens_purchased,
    tokensRemaining: result.tokens_remaining,
    priceUsd: parseFloat(result.price_usd),
    bundleType: result.bundle_type,
    status: result.status as TokenBundle['status'],
    purchasedAt: new Date(result.created_at),
    expiresAt: result.expires_at ? new Date(result.expires_at) : null,
    stripePaymentId: result.stripe_payment_id,
  };
}

/**
 * Grant free tokens (promotional, gift, admin grant)
 */
export async function grantTokens(
  tenantId: string,
  tokens: number,
  reason: string,
  expiresInDays: number = 30
): Promise<TokenBundle> {
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const result = await queryOne<{
    id: string;
    tenant_id: string;
    tokens_purchased: number;
    tokens_remaining: number;
    price_usd: string;
    bundle_type: string;
    status: string;
    created_at: string;
    expires_at: string | null;
    stripe_payment_id: string | null;
  }>(
    `INSERT INTO token_bundles (
      id, tenant_id, tokens_purchased, tokens_remaining, price_usd,
      bundle_type, expires_at, status
    ) VALUES (
      gen_random_uuid()::text, $1, $2, $2, 0, 'promotional', $3, 'active'
    ) RETURNING *`,
    [tenantId, tokens, expiresAt]
  );

  if (!result) {
    throw new Error('Failed to grant tokens');
  }

  return {
    id: result.id,
    tenantId: result.tenant_id,
    tokensPurchased: result.tokens_purchased,
    tokensRemaining: result.tokens_remaining,
    priceUsd: parseFloat(result.price_usd),
    bundleType: result.bundle_type,
    status: result.status as TokenBundle['status'],
    purchasedAt: new Date(result.created_at),
    expiresAt: result.expires_at ? new Date(result.expires_at) : null,
    stripePaymentId: result.stripe_payment_id,
  };
}

/**
 * Get bundle purchase history
 */
export async function getBundleHistory(tenantId: string): Promise<TokenBundle[]> {
  const result = await query<{
    id: string;
    tenant_id: string;
    tokens_purchased: number;
    tokens_remaining: number;
    price_usd: string;
    bundle_type: string;
    status: string;
    created_at: string;
    expires_at: string | null;
    stripe_payment_id: string | null;
  }>(
    `SELECT * FROM token_bundles
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [tenantId]
  );

  return result.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tokensPurchased: row.tokens_purchased,
    tokensRemaining: row.tokens_remaining,
    priceUsd: parseFloat(row.price_usd),
    bundleType: row.bundle_type,
    status: row.status as TokenBundle['status'],
    purchasedAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    stripePaymentId: row.stripe_payment_id,
  }));
}

/**
 * Get available packages
 */
export function getPackages() {
  return Object.values(TOKEN_PACKAGES);
}

/**
 * Get a specific package
 */
export function getPackage(packageId: PackageId) {
  return TOKEN_PACKAGES[packageId] || null;
}

/**
 * Get platform key for free tier users
 */
export async function getPlatformKey(
  provider: 'openai' | 'anthropic'
): Promise<{ keyId: string; apiKey: string } | null> {
  const result = await queryOne<{ key_id: string; api_key_encrypted: string }>(
    `SELECT * FROM get_platform_key($1)`,
    [provider]
  );

  if (!result?.key_id) {
    return null;
  }

  // Decrypt API key using AES-256-CBC
  const encryptionKey = process.env['ENCRYPTION_KEY'];
  if (!encryptionKey) {
    console.error('ENCRYPTION_KEY not configured');
    return null;
  }

  try {
    const crypto = await import('crypto');
    const [ivHex, encryptedHex] = result.api_key_encrypted.split(':');
    if (!ivHex || !encryptedHex) {
      // Key might not be encrypted (legacy)
      return {
        keyId: result.key_id,
        apiKey: result.api_key_encrypted,
      };
    }
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return {
      keyId: result.key_id,
      apiKey: decrypted.toString('utf8'),
    };
  } catch (err) {
    console.error('Failed to decrypt platform key:', err);
    return null;
  }
}

/**
 * Record platform key usage
 */
export async function recordPlatformKeyUsage(keyId: string, tokensUsed: number): Promise<void> {
  await query(`SELECT record_platform_key_usage($1, $2)`, [keyId, tokensUsed]);
}

/**
 * Get user's tier
 */
export async function getUserTier(tenantId: string): Promise<string> {
  const result = await queryOne<{ tier: string }>(`SELECT tier FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  return result?.tier || 'free';
}

/**
 * Get available models for user's tier
 */
export async function getAvailableModels(
  tierName: string
): Promise<
  Array<{
    provider: string;
    modelId: string;
    displayName: string;
    isFastModel: boolean;
    isReasoningModel: boolean;
    minTier: string;
  }>
> {
  const TIER_RANK: Record<string, number> = {
    demo: 1,
    free: 2,
    individual: 3,
    business: 4,
    enterprise: 5,
  };

  const result = await query<{
    provider: string;
    model_id: string;
    display_name: string;
    is_fast_model: boolean;
    is_reasoning_model: boolean;
    min_tier: string;
  }>(
    `SELECT provider, model_id, display_name, is_fast_model, is_reasoning_model, min_tier
     FROM model_access_tiers
     WHERE is_active = TRUE
     ORDER BY provider, display_name`
  );

  const tierRank = TIER_RANK[tierName] ?? TIER_RANK['free'] ?? 2;

  return result
    .filter((model) => {
      const modelRank = TIER_RANK[model.min_tier] ?? TIER_RANK['enterprise'] ?? 5;
      return (tierRank ?? 2) >= (modelRank ?? 5);
    })
    .map((model) => ({
      provider: model.provider,
      modelId: model.model_id,
      displayName: model.display_name,
      isFastModel: model.is_fast_model,
      isReasoningModel: model.is_reasoning_model,
      minTier: model.min_tier,
    }));
}

export default {
  checkUsageAndBilling,
  recordUsage,
  getBundleBalance,
  purchaseBundle,
  grantTokens,
  getBundleHistory,
  getPackages,
  getPackage,
  getPlatformKey,
  recordPlatformKeyUsage,
  getUserTier,
  getAvailableModels,
  TOKEN_PACKAGES,
};
