// SUBSTRATE v1: Subscription Management
// Subscription CRUD, upgrades, downgrades, and cancellations

import { ulid } from 'ulid';
import { query, queryOne } from '@substrate/database';
import { getPlanById, getFreePlan, type Plan, type PlanLimits, type PlanFeatures } from './plans.js';

/**
 * Subscription status
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

/**
 * Subscription record
 */
export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  trial_start: Date | null;
  trial_end: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  cancellation_reason: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Subscription with plan details
 */
export interface SubscriptionWithPlan extends Subscription {
  plan: Plan;
}

/**
 * Convert database row to Subscription
 */
function rowToSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    plan_id: row['plan_id'] as string,
    status: row['status'] as SubscriptionStatus,
    trial_start: row['trial_start'] ? new Date(row['trial_start'] as string) : null,
    trial_end: row['trial_end'] ? new Date(row['trial_end'] as string) : null,
    current_period_start: row['current_period_start']
      ? new Date(row['current_period_start'] as string)
      : null,
    current_period_end: row['current_period_end']
      ? new Date(row['current_period_end'] as string)
      : null,
    cancel_at_period_end: row['cancel_at_period_end'] as boolean,
    canceled_at: row['canceled_at'] ? new Date(row['canceled_at'] as string) : null,
    cancellation_reason: row['cancellation_reason'] as string | null,
    stripe_customer_id: row['stripe_customer_id'] as string | null,
    stripe_subscription_id: row['stripe_subscription_id'] as string | null,
    metadata: (row['metadata'] as Record<string, unknown>) ?? {},
    created_at: new Date(row['created_at'] as string),
    updated_at: new Date(row['updated_at'] as string),
  };
}

/**
 * Create a new subscription for a tenant
 */
export async function createSubscription(
  tenantId: string,
  planId: string,
  options?: {
    trialDays?: number;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Subscription> {
  const id = `sub_${ulid()}`;
  const now = new Date();

  let trialStart: Date | null = null;
  let trialEnd: Date | null = null;
  let status: SubscriptionStatus = 'active';

  if (options?.trialDays && options.trialDays > 0) {
    trialStart = now;
    trialEnd = new Date(now.getTime() + options.trialDays * 24 * 60 * 60 * 1000);
    status = 'trialing';
  }

  const sql = `
    INSERT INTO subscriptions (
      id, tenant_id, plan_id, status,
      trial_start, trial_end,
      current_period_start, current_period_end,
      stripe_customer_id, stripe_subscription_id,
      metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING *
  `;

  // Default period is 1 month
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const rows = await query<Record<string, unknown>>(sql, [
    id,
    tenantId,
    planId,
    status,
    trialStart,
    trialEnd,
    now,
    periodEnd,
    options?.stripeCustomerId ?? null,
    options?.stripeSubscriptionId ?? null,
    JSON.stringify(options?.metadata ?? {}),
  ]);

  if (!rows[0]) {
    throw new Error('Failed to create subscription');
  }

  return rowToSubscription(rows[0]);
}

/**
 * Get a subscription by ID
 */
export async function getSubscriptionById(id: string): Promise<Subscription | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM subscriptions WHERE id = $1',
    [id]
  );
  return row ? rowToSubscription(row) : null;
}

/**
 * Get active subscription for a tenant
 */
export async function getActiveSubscription(tenantId: string): Promise<Subscription | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM subscriptions
     WHERE tenant_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return row ? rowToSubscription(row) : null;
}

/**
 * Get subscription with plan details
 */
export async function getSubscriptionWithPlan(
  tenantId: string
): Promise<SubscriptionWithPlan | null> {
  const subscription = await getActiveSubscription(tenantId);
  if (!subscription) {
    return null;
  }

  const plan = await getPlanById(subscription.plan_id);
  if (!plan) {
    throw new Error(`Plan not found: ${subscription.plan_id}`);
  }

  return { ...subscription, plan };
}

/**
 * Get all subscriptions for a tenant (including canceled)
 */
export async function getTenantSubscriptions(tenantId: string): Promise<Subscription[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  return rows.map(rowToSubscription);
}

/**
 * Update subscription plan (upgrade/downgrade)
 */
export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanId: string,
  options?: {
    immediate?: boolean; // Apply immediately or at period end
    stripeSubscriptionId?: string;
  }
): Promise<Subscription> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const sql = `
    UPDATE subscriptions
    SET plan_id = $1,
        stripe_subscription_id = COALESCE($2, stripe_subscription_id),
        metadata = metadata || $3::jsonb,
        updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `;

  const metadata = {
    plan_changed_at: new Date().toISOString(),
    previous_plan_id: subscription.plan_id,
  };

  const rows = await query<Record<string, unknown>>(sql, [
    newPlanId,
    options?.stripeSubscriptionId ?? null,
    JSON.stringify(metadata),
    subscriptionId,
  ]);

  if (!rows[0]) {
    throw new Error('Failed to update subscription');
  }

  return rowToSubscription(rows[0]);
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(
  subscriptionId: string,
  options?: {
    immediate?: boolean;
    reason?: string;
  }
): Promise<Subscription> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const sql = options?.immediate
    ? `UPDATE subscriptions
       SET status = 'canceled',
           cancel_at_period_end = false,
           canceled_at = NOW(),
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`
    : `UPDATE subscriptions
       SET cancel_at_period_end = true,
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`;

  const rows = await query<Record<string, unknown>>(sql, [
    options?.reason ?? 'user_requested',
    subscriptionId,
  ]);

  if (!rows[0]) {
    throw new Error('Failed to cancel subscription');
  }

  return rowToSubscription(rows[0]);
}

/**
 * Reactivate a canceled subscription (if not yet expired)
 */
export async function reactivateSubscription(subscriptionId: string): Promise<Subscription> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new Error('Subscription not found');
  }

  if (subscription.status === 'canceled' && subscription.current_period_end) {
    // Can only reactivate if within the billing period
    if (new Date() > subscription.current_period_end) {
      throw new Error('Subscription has expired and cannot be reactivated');
    }
  }

  const sql = `
    UPDATE subscriptions
    SET status = 'active',
        cancel_at_period_end = false,
        canceled_at = NULL,
        cancellation_reason = NULL,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, [subscriptionId]);

  if (!rows[0]) {
    throw new Error('Failed to reactivate subscription');
  }

  return rowToSubscription(rows[0]);
}

/**
 * Update subscription status (for Stripe webhooks)
 */
export async function updateSubscriptionStatus(
  subscriptionId: string,
  status: SubscriptionStatus,
  options?: {
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    stripeSubscriptionId?: string;
  }
): Promise<Subscription> {
  const updates: string[] = ['status = $1'];
  const params: unknown[] = [status];
  let paramIndex = 2;

  if (options?.currentPeriodStart) {
    updates.push(`current_period_start = $${paramIndex}`);
    params.push(options.currentPeriodStart);
    paramIndex++;
  }

  if (options?.currentPeriodEnd) {
    updates.push(`current_period_end = $${paramIndex}`);
    params.push(options.currentPeriodEnd);
    paramIndex++;
  }

  if (options?.stripeSubscriptionId) {
    updates.push(`stripe_subscription_id = $${paramIndex}`);
    params.push(options.stripeSubscriptionId);
    paramIndex++;
  }

  params.push(subscriptionId);

  const sql = `
    UPDATE subscriptions
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const rows = await query<Record<string, unknown>>(sql, params);

  if (!rows[0]) {
    throw new Error('Failed to update subscription status');
  }

  return rowToSubscription(rows[0]);
}

/**
 * Set Stripe customer ID for subscription
 */
export async function setStripeCustomerId(
  subscriptionId: string,
  stripeCustomerId: string
): Promise<void> {
  await query(
    'UPDATE subscriptions SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
    [stripeCustomerId, subscriptionId]
  );
}

/**
 * Get subscription by Stripe subscription ID
 */
export async function getSubscriptionByStripeId(
  stripeSubscriptionId: string
): Promise<Subscription | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubscriptionId]
  );
  return row ? rowToSubscription(row) : null;
}

/**
 * Get tenant limits (from active subscription or free plan)
 */
export async function getTenantLimits(tenantId: string): Promise<PlanLimits> {
  const row = await queryOne<{ limits: PlanLimits }>(
    'SELECT get_tenant_limits($1) as limits',
    [tenantId]
  );
  return row?.limits ?? (await getFreePlan()).limits;
}

/**
 * Get tenant features (from active subscription or free plan)
 */
export async function getTenantFeatures(tenantId: string): Promise<PlanFeatures> {
  const row = await queryOne<{ features: PlanFeatures }>(
    'SELECT get_tenant_features($1) as features',
    [tenantId]
  );
  return row?.features ?? (await getFreePlan()).features;
}

/**
 * Check if tenant has a specific feature
 */
export async function tenantHasFeature(
  tenantId: string,
  feature: keyof PlanFeatures
): Promise<boolean> {
  const row = await queryOne<{ has_feature: boolean }>(
    'SELECT tenant_has_feature($1, $2) as has_feature',
    [tenantId, feature]
  );
  return row?.has_feature ?? false;
}

/**
 * Check if tenant is within a specific limit
 */
export async function tenantWithinLimit(
  tenantId: string,
  limitType: keyof PlanLimits,
  currentCount: number
): Promise<boolean> {
  const row = await queryOne<{ within_limit: boolean }>(
    'SELECT tenant_within_limit($1, $2, $3) as within_limit',
    [tenantId, limitType, currentCount]
  );
  return row?.within_limit ?? false;
}

/**
 * Check if subscription is in trial
 */
export function isInTrial(subscription: Subscription): boolean {
  return subscription.status === 'trialing' &&
         subscription.trial_end !== null &&
         new Date() < subscription.trial_end;
}

/**
 * Get days remaining in trial
 */
export function getTrialDaysRemaining(subscription: Subscription): number {
  if (!isInTrial(subscription) || !subscription.trial_end) {
    return 0;
  }
  const remaining = subscription.trial_end.getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

/**
 * Check if subscription will cancel at period end
 */
export function willCancelAtPeriodEnd(subscription: Subscription): boolean {
  return subscription.cancel_at_period_end;
}

/**
 * Process subscriptions that need status updates (for cron job)
 */
export async function processSubscriptionUpdates(): Promise<{
  trialsEnded: number;
  periodsExpired: number;
}> {
  // End trials that have expired
  const trialsResult = await query<{ id: string }>(
    `UPDATE subscriptions
     SET status = 'active', trial_start = NULL, trial_end = NULL, updated_at = NOW()
     WHERE status = 'trialing' AND trial_end <= NOW()
     RETURNING id`
  );

  // Cancel subscriptions that were scheduled to cancel
  const cancelResult = await query<{ id: string }>(
    `UPDATE subscriptions
     SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
     WHERE cancel_at_period_end = true
       AND current_period_end <= NOW()
       AND status != 'canceled'
     RETURNING id`
  );

  return {
    trialsEnded: trialsResult.length,
    periodsExpired: cancelResult.length,
  };
}
