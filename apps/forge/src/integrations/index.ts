/**
 * Git Provider Registry
 * Maps provider names to their adapter + OAuth config.
 */

import type { GitProvider, GitProviderOAuthConfig } from './types.js';
import { githubProvider, getGitHubOAuthConfig } from './github.js';
import { gitlabProvider, getGitLabOAuthConfig } from './gitlab.js';
import { bitbucketProvider, getBitbucketOAuthConfig } from './bitbucket.js';

export type IntegrationProvider = 'github' | 'gitlab' | 'bitbucket';

const PROVIDERS: Record<IntegrationProvider, GitProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
  bitbucket: bitbucketProvider,
};

const OAUTH_CONFIGS: Record<IntegrationProvider, () => GitProviderOAuthConfig | null> = {
  github: getGitHubOAuthConfig,
  gitlab: getGitLabOAuthConfig,
  bitbucket: getBitbucketOAuthConfig,
};

export function getProvider(name: IntegrationProvider): GitProvider {
  return PROVIDERS[name];
}

export function getOAuthConfig(name: IntegrationProvider): GitProviderOAuthConfig | null {
  return OAUTH_CONFIGS[name]();
}

export function isValidProvider(name: string): name is IntegrationProvider {
  return name === 'github' || name === 'gitlab' || name === 'bitbucket';
}

export { type GitProvider, type GitProviderOAuthConfig, type GitRepo, type GitBranch, type GitProviderUserInfo } from './types.js';
