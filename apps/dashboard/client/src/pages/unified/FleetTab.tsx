import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { hubApi } from '../../hooks/useHubApi';
import { useToast } from '../../components/Toast';
import type {
  Agent,
  AgentDetail,
} from '../../hooks/useHubApi';
import AgentConfigEditor from './AgentConfigEditor';
import './FleetTab.css';

// ── Types ──

type DetailTab = 'overview' | 'logs' | 'exec' | 'config';
type SortColumn = 'name' | 'status' | 'tasks' | 'age';
type SortDir = 'asc' | 'desc';

// ── Helpers ──

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getTools(agent: Agent): string[] {
  if (agent.enabled_tools?.length) return agent.enabled_tools;
  const cfg = agent.config as Record<string, unknown>;
  return (cfg?.tools as string[]) || (cfg?.enabled_tools as string[]) || [];
}

// ── Stats Cards ──

function FleetStats({ agents }: { agents: Agent[] }) {
  const active = agents.filter(a => a.status === 'active' || a.status === 'running').length;
  const idle = agents.filter(a => a.status === 'idle').length;
  const errors = agents.filter(a => a.status === 'error').length;
  const tasksDone = agents.reduce((sum, a) => sum + a.tasks_completed, 0);
  const tasksFailed = agents.reduce((sum, a) => sum + a.tasks_failed, 0);

  return (
    <div className="fleet-stats-grid">
      <div className="fleet-stat-card">
        <div className="fleet-stat-value green">{active}</div>
        <div className="fleet-stat-label">Active</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value muted">{idle}</div>
        <div className="fleet-stat-label">Idle</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value red">{errors}</div>
        <div className="fleet-stat-label">Errors</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value violet">{tasksDone}</div>
        <div className="fleet-stat-label">Completed{tasksFailed > 0 ? ` / ${tasksFailed} failed` : ''}</div>
      </div>
    </div>
  );
}

// ── Agent List ──

function AgentList({
  agents,
  selectedId,
  sortColumn,
  sortDir,
  onSort,
  onSelect,
}: {
  agents: Agent[];
  selectedId: string | null;
  sortColumn: SortColumn;
  sortDir: SortDir;
  onSort: (col: SortColumn) => void;
  onSelect: (id: string) => void;
}) {
  const sorted = [...agents].sort((a, b) => {
    let cmp = 0;
    switch (sortColumn) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'status': cmp = a.status.localeCompare(b.status); break;
      case 'tasks': cmp = (a.tasks_completed + a.tasks_failed) - (b.tasks_completed + b.tasks_failed); break;
      case 'age': cmp = new Date(a.last_run_at || 0).getTime() - new Date(b.last_run_at || 0).getTime(); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const cols: { key: SortColumn; label: string }[] = [
    { key: 'name', label: 'NAME' },
    { key: 'status', label: 'STATUS' },
    { key: 'tasks', label: 'DONE/TOTAL' },
    { key: 'age', label: 'LAST RUN' },
  ];

  return (
    <div className="fleet-table-wrap">
      <table className="fleet-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                className={sortColumn === c.key ? 'sorted' : ''}
                onClick={() => onSort(c.key)}
                aria-sort={sortColumn === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                style={{ cursor: 'pointer' }}
              >
                {c.label}
                {sortColumn === c.key && (
                  <span className="fleet-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent) => (
            <tr
              key={agent.id}
              className={selectedId === agent.id ? 'selected' : ''}
              onClick={() => onSelect(agent.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(agent.id); } }}
              tabIndex={0}
              aria-selected={selectedId === agent.id}
              role="row"
              style={{ cursor: 'pointer' }}
            >
              <td>
                {agent.name}
                <span className="fleet-agent-type">{agent.type}</span>
              </td>
              <td>
                <span className={`fleet-status ${agent.status}`}>
                  <span className="fleet-status-dot" aria-hidden="true" />
                  {agent.status}
                </span>
              </td>
              <td>{agent.tasks_completed}/{agent.tasks_completed + agent.tasks_failed}</td>
              <td>{relativeTime(agent.last_run_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Agent Detail Panel ──

interface LiveLogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
}

function AgentDetailPanel({
  detail,
  agent,
  tab,
  onTabChange,
  onClose,
  onRun,
  onPause,
  onDecommission,
  onRecommission,
  actionLoading,
  liveLogEntries,
  onConfigSaved,
}: {
  detail: AgentDetail | null;
  agent: Agent;
  tab: DetailTab;
  onTabChange: (t: DetailTab) => void;
  onClose: () => void;
  onRun: (prompt?: string) => void;
  onPause: () => void;
  onDecommission: () => void;
  onRecommission: () => void;
  actionLoading: boolean;
  liveLogEntries: LiveLogEntry[];
  onConfigSaved: () => void;
}) {
  const [execPrompt, setExecPrompt] = useState('');
  const tools = getTools(agent);

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'logs', label: 'Logs' },
    { key: 'exec', label: 'Exec' },
    { key: 'config', label: 'Config' },
  ];

  return (
    <div className="fleet-detail">
      <div className="fleet-detail-header">
        <span className="fleet-detail-title">{agent.name}</span>
        <button className="fleet-detail-close" onClick={onClose} aria-label={`Close ${agent.name} details`}>&times;</button>
      </div>

      <div className="fleet-detail-tabs" role="tablist" aria-label={`${agent.name} sections`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`fleet-detail-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="fleet-detail-body">
        {tab === 'overview' && (
          <>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Status</span>
              <span className={`fleet-status ${agent.status}`}>
                <span className="fleet-status-dot" aria-hidden="true" />{agent.status}
              </span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Type</span>
              <span className="fleet-overview-value">{agent.type}</span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Autonomy</span>
              <span className="fleet-overview-value">{agent.autonomy_level}/5</span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Schedule</span>
              <span className="fleet-overview-value">{agent.schedule || 'manual'}</span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Tasks</span>
              <span className="fleet-overview-value">
                {agent.tasks_completed} done / {agent.tasks_failed} failed
              </span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Last Run</span>
              <span className="fleet-overview-value">{relativeTime(agent.last_run_at)}</span>
            </div>
            {agent.description && (
              <div className="fleet-overview-row" style={{ flexDirection: 'column', gap: 4 }}>
                <span className="fleet-overview-label">Description</span>
                <span className="fleet-overview-value" style={{ fontWeight: 400, fontSize: 12, lineHeight: 1.5 }}>
                  {agent.description}
                </span>
              </div>
            )}
            {tools.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span className="fleet-overview-label">Tools</span>
                <div className="fleet-tools-list">
                  {tools.map((t) => (
                    <span key={t} className="fleet-tool-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'logs' && (
          <div className="fleet-logs">
            {liveLogEntries.length > 0 && liveLogEntries.map((entry) => (
              <div key={entry.id} className="fleet-log-line fleet-log-live">
                <span className="fleet-log-time">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className={`fleet-log-level ${entry.level}`}>{entry.level}</span>
                <span className="fleet-log-msg">{entry.message}</span>
              </div>
            ))}
            {detail?.logs && detail.logs.length > 0 ? (
              detail.logs.slice(0, 100).map((log) => (
                <div key={log.id} className="fleet-log-line">
                  <span className="fleet-log-time">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className={`fleet-log-level ${log.level}`}>{log.level}</span>
                  <span className="fleet-log-msg">{log.message}</span>
                </div>
              ))
            ) : liveLogEntries.length === 0 ? (
              <div className="fleet-empty">No logs available</div>
            ) : null}
          </div>
        )}

        {tab === 'exec' && (
          <div className="fleet-exec">
            <label htmlFor="fleet-exec-prompt" className="fleet-overview-label">Prompt</label>
            <textarea
              id="fleet-exec-prompt"
              value={execPrompt}
              onChange={(e) => setExecPrompt(e.target.value)}
              placeholder="Enter prompt to run agent with..."
            />
            <div className="fleet-exec-actions">
              <button
                className="fleet-btn primary"
                disabled={actionLoading}
                onClick={() => { onRun(execPrompt || undefined); setExecPrompt(''); }}
              >
                {actionLoading ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>
        )}

        {tab === 'config' && (
          <AgentConfigEditor agent={agent} onSaved={onConfigSaved} />
        )}
      </div>

      <div className="fleet-detail-actions">
        {agent.is_decommissioned ? (
          <button className="fleet-btn primary" onClick={onRecommission} disabled={actionLoading}>
            Recommission
          </button>
        ) : (
          <>
            <button className="fleet-btn primary" onClick={() => onRun()} disabled={actionLoading || agent.status === 'running'}>
              Run
            </button>
            <button className="fleet-btn" onClick={onPause} disabled={actionLoading || agent.status === 'paused'}>
              Pause
            </button>
            <button className="fleet-btn danger" onClick={onDecommission} disabled={actionLoading}>
              Decommission
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──

interface ForgeEvent {
  category: string;
  type: string;
  receivedAt: number;
  agentId?: string;
  status?: string;
  [key: string]: unknown;
}

export default function FleetTab({ wsEvents = [] }: { wsEvents?: ForgeEvent[] }) {
  const { addToast } = useToast();

  // Core state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailData, setDetailData] = useState<AgentDetail | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [liveLogEntries, setLiveLogEntries] = useState<LiveLogEntry[]>([]);
  const [showDecommissioned, setShowDecommissioned] = useState(false);

  // Polling: agents every 15s
  const pollCallback = useCallback(async () => {
    try {
      const agentsRes = await hubApi.agents.list(showDecommissioned);
      setAgents(agentsRes.agents);
    } catch {
      addToast('Failed to refresh fleet data', 'error');
    }
  }, [addToast, showDecommissioned]);

  usePolling(pollCallback, 15000);

  // WS-accelerated refresh
  const latestEventTs = useRef(0);
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (!latest || latest.receivedAt <= latestEventTs.current) return;
    latestEventTs.current = latest.receivedAt;
    if (latest.category === 'agent' || latest.category === 'execution') {
      pollCallback();
    }
  }, [wsEvents, pollCallback]);

  // Optimistic agent status from WS
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (latest?.category === 'agent' && latest.agentId) {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === latest.agentId
            ? { ...a, status: (latest.status as Agent['status']) || a.status }
            : a
        )
      );
    }
  }, [wsEvents]);

  // Live logs for selected agent
  const liveLogEventTs = useRef(0);
  useEffect(() => {
    if (!selectedAgentId || wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (!latest || latest.receivedAt <= liveLogEventTs.current) return;
    if (latest.category !== 'execution' || latest.agentId !== selectedAgentId) return;
    liveLogEventTs.current = latest.receivedAt;

    hubApi.agents.detail(selectedAgentId).then(setDetailData).catch(() => {});

    const agentName = agents.find((a) => a.id === selectedAgentId)?.name || 'Agent';
    const eventType = (latest.type as string) || (latest.status as string) || 'event';
    setLiveLogEntries((prev) => [
      {
        id: `live-${latest.receivedAt}`,
        timestamp: new Date(latest.receivedAt).toISOString(),
        level: eventType === 'failed' ? 'error' : 'info',
        message: `[LIVE] ${agentName} — ${eventType}${latest.output ? `: ${String(latest.output).slice(0, 120)}` : ''}`,
      },
      ...prev.slice(0, 49),
    ]);
  }, [wsEvents, selectedAgentId, agents]);

  // Fetch detail when agent selected
  useEffect(() => {
    if (!selectedAgentId) {
      setDetailData(null);
      setLiveLogEntries([]);
      return;
    }
    setLiveLogEntries([]);
    hubApi.agents.detail(selectedAgentId).then(setDetailData).catch(() => {});
  }, [selectedAgentId]);

  // Filter agents
  const activeAgents = useMemo(() =>
    showDecommissioned ? agents : agents.filter((a) => !a.is_decommissioned),
    [agents, showDecommissioned]
  );
  const filtered = useMemo(() =>
    search
      ? activeAgents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
      : activeAgents,
    [activeAgents, search]
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Actions
  const withLoading = async (key: string, fn: () => Promise<unknown>, label?: string) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await fn();
      const res = await hubApi.agents.list(showDecommissioned);
      setAgents(res.agents);
      if (label) addToast(`${label} succeeded`, 'success');
    } catch {
      addToast(label ? `${label} failed` : 'Action failed', 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleRun = (id: string, prompt?: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    withLoading(id, () => hubApi.agents.run(id, prompt), `Run ${name}`);
  };

  const handleStop = (id: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    withLoading(id, () => hubApi.agents.stop(id), `Stop ${name}`);
  };

  const handleDecommission = (id: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    if (!window.confirm(`Decommission "${name}"? This will archive the agent.`)) return;
    withLoading(id, () => hubApi.agents.decommission(id), `Decommission ${name}`);
  };

  const handleRecommission = (id: string) => {
    const name = agents.find((a) => a.id === id)?.name || 'Agent';
    withLoading(id, () => hubApi.agents.recommission(id), `Recommission ${name}`);
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  return (
    <div className="fleet-tab">
      {/* Header */}
      <div className="fleet-header">
        <div className="fleet-title-row">
          <span className="fleet-icon">&#x2B21;</span>
          <h2 className="fleet-title">Agent Fleet</h2>
        </div>
        <p className="fleet-subtitle">Manage &middot; Monitor &middot; Execute</p>
      </div>

      {/* Scrollable content */}
      <div className="fleet-content-area">
        {/* Stats */}
        <FleetStats agents={activeAgents} />

        {/* Agent panel */}
        <div className="fleet-panel">
          <div className="fleet-panel-header">
            <span className="fleet-section-title">Agents</span>
            <div className="fleet-panel-meta">
              <label className="fleet-toggle-label">
                <input
                  type="checkbox"
                  checked={showDecommissioned}
                  onChange={(e) => setShowDecommissioned(e.target.checked)}
                />
                Archived
              </label>
              <input
                className="fleet-search"
                type="search"
                aria-label="Search agents"
                placeholder="Search agents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="fleet-agent-count">{filtered.length} total</span>
            </div>
          </div>

          <div className="fleet-main">
            <div className="fleet-content">
              {filtered.length === 0 ? (
                <div className="fleet-empty">
                  {search ? 'No agents match your search' : 'No agents'}
                </div>
              ) : (
                <AgentList
                  agents={filtered}
                  selectedId={selectedAgentId}
                  sortColumn={sortColumn}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onSelect={(id) => {
                    setSelectedAgentId(selectedAgentId === id ? null : id);
                    setDetailTab('overview');
                  }}
                />
              )}
            </div>

            {selectedAgent && (
              <AgentDetailPanel
                detail={detailData}
                agent={selectedAgent}
                tab={detailTab}
                onTabChange={setDetailTab}
                onClose={() => setSelectedAgentId(null)}
                onRun={(prompt) => handleRun(selectedAgent.id, prompt)}
                onPause={() => handleStop(selectedAgent.id)}
                onDecommission={() => handleDecommission(selectedAgent.id)}
                onRecommission={() => handleRecommission(selectedAgent.id)}
                actionLoading={!!actionLoading[selectedAgent.id]}
                liveLogEntries={liveLogEntries}
                onConfigSaved={pollCallback}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
