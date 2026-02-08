import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './Tasks.css';

const API_BASE = window.location.hostname.includes('askalf.org')
  ? ''
  : 'http://localhost:3001';

interface Task {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: string;
  type: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  parent_task_id: string | null;
  handoff_to_agent_id: string | null;
  handoff_to_agent_name: string | null;
}

interface TaskStats {
  totals: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    handoffs: number;
  };
  recentByAgent: Array<{
    agent_name: string;
    task_count: string;
    success_rate: string;
  }>;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  in_progress: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#9ca3af',
};

export default function Tasks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskDetail, setTaskDetail] = useState<{
    task: Task;
    logs: Array<{ id: string; level: string; message: string; metadata: Record<string, unknown>; created_at: string }>;
    childTasks: Array<{ id: string; agent_name: string; type: string; status: string; created_at: string }>;
    interventions: Array<{ id: string; type: string; title: string; status: string; created_at: string }>;
  } | null>(null);

  const currentPage = parseInt(searchParams.get('page') || '1');
  const statusFilter = searchParams.get('status') || '';
  const agentFilter = searchParams.get('agent_id') || '';

  const fetchTasks = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      });
      if (statusFilter) params.set('status', statusFilter);
      if (agentFilter) params.set('agent_id', agentFilter);

      const [tasksRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/tasks?${params}`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/tasks/stats`, { credentials: 'include' }),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
        setPagination(data.pagination);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskDetail = async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/tasks/${taskId}`, { credentials: 'include' });
      if (res.ok) {
        setTaskDetail(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch task detail:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [currentPage, statusFilter, agentFilter]);

  useEffect(() => {
    if (selectedTask) {
      fetchTaskDetail(selectedTask.id);
    } else {
      setTaskDetail(null);
    }
  }, [selectedTask]);

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    setSearchParams(params);
  };

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    setSearchParams(params);
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return '-';
    const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  return (
    <div className="tasks-page">
      <header className="tasks-header">
        <div>
          <h1>Task Audit Trail</h1>
          <p className="header-subtitle">Complete history of all agent tasks and handoffs</p>
        </div>
      </header>

      {/* Stats Overview */}
      {stats && (
        <div className="tasks-stats">
          <div className="stat-card">
            <span className="stat-value">{stats.totals.total}</span>
            <span className="stat-label">Total Tasks</span>
          </div>
          <div className="stat-card">
            <span className="stat-value pending">{stats.totals.pending}</span>
            <span className="stat-label">Pending</span>
          </div>
          <div className="stat-card">
            <span className="stat-value in-progress">{stats.totals.in_progress}</span>
            <span className="stat-label">In Progress</span>
          </div>
          <div className="stat-card">
            <span className="stat-value completed">{stats.totals.completed}</span>
            <span className="stat-label">Completed</span>
          </div>
          <div className="stat-card">
            <span className="stat-value failed">{stats.totals.failed}</span>
            <span className="stat-label">Failed</span>
          </div>
          <div className="stat-card">
            <span className="stat-value handoffs">{stats.totals.handoffs}</span>
            <span className="stat-label">Handoffs</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="tasks-filters">
        <select
          value={statusFilter}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Tasks Table */}
      <div className="tasks-table-container">
        {loading ? (
          <div className="tasks-loading">Loading tasks...</div>
        ) : (
          <>
            <table className="tasks-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Handoff</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className={task.status}>
                    <td>
                      <div className="agent-cell">
                        <span className="agent-name">{task.agent_name}</span>
                        <span className="agent-type">{task.agent_type}</span>
                      </div>
                    </td>
                    <td className="task-type">{task.type}</td>
                    <td>
                      <span
                        className="status-badge"
                        style={{ background: `${STATUS_COLORS[task.status]}20`, color: STATUS_COLORS[task.status] }}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="timestamp">{formatDate(task.started_at || task.created_at)}</td>
                    <td className="duration">{formatDuration(task.started_at, task.completed_at)}</td>
                    <td>
                      {task.handoff_to_agent_name ? (
                        <span className="handoff-badge">→ {task.handoff_to_agent_name}</span>
                      ) : task.parent_task_id ? (
                        <span className="handoff-badge child">← Child</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <button
                        className="view-btn"
                        onClick={() => setSelectedTask(task)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {tasks.length === 0 && (
              <p className="no-data">No tasks found</p>
            )}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="pagination">
                <button
                  disabled={!pagination.hasPrev}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  ← Prev
                </button>
                <span className="page-info">
                  Page {pagination.page} of {pagination.totalPages}
                  <span className="total-count">({pagination.total} total)</span>
                </span>
                <button
                  disabled={!pagination.hasNext}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="task-modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Task Details</h2>
              <button className="close-btn" onClick={() => setSelectedTask(null)}>×</button>
            </div>

            <div className="modal-content">
              <div className="detail-section">
                <h3>Overview</h3>
                <div className="detail-grid">
                  <div><strong>Agent:</strong> {selectedTask.agent_name}</div>
                  <div><strong>Type:</strong> {selectedTask.type}</div>
                  <div><strong>Status:</strong> {selectedTask.status}</div>
                  <div><strong>Created:</strong> {formatDate(selectedTask.created_at)}</div>
                  <div><strong>Started:</strong> {formatDate(selectedTask.started_at)}</div>
                  <div><strong>Completed:</strong> {formatDate(selectedTask.completed_at)}</div>
                </div>
              </div>

              {selectedTask.error && (
                <div className="detail-section error">
                  <h3>Error</h3>
                  <pre>{selectedTask.error}</pre>
                </div>
              )}

              {taskDetail?.logs && taskDetail.logs.length > 0 && (
                <div className="detail-section">
                  <h3>Logs ({taskDetail.logs.length})</h3>
                  <div className="logs-list">
                    {taskDetail.logs.map((log) => (
                      <div key={log.id} className={`log-entry ${log.level}`}>
                        <span className="log-time">{formatDate(log.created_at)}</span>
                        <span className={`log-level ${log.level}`}>{log.level}</span>
                        <span className="log-message">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {taskDetail?.childTasks && taskDetail.childTasks.length > 0 && (
                <div className="detail-section">
                  <h3>Handoff Tasks ({taskDetail.childTasks.length})</h3>
                  <div className="child-tasks">
                    {taskDetail.childTasks.map((child) => (
                      <div key={child.id} className="child-task">
                        <span className="child-agent">{child.agent_name}</span>
                        <span className="child-type">{child.type}</span>
                        <span className={`status-badge ${child.status}`}>{child.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {taskDetail?.interventions && taskDetail.interventions.length > 0 && (
                <div className="detail-section">
                  <h3>Interventions ({taskDetail.interventions.length})</h3>
                  <div className="interventions-list">
                    {taskDetail.interventions.map((intervention) => (
                      <div key={intervention.id} className="intervention-item">
                        <span className="intervention-title">{intervention.title}</span>
                        <span className={`status-badge ${intervention.status}`}>{intervention.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedTask.output && Object.keys(selectedTask.output).length > 0 && (
                <div className="detail-section">
                  <h3>Output</h3>
                  <pre className="output-pre">
                    {typeof selectedTask.output === 'object' && 'response' in selectedTask.output
                      ? String(selectedTask.output.response).slice(0, 2000)
                      : JSON.stringify(selectedTask.output, null, 2).slice(0, 2000)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
