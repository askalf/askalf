// SELF AI: Core Type Definitions

import { z } from 'zod';

// ============================================
// SELF INSTANCE
// ============================================

export const SelfStatusSchema = z.enum([
  'initializing',
  'active',
  'paused',
  'sleeping',
  'error',
]);
export type SelfStatus = z.infer<typeof SelfStatusSchema>;

export const AutonomyLevelSchema = z.number().int().min(1).max(5);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export interface SelfPersona {
  communicationStyle?: string;
  traits?: string[];
  tone?: string;
  formality?: 'casual' | 'balanced' | 'formal';
}

export interface SelfInstance {
  id: string;
  user_id: string;
  tenant_id: string;
  name: string;
  persona: SelfPersona;
  autonomy_level: AutonomyLevel;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  daily_spent_usd: number;
  monthly_spent_usd: number;
  status: SelfStatus;
  last_heartbeat: string | null;
  heartbeat_interval_ms: number;
  forge_agent_id: string;
  actions_taken: number;
  approvals_requested: number;
  conversations: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// ACTIVITY FEED
// ============================================

export const ActivityTypeSchema = z.enum([
  'action',
  'observation',
  'decision',
  'approval_request',
  'approval_response',
  'thought',
  'memory',
  'error',
  'chat',
  'integration',
  'system',
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export interface SelfActivity {
  id: string;
  self_id: string;
  user_id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  execution_id: string | null;
  integration_id: string | null;
  approval_id: string | null;
  parent_id: string | null;
  visible_to_user: boolean;
  importance: number;
  cost_usd: number;
  tokens_used: number;
  created_at: string;
}

// ============================================
// INTEGRATIONS
// ============================================

export const IntegrationStatusSchema = z.enum([
  'pending',
  'connecting',
  'connected',
  'error',
  'disconnected',
  'revoked',
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const AuthTypeSchema = z.enum(['oauth2', 'api_key', 'basic', 'none']);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const TransportTypeSchema = z.enum(['stdio', 'sse', 'http']);
export type TransportType = z.infer<typeof TransportTypeSchema>;

export interface SelfIntegration {
  id: string;
  self_id: string;
  user_id: string;
  provider: string;
  display_name: string;
  icon_url: string | null;
  mcp_server_id: string | null;
  transport_type: TransportType;
  connection_config: Record<string, unknown>;
  auth_type: AuthType;
  credentials: Record<string, unknown>;
  status: IntegrationStatus;
  poll_interval_ms: number | null;
  next_poll_at: string | null;
  last_sync: string | null;
  allowed_actions: string[];
  blocked_actions: string[];
  created_at: string;
  updated_at: string;
}

// ============================================
// APPROVALS
// ============================================

export const ApprovalTypeSchema = z.enum([
  'action',
  'budget',
  'integration',
  'data_access',
  'confirmation',
  'input',
]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
  'auto_approved',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const UrgencySchema = z.enum(['low', 'normal', 'high', 'critical']);
export type Urgency = z.infer<typeof UrgencySchema>;

export interface SelfApproval {
  id: string;
  self_id: string;
  user_id: string;
  type: ApprovalType;
  title: string;
  description: string | null;
  context: Record<string, unknown>;
  proposed_action: Record<string, unknown>;
  estimated_cost: number;
  status: ApprovalStatus;
  response: Record<string, unknown> | null;
  responded_at: string | null;
  timeout_at: string | null;
  urgency: Urgency;
  created_at: string;
}

// ============================================
// SCHEDULES
// ============================================

export interface SelfSchedule {
  id: string;
  self_id: string;
  name: string;
  action_type: string;
  action_config: Record<string, unknown>;
  cron_expression: string | null;
  interval_ms: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// CONVERSATIONS + MESSAGES
// ============================================

export const MessageRoleSchema = z.enum(['user', 'self', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export interface SelfConversation {
  id: string;
  self_id: string;
  user_id: string;
  title: string | null;
  forge_session_id: string;
  created_at: string;
  updated_at: string;
}

export interface SelfMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  actions_taken: Record<string, unknown>[];
  tokens_used: number;
  cost_usd: number;
  created_at: string;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface ActivateSelfRequest {
  name?: string;
  autonomy_level?: number;
}

export interface ActivateSelfResponse {
  self: SelfInstance;
  conversation: SelfConversation;
  welcome_message: SelfMessage;
}

export interface SendMessageRequest {
  content: string;
}

export interface SendMessageResponse {
  message: SelfMessage;
  response: SelfMessage;
  activity_id: string;
}

export interface UpdateSettingsRequest {
  name?: string;
  autonomy_level?: number;
  daily_budget_usd?: number;
  monthly_budget_usd?: number;
  persona?: Partial<SelfPersona>;
}

export interface ActivityFeedQuery {
  type?: ActivityType;
  integration_id?: string;
  min_importance?: number;
  limit?: number;
  offset?: number;
}
