import { z } from 'zod';

// ===========================================
// TOKEN BUNDLES (Hybrid Billing Model)
// ===========================================

export const TokenBundleStatus = z.enum(['active', 'depleted', 'expired', 'refunded']);
export type TokenBundleStatus = z.infer<typeof TokenBundleStatus>;

export const TokenBundleType = z.enum(['standard', 'promotional', 'gift', 'enterprise']);
export type TokenBundleType = z.infer<typeof TokenBundleType>;

export const TokenBundleSchema = z.object({
  id: z.string(),
  tenantId: z.string(),

  // Purchase details
  tokensPurchased: z.number(),
  tokensRemaining: z.number(),
  priceUsd: z.number().optional(),

  // Metadata
  bundleType: TokenBundleType.default('standard'),
  purchasedAt: z.date(),
  expiresAt: z.date().optional(),

  // Payment integration
  stripePaymentId: z.string().optional(),
  stripeProductId: z.string().optional(),

  // Status
  status: TokenBundleStatus.default('active'),

  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TokenBundle = z.infer<typeof TokenBundleSchema>;

// ===========================================
// DEMO SESSIONS (Anonymous User Tracking)
// ===========================================

export const DemoSessionSchema = z.object({
  id: z.string(),

  // Session identification
  sessionToken: z.string(),
  fingerprint: z.string().optional(),
  ipHash: z.string().optional(),

  // Usage tracking
  interactionsUsed: z.number().default(0),
  maxInteractions: z.number().default(5),

  // Models used (for analytics)
  modelsUsed: z.array(z.string()).default([]),

  // Conversion tracking
  convertedToUserId: z.string().optional(),
  convertedAt: z.date().optional(),

  // Environmental impact (accumulated during demo)
  totalTokensSaved: z.number().default(0),
  totalWaterMlSaved: z.number().default(0),
  totalPowerWhSaved: z.number().default(0),
  totalCarbonGSaved: z.number().default(0),

  // Session metadata
  userAgent: z.string().optional(),
  referrer: z.string().optional(),
  landingPage: z.string().optional(),

  createdAt: z.date(),
  lastActiveAt: z.date(),
  expiresAt: z.date().optional(),
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;

// ===========================================
// MODEL ACCESS TIERS
// ===========================================

// Note: ModelTier type is defined in utils/environmental.ts to avoid duplication
// Import via: import { ModelTier, MODEL_TIERS } from '@askalf/core'

const ModelTierEnum = z.enum(['demo', 'free', 'individual', 'business', 'enterprise']);

export const AIProvider = z.enum(['openai', 'anthropic', 'google', 'xai', 'deepseek', 'ollama', 'lmstudio']);
export type AIProvider = z.infer<typeof AIProvider>;

export const ModelAccessTierSchema = z.object({
  id: z.string(),

  // Model identification
  provider: AIProvider,
  modelId: z.string(),
  displayName: z.string(),

  // Access tier (who can use)
  minTier: ModelTierEnum,

  // Cost info (per 1K tokens)
  inputCostPer1k: z.number().optional(),
  outputCostPer1k: z.number().optional(),

  // Flags
  isReasoningModel: z.boolean().default(false),
  isEmbeddingModel: z.boolean().default(false),
  isFastModel: z.boolean().default(false),

  // Status
  isActive: z.boolean().default(true),

  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ModelAccessTier = z.infer<typeof ModelAccessTierSchema>;

// ===========================================
// USER AI CONNECTORS (BYOK)
// ===========================================

export const ValidationStatus = z.enum(['unknown', 'valid', 'invalid', 'expired']);
export type ValidationStatus = z.infer<typeof ValidationStatus>;

export const UserAIConnectorSchema = z.object({
  id: z.string(),
  tenantId: z.string(),

  // Provider identification
  provider: AIProvider,

  // Credentials (encrypted in production)
  apiKeyEncrypted: z.string().optional(),
  apiKeyLast4: z.string().optional(),
  baseUrl: z.string().optional(), // For Ollama/custom endpoints

  // Preferences
  defaultModel: z.string().optional(),
  isEnabled: z.boolean().default(true),
  priority: z.number().default(0), // Higher = preferred

  // Validation
  lastValidatedAt: z.date().optional(),
  validationStatus: ValidationStatus.default('unknown'),
  validationError: z.string().optional(),

  createdAt: z.date(),
  updatedAt: z.date(),
});
export type UserAIConnector = z.infer<typeof UserAIConnectorSchema>;

// ===========================================
// GLOBAL COUNTERS
// ===========================================

export const GlobalCounterSchema = z.object({
  id: z.string(),
  counterName: z.string(),
  counterValue: z.number(),
  lastUpdated: z.date(),
});
export type GlobalCounter = z.infer<typeof GlobalCounterSchema>;

// ===========================================
// API REQUEST/RESPONSE TYPES
// ===========================================

// Demo session creation
export const CreateDemoSessionRequestSchema = z.object({
  fingerprint: z.string().optional(),
  userAgent: z.string().optional(),
  referrer: z.string().optional(),
  landingPage: z.string().optional(),
});
export type CreateDemoSessionRequest = z.infer<typeof CreateDemoSessionRequestSchema>;

export const DemoSessionResponseSchema = z.object({
  sessionToken: z.string(),
  interactionsRemaining: z.number(),
  maxInteractions: z.number(),
  expiresAt: z.string(),
});
export type DemoSessionResponse = z.infer<typeof DemoSessionResponseSchema>;

// Demo interaction
export const DemoInteractionRequestSchema = z.object({
  sessionToken: z.string(),
  message: z.string(),
  model: z.string().optional(), // Will default to demo-tier model
});
export type DemoInteractionRequest = z.infer<typeof DemoInteractionRequestSchema>;

export const DemoInteractionResponseSchema = z.object({
  response: z.string(),
  interactionsRemaining: z.number(),
  isShardHit: z.boolean(),
  environmental: z.object({
    tokensSaved: z.number(),
    waterMlSaved: z.number(),
    powerWhSaved: z.number(),
    carbonGSaved: z.number(),
  }).optional(),
  requiresSignup: z.boolean(),
});
export type DemoInteractionResponse = z.infer<typeof DemoInteractionResponseSchema>;

// Token bundle purchase
export const PurchaseTokenBundleRequestSchema = z.object({
  bundleSize: z.enum(['small', 'medium', 'large', 'xl']),
  paymentMethodId: z.string().optional(),
});
export type PurchaseTokenBundleRequest = z.infer<typeof PurchaseTokenBundleRequestSchema>;

// Model availability check
export const ModelAvailabilityResponseSchema = z.object({
  provider: AIProvider,
  modelId: z.string(),
  displayName: z.string(),
  isAvailable: z.boolean(),
  reason: z.string().optional(), // e.g., "Requires Business tier"
  isFastModel: z.boolean(),
  isReasoningModel: z.boolean(),
});
export type ModelAvailabilityResponse = z.infer<typeof ModelAvailabilityResponseSchema>;

// Environmental stats
export const EnvironmentalStatsResponseSchema = z.object({
  // User's personal stats
  personal: z.object({
    tokensSaved: z.number(),
    waterMlSaved: z.number(),
    powerWhSaved: z.number(),
    carbonGSaved: z.number(),
    shardHits: z.number(),
  }),
  // Global platform stats
  global: z.object({
    tokensSaved: z.number(),
    waterMlSaved: z.number(),
    powerWhSaved: z.number(),
    carbonGSaved: z.number(),
    shardHits: z.number(),
    totalUsers: z.number(),
  }),
  // Formatted for display
  formatted: z.object({
    personal: z.object({
      tokens: z.string(),
      water: z.string(),
      power: z.string(),
      carbon: z.string(),
    }),
    global: z.object({
      tokens: z.string(),
      water: z.string(),
      power: z.string(),
      carbon: z.string(),
    }),
  }),
});
export type EnvironmentalStatsResponse = z.infer<typeof EnvironmentalStatsResponseSchema>;

// ===========================================
// BUNDLE PRICING (Reference only - actual prices in Stripe)
// ===========================================

export const TOKEN_BUNDLE_SIZES = {
  small: {
    tokens: 10_000,
    priceUsd: 5,
    label: '10K Tokens',
    popular: false,
  },
  medium: {
    tokens: 50_000,
    priceUsd: 20,
    label: '50K Tokens',
    popular: true,
  },
  large: {
    tokens: 200_000,
    priceUsd: 60,
    label: '200K Tokens',
    popular: false,
  },
  xl: {
    tokens: 1_000_000,
    priceUsd: 200,
    label: '1M Tokens',
    popular: false,
  },
} as const;

export type TokenBundleSize = keyof typeof TOKEN_BUNDLE_SIZES;
