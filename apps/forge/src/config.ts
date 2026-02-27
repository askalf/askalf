/**
 * Forge Configuration
 * Environment-based configuration for all forge services
 */

export interface ForgeConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  anthropicApiKey?: string;
  anthropicApiKeyFallback?: string;
  openaiApiKey?: string;
  googleAiKey?: string;
  nodeEnv: string;
  maxExecutionIterations: number;
  maxTokensPerTurn: number;
  defaultMaxCostPerExecution: number;
  // CLI execution settings
  maxCliConcurrency: number;
  cliTimeout: number;
  cliMaxTurns: number;
  cliBudgetUsd: string;
  substrateDatabaseUrl?: string;
}

export function loadConfig(): ForgeConfig {
  const databaseUrl = process.env['FORGE_DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('FORGE_DATABASE_URL environment variable is required');
  }

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  return {
    port: parseInt(process.env['PORT'] ?? '3005', 10),
    databaseUrl,
    redisUrl,
    jwtSecret,
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    anthropicApiKeyFallback: process.env['ANTHROPIC_API_KEY_FALLBACK'],
    openaiApiKey: process.env['OPENAI_API_KEY'],
    googleAiKey: process.env['GOOGLE_AI_KEY'],
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    maxExecutionIterations: parseInt(process.env['MAX_EXECUTION_ITERATIONS'] ?? '25', 10),
    maxTokensPerTurn: parseInt(process.env['MAX_TOKENS_PER_TURN'] ?? '8192', 10),
    defaultMaxCostPerExecution: parseFloat(process.env['DEFAULT_MAX_COST_PER_EXECUTION'] ?? '1.00'),
    // CLI execution
    maxCliConcurrency: parseInt(process.env['MAX_CLI_CONCURRENCY'] ?? '2', 10),
    cliTimeout: parseInt(process.env['CLI_TIMEOUT'] ?? '900000', 10),
    cliMaxTurns: parseInt(process.env['CLI_MAX_TURNS'] ?? '15', 10),
    cliBudgetUsd: process.env['CLI_BUDGET_USD'] ?? '0.50',
    substrateDatabaseUrl: process.env['SUBSTRATE_DATABASE_URL'] || databaseUrl,
  };
}
