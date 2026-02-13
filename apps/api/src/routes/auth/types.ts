/**
 * Shared types for auth module
 */

export interface CreateUserInput {
  email: string;
  password: string;
  display_name?: string;
  timezone?: string;
}

export interface SafeUser {
  id: string;
  tenant_id: string;
  email: string;
  email_normalized: string;
  email_verified: boolean;
  email_verification_expires: Date | null;
  status: 'active' | 'suspended' | 'deleted';
  role: 'user' | 'admin' | 'super_admin';
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  device_type: 'desktop' | 'mobile' | 'tablet' | null;
  expires_at: Date;
  last_active_at: Date;
  revoked: boolean;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Date;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none' | 'strict';
  path: string;
  domain?: string;
  maxAge: number;
}
