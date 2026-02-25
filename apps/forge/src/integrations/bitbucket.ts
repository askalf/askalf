/**
 * Bitbucket Cloud Integration — REST API 2.0
 */

import type { GitProvider, GitRepo, GitBranch, GitProviderUserInfo, GitProviderOAuthConfig } from './types.js';

const API = 'https://api.bitbucket.org/2.0';

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function getBitbucketOAuthConfig(): GitProviderOAuthConfig | null {
  const clientId = process.env['BITBUCKET_CLIENT_ID'];
  const clientSecret = process.env['BITBUCKET_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
    tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
    scopes: ['repository', 'account'],
  };
}

export const bitbucketProvider: GitProvider = {
  async getUserInfo(accessToken: string): Promise<GitProviderUserInfo> {
    const res = await fetch(`${API}/user`, { headers: headers(accessToken) });
    if (!res.ok) throw new Error(`Bitbucket user info failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const links = data['links'] as Record<string, { href: string }> | undefined;
    return {
      id: String(data['uuid']),
      username: String(data['username'] ?? data['nickname']),
      displayName: (data['display_name'] as string) ?? null,
      avatarUrl: links?.['avatar']?.href ?? null,
    };
  },

  async listRepos(accessToken: string): Promise<GitRepo[]> {
    const repos: GitRepo[] = [];
    let url: string | null = `${API}/repositories?role=member&pagelen=100&sort=-updated_on`;

    // Follow pagination (max 10 pages)
    let pages = 0;
    while (url && pages < 10) {
      const res = await fetch(url, { headers: headers(accessToken) });
      if (!res.ok) throw new Error(`Bitbucket list repos failed: ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const values = (data['values'] ?? []) as Array<Record<string, unknown>>;

      for (const r of values) {
        const links = r['links'] as Record<string, { href: string }[]> | undefined;
        const cloneLinks = links?.['clone'] ?? [];
        const httpsClone = cloneLinks.find((l) => l.href.startsWith('https://'));
        const mainBranch = r['mainbranch'] as Record<string, unknown> | undefined;

        repos.push({
          fullName: String(r['full_name']),
          url: (links?.['html']?.[0]?.href) ?? `https://bitbucket.org/${r['full_name']}`,
          cloneUrl: httpsClone?.href ?? `https://bitbucket.org/${r['full_name']}.git`,
          defaultBranch: mainBranch ? String(mainBranch['name'] ?? 'main') : 'main',
          isPrivate: Boolean(r['is_private']),
          description: (r['description'] as string) ?? null,
          language: (r['language'] as string) ?? null,
        });
      }

      url = (data['next'] as string) ?? null;
      pages++;
    }

    return repos;
  },

  async getBranches(accessToken: string, repoFullName: string): Promise<GitBranch[]> {
    const res = await fetch(
      `${API}/repositories/${repoFullName}/refs/branches?pagelen=100`,
      { headers: headers(accessToken) },
    );
    if (!res.ok) throw new Error(`Bitbucket list branches failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const values = (data['values'] ?? []) as Array<Record<string, unknown>>;

    // Get default branch
    const repoRes = await fetch(`${API}/repositories/${repoFullName}`, { headers: headers(accessToken) });
    const repoData = repoRes.ok ? await repoRes.json() as Record<string, unknown> : null;
    const mainBranch = repoData ? (repoData['mainbranch'] as Record<string, unknown>)?.['name'] as string : 'main';

    return values.map((b) => ({
      name: String(b['name']),
      isDefault: String(b['name']) === mainBranch,
    }));
  },
};
