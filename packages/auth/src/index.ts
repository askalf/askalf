// SUBSTRATE v1: Authentication Package
// Complete auth solution for the SUBSTRATE platform

// Types
export * from './types.js';

// Password utilities
export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  isValidPassword,
  generateSecureToken,
  generateSessionToken,
  generateApiKey,
  hashToken,
} from './password.js';

// User management
export {
  normalizeEmail,
  toSafeUser,
  createUser,
  getUserById,
  getUserByEmail,
  getSafeUserById,
  updateUser,
  deleteUser,
  hardDeleteUser,
  verifyEmail,
  resendEmailVerification,
  requestPasswordReset,
  resetPassword,
  changePassword,
  attemptLogin,
  suspendUser,
  unsuspendUser,
  updateUserRole,
  listUsersByTenant,
  countUsersByTenant,
  createAuditLog,
} from './users.js';

// Session management
export {
  createSession,
  validateSession,
  validateSessionWithUser,
  computeFingerprint,
  refreshSession,
  revokeSession,
  revokeSessionById,
  revokeAllUserSessions,
  revokeOtherSessions,
  listUserSessions,
  getSessionById,
  cleanupExpiredSessions,
  countUserSessions,
} from './sessions.js';

// API key management
export {
  toSafeApiKey,
  createApiKey,
  validateApiKey,
  getApiKeyById,
  getApiKeyByPrefix,
  revokeApiKey,
  revokeAllTenantApiKeys,
  revokeAllUserApiKeys,
  listApiKeysByTenant,
  listApiKeysByUser,
  countApiKeysByTenant,
  updateApiKey,
  hasScope,
  hasAllScopes,
  hasAnyScope,
  cleanupExpiredApiKeys,
} from './api-keys.js';

// Plan management
export {
  type Plan,
  type PlanLimits,
  type PlanFeatures,
  getActivePlans,
  getPlanById,
  getPlanByName,
  getFreePlan,
  canUpgrade,
  isDowngrade,
  formatMonthlyPrice,
  formatYearlyPrice,
  getYearlySavings,
  planHasFeature,
  getPlanLimit,
  isUnlimited,
  comparePlans,
} from './plans.js';

// Subscription management
export {
  type Subscription,
  type SubscriptionWithPlan,
  type SubscriptionStatus,
  createSubscription,
  getSubscriptionById,
  getActiveSubscription,
  getSubscriptionWithPlan,
  getTenantSubscriptions,
  changeSubscriptionPlan,
  cancelSubscription,
  reactivateSubscription,
  updateSubscriptionStatus,
  setStripeCustomerId,
  getSubscriptionByStripeId,
  getTenantLimits,
  getTenantFeatures,
  tenantHasFeature,
  tenantWithinLimit,
  isInTrial,
  getTrialDaysRemaining,
  willCancelAtPeriodEnd,
  processSubscriptionUpdates,
} from './subscriptions.js';

// Usage tracking
export {
  type UsageRecord,
  type UsageSummary,
  type UsageType,
  getOrCreateTodayUsage,
  incrementUsage,
  checkUsageLimit,
  tryIncrementUsage,
  getUsageForRange,
  getUsageSummary,
  getAggregatedUsage,
  updateStorageUsage,
  markLimitHit,
  getTenantsNearLimits,
  cleanupOldUsageRecords,
} from './usage.js';

// Middleware
export * from './middleware/index.js';
