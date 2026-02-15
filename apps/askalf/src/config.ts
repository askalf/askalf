/**
 * Ask Alf Configuration
 * Environment-based configuration for the Ask Alf service
 */

export interface AskAlfConfig {
  port: number;
  databaseUrl: string;
  substrateDatabaseUrl: string;
  jwtSecret: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  encryptionKey?: string;
}

export function loadConfig(): AskAlfConfig {
  const databaseUrl = process.env['ASKALF_DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('ASKALF_DATABASE_URL environment variable is required');
  }

  const substrateDatabaseUrl = process.env['SUBSTRATE_DATABASE_URL'];
  if (!substrateDatabaseUrl) {
    throw new Error('SUBSTRATE_DATABASE_URL environment variable is required');
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  return {
    port: parseInt(process.env['PORT'] ?? '3007', 10),
    databaseUrl,
    substrateDatabaseUrl,
    jwtSecret,
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] || undefined,
    openaiApiKey: process.env['OPENAI_API_KEY'] || undefined,
    encryptionKey: process.env['ENCRYPTION_KEY'] || undefined,
  };
}
