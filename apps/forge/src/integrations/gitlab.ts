/**
 * GitLab Integration — REST API v4
 */

import type { GitProvider, GitRepo, GitBranch, GitProviderUserInfo, GitProviderOAuthConfig } from './types.js';

const API = 'https://gitlab.com/api/v4';

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function getGitLabOAuthConfig(): GitProviderOAuthConfig | null {
  const clientId = process.env['GITLAB_CLIENT_ID'];
  const clientSecret = process.env['GITLAB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scopes: ['read_user', 'read_api', 'read_repository'],
  };
}

export const gitlabProvider: GitProvider = {
  async getUserInfo(accessToken: string): Promise<GitProviderUserInfo> {
    const res = await fetch(`${API}/user`, { headers: headers(accessToken) });
    if (!res.ok) throw new Error(`GitLab user info failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      id: String(data['id']),
      username: String(data['username']),
      displayName: (data['name'] as string) ?? null,
      avatarUrl: (data['avatar_url'] as string) ?? null,
    };
  },

  async listRepos(accessToken: string): Promise<GitRepo[]> {
    const repos: GitRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (page <= 10) {
      const res = await fetch(
        `${API}/projects?membership=true&per_page=${perPage}&page=${page}&order_by=last_activity_at&sort=desc`,
        { headers: headers(accessToken) },
      );
      if (!res.ok) throw new Error(`GitLab list projects failed: ${res.status}`);
      const data = await res.json() as Array<Record<string, unknown>>;

      for (const r of data) {
        repos.push({
          fullName: String(r['path_with_namespace']),
          url: String(r['web_url']),
          cloneUrl: String(r['http_url_to_repo']),
          defaultBranch: String(r['default_branch'] ?? 'main'),
          isPrivate: (r['visibility'] as string) === 'private',
          description: (r['description'] as string) ?? null,
          language: null, // GitLab doesn't return language in list endpoint
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return repos;
  },

  async getBranches(accessToken: string, repoFullName: string): Promise<GitBranch[]> {
    const encoded = encodeURIComponent(repoFullName);
    const res = await fetch(
      `${API}/projects/${encoded}/repository/branches?per_page=100`,
      { headers: headers(accessToken) },
    );
    if (!res.ok) throw new Error(`GitLab list branches failed: ${res.status}`);
    const data = await res.json() as Array<Record<string, unknown>>;

    return data.map((b) => ({
      name: String(b['name']),
      isDefault: Boolean(b['default']),
    }));
  },
};
