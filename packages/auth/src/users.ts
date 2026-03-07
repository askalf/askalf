// User lookup — minimal surface for dashboard server.js

import { queryOne } from '@askalf/database';

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  email_verified: boolean;
  status: 'active' | 'suspended' | 'deleted';
  role: 'owner' | 'admin' | 'member' | 'viewer';
  name: string | null;
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

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    tenant_id: row['tenant_id'] as string,
    email: row['email'] as string,
    email_normalized: row['email_normalized'] as string,
    password_hash: row['password_hash'] as string,
    email_verified: row['email_verified'] as boolean,
    status: row['status'] as User['status'],
    role: row['role'] as User['role'],
    name: row['name'] as string | null,
    display_name: row['display_name'] as string | null,
    avatar_url: row['avatar_url'] as string | null,
    timezone: row['timezone'] as string,
    failed_login_attempts: row['failed_login_attempts'] as number,
    locked_until: row['locked_until']
      ? new Date(row['locked_until'] as string)
      : null,
    last_login_at: row['last_login_at']
      ? new Date(row['last_login_at'] as string)
      : null,
    last_login_ip: row['last_login_ip'] as string | null,
    created_at: new Date(row['created_at'] as string),
    updated_at: new Date(row['updated_at'] as string),
  };
}

/**
 * Get a user by ID
 */
export async function getUserById(id: string): Promise<User | null> {
  const sql = 'SELECT * FROM users WHERE id = $1';
  const row = await queryOne<Record<string, unknown>>(sql, [id]);
  return row ? rowToUser(row) : null;
}
