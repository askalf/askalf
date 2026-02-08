// SUBSTRATE v1: Plan Management
// Plan CRUD operations and feature checks

import { query, queryOne } from '@substrate/database';

/**
 * Plan limits structure
 */
export interface PlanLimits {
  executions_per_day: number;
  traces_per_day: number;
  private_shards: number;
  api_requests_per_day: number;
  mcp_connections: number;
  mcp_requests_per_minute: number;
  team_members: number;
  storage_mb: number;
}

/**
 * Plan features structure
 */
export interface PlanFeatures {
  public_shards: boolean;
  private_shards: boolean;
  mcp_access: boolean;
  api_access: boolean;
  team_management: boolean;
  priority_support: boolean;
  custom_integrations?: boolean;
  sla?: boolean;
  dedicated_support?: boolean;
}

/**
 * Plan record from database
 */
export interface Plan {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  limits: PlanLimits;
  features: PlanFeatures;
  sort_order: number;
  is_featured: boolean;
  is_active: boolean;
  stripe_price_monthly_id: string | null;
  stripe_price_yearly_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Convert database row to Plan
 */
function rowToPlan(row: Record<string, unknown>): Plan {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    display_name: row['display_name'] as string,
    description: row['description'] as string | null,
    price_monthly: row['price_monthly'] as number | null,
    price_yearly: row['price_yearly'] as number | null,
    limits: row['limits'] as PlanLimits,
    features: row['features'] as PlanFeatures,
    sort_order: row['sort_order'] as number,
    is_featured: row['is_featured'] as boolean,
    is_active: row['is_active'] as boolean,
    stripe_price_monthly_id: row['stripe_price_monthly_id'] as string | null,
    stripe_price_yearly_id: row['stripe_price_yearly_id'] as string | null,
    created_at: new Date(row['created_at'] as string),
    updated_at: new Date(row['updated_at'] as string),
  };
}

/**
 * Get all active plans
 */
export async function getActivePlans(): Promise<Plan[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC'
  );
  return rows.map(rowToPlan);
}

/**
 * Get a plan by ID
 */
export async function getPlanById(id: string): Promise<Plan | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM plans WHERE id = $1',
    [id]
  );
  return row ? rowToPlan(row) : null;
}

/**
 * Get a plan by name
 */
export async function getPlanByName(name: string): Promise<Plan | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM plans WHERE name = $1',
    [name]
  );
  return row ? rowToPlan(row) : null;
}

/**
 * Get the free plan
 */
export async function getFreePlan(): Promise<Plan> {
  const plan = await getPlanByName('free');
  if (!plan) {
    throw new Error('Free plan not found in database');
  }
  return plan;
}

/**
 * Check if a plan allows upgrade to target plan
 */
export function canUpgrade(currentPlan: Plan, targetPlan: Plan): boolean {
  // Can't upgrade to the same plan
  if (currentPlan.id === targetPlan.id) {
    return false;
  }
  // Can upgrade if target plan has higher sort order (more expensive)
  return targetPlan.sort_order > currentPlan.sort_order;
}

/**
 * Check if plan is a downgrade
 */
export function isDowngrade(currentPlan: Plan, targetPlan: Plan): boolean {
  return targetPlan.sort_order < currentPlan.sort_order;
}

/**
 * Get monthly price formatted
 */
export function formatMonthlyPrice(plan: Plan): string {
  if (plan.price_monthly === null) {
    return plan.name === 'enterprise' ? 'Contact us' : 'Free';
  }
  return `$${(plan.price_monthly / 100).toFixed(2)}/mo`;
}

/**
 * Get yearly price formatted
 */
export function formatYearlyPrice(plan: Plan): string {
  if (plan.price_yearly === null) {
    return plan.name === 'enterprise' ? 'Contact us' : 'Free';
  }
  return `$${(plan.price_yearly / 100).toFixed(2)}/yr`;
}

/**
 * Calculate yearly savings percentage
 */
export function getYearlySavings(plan: Plan): number {
  if (plan.price_monthly === null || plan.price_yearly === null) {
    return 0;
  }
  const monthlyTotal = plan.price_monthly * 12;
  const savings = ((monthlyTotal - plan.price_yearly) / monthlyTotal) * 100;
  return Math.round(savings);
}

/**
 * Check if a plan has a specific feature
 */
export function planHasFeature(plan: Plan, feature: keyof PlanFeatures): boolean {
  return plan.features[feature] === true;
}

/**
 * Get limit value from plan (-1 means unlimited)
 */
export function getPlanLimit(plan: Plan, limit: keyof PlanLimits): number {
  return plan.limits[limit];
}

/**
 * Check if limit is unlimited (-1)
 */
export function isUnlimited(plan: Plan, limit: keyof PlanLimits): boolean {
  return plan.limits[limit] === -1;
}

/**
 * Compare two plans for display (returns comparison data)
 */
export function comparePlans(planA: Plan, planB: Plan): {
  limitComparisons: Array<{ name: string; planA: string; planB: string }>;
  featureComparisons: Array<{ name: string; planA: boolean; planB: boolean }>;
} {
  const limitKeys: Array<keyof PlanLimits> = [
    'executions_per_day',
    'traces_per_day',
    'private_shards',
    'api_requests_per_day',
    'mcp_connections',
    'mcp_requests_per_minute',
    'team_members',
    'storage_mb',
  ];

  const featureKeys: Array<keyof PlanFeatures> = [
    'public_shards',
    'private_shards',
    'mcp_access',
    'api_access',
    'team_management',
    'priority_support',
  ];

  const formatLimit = (value: number): string => {
    if (value === -1) return 'Unlimited';
    if (value === 0) return 'Not included';
    return value.toLocaleString();
  };

  const formatLimitName = (key: string): string => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return {
    limitComparisons: limitKeys.map((key) => ({
      name: formatLimitName(key),
      planA: formatLimit(planA.limits[key]),
      planB: formatLimit(planB.limits[key]),
    })),
    featureComparisons: featureKeys.map((key) => ({
      name: formatLimitName(key),
      planA: planA.features[key] ?? false,
      planB: planB.features[key] ?? false,
    })),
  };
}
