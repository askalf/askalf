import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { hubApi } from '../../hooks/useHubApi';
import { useToast } from '../../components/Toast';
import TabBar from '../../components/TabBar';
import type {
  Agent,
  AgentDetail,
} from '../../hooks/useHubApi';
import type { ForgeEvent } from '../../constants/status';
import { relativeTime } from '../../utils/format';
import AgentConfigEditor from './AgentConfigEditor';
import './FleetTab.css';

// ── Types ──

type DetailTab = 'overview' | 'logs' | 'exec' | 'config';
type SortColumn = 'name' | 'status' | 'tasks' | 'age';
type SortDir = 'asc' | 'desc';

function getTools(agent: Agent): string[] {
  if (agent.enabled_tools?.length) return agent.enabled_tools;
  const cfg = agent.config as Record<string, unknown>;
  return (cfg?.tools as string[]) || (cfg?.enabled_tools as string[]) || [];
}

// ── Stats Cards ──

function FleetStats({ agents }: { agents: Agent[] }) {
  const active = agents.filter(a => a.status === 'running').length;
  const idle = agents.filter(a => a.status !== 'running' && a.status !== 'error').length;
  const errors = agents.filter(a => a.status === 'error').length;
  const tasksDone = agents.reduce((sum, a) => sum + a.tasks_completed, 0);
  const tasksFailed = agents.reduce((sum, a) => sum + a.tasks_failed, 0);
  const totalTasks = tasksDone + tasksFailed;
  const successRate = totalTasks > 0 ? Math.round((tasksDone / totalTasks) * 100) : 0;

  return (
    <div className="fleet-stats-grid">
      <div className="fleet-stat-card">
        <div className="fleet-stat-value green">{active}</div>
        <div className="fleet-stat-label">Running</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value muted">{idle}</div>
        <div className="fleet-stat-label">Standing By</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value red">{errors}</div>
        <div className="fleet-stat-label">Errors</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value violet">{tasksDone}</div>
        <div className="fleet-stat-label">Tasks Done</div>
      </div>
      <div className="fleet-stat-card">
        <div className={`fleet-stat-value ${successRate >= 90 ? 'green' : successRate >= 70 ? 'amber' : 'red'}`}>{successRate}%</div>
        <div className="fleet-stat-label">Success Rate</div>
      </div>
      <div className="fleet-stat-card">
        <div className="fleet-stat-value muted">{agents.length}</div>
        <div className="fleet-stat-label">Total Workers</div>
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
    { key: 'name', label: 'WORKER' },
    { key: 'status', label: 'STATUS' },
    { key: 'tasks', label: 'SUCCESS' },
    { key: 'age', label: 'LAST ACTIVE' },
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
              <td>
                {(() => {
                  const total = agent.tasks_completed + agent.tasks_failed;
                  if (total === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                  const rate = Math.round((agent.tasks_completed / total) * 100);
                  return <><span className={rate >= 90 ? 'fleet-rate-good' : rate >= 70 ? 'fleet-rate-ok' : 'fleet-rate-bad'}>{rate}%</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({total})</span></>;
                })()}
              </td>
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

// ── Schedule Editor ──

function ScheduleEditor({ agentId, currentSchedule, currentInterval }: { agentId: string; currentSchedule: string; currentInterval?: number }) {
  const [editing, setEditing] = useState(false);
  const [scheduleType, setScheduleType] = useState(currentSchedule === 'manual' ? 'manual' : 'continuous');
  const [intervalMin, setIntervalMin] = useState(currentInterval || 60);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  if (!editing) {
    const label = currentSchedule === 'manual' || !currentSchedule
      ? 'Manual'
      : `Every ${currentInterval || '?'} min`;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="fleet-overview-value">{label}</span>
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: 'rgba(255,255,255,.5)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={scheduleType}
          onChange={(e) => setScheduleType(e.target.value)}
          style={{ padding: '4px 8px', background: 'var(--deep)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12 }}
        >
          <option value="manual">Manual</option>
          <option value="continuous">Continuous</option>
        </select>
        {scheduleType === 'continuous' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>every</span>
            <input
              type="number"
              value={intervalMin}
              onChange={(e) => setIntervalMin(Math.max(5, parseInt(e.target.value) || 30))}
              min={5}
              max={1440}
              style={{ width: 60, padding: '4px 6px', background: 'var(--deep)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12, textAlign: 'center' }}
            />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>min</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await fetch(`${window.location.origin}/api/v1/admin/agents/${agentId}/schedule`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  schedule_type: scheduleType === 'continuous' ? 'scheduled' : 'manual',
                  schedule_interval_minutes: scheduleType === "continuous" ? intervalMin : null,
                  is_continuous: scheduleType === 'continuous',
                }),
              });
              addToast('Schedule updated', 'success');
              setEditing(false);
            } catch {
              addToast('Failed to update schedule', 'error');
            }
            setSaving(false);
          }}
          style={{ padding: '3px 12px', background: 'rgba(124,58,237,.2)', border: '1px solid rgba(124,58,237,.3)', borderRadius: 4, color: '#c4b5fd', fontSize: 11, cursor: 'pointer' }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          style={{ padding: '3px 12px', background: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: 'rgba(255,255,255,.4)', fontSize: 11, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
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

      <TabBar tabs={tabs} active={tab} onChange={(k) => onTabChange(k as DetailTab)} className="fleet-detail-tabs" tabClassName="fleet-detail-tab" ariaLabel={`${agent.name} sections`} />

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
            <div className="fleet-overview-row" style={{ flexDirection: 'column', gap: 8 }}>
              <span className="fleet-overview-label">Schedule</span>
              <ScheduleEditor agentId={agent.id} currentSchedule={agent.schedule || 'manual'} currentInterval={agent.schedule_interval_minutes ?? undefined} />
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
    const VALID_STATUSES = new Set(['idle', 'running', 'error', 'disabled', 'paused', 'scheduled']);
    if (latest?.category === 'agent' && latest.agentId && typeof latest.status === 'string' && VALID_STATUSES.has(latest.status)) {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === latest.agentId
            ? { ...a, status: latest.status as Agent['status'] }
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
          <h2 className="fleet-title">Your Team</h2>
        </div>
        <p className="fleet-subtitle">Alf builds and manages your workers automatically</p>
      </div>

      {/* Scrollable content */}
      <div className="fleet-content-area">
        {/* Stats */}
        <FleetStats agents={activeAgents} />

        {/* Agent panel */}
        <div className="fleet-panel">
          <div className="fleet-panel-header">
            <span className="fleet-section-title">Workers</span>
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
                aria-label="Search workers"
                placeholder="Search workers..."
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
                  {search ? 'No workers match your search' : 'No workers yet — tell Alf what you need and workers will be created automatically'}
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
