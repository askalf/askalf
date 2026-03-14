/**
 * Shared API fetch utility
 * Single source for all frontend API calls — avoids 5 duplicate implementations.
 */

const getApiBase = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

export const API_BASE = getApiBase();

/**
 * Fetch with credentials, JSON content type, and optional retries for GET.
 * Throws on non-ok response.
 */
export async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const maxRetries = options?.method && options.method !== 'GET' ? 0 : 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError!;
}

/**
 * Fetch that returns null on failure instead of throwing.
 * Useful for optional data loading (health checks, stats, etc).
 */
export async function apiFetchSafe<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch {
    return null;
  }
}
