import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';
import type { ConversationMessage, ParsedIntent, IntentSubtask, Conversation } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { integrationApi } from '../../hooks/useHubApi';
import type { UserRepo } from '../../hooks/useHubApi';
import './ChatTab.css';

import { apiFetch as cmdFetch, API_BASE } from '../../utils/api';

// ── Slash command system ──

interface SlashResult { text: string; }

async function executeSlashCommand(cmd: string, args: string, onNavigate?: (tab: string) => void): Promise<SlashResult | null> {
  switch (cmd) {
    case 'help':
    case '?':
    case 'h':
      return { text: [
        '**Available Commands**',
        '`/help` — Show this help',
        '`/briefing` — Daily overnight report',
        '`/status` — System status overview',
        '`/fleet` — Team overview',
        '`/costs` — Cost summary (30 days)',
        '`/logs [agent]` — Recent execution logs',
        '`/tickets` — Open ticket board',
        '`/keys` — AI provider key status',
        '`/whoami` — Current user info',
        '`/settings [tab]` — Open settings',
        '`/dispatch <task>` — Route a task to the right agent',
        '`/connect` — Import Anthropic OAuth token',
        '`/clear` — Clear conversation',
        '',
        'Type naturally to get things done.',
      ].join('\n') };

    case 'status':
    case 'stat':
    case 'st': {
      const [health, agents] = await Promise.all([
        cmdFetch<{ status: string; database?: string; checks?: { database: boolean; redis: boolean }; uptime?: number }>('/health'),
        cmdFetch<{ agents: { status: string }[] }>('/api/v1/forge/agents').catch(() => ({ agents: [] })),
      ]);
      const dbOk = health.checks?.database ?? health.database === 'connected';
      const active = agents.agents.filter(a => a.status === 'active').length;
      const lines = [
        `**System Status**`,
        `Platform: **${health.status.toUpperCase()}**`,
        `Database: ${dbOk ? 'connected' : '**DOWN**'}`,
        `Workers: ${active}/${agents.agents.length} active`,
      ];
      if (health.uptime) {
        const h = Math.floor(health.uptime / 3600);
        const m = Math.floor((health.uptime % 3600) / 60);
        lines.push(`Uptime: ${h}h ${m}m`);
      }
      return { text: lines.join('\n') };
    }

    case 'fleet':
    case 'agents': {
      const data = await cmdFetch<{ agents: { name: string; status: string; role: string }[] }>('/api/v1/forge/agents');
      if (!data.agents.length) return { text: 'No agents found.' };
      const rows = data.agents.map(a => `${a.status === 'active' ? '\u25CF' : '\u25CB'} **${a.name}** — ${a.role} (${a.status})`);
      return { text: `**Your Team** (${data.agents.length})\n${rows.join('\n')}` };
    }

    case 'costs':
    case 'cost':
    case 'spend': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await cmdFetch<{ totals: { totalCost: number; executionCount: number }; byAgent?: { agentName: string; totalCost: number; eventCount: number }[] }>('/api/v1/admin/costs/summary').catch(() => ({ totals: { totalCost: 0, executionCount: 0 } } as any));
      const lines = [`**Cost Summary (30 days)**`, `Total: **$${data.totals.totalCost.toFixed(2)}** (${data.totals.executionCount} runs)`];
      if (data.byAgent?.length) {
        lines.push('', '**By Agent:**');
        for (const a of data.byAgent.slice(0, 8)) {
          lines.push(`\`${a.agentName.padEnd(18)}\` $${a.totalCost.toFixed(2)} (${a.eventCount} runs)`);
        }
      }
      return { text: lines.join('\n') };
    }

    case 'logs':
    case 'log':
    case 'executions': {
      const url = args ? `/api/v1/forge/executions?limit=10&agent_name=${encodeURIComponent(args)}` : '/api/v1/forge/executions?limit=10';
      const data = await cmdFetch<{ executions: { agent_name: string; status: string; created_at: string; total_cost: number }[] }>(url);
      if (!data.executions?.length) return { text: 'No executions found.' };
      const rows = data.executions.map(e => {
        const ts = new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        const icon = e.status === 'completed' ? '\u2713' : e.status === 'failed' ? '\u2717' : '\u25CB';
        return `${icon} ${ts} \`${e.agent_name}\` ${e.status} $${(e.total_cost ?? 0).toFixed(2)}`;
      });
      return { text: `**Recent Executions${args ? ` (${args})` : ''}**\n${rows.join('\n')}` };
    }

    case 'tickets':
    case 'ticket': {
      const data = await cmdFetch<{ tickets: { title: string; status: string; assigned_agent: string | null; priority: string }[] }>('/api/v1/forge/tickets?status=open&limit=15');
      if (!data.tickets?.length) return { text: 'No open tickets.' };
      const rows = data.tickets.map(t => `[${t.priority?.charAt(0)?.toUpperCase() ?? '-'}] **${t.title.slice(0, 50)}** → ${t.assigned_agent ?? 'unassigned'}`);
      return { text: `**Open Tickets** (${data.tickets.length})\n${rows.join('\n')}` };
    }

    case 'keys':
    case 'apikeys':
    case 'providers': {
      const data = await cmdFetch<{ providers: { provider: string; has_key: boolean; model_count: number }[] }>('/api/v1/forge/user-providers').catch(() => ({ providers: [] }));
      if (!data.providers.length) return { text: 'No providers configured. Use `/settings ai-keys` to add one.' };
      const rows = data.providers.map(p => `${p.has_key ? '\u2713' : '\u2717'} **${p.provider}** — ${p.has_key ? 'connected' : 'not set'} (${p.model_count} models)`);
      return { text: `**AI Provider Keys**\n${rows.join('\n')}` };
    }

    case 'whoami': {
      const user = useAuthStore.getState().user;
      return { text: `**${user?.name ?? 'Unknown'}**\nEmail: ${user?.email ?? 'unknown'}\nRole: ${user?.role ?? 'unknown'}` };
    }

    case 'settings': {
      const tab = args.trim() || 'profile';
      onNavigate?.(`settings-${tab}`);
      return { text: `Opening settings: **${tab}**` };
    }

    case 'briefing':
    case 'report':
    case 'overnight': {
      try {
        const data = await cmdFetch<{ summary: string; highlights: string[]; cost: { total: number }; tickets: { resolved: number; opened: number; stillOpen: number }; findings: { total: number }; period: { start?: string; end?: string; from?: string; to?: string } }>('/api/v1/admin/briefing/daily');
        const lines = [
          `**Daily Briefing**`,
          `*${new Date(data.period.start || data.period.from || '').toLocaleDateString()} — ${new Date(data.period.end || data.period.to || '').toLocaleDateString()}*`,
          '',
          data.summary,
          '',
          '**Highlights:**',
          ...data.highlights.map(h => `- ${h}`),
          '',
          `**Cost:** $${data.cost.total.toFixed(2)} | **Tickets:** ${data.tickets.resolved} resolved, ${data.tickets.stillOpen} open | **Findings:** ${data.findings.total}`,
          '',
          `[Open full report](${API_BASE}/api/v1/admin/briefing/daily/html) | Print or save as PDF from your browser`,
        ];
        return { text: lines.join('\n') };
      } catch {
        return { text: 'Briefing unavailable — no data in the last 24 hours.' };
      }
    }

    case 'connect': {
      // Initiate OAuth flow
      try {
        const res = await cmdFetch<{ authUrl: string }>('/api/v1/forge/oauth/start');
        if (res.authUrl) {
          window.open(res.authUrl, '_blank');
          return { text: '**OAuth flow started** — authorize in the new tab. Your credentials will be saved automatically.' };
        }
      } catch { /* fall through */ }
      return { text: '**Connect Claude** — go to Settings to set up OAuth, or use the onboarding wizard.' };
    }

    case 'dispatch':
    case 'task':
    case 'do': {
      if (!args) return { text: '**Usage:** `/dispatch <description>`\nExample: `/dispatch fix the broken import in forge admin route`' };
      const dispatchRes = await fetch(`${API_BASE}/api/v1/forge/dispatch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: args }),
      });
      if (!dispatchRes.ok) throw new Error(await dispatchRes.text().catch(() => 'Dispatch failed'));
      const result = await dispatchRes.json() as { ticketId: string; assignedTo: string; title: string };
      return { text: `**Task dispatched**\nTicket: \`${result.ticketId}\`\nAssigned to: **${result.assignedTo}**\nTitle: ${result.title}` };
    }

    case 'clear':
      return null; // handled specially by caller

    default:
      return { text: `Unknown command: \`/${cmd}\`. Type \`/help\` for available commands.` };
  }
}

// ── Sub-components ──

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title ?? '');
  };

  const commitRename = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  return (
    <div className="chat-sidebar">
      <button className="chat-new-btn" onClick={onCreate}>+ New Chat</button>
      <div className="chat-conv-list">
        {conversations.map(c => (
          <div
            key={c.id}
            className={`chat-conv-item ${c.id === activeId ? 'active' : ''}`}
            onClick={() => { if (editingId !== c.id) onSelect(c.id); }}
            title={c.title ?? 'Untitled'}
          >
            {editingId === c.id ? (
              <input
                ref={editRef}
                className="chat-conv-rename-input"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(c.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="chat-conv-title">{c.title ?? 'Untitled'}</span>
                <div className="chat-conv-row">
                  <span className="chat-conv-date">{new Date(c.updated_at).toLocaleDateString()}</span>
                  <span className="chat-conv-actions">
                    <button className="chat-conv-action" onClick={e => startRename(e, c)} title="Rename">R</button>
                    <button className="chat-conv-action chat-conv-action-delete" onClick={e => { e.stopPropagation(); onDelete(c.id); }} title="Delete">X</button>
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="chat-conv-empty">No conversations yet</div>
        )}
      </div>
    </div>
  );
}

// Simple markdown renderer — handles **bold**, `code`, and \n
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    if (li > 0) result.push(<br key={`br-${li}`} />);

    // Split by **bold** and `code` patterns
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    parts.forEach((part, pi) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        result.push(<strong key={`${li}-${pi}`}>{part.slice(2, -2)}</strong>);
      } else if (part.startsWith('`') && part.endsWith('`')) {
        result.push(<code key={`${li}-${pi}`} className="chat-inline-code">{part.slice(1, -1)}</code>);
      } else {
        result.push(part);
      }
    });
  });

  return result;
}

function ChatMessage({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';
  const isCmd = message.id.startsWith('cmd-') || message.id.startsWith('oauth-');
  const avatarLabel = isUser ? 'You' : isCmd ? '\u{2699}' : 'AI';
  return (
    <div className={`chat-msg ${isUser ? 'chat-msg-user' : 'chat-msg-assistant'}${isCmd && !isUser ? ' chat-msg-system' : ''}`}>
      <div className="chat-msg-avatar">{avatarLabel}</div>
      <div className="chat-msg-content">
        <div className="chat-msg-text">
          {isUser ? message.content : renderMarkdown(message.content)}
        </div>
        <div className="chat-msg-time">
          {new Date(message.created_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

const PATTERN_LABELS: Record<string, { label: string; color: string }> = {
  single: { label: 'Single Agent', color: '#6366f1' },
  pipeline: { label: 'Pipeline', color: '#3b82f6' },
  'fan-out': { label: 'Fan-Out', color: '#8b5cf6' },
  consensus: { label: 'Consensus', color: '#06b6d4' },
};

function SubtaskList({
  subtasks,
  pattern,
}: {
  subtasks: IntentSubtask[];
  pattern: string;
}) {
  const header = pattern === 'pipeline' ? 'Sequential Steps'
    : pattern === 'fan-out' ? 'Parallel Tasks'
    : 'Consensus Agents';

  return (
    <div className="chat-intent-subtasks">
      <div className="chat-intent-subtasks-header">{header}</div>
      {subtasks.map((st, i) => (
        <div key={i} className="chat-intent-subtask">
          <div className="chat-intent-subtask-connector">
            {pattern === 'pipeline'
              ? <span className="chat-intent-subtask-arrow">{i > 0 ? '\u2193' : '\u25CF'}</span>
              : <span className="chat-intent-subtask-parallel">{'\u2502'}</span>}
          </div>
          <div className="chat-intent-subtask-content">
            <div className="chat-intent-subtask-title">
              {st.title}
              <span className="chat-intent-subtask-type">{st.suggestedAgentType}</span>
            </div>
            <div className="chat-intent-subtask-desc">{st.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const MODEL_OPTIONS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.0-flash',
];

interface WorkspaceProject {
  path: string;
  name: string;
  type: string;
  branch?: string;
}

function IntentPreview({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: ParsedIntent;
  onConfirm: (modified: ParsedIntent) => void;
  onCancel: () => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState(intent.agentConfig.model);
  const [maxCost, setMaxCost] = useState(intent.agentConfig.maxCostPerExecution);
  const [showAdvanced, setShowAdvanced] = useState(() => {
    try { return localStorage.getItem('askalf_intent_advanced') === 'true'; } catch { return false; }
  });

  // Repo picker state
  const [repos, setRepos] = useState<UserRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [hasIntegrations, setHasIntegrations] = useState<boolean | null>(null);

  // Workspace project picker state
  const [wsProjects, setWsProjects] = useState<WorkspaceProject[]>([]);

  const isMultiAgent = intent.executionMode !== 'single' && intent.subtasks?.length;
  const patternInfo = PATTERN_LABELS[intent.executionMode] ?? PATTERN_LABELS['single']!;

  // Fetch repos + workspace projects when configuring opens
  useEffect(() => {
    if (!configuring) return;
    let cancelled = false;
    setReposLoading(true);
    Promise.all([
      integrationApi.repos().catch(() => ({ repos: [] as UserRepo[] })),
      fetch(`${API_BASE}/api/v1/admin/projects`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { projects: [] })
        .catch(() => ({ projects: [] })),
    ]).then(([repoData, projData]) => {
      if (cancelled) return;
      setRepos(repoData.repos);
      setHasIntegrations(repoData.repos.length > 0);
      setWsProjects(projData.projects ?? []);
      setReposLoading(false);
    });
    return () => { cancelled = true; };
  }, [configuring]);

  // Persist advanced toggle
  useEffect(() => {
    try { localStorage.setItem('askalf_intent_advanced', String(showAdvanced)); } catch { /* noop */ }
  }, [showAdvanced]);

  // Group repos by provider for the dropdown
  const reposByProvider = repos.reduce<Record<string, UserRepo[]>>((acc, r) => {
    (acc[r.provider] ??= []).push(r);
    return acc;
  }, {});

  const selectedRepo = repos.find(r => r.id === selectedRepoId) ?? null;

  const selectedProject = wsProjects.find(p => p.path === selectedProjectPath) ?? null;

  const handleLaunch = () => {
    const modified = structuredClone(intent);
    const prefix: string[] = [];
    if (selectedProject) {
      prefix.push(`WORKSPACE PROJECT: ${selectedProject.name} (${selectedProject.path})`);
      if (selectedProject.branch) prefix.push(`BRANCH: ${selectedProject.branch}`);
    }
    if (selectedRepo) {
      prefix.push(`TARGET REPOSITORY: ${selectedRepo.repo_full_name} (${selectedRepo.provider})`);
      if (selectedRepo.clone_url) prefix.push(`CLONE URL: ${selectedRepo.clone_url}`);
      prefix.push(`DEFAULT BRANCH: ${selectedRepo.default_branch}`);
    }
    if (instructions.trim()) prefix.push(`ADDITIONAL INSTRUCTIONS: ${instructions.trim()}`);
    if (prefix.length) {
      modified.agentConfig.systemPrompt = prefix.join('\n') + '\n\n' + modified.agentConfig.systemPrompt;
    }
    modified.agentConfig.model = model;
    modified.agentConfig.maxCostPerExecution = maxCost;
    modified.estimatedCost = maxCost;

    // Attach project context for backend
    if (selectedProject) {
      (modified as ParsedIntent & { projectPath?: string; projectName?: string }).projectPath = selectedProject.path;
      (modified as ParsedIntent & { projectName?: string }).projectName = selectedProject.name;
    }

    // Attach repo context for backend
    if (selectedRepo) {
      (modified as ParsedIntent & { repoId?: string; repoFullName?: string; repoProvider?: string }).repoId = selectedRepo.id;
      (modified as ParsedIntent & { repoFullName?: string }).repoFullName = selectedRepo.repo_full_name;
      (modified as ParsedIntent & { repoProvider?: string }).repoProvider = selectedRepo.provider;
    }

    onConfirm(modified);
  };

  return (
    <div className="chat-intent-preview">
      <div className="chat-intent-header">
        <div className="chat-intent-header-left">
          <span className="chat-intent-category">{intent.category}</span>
          {isMultiAgent && (
            <span className="chat-intent-mode-badge" style={{ background: patternInfo.color }}>
              {patternInfo.label}
            </span>
          )}
        </div>
        <span className="chat-intent-confidence">
          {Math.round(intent.confidence * 100)}% match
        </span>
      </div>
      <div className="chat-intent-summary">{intent.summary}</div>

      {isMultiAgent && intent.subtasks ? (
        <SubtaskList subtasks={intent.subtasks} pattern={intent.executionMode} />
      ) : (
        <div className="chat-intent-details">
          <div><strong>Agent:</strong> {intent.agentConfig.name}</div>
          <div><strong>Model:</strong> {intent.agentConfig.model}</div>
          <div><strong>Tools:</strong> {intent.agentConfig.tools.join(', ')}</div>
          {intent.templateName && (
            <div><strong>Template:</strong> {intent.templateName}</div>
          )}
          {intent.schedule && (
            <div><strong>Schedule:</strong> Every {intent.schedule}</div>
          )}
        </div>
      )}

      <div className="chat-intent-cost">
        Budget cap: <strong>${intent.agentConfig.maxCostPerExecution.toFixed(2)}</strong>
        {isMultiAgent && <span className="chat-intent-agent-count"> ({intent.subtasks?.length} agents)</span>}
        {intent.requiresApproval && (
          <span className="chat-intent-approval"> (requires approval)</span>
        )}
      </div>

      {configuring && (
        <div className="chat-intent-configure">
          {/* Workspace project picker */}
          {wsProjects.length > 0 && (
            <div className="chat-intent-field">
              <label>Workspace project</label>
              <select
                value={selectedProjectPath}
                onChange={e => setSelectedProjectPath(e.target.value)}
                className="chat-intent-repo-select"
              >
                <option value="">Default workspace</option>
                {wsProjects.map(p => (
                  <option key={p.path} value={p.path}>
                    {p.name} ({p.branch || p.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* External repo picker */}
          <div className="chat-intent-field">
            <label>Target repository</label>
            {reposLoading ? (
              <div className="chat-intent-repos-loading">Loading repos...</div>
            ) : hasIntegrations === false ? (
              <div className="chat-intent-no-repos">
                No connected repos.{' '}
                <a href="/command-center/settings?tab=integrations">Connect a repo in Settings</a>
              </div>
            ) : (
              <select
                value={selectedRepoId}
                onChange={e => setSelectedRepoId(e.target.value)}
                className="chat-intent-repo-select"
              >
                <option value="">No repo (general task)</option>
                {Object.entries(reposByProvider).map(([provider, providerRepos]) => (
                  <optgroup key={provider} label={provider.charAt(0).toUpperCase() + provider.slice(1)}>
                    {providerRepos.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.repo_full_name}{r.is_private ? ' (private)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          {/* Advanced toggle */}
          <button
            className="chat-intent-advanced-toggle"
            onClick={() => setShowAdvanced(prev => !prev)}
            type="button"
          >
            {showAdvanced ? '▾ Hide advanced' : '▸ Advanced options'}
          </button>

          {showAdvanced && (
            <div className="chat-intent-advanced">
              <div className="chat-intent-field">
                <label>Additional instructions (optional)</label>
                <textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  placeholder="Any extra context, constraints, or focus areas..."
                  rows={2}
                />
              </div>
              <div className="chat-intent-field-row">
                <div className="chat-intent-field">
                  <label>Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)}>
                    {MODEL_OPTIONS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="chat-intent-field">
                  <label>Max cost ($)</label>
                  <input
                    type="number"
                    value={maxCost}
                    onChange={e => setMaxCost(Number(e.target.value))}
                    min={0.01}
                    step={0.5}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="chat-intent-actions">
        {configuring ? (
          <>
            <button className="chat-btn chat-btn-primary" onClick={handleLaunch}>
              {isMultiAgent ? 'Launch Orchestration' : 'Launch Agent'}
            </button>
            <button className="chat-btn chat-btn-secondary" onClick={() => setConfiguring(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            <button className="chat-btn chat-btn-primary" onClick={() => setConfiguring(true)}>
              Configure
            </button>
            <button className="chat-btn chat-btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (msg: string) => void;
  disabled: boolean;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-input-area">
      <textarea
        ref={inputRef}
        className="chat-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything or type / for commands..."
        rows={2}
        disabled={disabled}
      />
      <button
        className="chat-send-btn"
        onClick={handleSend}
        disabled={disabled || !input.trim()}
      >
        Send
      </button>
    </div>
  );
}

// ── Main Component ──

export default function ChatTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const {
    conversations, activeConversationId, messages, isProcessing,
    pendingIntent, error,
    fetchConversations, createConversation, selectConversation,
    renameConversation, deleteConversation,
    sendMessage, confirmIntent, cancelIntent, clearError,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingIntent]);

  const handleNewChat = useCallback(async () => {
    await createConversation();
  }, [createConversation]);

  const handleSend = useCallback(async (content: string) => {
    // Slash command interception
    if (content.startsWith('/')) {
      const spaceIdx = content.indexOf(' ');
      const cmd = (spaceIdx > 0 ? content.slice(1, spaceIdx) : content.slice(1)).toLowerCase();
      const args = spaceIdx > 0 ? content.slice(spaceIdx + 1).trim() : '';

      // /clear — reset conversation messages locally
      if (cmd === 'clear') {
        // Add the command as a user message, then create a fresh conversation
        await createConversation();
        return;
      }

      // Ensure a conversation exists for displaying command results
      if (!activeConversationId) {
        await createConversation();
      }

      // Show the command as a user message
      const now = new Date().toISOString();
      const userMsg: ConversationMessage = {
        id: `cmd-${Date.now()}`,
        conversation_id: activeConversationId ?? '',
        role: 'user',
        content,
        execution_id: null,
        intent: null,
        metadata: {},
        created_at: now,
      };
      useChatStore.setState(s => ({ messages: [...s.messages, userMsg] }));

      try {
        const result = await executeSlashCommand(cmd, args, onNavigate);
        if (result) {
          const sysMsg: ConversationMessage = {
            id: `cmd-res-${Date.now()}`,
            conversation_id: activeConversationId ?? '',
            role: 'assistant',
            content: result.text,
            execution_id: null,
            intent: null,
            metadata: {},
            created_at: new Date().toISOString(),
          };
          useChatStore.setState(s => ({ messages: [...s.messages, sysMsg] }));
        }
      } catch (err) {
        const errMsg: ConversationMessage = {
          id: `cmd-err-${Date.now()}`,
          conversation_id: activeConversationId ?? '',
          role: 'assistant',
          content: `**Error:** ${err instanceof Error ? err.message : 'Command failed'}`,
          execution_id: null,
          intent: null,
          metadata: {},
          created_at: new Date().toISOString(),
        };
        useChatStore.setState(s => ({ messages: [...s.messages, errMsg] }));
      }
      return;
    }

    // OAuth credential paste detection — JSON starting with { "oauth_token" or similar
    if (content.startsWith('{') && content.includes('oauth_token')) {
      try {
        JSON.parse(content); // validate it's JSON
        const res = await fetch(`${API_BASE}/api/v1/user/claude-credentials`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: content,
        });
        const sysMsg: ConversationMessage = {
          id: `oauth-${Date.now()}`,
          conversation_id: activeConversationId ?? '',
          role: 'assistant',
          content: res.ok ? '**OAuth token imported successfully.** Claude Code will use this credential.' : `**Failed to import token:** ${await res.text()}`,
          execution_id: null,
          intent: null,
          metadata: {},
          created_at: new Date().toISOString(),
        };
        useChatStore.setState(s => ({ messages: [...s.messages, sysMsg] }));
        return;
      } catch { /* not valid JSON, fall through to normal send */ }
    }

    // Two-path: try conversational chat first, fall back to intent dispatch
    if (!activeConversationId) await createConversation();

    // Show user message immediately
    const now = new Date().toISOString();
    const userMsg: ConversationMessage = {
      id: `msg-${Date.now()}`,
      conversation_id: activeConversationId ?? '',
      role: 'user',
      content,
      execution_id: null,
      intent: null,
      metadata: {},
      created_at: now,
    };
    useChatStore.setState(s => ({ messages: [...s.messages, userMsg], isProcessing: true }));

    try {
      const chatRes = await fetch(`${API_BASE}/api/v1/forge/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });

      if (chatRes.ok) {
        const data = await chatRes.json() as { mode: 'chat' | 'dispatch'; text?: string };

        if (data.mode === 'chat' && data.text) {
          // Alf answered directly — show the response
          const alfMsg: ConversationMessage = {
            id: `alf-${Date.now()}`,
            conversation_id: activeConversationId ?? '',
            role: 'assistant',
            content: data.text,
            execution_id: null,
            intent: null,
            metadata: {},
            created_at: new Date().toISOString(),
          };
          useChatStore.setState(s => ({ messages: [...s.messages, alfMsg], isProcessing: false }));
          return;
        }
      }
    } catch {
      // Chat endpoint failed — fall through to intent dispatch
    }

    // Dispatch mode — send to intent parser
    useChatStore.setState(() => ({ isProcessing: false }));
    await sendMessage(content);
  }, [sendMessage, activeConversationId, createConversation, onNavigate]);

  const handleConfirm = useCallback(async (modified?: ParsedIntent) => {
    if (modified) {
      await confirmIntent(modified);
    } else if (pendingIntent) {
      await confirmIntent(pendingIntent);
    }
  }, [pendingIntent, confirmIntent]);

  return (
    <div className="chat-container">
      {conversations.length > 1 && (
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={selectConversation}
          onCreate={handleNewChat}
          onRename={renameConversation}
          onDelete={deleteConversation}
        />
      )}
      <div className="chat-main">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <div className="chat-welcome-beacon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              </div>
              <h2>{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}. I'm Alf.</h2>
              <p>Tell me what you need — I'll figure out who to assign, what tools to use, and get it done. Ask me anything or pick a quick action below.</p>
              <div className="chat-suggestions">
                <button onClick={() => handleSend('Scan my systems for security vulnerabilities')}>
                  <span className="chat-sugg-icon">&#x1F6E1;</span>
                  Run a security scan
                </button>
                <button onClick={() => handleSend('/briefing')}>
                  <span className="chat-sugg-icon">&#x1F4CB;</span>
                  Morning briefing
                </button>
                <button onClick={() => handleSend('Monitor my infrastructure and fix anything that looks wrong')}>
                  <span className="chat-sugg-icon">&#x2764;</span>
                  Health check + auto-fix
                </button>
                <button onClick={() => handleSend('Research my top 3 competitors and summarize their strengths')}>
                  <span className="chat-sugg-icon">&#x1F50D;</span>
                  Competitor research
                </button>
                <button onClick={() => handleSend('Write a weekly status report from this week\u2019s activity')}>
                  <span className="chat-sugg-icon">&#x1F4DD;</span>
                  Generate status report
                </button>
                <button onClick={() => handleSend('Create a specialist to monitor customer reviews on our site')}>
                  <span className="chat-sugg-icon">&#x2B50;</span>
                  Build a new specialist
                </button>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {isProcessing && !pendingIntent && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-avatar">AI</div>
              <div className="chat-msg-content">
                <div className="chat-msg-text chat-thinking">Thinking...</div>
              </div>
            </div>
          )}

          {pendingIntent && (
            <IntentPreview
              intent={pendingIntent}
              onConfirm={handleConfirm}
              onCancel={cancelIntent}
            />
          )}

          {error && (
            <div className="chat-error">
              <span>{error}</span>
              <button onClick={clearError}>Dismiss</button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-hint">Enter to send &middot; Shift+Enter for new line &middot; /help for commands</div>
        <ChatInput onSend={handleSend} disabled={isProcessing} />
      </div>
    </div>
  );
}
