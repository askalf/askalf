/**
 * SELF Auth API Client
 * Independent auth — no redirects to app.askalf.org
 */

import { API_BASE } from './client';

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  preferredName?: string;
  role: string;
}

interface AuthResponse {
  user: AuthUser;
}

interface MessageResponse {
  message: string;
}

async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await res.json().catch(() => ({ error: 'Request failed' }));

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data as T;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await authFetch<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthUser> {
  const data = await authFetch<AuthResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await authFetch<{ ok: boolean }>('/api/v1/auth/logout', {
    method: 'POST',
  });
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const data = await authFetch<AuthResponse>('/api/v1/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

export async function forgotPassword(email: string): Promise<string> {
  const data = await authFetch<MessageResponse>('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return data.message;
}

export async function resetPasswordApi(token: string, newPassword: string): Promise<string> {
  const data = await authFetch<MessageResponse>('/api/v1/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  return data.message;
}
