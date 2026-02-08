/**
 * SELF AI Configuration
 * Environment-based configuration
 */

export interface SelfConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  sessionSecret: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleAiKey?: string;
  nodeEnv: string;
  forgeDatabaseUrl: string;
}

export function loadConfig(): SelfConfig {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  const sessionSecret = process.env['SESSION_SECRET'];
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET environment variable is required and must be at least 32 characters');
  }

  const forgeDatabaseUrl = process.env['FORGE_DATABASE_URL'];
  if (!forgeDatabaseUrl) {
    throw new Error('FORGE_DATABASE_URL environment variable is required');
  }

  const config: SelfConfig = {
    port: parseInt(process.env['PORT'] ?? '3006', 10),
    databaseUrl,
    redisUrl,
    sessionSecret,
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    forgeDatabaseUrl,
  };

  if (process.env['ANTHROPIC_API_KEY']) config.anthropicApiKey = process.env['ANTHROPIC_API_KEY'];
  if (process.env['OPENAI_API_KEY']) config.openaiApiKey = process.env['OPENAI_API_KEY'];
  if (process.env['GOOGLE_AI_KEY']) config.googleAiKey = process.env['GOOGLE_AI_KEY'];

  return config;
}
