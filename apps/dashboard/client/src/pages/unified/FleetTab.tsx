import { useState, useCallback, useEffect } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { hubApi } from '../../hooks/useHubApi';
import type {
  Agent,
  AgentDetail,
  SchedulerStatus,
  AgentPerformanceReport,
  AgentPerformanceEntry,
  CostSummary,
  DailyCost,
} from '../../hooks/useHubApi';
import './FleetTab.css';

// ── Types ──

type Namespace = 'All' | 'Security' | 'Backend' | 'Frontend' | 'DevOps' | 'QA' | 'Monitor' | 'Custom';
type ViewMode = 'grid' | 'list';
type DetailTab = 'overview' | 'logs' | 'events' | 'yaml' | 'exec';
type SortColumn = 'name' | 'status' | 'tasks' | 'age' | 'model' | 'cost';
type SortDir = 'asc' | 'desc';

const NAMESPACES: Namespace[] = ['All', 'Security', 'Backend', 'Frontend', 'DevOps', 'QA', 'Monitor', 'Custom'];

// ── Helpers ──

function classifyNamespace(agent: Agent): Namespace {
  const n = agent.name.toLowerCase();
  if (n.includes('aegis') || n.includes('security')) return 'Security';
  if (n.includes('frontend') || n.includes('ui')) return 'Frontend';
  if (n.includes('backend') || n.includes('dev')) return 'Backend';
  if (n.includes('devops') || n.includes('ops') || n.includes('infra')) return 'DevOps';
  if (n.includes('qa') || n.includes('test')) return 'QA';
  if (agent.type === 'monitor') return 'Monitor';
  return 'Custom';
}

function shortName(name: string): string {
  const words = name.split(/[\s_-]+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

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

function gaugeColor(pct: number): string {
  if (pct < 60) return 'green';
  if (pct < 85) return 'yellow';
  return 'red';
}

function getModelFromConfig(agent: Agent): string {
  const cfg = agent.config as Record<string, unknown>;
  return (cfg?.model_id as string) || (cfg?.model as string) || 'default';
}

function getCostLimit(agent: Agent): number {
  const cfg = agent.config as Record<string, unknown>;
  return (cfg?.cost_limit as number) || (cfg?.max_cost as number) || 5;
}

function getTools(agent: Agent): string[] {
  const cfg = agent.config as Record<string, unknown>;
  return (cfg?.tools as string[]) || (cfg?.enabled_tools as string[]) || [];
}

// ── Sub-components ──

function ClusterOverview({
  agents,
  costSummary,
  dailyCosts,
  schedulerStatus,
  onToggleScheduler,
  actionLoading,
}: {
  agents: Agent[];
  costSummary: CostSummary | null;
  dailyCosts: DailyCost[];
  schedulerStatus: SchedulerStatus | null;
  onToggleScheduler: () => void;
  actionLoading: Record<string, boolean>;
}) {
  const active = agents.filter((a) => !a.is_decommissioned);
  const running = active.filter((a) => a.status === 'running').length;
  const idle = active.filter((a) => a.status === 'idle').length;
  const paused = active.filter((a) => a.status === 'paused').length;
  const errored = active.filter((a) => a.status === 'error').length;

  const health = errored > 0 ? 'unhealthy' : running > 0 ? 'healthy' : 'degraded';
  const healthLabel = errored > 0 ? 'Degraded' : 'Healthy';

  const todayCost = costSummary?.total?.totalCost ?? 0;
  const weekCost = dailyCosts.reduce((s, d) => s + d.totalCost, 0);

  return (
    <div className="fleet-cluster-bar">
      <div className="fleet-cluster-left">
        <span className={`fleet-health-dot ${health}`} />
        <span className="fleet-health-label">{healthLabel}</span>
        <div className="fleet-pod-counts">
          <span style={{ color: '#4ade80' }}>{running} Running</span>
          <span>{idle} Idle</span>
          <span style={{ color: '#facc15' }}>{paused} Paused</span>
          <span style={{ color: '#f87171' }}>{errored} Error</span>
        </div>
        <div className="fleet-cost-summary">
          <span>${todayCost.toFixed(2)} today</span>
          <span>${weekCost.toFixed(2)} 7d</span>
        </div>
      </div>
      <div className="fleet-cluster-right">
        <button
          className={`fleet-btn ${schedulerStatus?.running ? 'active' : ''}`}
          onClick={onToggleScheduler}
          disabled={actionLoading['scheduler']}
        >
          {schedulerStatus?.running ? '⏸ Scheduler' : '▶ Scheduler'}
        </button>
      </div>
    </div>
  );
}

function NamespaceSelector({
  agents,
  namespace,
  onSelect,
}: {
  agents: Agent[];
  namespace: Namespace;
  onSelect: (ns: Namespace) => void;
}) {
  const active = agents.filter((a) => !a.is_decommissioned);
  const counts: Record<Namespace, number> = {
    All: active.length,
    Security: 0, Backend: 0, Frontend: 0, DevOps: 0, QA: 0, Monitor: 0, Custom: 0,
  };
  active.forEach((a) => { counts[classifyNamespace(a)]++; });

  return (
    <div className="fleet-namespaces">
      {NAMESPACES.map((ns) => (
        <button
          key={ns}
          className={`fleet-ns-pill ${namespace === ns ? 'active' : ''}`}
          onClick={() => onSelect(ns)}
        >
          {ns}
          <span className="fleet-ns-count">{counts[ns]}</span>
        </button>
      ))}
    </div>
  );
}

function PodCard({
  agent,
  perf,
  selected,
  onClick,
  onRun,
  onPause,
  onStop,
  actionLoading,
}: {
  agent: Agent;
  perf: AgentPerformanceEntry | undefined;
  selected: boolean;
  onClick: () => void;
  onRun: () => void;
  onPause: () => void;
  onStop: () => void;
  actionLoading: boolean;
}) {
  const costLimit = getCostLimit(agent);
  const agentCost = perf?.totalCost ?? 0;
  const costPct = costLimit > 0 ? Math.min((agentCost / costLimit) * 100, 100) : 0;
  const total = agent.tasks_completed + agent.tasks_failed;
  const taskPct = total > 0 ? (agent.tasks_completed / total) * 100 : 0;
  const model = getModelFromConfig(agent);

  return (
    <div className={`fleet-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="fleet-card-header">
        <div className="fleet-card-abbr">{shortName(agent.name)}</div>
        <div className="fleet-card-title">
          <span className="fleet-card-name">{agent.name}</span>
          <span className="fleet-card-type">{agent.type}</span>
        </div>
        <span className={`fleet-status ${agent.status}`}>
          <span className="fleet-status-dot" />
          {agent.status}
        </span>
      </div>

      <div className="fleet-gauge">
        <div className="fleet-gauge-label">
          <span>Cost</span>
          <span>${agentCost.toFixed(2)} / ${costLimit.toFixed(2)}</span>
        </div>
        <div className="fleet-gauge-bar">
          <div
            className={`fleet-gauge-fill ${gaugeColor(costPct)}`}
            style={{ width: `${costPct}%` }}
          />
        </div>
      </div>

      <div className="fleet-gauge">
        <div className="fleet-gauge-label">
          <span>Tasks</span>
          <span>{agent.tasks_completed} done / {agent.tasks_failed} fail</span>
        </div>
        <div className="fleet-gauge-bar">
          <div
            className={`fleet-gauge-fill ${gaugeColor(100 - taskPct)}`}
            style={{ width: `${taskPct}%` }}
          />
        </div>
      </div>

      <div className="fleet-card-meta">
        <span className="fleet-card-model">{model}</span>
        <span className="fleet-card-age">{relativeTime(agent.last_run_at)}</span>
      </div>

      <div className="fleet-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="fleet-btn primary" onClick={onRun} disabled={actionLoading || agent.status === 'running'}>
          ▶
        </button>
        <button className="fleet-btn" onClick={onPause} disabled={actionLoading || agent.status === 'paused'}>
          ⏸
        </button>
        <button className="fleet-btn danger" onClick={onStop} disabled={actionLoading || agent.status !== 'running'}>
          ⏹
        </button>
      </div>
    </div>
  );
}

function PodList({
  agents,
  perfMap,
  selectedId,
  sortColumn,
  sortDir,
  onSort,
  onSelect,
}: {
  agents: Agent[];
  perfMap: Map<string, AgentPerformanceEntry>;
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
      case 'age': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
      case 'model': cmp = getModelFromConfig(a).localeCompare(getModelFromConfig(b)); break;
      case 'cost': {
        const ca = perfMap.get(a.id)?.totalCost ?? 0;
        const cb = perfMap.get(b.id)?.totalCost ?? 0;
        cmp = ca - cb;
        break;
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const cols: { key: SortColumn; label: string }[] = [
    { key: 'name', label: 'NAME' },
    { key: 'status', label: 'STATUS' },
    { key: 'tasks', label: 'TASKS' },
    { key: 'age', label: 'AGE' },
    { key: 'model', label: 'MODEL' },
    { key: 'cost', label: 'COST/LIMIT' },
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
              >
                {c.label}
                {sortColumn === c.key && (
                  <span className="fleet-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent) => {
            const perf = perfMap.get(agent.id);
            const cost = perf?.totalCost ?? 0;
            const limit = getCostLimit(agent);
            return (
              <tr
                key={agent.id}
                className={selectedId === agent.id ? 'selected' : ''}
                onClick={() => onSelect(agent.id)}
              >
                <td>{agent.name}</td>
                <td>
                  <span className={`fleet-status ${agent.status}`}>
                    <span className="fleet-status-dot" />
                    {agent.status}
                  </span>
                </td>
                <td>{agent.tasks_completed}/{agent.tasks_completed + agent.tasks_failed}</td>
                <td>{relativeTime(agent.created_at)}</td>
                <td>{getModelFromConfig(agent)}</td>
                <td>${cost.toFixed(2)}/${limit.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PodDetail({
  detail,
  agent,
  perf,
  tab,
  onTabChange,
  onClose,
  onRun,
  onPause,
  onDecommission,
  actionLoading,
}: {
  detail: AgentDetail | null;
  agent: Agent;
  perf: AgentPerformanceEntry | undefined;
  tab: DetailTab;
  onTabChange: (t: DetailTab) => void;
  onClose: () => void;
  onRun: (prompt?: string) => void;
  onPause: () => void;
  onDecommission: () => void;
  actionLoading: boolean;
}) {
  const [execPrompt, setExecPrompt] = useState('');

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'logs', label: 'Logs' },
    { key: 'events', label: 'Events' },
    { key: 'yaml', label: 'YAML' },
    { key: 'exec', label: 'Exec' },
  ];

  const model = getModelFromConfig(agent);
  const tools = getTools(agent);
  const costLimit = getCostLimit(agent);
  const agentCost = perf?.totalCost ?? 0;

  // Build YAML-like display
  const yamlContent = buildYaml(agent, perf);

  return (
    <div className="fleet-detail">
      <div className="fleet-detail-header">
        <span className="fleet-detail-title">{agent.name}</span>
        <button className="fleet-detail-close" onClick={onClose}>&times;</button>
      </div>

      <div className="fleet-detail-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
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
                <span className="fleet-status-dot" />{agent.status}
              </span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Type</span>
              <span className="fleet-overview-value">{agent.type}</span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Model</span>
              <span className="fleet-overview-value">{model}</span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Autonomy</span>
              <span className="fleet-overview-value">
                <span className="fleet-autonomy-bar">
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className={`fleet-autonomy-seg ${i < agent.autonomy_level ? 'filled' : ''}`}
                    />
                  ))}
                  <span style={{ marginLeft: 6, fontSize: 11 }}>{agent.autonomy_level}/10</span>
                </span>
              </span>
            </div>
            <div className="fleet-overview-row">
              <span className="fleet-overview-label">Cost</span>
              <span className="fleet-overview-value">${agentCost.toFixed(2)} / ${costLimit.toFixed(2)}</span>
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
              <div style={{ marginTop: 8 }}>
                <span className="fleet-overview-label" style={{ fontSize: 12 }}>Tools</span>
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
            ) : (
              <div className="fleet-empty">No logs available</div>
            )}
          </div>
        )}

        {tab === 'events' && (
          <div className="fleet-events">
            {detail?.tasks && detail.tasks.length > 0 ? (
              detail.tasks.slice(0, 50).map((task) => (
                <div key={task.id} className="fleet-event">
                  <span className={`fleet-event-dot ${task.status}`} />
                  <div className="fleet-event-content">
                    <span className="fleet-event-type">{task.type} — {task.status}</span>
                    <span className="fleet-event-time">{relativeTime(task.started_at)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="fleet-empty">No events</div>
            )}
          </div>
        )}

        {tab === 'yaml' && (
          <div className="fleet-yaml" dangerouslySetInnerHTML={{ __html: yamlContent }} />
        )}

        {tab === 'exec' && (
          <div className="fleet-exec">
            <textarea
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
                {actionLoading ? 'Running...' : '▶ Run'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="fleet-detail-actions">
        <button className="fleet-btn primary" onClick={() => onRun()} disabled={actionLoading || agent.status === 'running'}>
          Run
        </button>
        <button className="fleet-btn" onClick={onPause} disabled={actionLoading || agent.status === 'paused'}>
          Pause
        </button>
        <button className="fleet-btn danger" onClick={onDecommission} disabled={actionLoading}>
          Decommission
        </button>
      </div>
    </div>
  );
}

function buildYaml(agent: Agent, perf: AgentPerformanceEntry | undefined): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const k = (s: string) => `<span class="fleet-yaml-key">${esc(s)}</span>`;
  const str = (s: string) => `<span class="fleet-yaml-string">"${esc(s)}"</span>`;
  const num = (n: number) => `<span class="fleet-yaml-number">${n}</span>`;
  const bool = (b: boolean) => `<span class="fleet-yaml-bool">${b}</span>`;
  const nul = () => `<span class="fleet-yaml-null">null</span>`;
  const br = (s: string) => `<span class="fleet-yaml-bracket">${esc(s)}</span>`;

  const model = getModelFromConfig(agent);
  const tools = getTools(agent);
  const costLimit = getCostLimit(agent);

  const lines = [
    `${k('apiVersion')}: ${str('forge/v1')}`,
    `${k('kind')}: ${str('Agent')}`,
    `${k('metadata')}:`,
    `  ${k('name')}: ${str(agent.name)}`,
    `  ${k('id')}: ${str(agent.id)}`,
    `  ${k('namespace')}: ${str(classifyNamespace(agent))}`,
    `  ${k('created')}: ${str(agent.created_at)}`,
    `${k('spec')}:`,
    `  ${k('type')}: ${str(agent.type)}`,
    `  ${k('model')}: ${str(model)}`,
    `  ${k('autonomyLevel')}: ${num(agent.autonomy_level)}`,
    `  ${k('schedule')}: ${agent.schedule ? str(agent.schedule) : nul()}`,
    `  ${k('costLimit')}: ${num(costLimit)}`,
    `  ${k('tools')}: ${br('[')}${tools.map((t) => str(t)).join(', ')}${br(']')}`,
    `${k('status')}:`,
    `  ${k('phase')}: ${str(agent.status)}`,
    `  ${k('lastRun')}: ${agent.last_run_at ? str(agent.last_run_at) : nul()}`,
    `  ${k('tasksCompleted')}: ${num(agent.tasks_completed)}`,
    `  ${k('tasksFailed')}: ${num(agent.tasks_failed)}`,
    `  ${k('pendingInterventions')}: ${num(agent.pending_interventions)}`,
    `  ${k('isDecommissioned')}: ${bool(agent.is_decommissioned)}`,
  ];

  if (perf) {
    lines.push(
      `${k('metrics')}:`,
      `  ${k('totalExecutions')}: ${num(perf.totalExecutions)}`,
      `  ${k('successRate')}: ${num(Math.round(perf.successRate * 100))}`,
      `  ${k('totalCost')}: ${num(parseFloat(perf.totalCost.toFixed(4)))}`,
      `  ${k('avgDurationMs')}: ${num(Math.round(perf.avgDurationMs))}`,
    );
  }

  return lines.join('\n');
}

// ── Main Component ──

export default function FleetTab() {
  // Core state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [namespace, setNamespace] = useState<Namespace>('All');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailData, setDetailData] = useState<AgentDetail | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [performance, setPerformance] = useState<AgentPerformanceReport | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([]);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Performance map by agent ID
  const perfMap = new Map<string, AgentPerformanceEntry>();
  performance?.agents.forEach((a) => perfMap.set(a.agentId, a));

  // Polling: agents + scheduler + costs every 15s
  const pollCallback = useCallback(async () => {
    try {
      const [agentsRes, schedRes, costRes] = await Promise.all([
        hubApi.agents.list(),
        hubApi.reports.scheduler(),
        hubApi.costs.summary({ days: 7 }),
      ]);
      setAgents(agentsRes.agents);
      setSchedulerStatus(schedRes);
      setCostSummary(costRes.summary);
      setDailyCosts(costRes.dailyCosts || []);
    } catch {
      // swallow
    }
  }, []);

  usePolling(pollCallback, 15000);

  // One-time fetches
  useEffect(() => {
    hubApi.agents.performance(7).then(setPerformance).catch(() => {});
  }, []);

  // Fetch detail when agent selected
  useEffect(() => {
    if (!selectedAgentId) {
      setDetailData(null);
      return;
    }
    hubApi.agents.detail(selectedAgentId).then(setDetailData).catch(() => {});
  }, [selectedAgentId]);

  // Filter agents
  const activeAgents = agents.filter((a) => !a.is_decommissioned);
  const filtered = namespace === 'All'
    ? activeAgents
    : activeAgents.filter((a) => classifyNamespace(a) === namespace);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Actions
  const withLoading = async (key: string, fn: () => Promise<unknown>) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await fn();
      // Refresh agents
      const res = await hubApi.agents.list();
      setAgents(res.agents);
    } catch {
      // swallow
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleRun = (id: string, prompt?: string) =>
    withLoading(id, () => hubApi.agents.run(id, prompt));

  const handleStop = (id: string) =>
    withLoading(id, () => hubApi.agents.stop(id));

  const handleDecommission = (id: string) =>
    withLoading(id, () => hubApi.agents.decommission(id));

  const handleToggleScheduler = () =>
    withLoading('scheduler', async () => {
      const action = schedulerStatus?.running ? 'stop' : 'start';
      await hubApi.reports.toggleScheduler(action);
      const s = await hubApi.reports.scheduler();
      setSchedulerStatus(s);
    });

  const handleBatchProcess = () =>
    withLoading('batch', () => hubApi.agents.batchProcess());

  const handleBatchPause = () =>
    withLoading('batch', () => hubApi.agents.batchPause());

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDir('asc');
    }
  };

  return (
    <div>
      <ClusterOverview
        agents={agents}
        costSummary={costSummary}
        dailyCosts={dailyCosts}
        schedulerStatus={schedulerStatus}
        onToggleScheduler={handleToggleScheduler}
        actionLoading={actionLoading}
      />

      <div className="fleet-toolbar">
        <NamespaceSelector agents={agents} namespace={namespace} onSelect={setNamespace} />
        <div className="fleet-toolbar-right">
          <button
            className={`fleet-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            Grid
          </button>
          <button
            className={`fleet-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            className="fleet-btn primary"
            onClick={handleBatchProcess}
            disabled={actionLoading['batch']}
          >
            {actionLoading['batch'] ? 'Processing...' : 'Apply'}
          </button>
          <button
            className="fleet-btn"
            onClick={handleBatchPause}
            disabled={actionLoading['batch']}
          >
            Scale Down
          </button>
        </div>
      </div>

      <div className="fleet-main">
        <div className="fleet-content">
          {filtered.length === 0 ? (
            <div className="fleet-empty">No agents in this namespace</div>
          ) : viewMode === 'grid' ? (
            <div className="fleet-grid">
              {filtered.map((agent) => (
                <PodCard
                  key={agent.id}
                  agent={agent}
                  perf={perfMap.get(agent.id)}
                  selected={selectedAgentId === agent.id}
                  onClick={() => {
                    setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id);
                    setDetailTab('overview');
                  }}
                  onRun={() => handleRun(agent.id)}
                  onPause={() => handleStop(agent.id)}
                  onStop={() => handleStop(agent.id)}
                  actionLoading={!!actionLoading[agent.id]}
                />
              ))}
            </div>
          ) : (
            <PodList
              agents={filtered}
              perfMap={perfMap}
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
          <PodDetail
            detail={detailData}
            agent={selectedAgent}
            perf={perfMap.get(selectedAgent.id)}
            tab={detailTab}
            onTabChange={setDetailTab}
            onClose={() => setSelectedAgentId(null)}
            onRun={(prompt) => handleRun(selectedAgent.id, prompt)}
            onPause={() => handleStop(selectedAgent.id)}
            onDecommission={() => handleDecommission(selectedAgent.id)}
            actionLoading={!!actionLoading[selectedAgent.id]}
          />
        )}
      </div>

    </div>
  );
}
