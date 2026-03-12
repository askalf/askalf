import { useCallback, useEffect, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import { relativeTime } from '../../utils/format';
import { STATUS_COLORS } from '../../constants/status';
import type { CoordinationSession, CoordinationTask, Agent } from '../../hooks/useHubApi';

const PATTERN_INFO: Record<string, { label: string; color: string }> = {
  pipeline: { label: 'Pipeline', color: 'var(--water)' },
  'fan-out': { label: 'Fan-Out', color: 'var(--synapse)' },
  consensus: { label: 'Consensus', color: 'var(--crystal)' },
};

function PatternBadge({ pattern }: { pattern: string }) {
  const info = PATTERN_INFO[pattern] || { label: pattern, color: 'var(--text-muted)' };
  return (
    <span className="coord-pattern-badge" style={{ background: info.color }}>
      {info.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="coord-status-badge" style={{ background: STATUS_COLORS[status] || 'var(--text-muted)' }}>
      {status}
    </span>
  );
}

function TaskProgress({ tasks }: { tasks: CoordinationTask[] }) {
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const total = tasks.length;
  const pct = total > 0 ? ((completed + failed) / total) * 100 : 0;

  return (
    <div className="coord-progress">
      <div className="coord-progress-bar">
        <div className="coord-progress-fill" style={{ width: `${pct}%`, background: failed > 0 ? 'var(--error)' : 'var(--crystal)' }} />
      </div>
      <span className="coord-progress-label">{completed}/{total} tasks</span>
    </div>
  );
}

function SessionCard({
  session,
  isSelected,
  onSelect,
}: {
  session: CoordinationSession;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const tasks = session.plan?.tasks || [];
  return (
    <div className={`coord-session-card ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="coord-session-header">
        <span className="coord-session-title">{session.plan?.title || 'Untitled Session'}</span>
        <StatusBadge status={session.status} />
      </div>
      <div className="coord-session-meta">
        <PatternBadge pattern={session.plan?.pattern || 'pipeline'} />
        <span className="coord-session-lead">Lead: {session.plan?.leadAgentName || 'Unknown'}</span>
        <span className="coord-session-time">{relativeTime(session.startedAt)}</span>
      </div>
      {tasks.length > 0 && <TaskProgress tasks={tasks} />}
    </div>
  );
}

function TaskRow({ task }: { task: CoordinationTask }) {
  return (
    <div className="coord-task-row">
      <div className="coord-task-status-dot" style={{ background: STATUS_COLORS[task.status] || 'var(--text-muted)' }} />
      <div className="coord-task-info">
        <div className="coord-task-title">{task.title}</div>
        <div className="coord-task-agent">{task.assignedAgent}</div>
      </div>
      <StatusBadge status={task.status} />
      {task.dependencies.length > 0 && (
        <span className="coord-task-deps">deps: {task.dependencies.length}</span>
      )}
    </div>
  );
}

function SessionDetail({
  session,
  onCancel,
}: {
  session: CoordinationSession;
  onCancel: () => void;
}) {
  const plan = session.plan;
  if (!plan) return <div className="coord-detail-empty">Plan data expired (24h TTL)</div>;

  return (
    <div className="coord-detail">
      <div className="coord-detail-header">
        <h3>{plan.title}</h3>
        <div className="coord-detail-badges">
          <PatternBadge pattern={plan.pattern} />
          <StatusBadge status={plan.status} />
        </div>
      </div>

      <div className="coord-detail-info">
        <div>Lead: <strong>{plan.leadAgentName}</strong></div>
        <div>Tasks: <strong>{plan.tasks.length}</strong></div>
        <div>Started: <strong>{relativeTime(plan.createdAt)}</strong></div>
        {session.completedAt && <div>Completed: <strong>{relativeTime(session.completedAt)}</strong></div>}
      </div>

      <div className="coord-detail-tasks">
        <h4>Tasks</h4>
        {plan.tasks.map((task) => (
          <div key={task.id} className="coord-detail-task">
            <TaskRow task={task} />
            {task.result && (
              <div className="coord-task-result">
                <pre>{task.result.substring(0, 500)}{task.result.length > 500 ? '...' : ''}</pre>
              </div>
            )}
            {task.error && (
              <div className="coord-task-error">{task.error}</div>
            )}
          </div>
        ))}
      </div>

      {session.summary && (
        <div className="coord-detail-summary">
          <h4>Summary</h4>
          <pre>{session.summary}</pre>
        </div>
      )}

      {session.status === 'active' && (
        <button className="coord-cancel-btn" onClick={onCancel}>Cancel Session</button>
      )}
    </div>
  );
}

interface TaskFormRow {
  title: string;
  description: string;
  agentName: string;
  dependencies: string[];
}

function StartTeamModal({
  agents,
  onClose,
  onSubmit,
}: {
  agents: Agent[];
  onClose: () => void;
  onSubmit: (data: {
    leadAgentId: string; leadAgentName: string; title: string;
    pattern: 'pipeline' | 'fan-out' | 'consensus';
    tasks: TaskFormRow[];
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [pattern, setPattern] = useState<'pipeline' | 'fan-out' | 'consensus'>('pipeline');
  const [leadAgent, setLeadAgent] = useState('');
  const [tasks, setTasks] = useState<TaskFormRow[]>([{ title: '', description: '', agentName: '', dependencies: [] }]);
  const [submitting, setSubmitting] = useState(false);

  const activeAgents = agents.filter((a) => !a.is_decommissioned);

  const addTask = () => setTasks([...tasks, { title: '', description: '', agentName: '', dependencies: [] }]);
  const removeTask = (i: number) => setTasks(tasks.filter((_, idx) => idx !== i));
  const updateTask = (i: number, field: keyof TaskFormRow, value: string | string[]) => {
    const updated = [...tasks];
    (updated[i] as unknown as Record<string, unknown>)[field] = value;
    setTasks(updated);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !leadAgent || tasks.some((t) => !t.title.trim() || !t.agentName)) return;
    setSubmitting(true);
    const lead = activeAgents.find((a) => a.id === leadAgent);
    onSubmit({
      leadAgentId: leadAgent,
      leadAgentName: lead?.name || 'Unknown',
      title: title.trim(),
      pattern,
      tasks: tasks.map((t) => ({ ...t, title: t.title.trim(), description: t.description.trim() })),
    });
    setSubmitting(false);
  };

  return (
    <div className="coord-modal-overlay" onClick={onClose}>
      <div className="coord-modal" onClick={(e) => e.stopPropagation()}>
        <div className="coord-modal-header">
          <h3>Start Team Session</h3>
          <button className="coord-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="coord-modal-body">
          <label className="coord-form-label">
            Title
            <input className="coord-form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Security Audit Sprint" />
          </label>

          <label className="coord-form-label">
            Pattern
            <div className="coord-pattern-select">
              {(['pipeline', 'fan-out', 'consensus'] as const).map((p) => (
                <button
                  key={p}
                  className={`coord-pattern-option ${pattern === p ? 'active' : ''}`}
                  onClick={() => setPattern(p)}
                  style={{ borderColor: pattern === p ? PATTERN_INFO[p].color : undefined }}
                >
                  <strong>{PATTERN_INFO[p].label}</strong>
                </button>
              ))}
            </div>
          </label>

          <label className="coord-form-label">
            Lead Agent
            <select className="coord-form-input" value={leadAgent} onChange={(e) => setLeadAgent(e.target.value)}>
              <option value="">Select agent...</option>
              {activeAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>

          <div className="coord-form-label">
            Tasks
            {tasks.map((task, i) => (
              <div key={i} className="coord-task-form-row">
                <input className="coord-form-input" placeholder="Task title" value={task.title}
                  onChange={(e) => updateTask(i, 'title', e.target.value)} />
                <input className="coord-form-input" placeholder="Description" value={task.description}
                  onChange={(e) => updateTask(i, 'description', e.target.value)} />
                <select className="coord-form-input coord-form-agent-select" value={task.agentName}
                  onChange={(e) => updateTask(i, 'agentName', e.target.value)}>
                  <option value="">Agent...</option>
                  {activeAgents.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                </select>
                {tasks.length > 1 && (
                  <button className="coord-remove-task" onClick={() => removeTask(i)} aria-label="Remove task">-</button>
                )}
              </div>
            ))}
            <button className="coord-add-task" onClick={addTask}>+ Add Task</button>
          </div>
        </div>

        <div className="coord-modal-footer">
          <button className="coord-btn secondary" onClick={onClose}>Cancel</button>
          <button className="coord-btn primary" onClick={handleSubmit} disabled={submitting || !title.trim() || !leadAgent}>
            {submitting ? 'Starting...' : 'Start Team'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FleetCoordination() {
  const sessions = useHubStore((s) => s.coordinationSessions);
  const stats = useHubStore((s) => s.coordinationStats);
  const selected = useHubStore((s) => s.selectedCoordinationSession);
  const setSelected = useHubStore((s) => s.setSelectedCoordinationSession);
  const showStartTeam = useHubStore((s) => s.showStartTeam);
  const setShowStartTeam = useHubStore((s) => s.setShowStartTeam);
  const fetchSessions = useHubStore((s) => s.fetchCoordinationSessions);
  const fetchStats = useHubStore((s) => s.fetchCoordinationStats);
  const fetchDetail = useHubStore((s) => s.fetchCoordinationSessionDetail);
  const startTeam = useHubStore((s) => s.startTeam);
  const cancelSession = useHubStore((s) => s.cancelCoordinationSession);
  const agents = useHubStore((s) => s.agents);
  const loading = useHubStore((s) => s.loading['coordinationSessions']);

  // Initial fetch
  useEffect(() => {
    fetchSessions();
    fetchStats();
  }, [fetchSessions, fetchStats]);

  // Poll every 10s
  const poll = useCallback(() => {
    fetchSessions();
    fetchStats();
  }, [fetchSessions, fetchStats]);
  usePolling(poll, 10000);

  const handleSelect = (session: CoordinationSession) => {
    if (selected?.id === session.id) {
      setSelected(null);
    } else {
      fetchDetail(session.id);
    }
  };

  const handleStartTeam = async (data: {
    leadAgentId: string; leadAgentName: string; title: string;
    pattern: 'pipeline' | 'fan-out' | 'consensus';
    tasks: Array<{ title: string; description: string; agentName: string; dependencies: string[] }>;
  }) => {
    const ok = await startTeam(data);
    if (ok) setShowStartTeam(false);
  };

  return (
    <div className="coord-container">
      {/* Stats Row */}
      <div className="coord-stats-grid">
        <div className="coord-stat-card">
          <div className="coord-stat-value" style={{ color: 'var(--synapse)' }}>{stats?.activeSessions ?? 0}</div>
          <div className="coord-stat-label">Active</div>
        </div>
        <div className="coord-stat-card">
          <div className="coord-stat-value" style={{ color: 'var(--crystal)' }}>{stats?.completedSessions ?? 0}</div>
          <div className="coord-stat-label">Completed</div>
        </div>
        <div className="coord-stat-card">
          <div className="coord-stat-value" style={{ color: 'var(--error)' }}>{stats?.failedSessions ?? 0}</div>
          <div className="coord-stat-label">Failed</div>
        </div>
        <div className="coord-stat-card">
          <div className="coord-stat-value">{stats?.totalTasks ?? 0}</div>
          <div className="coord-stat-label">Total Tasks</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="coord-toolbar">
        <h3>Team Sessions</h3>
        <button className="coord-btn primary" onClick={() => setShowStartTeam(true)}>Start Team</button>
      </div>

      {/* Content */}
      <div className="coord-content">
        {/* Session List */}
        <div className="coord-session-list">
          {loading && sessions.length === 0 && <div className="coord-empty">Loading...</div>}
          {!loading && sessions.length === 0 && <div className="coord-empty">No coordination sessions yet. Start a team to begin.</div>}
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isSelected={selected?.id === session.id}
              onSelect={() => handleSelect(session)}
            />
          ))}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="coord-detail-panel">
            <SessionDetail
              session={selected}
              onCancel={() => cancelSession(selected.id)}
            />
          </div>
        )}
      </div>

      {/* Start Team Modal */}
      {showStartTeam && (
        <StartTeamModal
          agents={agents}
          onClose={() => setShowStartTeam(false)}
          onSubmit={handleStartTeam}
        />
      )}
    </div>
  );
}
