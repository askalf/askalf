// SUBSTRATE v1: Authentication Types
// User, Session, and API Key type definitions

import { z } from 'zod';

// ============================================
// USER TYPES
// ============================================

export const UserStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UserRoleSchema = z.enum(['user', 'admin', 'super_admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  email: z.string().email(),
  email_normalized: z.string(),
  password_hash: z.string(),

  email_verified: z.boolean().default(false),
  email_verification_token: z.string().nullable(),
  email_verification_expires: z.date().nullable(),

  password_reset_token: z.string().nullable(),
  password_reset_expires: z.date().nullable(),

  status: UserStatusSchema.default('active'),
  role: UserRoleSchema.default('user'),

  name: z.string().nullable(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  timezone: z.string().default('UTC'),

  failed_login_attempts: z.number().default(0),
  locked_until: z.date().nullable(),
  last_login_at: z.date().nullable(),
  last_login_ip: z.string().nullable(),

  created_at: z.date(),
  updated_at: z.date(),
});

export type User = z.infer<typeof UserSchema>;

export const CreateUserInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  display_name: z.string().optional(),
  timezone: z.string().default('UTC'),
});

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const UpdateUserInputSchema = z.object({
  email: z.string().email().optional(),
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

// Safe user (without password hash and sensitive tokens)
export type SafeUser = Omit<
  User,
  | 'password_hash'
  | 'email_verification_token'
  | 'password_reset_token'
  | 'password_reset_expires'
>;

// ============================================
// SESSION TYPES
// ============================================

export const SessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  token_hash: z.string(),

  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  device_type: z.enum(['desktop', 'mobile', 'tablet']).nullable(),

  expires_at: z.date(),
  last_active_at: z.date(),

  revoked: z.boolean().default(false),
  revoked_at: z.date().nullable(),
  revoked_reason: z.string().nullable(),

  created_at: z.date(),
});

export type Session = z.infer<typeof SessionSchema>;

export interface SessionMetadata {
  ip_address?: string;
  user_agent?: string;
  device_type?: 'desktop' | 'mobile' | 'tablet';
}

export interface SessionWithUser extends Session {
  user: SafeUser;
}

// ============================================
// API KEY TYPES
// ============================================

export const ApiKeyScopeSchema = z.enum(['read', 'write', 'execute']);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const ApiKeyStatusSchema = z.enum(['active', 'revoked']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const ApiKeySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  user_id: z.string().nullable(),

  key_prefix: z.string(),
  key_hash: z.string(),

  name: z.string(),
  description: z.string().nullable(),

  scopes: z.array(ApiKeyScopeSchema),

  last_used_at: z.date().nullable(),
  usage_count: z.number().default(0),

  status: ApiKeyStatusSchema.default('active'),
  expires_at: z.date().nullable(),
  revoked_at: z.date().nullable(),

  created_at: z.date(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

// Safe API key (without hash)
export type SafeApiKey = Omit<ApiKey, 'key_hash'>;

// ============================================
// PASSWORD VALIDATION
// ============================================

export const PasswordStrengthSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  score: z.number().min(0).max(5),
});

export type PasswordStrength = z.infer<typeof PasswordStrengthSchema>;

// ============================================
// AUTH CONTEXT
// ============================================

export interface AuthContext {
  user: SafeUser;
  session?: Session;
  apiKey?: SafeApiKey;
  tenant_id: string;
}

// ============================================
// AUDIT LOG TYPES
// ============================================

export const AuditActionSchema = z.enum([
  'user.register',
  'user.login',
  'user.logout',
  'user.password_reset_request',
  'user.password_reset',
  'user.email_verify',
  'user.update',
  'user.delete',
  'user.suspend',
  'user.unsuspend',
  'session.create',
  'session.revoke',
  'session.revoke_all',
  'api_key.create',
  'api_key.revoke',
  'api_key.use',
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export interface AuditLogEntry {
  tenant_id?: string;
  user_id?: string;
  api_key_id?: string;
  action: AuditAction | string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  request_id?: string;
  success?: boolean;
  error_message?: string;
}
