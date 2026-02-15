/**
 * Self Configuration
 * Environment-based configuration for the Self service
 */

export interface SelfConfig {
  port: number;
  databaseUrl: string;
  substrateDatabaseUrl: string;
  jwtSecret: string;
  anthropicApiKey?: string;
  encryptionKey?: string;
  oauthRedirectBase?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
}

export function loadConfig(): SelfConfig {
  const databaseUrl = process.env['SELF_DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('SELF_DATABASE_URL environment variable is required');
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
    port: parseInt(process.env['PORT'] ?? '3006', 10),
    databaseUrl,
    substrateDatabaseUrl,
    jwtSecret,
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] || undefined,
    encryptionKey: process.env['ENCRYPTION_KEY'] || undefined,
    oauthRedirectBase: process.env['OAUTH_REDIRECT_BASE'] || undefined,
    googleClientId: process.env['GOOGLE_CLIENT_ID'] || undefined,
    googleClientSecret: process.env['GOOGLE_CLIENT_SECRET'] || undefined,
    microsoftClientId: process.env['MICROSOFT_CLIENT_ID'] || undefined,
    microsoftClientSecret: process.env['MICROSOFT_CLIENT_SECRET'] || undefined,
    githubClientId: process.env['GITHUB_CLIENT_ID'] || undefined,
    githubClientSecret: process.env['GITHUB_CLIENT_SECRET'] || undefined,
  };
}
