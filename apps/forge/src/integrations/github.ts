/**
 * GitHub Integration — REST API v3
 */

import type { GitProvider, GitRepo, GitBranch, GitProviderUserInfo, GitProviderOAuthConfig } from './types.js';

const API = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function getGitHubOAuthConfig(): GitProviderOAuthConfig | null {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user', 'user:email'],
  };
}

export const githubProvider: GitProvider = {
  async getUserInfo(accessToken: string): Promise<GitProviderUserInfo> {
    const res = await fetch(`${API}/user`, { headers: headers(accessToken) });
    if (!res.ok) throw new Error(`GitHub user info failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    return {
      id: String(data['id']),
      username: String(data['login']),
      displayName: (data['name'] as string) ?? null,
      avatarUrl: (data['avatar_url'] as string) ?? null,
    };
  },

  async listRepos(accessToken: string): Promise<GitRepo[]> {
    const repos: GitRepo[] = [];
    let page = 1;
    const perPage = 100;

    // Paginate through all repos (max 10 pages = 1000 repos)
    while (page <= 10) {
      const res = await fetch(
        `${API}/user/repos?per_page=${perPage}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
        { headers: headers(accessToken) },
      );
      if (!res.ok) throw new Error(`GitHub list repos failed: ${res.status}`);
      const data = await res.json() as Array<Record<string, unknown>>;

      for (const r of data) {
        repos.push({
          fullName: String(r['full_name']),
          url: String(r['html_url']),
          cloneUrl: String(r['clone_url']),
          defaultBranch: String(r['default_branch'] ?? 'main'),
          isPrivate: Boolean(r['private']),
          description: (r['description'] as string) ?? null,
          language: (r['language'] as string) ?? null,
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return repos;
  },

  async getBranches(accessToken: string, repoFullName: string): Promise<GitBranch[]> {
    const res = await fetch(
      `${API}/repos/${repoFullName}/branches?per_page=100`,
      { headers: headers(accessToken) },
    );
    if (!res.ok) throw new Error(`GitHub list branches failed: ${res.status}`);
    const data = await res.json() as Array<Record<string, unknown>>;

    // Get default branch name
    const repoRes = await fetch(`${API}/repos/${repoFullName}`, { headers: headers(accessToken) });
    const repoData = repoRes.ok ? await repoRes.json() as Record<string, unknown> : null;
    const defaultBranch = repoData ? String(repoData['default_branch'] ?? 'main') : 'main';

    return data.map((b) => ({
      name: String(b['name']),
      isDefault: String(b['name']) === defaultBranch,
    }));
  },
};
