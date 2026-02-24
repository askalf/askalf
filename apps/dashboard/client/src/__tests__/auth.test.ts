/**
 * Test suite for stores/auth.ts
 *
 * Coverage targets:
 *  - checkAuth: success, non-ok response, network error
 *  - fetchWithRetry: retry behaviour (tested indirectly via checkAuth)
 *  - login: success (calls checkAuth), failure (!res.ok), network error
 *  - register: success (auto-calls login), failure, optional fields
 *  - logout: clears user, works even when API throws
 *  - clearError: resets error state only
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist a stable fetch mock so it exists BEFORE the module import runs.
// The module-level `useAuthStore.getState().checkAuth()` at the bottom of
// auth.ts fires on first import; giving it a non-ok resolved response keeps
// the initial state clean (user=null, isLoading=false, error=null).
// ---------------------------------------------------------------------------
const fetchMock = vi.hoisted(() => {
  const fn = vi.fn();
  fn.mockResolvedValue({
    ok: false,
    status: 0,
    json: () => Promise.resolve({}),
  } as unknown as Response);
  return fn;
});
vi.stubGlobal('fetch', fetchMock);

import { useAuthStore } from '../stores/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser = { id: '1', email: 'test@example.com', role: 'user' as const };

/** Set up a single resolved fetch response (consumed once). */
function mockFetch(ok: boolean, data: unknown, status = ok ? 200 : 400) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(data),
  } as unknown as Response);
}

/** Set up a single fetch that throws (network failure). */
function mockFetchNetworkError(message = 'Network error') {
  fetchMock.mockRejectedValueOnce(new Error(message));
}

/** Reset the Zustand store to a known state before each test. */
function resetStore() {
  useAuthStore.setState({ user: null, isLoading: false, error: null });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Auth Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // checkAuth
  // -------------------------------------------------------------------------
  describe('checkAuth', () => {
    it('sets user when /auth/me returns ok', async () => {
      mockFetch(true, { user: mockUser });

      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('clears user and keeps error null on non-ok response', async () => {
      useAuthStore.setState({ user: mockUser });
      mockFetch(false, { error: 'Unauthorized' }, 401);

      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets friendly network error message when fetch throws', async () => {
      mockFetchNetworkError('Failed to fetch');

      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Network error - please check your connection');
    });

    it('calls /api/v1/auth/me with credentials: include', async () => {
      mockFetch(true, { user: null });

      await useAuthStore.getState().checkAuth();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/me'),
        expect.objectContaining({ credentials: 'include' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // fetchWithRetry — tested indirectly via checkAuth
  // -------------------------------------------------------------------------
  describe('fetchWithRetry (via checkAuth)', () => {
    it('retries up to MAX_RETRIES (2) times on network error before giving up', async () => {
      // 3 rejections total: original call + 2 retries
      mockFetchNetworkError();
      mockFetchNetworkError();
      mockFetchNetworkError();

      await useAuthStore.getState().checkAuth();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(useAuthStore.getState().error).toBe('Network error - please check your connection');
    });

    it('succeeds on second attempt when first throws', async () => {
      mockFetchNetworkError();
      mockFetch(true, { user: mockUser });

      await useAuthStore.getState().checkAuth();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('does NOT retry on HTTP error responses (non-ok but resolved)', async () => {
      mockFetch(false, { error: 'Bad Request' }, 400);

      await useAuthStore.getState().checkAuth();

      // Resolved responses are returned immediately — no retry
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------
  describe('login', () => {
    it('calls checkAuth after successful login and sets user', async () => {
      mockFetch(true, {}); // POST /auth/login
      mockFetch(true, { user: mockUser }); // GET /auth/me (inside checkAuth)

      await useAuthStore.getState().login('test@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('sets error and throws on !res.ok with server error message', async () => {
      mockFetch(false, { error: 'Invalid credentials' }, 401);

      await expect(
        useAuthStore.getState().login('bad@email.com', 'wrong'),
      ).rejects.toThrow('Invalid credentials');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Invalid credentials');
      expect(state.isLoading).toBe(false);
    });

    it('uses fallback "Login failed" when server provides no error field', async () => {
      mockFetch(false, {}, 500);

      await expect(
        useAuthStore.getState().login('x@x.com', 'pw'),
      ).rejects.toThrow('Login failed');

      expect(useAuthStore.getState().error).toBe('Login failed');
    });

    it('sets error and throws on network failure', async () => {
      mockFetchNetworkError('Connection refused');

      await expect(
        useAuthStore.getState().login('x@x.com', 'pw'),
      ).rejects.toThrow('Connection refused');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Connection refused');
      expect(state.isLoading).toBe(false);
    });

    it('POSTs email and password to /api/v1/auth/login', async () => {
      mockFetch(true, {});
      mockFetch(true, { user: null });

      await useAuthStore.getState().login('u@e.com', 'pw').catch(() => {});

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/login'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ email: 'u@e.com', password: 'pw' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------
  describe('register', () => {
    it('auto-calls login (and then checkAuth) after successful registration', async () => {
      mockFetch(true, {}); // POST /auth/register
      mockFetch(true, {}); // POST /auth/login (auto-login)
      mockFetch(true, { user: mockUser }); // GET /auth/me

      await useAuthStore.getState().register('new@user.com', 'pass123');

      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('includes displayName as display_name in request body', async () => {
      mockFetch(true, {});
      mockFetch(true, {});
      mockFetch(true, { user: mockUser });

      await useAuthStore.getState().register('n@n.com', 'pw', 'Alice');

      const registerCall = fetchMock.mock.calls[0];
      const body = JSON.parse(registerCall[1].body as string);
      expect(body.display_name).toBe('Alice');
    });

    it('includes deploymentName as tenant_name in request body', async () => {
      mockFetch(true, {});
      mockFetch(true, {});
      mockFetch(true, { user: mockUser });

      await useAuthStore.getState().register('n@n.com', 'pw', undefined, 'myorg');

      const registerCall = fetchMock.mock.calls[0];
      const body = JSON.parse(registerCall[1].body as string);
      expect(body.tenant_name).toBe('myorg');
    });

    it('sets error and throws on registration failure', async () => {
      mockFetch(false, { error: 'Email already exists' }, 409);

      await expect(
        useAuthStore.getState().register('taken@email.com', 'pw'),
      ).rejects.toThrow('Email already exists');

      const state = useAuthStore.getState();
      expect(state.error).toBe('Email already exists');
      expect(state.isLoading).toBe(false);
    });

    it('uses fallback "Registration failed" when server provides no error field', async () => {
      mockFetch(false, {}, 500);

      await expect(
        useAuthStore.getState().register('t@t.com', 'pw'),
      ).rejects.toThrow('Registration failed');
    });

    it('POSTs to /api/v1/auth/register', async () => {
      mockFetch(true, {});
      mockFetch(true, {});
      mockFetch(true, { user: mockUser });

      await useAuthStore.getState().register('r@r.com', 'pw');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/register'),
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------
  describe('logout', () => {
    it('clears user after successful logout', async () => {
      useAuthStore.setState({ user: mockUser });
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().user).toBeNull();
    });

    it('clears user even when API call throws (finally block)', async () => {
      useAuthStore.setState({ user: mockUser });
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().user).toBeNull();
    });

    it('POSTs to /api/v1/auth/logout with credentials: include', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

      await useAuthStore.getState().logout();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/auth/logout'),
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------
  describe('clearError', () => {
    it('sets error to null', () => {
      useAuthStore.setState({ error: 'some error' });

      useAuthStore.getState().clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });

    it('does not affect user or isLoading state', () => {
      useAuthStore.setState({ user: mockUser, isLoading: false, error: 'oops' });

      useAuthStore.getState().clearError();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
    });
  });
});
