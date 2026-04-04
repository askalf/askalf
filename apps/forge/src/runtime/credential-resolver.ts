/**
 * Credential Resolver — Execution-Time Token Lookup
 *
 * Resolves user integration tokens at execution time for authenticated
 * git operations. Tokens are injected into the agent's environment and
 * NEVER persisted in execution logs or output.
 */

import { query } from '../database.js';

export interface RepoCredentials {
  provider: string;
  repoFullName: string;
  cloneUrl: string;
  authenticatedCloneUrl: string;
  defaultBranch: string;
  accessToken: string;
  displayName: string | null;
}

export interface RepoContext {
  repoFullName: string;
  repoProvider: string;
  cloneUrl?: string;
  defaultBranch?: string;
}

/**
 * Resolve credentials for a target repo by looking up the user's
 * integration token for the repo's provider.
 *
 * Returns null if:
 * - No integration exists for the provider
 * - Integration is not active
 * - No access token available
 */
export async function resolveRepoCredentials(
  ownerId: string,
  repoContext: RepoContext,
): Promise<RepoCredentials | null> {
  // Look up active integration for this provider
  const rows = await query<{
    access_token: string;
    display_name: string | null;
    status: string;
  }>(
    `SELECT access_token, display_name, status
     FROM user_integrations
     WHERE user_id = $1 AND provider = $2 AND status = 'active'
     LIMIT 1`,
    [ownerId, repoContext.repoProvider],
  );

  if (rows.length === 0 || !rows[0]?.access_token) {
    return null;
  }

  const integration = rows[0];
  const token = integration.access_token;

  // Build authenticated clone URL based on provider
  const cloneUrl = repoContext.cloneUrl ?? buildCloneUrl(repoContext.repoProvider, repoContext.repoFullName);
  const authenticatedCloneUrl = buildAuthenticatedCloneUrl(
    repoContext.repoProvider,
    repoContext.repoFullName,
    token,
  );

  return {
    provider: repoContext.repoProvider,
    repoFullName: repoContext.repoFullName,
    cloneUrl,
    authenticatedCloneUrl,
    defaultBranch: repoContext.defaultBranch ?? 'main',
    accessToken: token,
    displayName: integration.display_name,
  };
}

/**
 * Resolve repo context from execution metadata stored in the DB.
 * Returns null if the execution has no repoContext.
 */
export async function resolveRepoContextFromExecution(
  executionId: string,
): Promise<{ repoContext: RepoContext; ownerId: string } | null> {
  const rows = await query<{
    owner_id: string;
    metadata: { repoContext?: RepoContext } | null;
  }>(
    `SELECT owner_id, metadata FROM forge_executions WHERE id = $1`,
    [executionId],
  );

  if (rows.length === 0) return null;

  const { owner_id, metadata } = rows[0]!;
  if (!metadata?.repoContext) return null;

  return {
    repoContext: metadata.repoContext,
    ownerId: owner_id,
  };
}

/**
 * Build a standard (unauthenticated) clone URL for a provider.
 */
function buildCloneUrl(provider: string, repoFullName: string): string {
  switch (provider) {
    case 'github':
      return `https://github.com/${repoFullName}.git`;
    case 'gitlab':
      return `https://gitlab.com/${repoFullName}.git`;
    case 'bitbucket':
      return `https://bitbucket.org/${repoFullName}.git`;
    default:
      return `https://github.com/${repoFullName}.git`;
  }
}

/**
 * Build an authenticated clone URL by embedding the token.
 * Uses HTTPS token auth which works for all three providers.
 *
 * Format:
 * - GitHub:    https://x-access-token:{token}@github.com/{owner}/{repo}.git
 * - GitLab:    https://oauth2:{token}@gitlab.com/{owner}/{repo}.git
 * - Bitbucket: https://x-token-auth:{token}@bitbucket.org/{owner}/{repo}.git
 */
function buildAuthenticatedCloneUrl(
  provider: string,
  repoFullName: string,
  token: string,
): string {
  switch (provider) {
    case 'github':
      return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
    case 'gitlab':
      return `https://oauth2:${token}@gitlab.com/${repoFullName}.git`;
    case 'bitbucket':
      return `https://x-token-auth:${token}@bitbucket.org/${repoFullName}.git`;
    default:
      return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  }
}

/**
 * Build a git credential helper script content that provides
 * the token when git asks for credentials.
 * This is safer than embedding tokens in URLs as it doesn't
 * appear in git remote -v output.
 */
export function buildGitCredentialHelperScript(
  provider: string,
  token: string,
): string {
  const host = provider === 'github' ? 'github.com'
    : provider === 'gitlab' ? 'gitlab.com'
    : provider === 'bitbucket' ? 'bitbucket.org'
    : 'github.com';

  const username = provider === 'gitlab' ? 'oauth2'
    : provider === 'bitbucket' ? 'x-token-auth'
    : 'x-access-token';

  return `#!/bin/sh\necho "protocol=https\\nhost=${host}\\nusername=${username}\\npassword=${token}"`;
}

/**
 * Build system prompt instructions for an agent that has repo credentials.
 * Tells the agent how to clone/access the target repo.
 * IMPORTANT: Does NOT include the actual token — that's injected via env/credential helper.
 */
export function buildRepoPromptInstructions(credentials: RepoCredentials): string {
  return [
    '',
    '## TARGET REPOSITORY — AUTHENTICATED ACCESS',
    `You have authenticated access to: **${credentials.repoFullName}** (${credentials.provider})`,
    `Default branch: ${credentials.defaultBranch}`,
    '',
    'Git credentials are pre-configured in your environment. You can:',
    `- Clone: \`git clone ${credentials.cloneUrl} target-repo\``,
    '- Push/pull: credentials are automatic via git credential helper',
    '',
    'IMPORTANT: Do NOT log, print, or store any authentication tokens.',
    '',
  ].join('\n');
}
