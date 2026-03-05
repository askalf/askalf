import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore, type User } from '../../stores/auth';
import './TerminalTab.css';

// ── Types ──

interface TerminalLine {
  id: string;
  type: 'system' | 'input' | 'output' | 'error' | 'success' | 'info' | 'divider' | 'banner';
  text: string;
  timestamp?: string;
}

interface SetupState {
  hasApiKey: boolean;
  hasProfile: boolean;
  agentCount: number;
  fleetHealthy: boolean;
  loading: boolean;
}

// ── API helpers ──

const getApiBase = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

const API = getApiBase();

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

// ── Slash command registry ──

interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<TerminalLine[]>;
}

interface CommandContext {
  user: User | null;
  setup: SetupState;
  navigate: (tab: string) => void;
}

const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });
let lineId = 0;
const line = (type: TerminalLine['type'], text: string): TerminalLine => ({
  id: `L${++lineId}-${Date.now()}`,
  type,
  text,
  timestamp: type !== 'banner' && type !== 'divider' ? now() : undefined,
});

const COMMANDS: SlashCommand[] = [
  {
    name: 'help',
    aliases: ['?', 'h'],
    description: 'Show available commands',
    handler: async () => [
      line('divider', ''),
      line('info', 'AVAILABLE COMMANDS'),
      line('divider', ''),
      line('output', '/help              Show this help message'),
      line('output', '/status            System status overview'),
      line('output', '/setup             Run onboarding wizard'),
      line('output', '/keys              Manage AI provider keys'),
      line('output', '/fleet             Agent fleet overview'),
      line('output', '/costs             Cost summary'),
      line('output', '/tickets           Active ticket board'),
      line('output', '/settings [tab]    Open settings (profile|security|ai-keys|costs)'),
      line('output', '/agents            List all agents'),
      line('output', '/exec <agent> ...  Dispatch agent with prompt'),
      line('output', '/logs [agent]      Recent execution logs'),
      line('output', '/whoami            Current user info'),
      line('output', '/clear             Clear terminal'),
      line('divider', ''),
      line('info', 'Type any natural language to chat with the system.'),
      line('info', 'Use Tab to autocomplete commands.'),
    ],
  },
  {
    name: 'status',
    aliases: ['stat', 'st'],
    description: 'System status overview',
    handler: async (_args, ctx) => {
      const lines: TerminalLine[] = [line('divider', ''), line('info', 'SYSTEM STATUS')];
      try {
        const [health, agents, costs] = await Promise.all([
          apiFetch<{ status: string; checks: { database: boolean; redis: boolean }; uptime: number }>('/health'),
          apiFetch<{ agents: { id: string; name: string; status: string }[] }>('/api/v1/forge/agents').catch(() => ({ agents: [] })),
          apiFetch<{ summary: { total: { totalCost: number; executionCount: number } } }>('/api/v1/admin/reports/costs/summary').catch(() => ({ summary: { total: { totalCost: 0, executionCount: 0 } } })),
        ]);

        const upH = Math.floor(health.uptime / 3600);
        const upM = Math.floor((health.uptime % 3600) / 60);
        lines.push(line('divider', ''));
        lines.push(line(health.status === 'healthy' ? 'success' : 'error', `  Platform    ${health.status.toUpperCase()}`));
        lines.push(line(health.checks.database ? 'success' : 'error', `  Database    ${health.checks.database ? 'connected' : 'DOWN'}`));
        lines.push(line(health.checks.redis ? 'success' : 'error', `  Redis       ${health.checks.redis ? 'connected' : 'DOWN'}`));
        lines.push(line('output', `  Uptime      ${upH}h ${upM}m`));
        const active = agents.agents.filter(a => a.status === 'active').length;
        lines.push(line('output', `  Agents      ${active}/${agents.agents.length} active`));
        lines.push(line('output', `  Today       $${costs.summary.total.totalCost.toFixed(2)} (${costs.summary.total.executionCount} runs)`));
        lines.push(line('output', `  API Key     ${ctx.setup.hasApiKey ? 'configured' : 'NOT SET \u2014 run /setup'}`));
        lines.push(line('divider', ''));
      } catch (err) {
        lines.push(line('error', `  Failed to fetch status: ${err instanceof Error ? err.message : String(err)}`));
      }
      return lines;
    },
  },
  {
    name: 'setup',
    aliases: ['onboard', 'init'],
    description: 'Run onboarding wizard',
    handler: async (_args, ctx) => {
      const lines: TerminalLine[] = [
        line('divider', ''),
        line('info', 'ONBOARDING STATUS'),
        line('divider', ''),
      ];

      // Check each step
      const checks = [
        { label: 'Profile configured', done: ctx.setup.hasProfile, action: '/settings profile' },
        { label: 'AI provider key', done: ctx.setup.hasApiKey, action: '/settings ai-keys' },
        { label: 'Agents available', done: ctx.setup.agentCount > 0, action: '/fleet' },
      ];

      for (const check of checks) {
        const icon = check.done ? '\u2713' : '\u2717';
        lines.push(line(check.done ? 'success' : 'error', `  [${icon}] ${check.label}${check.done ? '' : `  \u2192 ${check.action}`}`));
      }

      lines.push(line('divider', ''));

      const allDone = checks.every(c => c.done);
      if (allDone) {
        lines.push(line('success', 'All set! Your account is fully configured.'));
        lines.push(line('info', 'Try: /fleet to see your agents, or just type a request.'));
      } else {
        const next = checks.find(c => !c.done);
        lines.push(line('info', `Next step: ${next?.action ?? '/help'}`));
        if (!ctx.setup.hasApiKey) {
          lines.push(line('info', 'To connect your Anthropic API key:'));
          lines.push(line('output', '  /settings ai-keys'));
          lines.push(line('info', 'Or navigate to Settings > AI Keys in the tab bar.'));
        }
      }
      return lines;
    },
  },
  {
    name: 'keys',
    aliases: ['apikeys', 'providers'],
    description: 'Manage AI provider keys',
    handler: async () => {
      try {
        const data = await apiFetch<{ providers: { provider: string; has_key: boolean; model_count: number }[] }>('/api/v1/user/providers');
        const lines: TerminalLine[] = [line('divider', ''), line('info', 'AI PROVIDER KEYS'), line('divider', '')];
        if (data.providers.length === 0) {
          lines.push(line('error', '  No providers configured.'));
          lines.push(line('info', '  Run /settings ai-keys to add your API key.'));
        } else {
          for (const p of data.providers) {
            lines.push(line(p.has_key ? 'success' : 'error',
              `  ${p.provider.padEnd(12)} ${p.has_key ? 'connected' : 'not set'}  (${p.model_count} models)`));
          }
        }
        lines.push(line('divider', ''));
        return lines;
      } catch {
        return [line('info', 'Navigate to Settings > AI Keys to manage your provider keys.'), line('info', '  /settings ai-keys')];
      }
    },
  },
  {
    name: 'fleet',
    aliases: ['agents-summary', 'pods'],
    description: 'Agent fleet overview',
    handler: async () => {
      try {
        const data = await apiFetch<{ agents: { id: string; name: string; status: string; type: string; is_internal: boolean }[] }>('/api/v1/forge/agents');
        const lines: TerminalLine[] = [line('divider', ''), line('info', 'AGENT FLEET'), line('divider', '')];

        const internal = data.agents.filter(a => a.is_internal);
        const userFacing = data.agents.filter(a => !a.is_internal);

        if (internal.length > 0) {
          lines.push(line('output', '  INTERNAL AGENTS'));
          for (const a of internal) {
            const statusIcon = a.status === 'active' ? '\u25cf' : '\u25cb';
            const statusColor = a.status === 'active' ? 'success' : 'output';
            lines.push(line(statusColor, `    ${statusIcon} ${a.name.padEnd(16)} ${a.status.padEnd(10)} ${a.type}`));
          }
        }
        if (userFacing.length > 0) {
          lines.push(line('output', '  USER AGENTS'));
          for (const a of userFacing) {
            const statusIcon = a.status === 'active' ? '\u25cf' : '\u25cb';
            const statusColor = a.status === 'active' ? 'success' : 'output';
            lines.push(line(statusColor, `    ${statusIcon} ${a.name.padEnd(16)} ${a.status.padEnd(10)} ${a.type}`));
          }
        }
        lines.push(line('divider', ''));
        return lines;
      } catch (err) {
        return [line('error', `Failed to fetch fleet: ${err instanceof Error ? err.message : String(err)}`)];
      }
    },
  },
  {
    name: 'costs',
    aliases: ['budget', 'spend'],
    description: 'Cost summary',
    handler: async () => {
      try {
        const data = await apiFetch<{ summary: { total: { totalCost: number; executionCount: number }; cli?: { totalCost: number; executionCount: number; estimatedCost?: number } } }>('/api/v1/admin/reports/costs/summary');
        const lines: TerminalLine[] = [line('divider', ''), line('info', 'COST SUMMARY (TODAY)'), line('divider', '')];
        const t = data.summary.total;
        const c = data.summary.cli;
        lines.push(line('output', `  Billed       $${t.totalCost.toFixed(2)}  (${t.executionCount} executions)`));
        if (c) {
          lines.push(line('output', `  CLI (OAuth)  $${c.totalCost.toFixed(2)}  (${c.executionCount} runs, ~$${(c.estimatedCost ?? 0).toFixed(2)} est.)`));
        }
        lines.push(line('divider', ''));
        return lines;
      } catch (err) {
        return [line('error', `Failed to fetch costs: ${err instanceof Error ? err.message : String(err)}`)];
      }
    },
  },
  {
    name: 'tickets',
    aliases: ['tix', 'board'],
    description: 'Active ticket board',
    handler: async () => {
      try {
        const data = await apiFetch<{ tickets: { id: string; title: string; status: string; priority: string; assigned_to: string }[] }>('/api/v1/admin/reports/tickets?status=open,in_progress&limit=20');
        const lines: TerminalLine[] = [line('divider', ''), line('info', 'ACTIVE TICKETS'), line('divider', '')];
        if (data.tickets.length === 0) {
          lines.push(line('output', '  No active tickets.'));
        } else {
          for (const t of data.tickets) {
            const pri = t.priority === 'urgent' ? '!!' : t.priority === 'high' ? '! ' : '  ';
            const st = t.status === 'in_progress' ? 'WIP' : 'OPEN';
            lines.push(line('output', `  ${pri} [${st}] ${t.id.slice(0, 12)} ${t.title.slice(0, 50).padEnd(50)} \u2192 ${t.assigned_to}`));
          }
        }
        lines.push(line('divider', ''));
        return lines;
      } catch (err) {
        return [line('error', `Failed to fetch tickets: ${err instanceof Error ? err.message : String(err)}`)];
      }
    },
  },
  {
    name: 'agents',
    aliases: ['ls'],
    description: 'List all agents',
    handler: async () => {
      try {
        const data = await apiFetch<{ agents: { id: string; name: string; status: string; type: string; model_id: string }[] }>('/api/v1/forge/agents');
        const lines: TerminalLine[] = [line('divider', ''), line('info', 'ALL AGENTS'), line('divider', '')];
        lines.push(line('output', `  ${'NAME'.padEnd(18)} ${'STATUS'.padEnd(10)} ${'TYPE'.padEnd(10)} MODEL`));
        lines.push(line('output', `  ${''.padEnd(18, '\u2500')} ${''.padEnd(10, '\u2500')} ${''.padEnd(10, '\u2500')} ${''.padEnd(20, '\u2500')}`));
        for (const a of data.agents) {
          lines.push(line(a.status === 'active' ? 'output' : 'info',
            `  ${a.name.padEnd(18)} ${a.status.padEnd(10)} ${a.type.padEnd(10)} ${a.model_id ?? 'default'}`));
        }
        lines.push(line('divider', ''));
        return lines;
      } catch (err) {
        return [line('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)];
      }
    },
  },
  {
    name: 'logs',
    aliases: ['executions', 'history'],
    description: 'Recent execution logs',
    handler: async () => {
      try {
        const data = await apiFetch<{ executions: { id: string; status: string; started_at: string; completed_at: string | null; agent_name?: string; input?: string }[] }>('/api/v1/forge/executions?limit=10&sort=desc');
        const lines: TerminalLine[] = [line('divider', ''), line('info', 'RECENT EXECUTIONS'), line('divider', '')];
        if (data.executions.length === 0) {
          lines.push(line('output', '  No recent executions.'));
        } else {
          for (const e of data.executions) {
            const st = e.status === 'completed' ? '\u2713' : e.status === 'running' ? '\u25b6' : e.status === 'failed' ? '\u2717' : '\u25cb';
            const statusType: TerminalLine['type'] = e.status === 'completed' ? 'success' : e.status === 'failed' ? 'error' : 'output';
            const when = e.started_at ? new Date(e.started_at).toLocaleString() : 'pending';
            lines.push(line(statusType,
              `  ${st} ${(e.agent_name ?? e.id.slice(0, 8)).padEnd(16)} ${e.status.padEnd(10)} ${when}`));
          }
        }
        lines.push(line('divider', ''));
        return lines;
      } catch (err) {
        return [line('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)];
      }
    },
  },
  {
    name: 'whoami',
    description: 'Current user info',
    handler: async (_args, ctx) => {
      if (!ctx.user) return [line('error', 'Not authenticated.')];
      return [
        line('divider', ''),
        line('output', `  User     ${ctx.user.name ?? ctx.user.email ?? 'unknown'}`),
        line('output', `  Email    ${ctx.user.email ?? 'not set'}`),
        line('output', `  Role     ${ctx.user.role ?? 'user'}`),
        line('output', `  API Key  ${ctx.setup.hasApiKey ? 'configured' : 'not set'}`),
        line('divider', ''),
      ];
    },
  },
  {
    name: 'settings',
    description: 'Open settings panel',
    handler: async (args, ctx) => {
      const tab = args.trim() || 'ai-keys';
      ctx.navigate(`settings`);
      return [line('info', `Opening settings (${tab})...`)];
    },
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Clear terminal',
    handler: async () => [],  // special-cased in processInput
  },
];

// ── Component ──

export default function TerminalTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { user } = useAuthStore();
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [setup, setSetup] = useState<SetupState>({ hasApiKey: false, hasProfile: false, agentCount: 0, fleetHealthy: false, loading: true });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Check setup state
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const [providers, agents] = await Promise.all([
          apiFetch<{ providers: { has_key: boolean }[] }>('/api/v1/user/providers').catch(() => ({ providers: [] })),
          apiFetch<{ agents: { id: string; status: string }[] }>('/api/v1/forge/agents').catch(() => ({ agents: [] })),
        ]);

        const hasKey = providers.providers.some(p => p.has_key);
        const hasProfile = !!(user?.name || user?.email);
        const activeAgents = agents.agents.filter(a => a.status === 'active').length;

        setSetup({ hasApiKey: hasKey, hasProfile, agentCount: activeAgents, fleetHealthy: activeAgents > 0, loading: false });
      } catch {
        setSetup(s => ({ ...s, loading: false }));
      }
    };
    checkSetup();
  }, [user]);

  // Boot sequence
  useEffect(() => {
    if (setup.loading) return;

    const bootLines: TerminalLine[] = [
      line('banner', 'ASKALF COMMAND CENTER'),
      line('banner', ''),
      line('system', 'AskAlf v1.0 \u2014 AI Agent Orchestration Platform'),
      line('system', `Session: ${user?.name ?? user?.email ?? 'anonymous'} | ${new Date().toLocaleDateString()}`),
      line('divider', ''),
    ];

    if (!setup.hasApiKey) {
      bootLines.push(line('error', 'No AI provider key configured.'));
      bootLines.push(line('info', 'Run /setup to get started, or /settings ai-keys to add your key.'));
      bootLines.push(line('divider', ''));
    } else if (!setup.hasProfile) {
      bootLines.push(line('info', 'Complete your profile: /settings profile'));
      bootLines.push(line('divider', ''));
    } else {
      bootLines.push(line('success', `Ready. ${setup.agentCount} agents online.`));
      bootLines.push(line('info', 'Type /help for commands or enter a natural language request.'));
      bootLines.push(line('divider', ''));
    }

    setLines(bootLines);
  }, [setup.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx: CommandContext = {
    user,
    setup,
    navigate: (tab: string) => onNavigate?.(tab),
  };

  const processInput = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Add to history
    setHistory(h => [trimmed, ...h.slice(0, 49)]);
    setHistoryIdx(-1);

    // Echo input
    setLines(prev => [...prev, line('input', `$ ${trimmed}`)]);

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const [cmdName, ...argParts] = trimmed.slice(1).split(/\s+/);
      const args = argParts.join(' ');

      // Special: /clear
      if (cmdName === 'clear' || cmdName === 'cls') {
        setLines([]);
        return;
      }

      const cmd = COMMANDS.find(c => c.name === cmdName || c.aliases?.includes(cmdName ?? ''));
      if (cmd) {
        try {
          const result = await cmd.handler(args, ctx);
          setLines(prev => [...prev, ...result]);
        } catch (err) {
          setLines(prev => [...prev, line('error', `Command error: ${err instanceof Error ? err.message : String(err)}`)]);
        }
      } else {
        setLines(prev => [...prev, line('error', `Unknown command: /${cmdName}`), line('info', 'Type /help for available commands.')]);
      }
      return;
    }

    // Natural language — echo back as a coming-soon for now
    // TODO: Wire to chat/assistant API for natural language processing
    setLines(prev => [
      ...prev,
      line('info', 'Natural language processing coming soon.'),
      line('info', 'For now, use slash commands. Type /help to see what\'s available.'),
    ]);
  }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void processInput(input);
      setInput('');
      setSuggestions([]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx] ?? '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx] ?? '');
      } else {
        setHistoryIdx(-1);
        setInput('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (input.startsWith('/')) {
        const partial = input.slice(1).toLowerCase();
        const matches = COMMANDS.filter(c =>
          c.name.startsWith(partial) || c.aliases?.some(a => a.startsWith(partial))
        );
        if (matches.length === 1) {
          setInput(`/${matches[0]!.name} `);
          setSuggestions([]);
        } else if (matches.length > 1) {
          setSuggestions(matches.map(c => `/${c.name}`));
        }
      }
    } else {
      setSuggestions([]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    setHistoryIdx(-1);
    if (!e.target.value.startsWith('/')) {
      setSuggestions([]);
    }
  };

  return (
    <div className="terminal-container" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-viewport" ref={scrollRef}>
        {lines.map(l => (
          <div key={l.id} className={`terminal-line terminal-${l.type}`}>
            {l.type === 'banner' ? (
              <span className="terminal-banner-text">{l.text}</span>
            ) : l.type === 'divider' ? (
              <span className="terminal-divider-line" />
            ) : (
              <>
                {l.timestamp && <span className="terminal-ts">{l.timestamp}</span>}
                <span className="terminal-content">{l.text}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {suggestions.length > 1 && (
        <div className="terminal-suggestions">
          {suggestions.map(s => (
            <span key={s} className="terminal-suggestion" onClick={() => { setInput(s + ' '); setSuggestions([]); inputRef.current?.focus(); }}>{s}</span>
          ))}
        </div>
      )}

      <div className="terminal-input-row">
        <span className="terminal-prompt">{user?.name ?? '$'} &gt;</span>
        <input
          ref={inputRef}
          className="terminal-input"
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a command or /help..."
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
      </div>
    </div>
  );
}
