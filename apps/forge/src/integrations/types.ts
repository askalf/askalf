/**
 * Shared types for git provider integrations.
 */

export interface GitRepo {
  fullName: string;       // e.g. "user/repo"
  url: string;            // web URL
  cloneUrl: string;       // HTTPS clone URL
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
  language: string | null;
}

export interface GitBranch {
  name: string;
  isDefault: boolean;
}

export interface GitProviderUserInfo {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface GitProvider {
  /** Fetch authenticated user info */
  getUserInfo(accessToken: string): Promise<GitProviderUserInfo>;
  /** List repos accessible to the authenticated user */
  listRepos(accessToken: string): Promise<GitRepo[]>;
  /** List branches for a specific repo */
  getBranches(accessToken: string, repoFullName: string): Promise<GitBranch[]>;
}

export interface GitProviderOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
}
