// SUBSTRATE v1: Environmental Impact Calculations
// "AI Shouldn't Cost Us the Earth"
//
// These calculations estimate the environmental savings when a shard
// is executed instead of calling an LLM. Values are based on industry
// research on AI model resource consumption.

/**
 * Environmental impact constants per 1000 LLM tokens avoided.
 *
 * Sources:
 * - Water: Data center cooling requirements (~500ml per 1000 tokens)
 * - Power: GPU compute + cooling (~10Wh per 1000 tokens)
 * - Carbon: Varies by region/energy mix (~5g CO2 per 1000 tokens average)
 *
 * These are conservative estimates for typical LLM inference.
 */
export const ENVIRONMENTAL_CONSTANTS = {
  /** Milliliters of water saved per 1000 tokens avoided */
  WATER_ML_PER_1K_TOKENS: 500,

  /** Watt-hours of power saved per 1000 tokens avoided */
  POWER_WH_PER_1K_TOKENS: 10,

  /** Grams of CO2 saved per 1000 tokens avoided */
  CARBON_G_PER_1K_TOKENS: 5,

  /** Average tokens in a typical LLM request (input + output) */
  AVG_TOKENS_PER_REQUEST: 1000,

  /** Estimated tokens saved per shard execution (conservative) */
  DEFAULT_TOKENS_SAVED_PER_SHARD: 100,
} as const;

/**
 * Environmental impact metrics for a single operation.
 */
export interface EnvironmentalImpact {
  /** Number of LLM tokens avoided */
  tokensSaved: number;

  /** Milliliters of water saved */
  waterMlSaved: number;

  /** Watt-hours of power saved */
  powerWhSaved: number;

  /** Grams of CO2 saved */
  carbonGSaved: number;
}

/**
 * Cumulative environmental impact over time.
 */
export interface CumulativeEnvironmentalImpact extends EnvironmentalImpact {
  /** Total shard executions that saved resources */
  shardHits: number;

  /** Period start (for time-bound metrics) */
  periodStart?: Date;

  /** Period end (for time-bound metrics) */
  periodEnd?: Date;
}

/**
 * Calculate environmental savings from tokens avoided.
 *
 * @param tokensSaved - Number of LLM tokens that were avoided
 * @returns Environmental impact metrics
 *
 * @example
 * ```ts
 * const impact = calculateEnvironmentalImpact(500);
 * // Returns:
 * // {
 * //   tokensSaved: 500,
 * //   waterMlSaved: 250,  // 500/1000 * 500ml
 * //   powerWhSaved: 5,    // 500/1000 * 10Wh
 * //   carbonGSaved: 2.5   // 500/1000 * 5g
 * // }
 * ```
 */
export function calculateEnvironmentalImpact(tokensSaved: number): EnvironmentalImpact {
  const ratio = tokensSaved / 1000;

  return {
    tokensSaved,
    waterMlSaved: Math.round(ratio * ENVIRONMENTAL_CONSTANTS.WATER_ML_PER_1K_TOKENS),
    powerWhSaved: parseFloat((ratio * ENVIRONMENTAL_CONSTANTS.POWER_WH_PER_1K_TOKENS).toFixed(2)),
    carbonGSaved: parseFloat((ratio * ENVIRONMENTAL_CONSTANTS.CARBON_G_PER_1K_TOKENS).toFixed(2)),
  };
}

/**
 * Calculate environmental impact for a shard execution.
 * Uses per-shard token estimate if provided, otherwise default.
 *
 * @param estimatedTokens - Optional per-shard token estimate
 * @returns Environmental impact for a single shard hit
 */
export function calculateShardHitImpact(estimatedTokens?: number): EnvironmentalImpact {
  const tokens = estimatedTokens ?? ENVIRONMENTAL_CONSTANTS.DEFAULT_TOKENS_SAVED_PER_SHARD;
  return calculateEnvironmentalImpact(tokens);
}

/**
 * Aggregate multiple environmental impacts.
 *
 * @param impacts - Array of individual impacts to sum
 * @returns Combined environmental impact
 */
export function aggregateEnvironmentalImpacts(impacts: EnvironmentalImpact[]): CumulativeEnvironmentalImpact {
  const result: CumulativeEnvironmentalImpact = {
    tokensSaved: 0,
    waterMlSaved: 0,
    powerWhSaved: 0,
    carbonGSaved: 0,
    shardHits: impacts.length,
  };

  for (const impact of impacts) {
    result.tokensSaved += impact.tokensSaved;
    result.waterMlSaved += impact.waterMlSaved;
    result.powerWhSaved += impact.powerWhSaved;
    result.carbonGSaved += impact.carbonGSaved;
  }

  // Round floating point values
  result.powerWhSaved = parseFloat(result.powerWhSaved.toFixed(2));
  result.carbonGSaved = parseFloat(result.carbonGSaved.toFixed(2));

  return result;
}

/**
 * Format environmental impact for display.
 */
export interface FormattedEnvironmentalImpact {
  tokens: string;
  water: string;
  power: string;
  carbon: string;
}

/**
 * Format environmental impact with human-readable units.
 *
 * @param impact - Environmental impact to format
 * @returns Formatted strings with appropriate units
 *
 * @example
 * ```ts
 * const formatted = formatEnvironmentalImpact({ tokensSaved: 50000, waterMlSaved: 25000, ... });
 * // Returns:
 * // {
 * //   tokens: "50K tokens",
 * //   water: "25L",
 * //   power: "500 Wh",
 * //   carbon: "250g CO2"
 * // }
 * ```
 */
export function formatEnvironmentalImpact(impact: EnvironmentalImpact): FormattedEnvironmentalImpact {
  return {
    tokens: formatNumber(impact.tokensSaved, 'tokens'),
    water: formatWater(impact.waterMlSaved),
    power: formatPower(impact.powerWhSaved),
    carbon: formatCarbon(impact.carbonGSaved),
  };
}

/**
 * Format a number with K/M/B suffixes.
 */
function formatNumber(value: number, unit: string): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B ${unit}`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M ${unit}`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K ${unit}`;
  }
  return `${value} ${unit}`;
}

/**
 * Format water volume (ml to L/kL).
 */
function formatWater(ml: number): string {
  if (ml >= 1_000_000) {
    return `${(ml / 1_000_000).toFixed(1)} kL`;
  }
  if (ml >= 1_000) {
    return `${(ml / 1_000).toFixed(1)} L`;
  }
  return `${ml} mL`;
}

/**
 * Format power (Wh to kWh/MWh).
 */
function formatPower(wh: number): string {
  if (wh >= 1_000_000) {
    return `${(wh / 1_000_000).toFixed(2)} MWh`;
  }
  if (wh >= 1_000) {
    return `${(wh / 1_000).toFixed(2)} kWh`;
  }
  return `${wh.toFixed(1)} Wh`;
}

/**
 * Format carbon (g to kg/tonnes).
 */
function formatCarbon(g: number): string {
  if (g >= 1_000_000) {
    return `${(g / 1_000_000).toFixed(2)} tonnes CO2`;
  }
  if (g >= 1_000) {
    return `${(g / 1_000).toFixed(2)} kg CO2`;
  }
  return `${g.toFixed(1)}g CO2`;
}

/**
 * Real-world equivalents for environmental savings.
 * Used for making impact more tangible to users.
 */
export const EQUIVALENTS = {
  /** Liters of water for one glass of drinking water */
  WATER_GLASS_ML: 250,

  /** Liters of water for one shower (average) */
  WATER_SHOWER_ML: 65_000,

  /** Wh to charge a smartphone */
  POWER_PHONE_CHARGE_WH: 15,

  /** Wh for LED bulb for 1 hour */
  POWER_LED_HOUR_WH: 10,

  /** g CO2 from driving 1 km */
  CARBON_DRIVING_KM_G: 120,

  /** g CO2 from 1 Google search */
  CARBON_SEARCH_G: 0.2,
} as const;

/**
 * Calculate real-world equivalents for environmental savings.
 *
 * @param impact - Environmental impact
 * @returns Object with real-world equivalent values
 */
export function calculateEquivalents(impact: EnvironmentalImpact): {
  waterGlasses: number;
  waterShowers: number;
  phoneCharges: number;
  ledHours: number;
  drivingKm: number;
  googleSearches: number;
} {
  return {
    waterGlasses: Math.round(impact.waterMlSaved / EQUIVALENTS.WATER_GLASS_ML),
    waterShowers: parseFloat((impact.waterMlSaved / EQUIVALENTS.WATER_SHOWER_ML).toFixed(2)),
    phoneCharges: Math.round(impact.powerWhSaved / EQUIVALENTS.POWER_PHONE_CHARGE_WH),
    ledHours: Math.round(impact.powerWhSaved / EQUIVALENTS.POWER_LED_HOUR_WH),
    drivingKm: parseFloat((impact.carbonGSaved / EQUIVALENTS.CARBON_DRIVING_KM_G).toFixed(2)),
    googleSearches: Math.round(impact.carbonGSaved / EQUIVALENTS.CARBON_SEARCH_G),
  };
}

/**
 * Model tier definitions for access control.
 */
export const MODEL_TIERS = {
  demo: 1,
  free: 2,
  individual: 3,
  pro: 3,  // 'pro' is equivalent to 'individual' for model access
  basic: 3,  // 'basic' tier also maps to individual
  business: 4,
  team: 4,  // 'team' tier maps to business
  enterprise: 5,
  lifetime: 5,  // lifetime users get enterprise access
  system: 5,  // system tenants get full access
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;

/**
 * Check if a user tier has access to a model tier.
 *
 * @param userTier - The user's subscription tier
 * @param modelTier - The minimum tier required for the model
 * @returns True if user can access the model
 */
export function canAccessModel(userTier: ModelTier, modelTier: ModelTier): boolean {
  return MODEL_TIERS[userTier] >= MODEL_TIERS[modelTier];
}

/**
 * Get the display name for a tier.
 */
export function getTierDisplayName(tier: ModelTier): string {
  const names: Record<ModelTier, string> = {
    demo: 'Demo',
    free: 'Free',
    individual: 'Individual',
    pro: 'Pro',
    basic: 'Basic',
    business: 'Business',
    team: 'Team',
    enterprise: 'Enterprise',
    lifetime: 'Lifetime',
    system: 'System',
  };
  return names[tier];
}
