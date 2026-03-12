import { useEffect, useState, useCallback, useMemo } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import { formatCost, formatDurationBetween, formatDurationSeconds, formatTokens, formatDate, formatDateFull, relativeTime } from '../../utils/format';
import StatusBadge from './shared/StatusBadge';
import PaginationBar from './shared/PaginationBar';
import FilterBar from './shared/FilterBar';
import { ExecutionLogViewer } from './ExecutionLogViewer';
import '../forge/forge-observe.css';

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  failed: '#ef4444',
  in_progress: '#f59e0b',
  pending: '#6b7280',
  cancelled: '#6b7280',
};

const getHandoffInfo = (task: { handoff_to_agent_name?: string | null; parent_task_id?: string | null; metadata?: Record<string, unknown> }) => {
  if (task.handoff_to_agent_name) return { type: 'handoff' as const, label: task.handoff_to_agent_name };
  if (task.parent_task_id) return { type: 'child' as const, label: 'Child' };
  const source = task.metadata?.source as string | undefined;
  if (source === 'fleet-dispatch') return { type: 'handoff' as const, label: (task.metadata?.planId as string)?.slice(0, 8) ?? 'Fleet' };
  const parentId = task.metadata?.parent_execution_id as string | undefined;
  if (parentId) return { type: 'child' as const, label: 'Child' };
  return null;
};

const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  api: { label: 'API', color: '#6366f1' },
  webhooks: { label: 'Webhook', color: '#8b5cf6' },
  slack: { label: 'Slack', color: '#e01e5a' },
  discord: { label: 'Discord', color: '#5865f2' },
  telegram: { label: 'Telegram', color: '#26a5e4' },
  whatsapp: { label: 'WhatsApp', color: '#25d366' },
  chat: { label: 'Chat', color: '#a78bfa' },
  template: { label: 'Template', color: '#f59e0b' },
};

const getChannelSource = (task: { metadata?: Record<string, unknown> }): { label: string; color: string } | null => {
  const source = task.metadata?.source as string | undefined;
  if (!source) return null;
  // dispatch-adapter sets source as 'channel:slack', 'channel:discord', etc.
  if (source.startsWith('channel:')) {
    const type = source.slice(8);
    return CHANNEL_LABELS[type] ?? { label: type, color: '#6366f1' };
  }
  if (source === 'chat') return CHANNEL_LABELS['chat'];
  if (source === 'template') return CHANNEL_LABELS['template'];
  if (source === 'fleet-dispatch') return { label: 'Fleet', color: '#f59e0b' };
  return null;
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="exec-copy-btn"
      title={label || 'Copy'}
      onClick={(e) => {
        e.stopPropagation();
        copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      )}
    </button>
  );
}

function CodeBlock({ text, maxCollapsed, label }: { text: string; maxCollapsed?: number; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = maxCollapsed !== undefined && text.length > maxCollapsed;
  const displayText = isLong && !expanded ? text.slice(0, maxCollapsed) + '\n...' : text;
  const charLabel = text.length > 1000 ? `${(text.length / 1000).toFixed(1)}k chars` : `${text.length} chars`;

  return (
    <div className="exec-code-block">
      <div className="exec-code-header">
        {label && <span className="exec-code-label">{label}</span>}
        <span className="exec-code-size">{charLabel}</span>
        <CopyButton text={text} />
        {isLong && (
          <button className="hub-btn hub-btn--sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Expand All'}
          </button>
        )}
      </div>
      <pre className="exec-code-pre">{displayText}</pre>
    </div>
  );
}

function parseOutput(output: unknown): string {
  if (!output) return '';
  const rawOutput = typeof output === 'string'
    ? output
    : typeof output === 'object' && output && 'response' in output
      ? String((output as Record<string, unknown>).response)
      : JSON.stringify(output, null, 2);

  let outputText = rawOutput;
  if (typeof rawOutput === 'string' && rawOutput.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawOutput) as Record<string, unknown>;
      if (parsed['result'] && typeof parsed['result'] === 'string' && (parsed['result'] as string).trim().length > 0) {
        outputText = parsed['result'] as string;
      } else if (parsed['subtype'] === 'error_max_budget_usd') {
        outputText = `[Budget exceeded after ${parsed['num_turns'] || 0} turn(s), $${(Number(parsed['total_cost_usd']) || 0).toFixed(4)} spent]`;
      } else if (parsed['subtype'] === 'error_max_turns') {
        outputText = `[Max turns reached (${parsed['num_turns'] || 0}), $${(Number(parsed['total_cost_usd']) || 0).toFixed(4)} spent]`;
      }
    } catch {
      // keep raw
    }
  }
  return outputText === 'null' || outputText === '{}' ? '' : outputText;
}

function parseInput(input: unknown): string {
  if (!input || (typeof input === 'object' && Object.keys(input as object).length === 0)) return '';
  if (typeof input === 'object' && input && 'prompt' in input) return String((input as Record<string, unknown>).prompt);
  return JSON.stringify(input, null, 2);
}

function getInputPreview(input: unknown): string {
  const text = parseInput(input);
  if (!text || text === '""' || text === '{}') return '';
  return text.length > 60 ? text.slice(0, 60) + '...' : text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StatusDistribution({ tasks }: { tasks: any[] }) {
  const dist = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [tasks]);
  const total = tasks.length || 1;

  if (dist.length === 0) return null;
  return (
    <div className="exec-dist">
      <div className="exec-dist-bar">
        {dist.map(([status, count]) => (
          <div key={status} className="exec-dist-seg" title={`${status}: ${count}`}
            style={{ width: `${(count / total) * 100}%`, background: STATUS_COLORS[status] || '#6b7280' }} />
        ))}
      </div>
      <div className="exec-dist-legend">
        {dist.map(([status, count]) => (
          <span key={status} className="exec-dist-item">
            <span className="exec-dist-dot" style={{ background: STATUS_COLORS[status] || '#6b7280' }} />
            {status} <span className="exec-dist-count">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ExecutionHistory() {
  const tasks = useHubStore((s) => s.tasks);
  const taskStats = useHubStore((s) => s.taskStats);
  const pagination = useHubStore((s) => s.taskPagination);
  const page = useHubStore((s) => s.taskPage);
  const statusFilter = useHubStore((s) => s.taskStatusFilter);
  const selectedTask = useHubStore((s) => s.selectedTask);
  const selectedTaskDetail = useHubStore((s) => s.selectedTaskDetail);
  const loading = useHubStore((s) => s.loading);

  const setPage = useHubStore((s) => s.setTaskPage);
  const setStatusFilter = useHubStore((s) => s.setTaskStatusFilter);
  const setSelectedTask = useHubStore((s) => s.setSelectedTask);
  const fetchTasks = useHubStore((s) => s.fetchTasks);
  const fetchTaskStats = useHubStore((s) => s.fetchTaskStats);
  const fetchTaskDetail = useHubStore((s) => s.fetchTaskDetail);

  useEffect(() => { fetchTasks(); fetchTaskStats(); }, [fetchTasks, fetchTaskStats]);
  useEffect(() => { fetchTasks(); }, [page, statusFilter, fetchTasks]);

  const pollTasks = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchTaskStats()]);
  }, [fetchTasks, fetchTaskStats]);
  usePolling(pollTasks, 15000);

  // Poll detail faster when viewing a running execution
  const isLiveExecution = selectedTask?.status === 'in_progress' || selectedTask?.status === 'pending';
  const pollDetail = useCallback(async () => {
    if (selectedTask) await fetchTaskDetail(selectedTask.id);
  }, [selectedTask, fetchTaskDetail]);
  usePolling(pollDetail, isLiveExecution ? 3000 : 0);

  useEffect(() => {
    if (selectedTask) {
      fetchTaskDetail(selectedTask.id);
    }
  }, [selectedTask, fetchTaskDetail]);

  const detailTask = selectedTaskDetail?.task || selectedTask;

  // Derived stats
  const derivedStats = useMemo(() => {
    if (!taskStats) return null;
    const totalCost = tasks.reduce((sum, t) => sum + (t.cost || 0), 0);
    const totalTokens = tasks.reduce((sum, t) => sum + (t.tokens_used || 0), 0);
    const avgDuration = tasks.length > 0
      ? tasks.reduce((sum, t) => sum + (t.duration_seconds || 0), 0) / tasks.filter(t => t.duration_seconds).length
      : 0;
    return { totalCost, totalTokens, avgDuration };
  }, [tasks, taskStats]);

  return (
    <div className="al-container">
      {/* Stats row */}
      {taskStats && (
        <div className="exec-stats-row">
          <div className="exec-stat-card">
            <div className="exec-stat-value">{taskStats.totals.total}</div>
            <div className="exec-stat-label">Total</div>
          </div>
          <div className="exec-stat-card exec-stat-card--warn">
            <div className="exec-stat-value">{taskStats.totals.in_progress}</div>
            <div className="exec-stat-label">In Progress</div>
          </div>
          <div className="exec-stat-card exec-stat-card--success">
            <div className="exec-stat-value">{taskStats.totals.completed}</div>
            <div className="exec-stat-label">Completed</div>
          </div>
          <div className="exec-stat-card exec-stat-card--danger">
            <div className="exec-stat-value">{taskStats.totals.failed}</div>
            <div className="exec-stat-label">Failed</div>
          </div>
          <div className="exec-stat-card exec-stat-card--purple">
            <div className="exec-stat-value">{taskStats.totals.handoffs}</div>
            <div className="exec-stat-label">Handoffs</div>
          </div>
          {derivedStats && (
            <>
              <div className="exec-stat-card exec-stat-card--info">
                <div className="exec-stat-value">{formatCost(derivedStats.totalCost)}</div>
                <div className="exec-stat-label">Page Cost</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Status distribution */}
      <StatusDistribution tasks={tasks} />

      {/* Filters */}
      <FilterBar
        filters={[{
          value: statusFilter,
          onChange: setStatusFilter,
          options: [
            { value: '', label: 'All Statuses' },
            { value: 'pending', label: 'Pending' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ],
        }]}
      />

      {/* Table */}
      <div className="al-table-wrap">
        {loading.tasks ? (
          <div className="exec-empty-state">
            <div className="exec-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="exec-empty-text">Loading executions...</div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="exec-empty-state">
            <div className="exec-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="exec-empty-text">No executions found</div>
            <div className="exec-empty-sub">Agent executions will appear here as tasks run and complete.</div>
          </div>
        ) : (
          <table className="al-table">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>When</th>
                <th>Agent</th>
                <th style={{ width: '100px' }}>Status</th>
                <th style={{ width: '90px' }}>Duration</th>
                <th style={{ width: '90px' }}>Cost</th>
                <th style={{ width: '80px' }}>Tokens</th>
                <th>Input</th>
                <th style={{ width: '80px' }}>Source</th>
                <th style={{ width: '80px' }}>Handoff</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const handoff = getHandoffInfo(task);
                const channelSource = getChannelSource(task);
                const preview = getInputPreview(task.input);
                const statusColor = STATUS_COLORS[task.status] || '#6b7280';
                return (
                  <tr key={task.id}
                    className={`al-row al-row-clickable exec-row-${task.status}`}
                    onClick={() => setSelectedTask(task)}
                    style={{ borderLeft: `3px solid ${statusColor}` }}>
                    <td className="al-time-cell">
                      <span className="al-time-rel">{relativeTime(task.started_at || task.created_at)}</span>
                      <span className="al-time-abs">{formatDate(task.started_at || task.created_at)}</span>
                    </td>
                    <td>
                      <div className="hub-hist-agent-cell">
                        <span className="hub-hist-agent-name">{task.agent_name}</span>
                        <span className="hub-hist-agent-type">{task.agent_type}</span>
                      </div>
                    </td>
                    <td><StatusBadge status={task.status} /></td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {task.duration_seconds ? formatDurationSeconds(task.duration_seconds) : formatDurationBetween(task.started_at, task.completed_at)}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatCost(task.cost)}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatTokens(task.tokens_used)}</td>
                    <td>
                      {preview ? (
                        <span className="exec-input-preview" title={preview}>{preview}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      {channelSource ? (
                        <span style={{
                          fontSize: '0.6875rem',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          background: `${channelSource.color}20`,
                          color: channelSource.color,
                          fontWeight: 500,
                        }}>{channelSource.label}</span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      {handoff ? (
                        <span className={`hub-hist-handoff ${handoff.type === 'child' ? 'child' : ''}`}>
                          {handoff.type === 'handoff' ? <>&rarr; {handoff.label}</> : <>&larr; {handoff.label}</>}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <PaginationBar pagination={pagination} currentPage={page} onPageChange={setPage} />

      {/* Task Detail Slide-over */}
      {selectedTask && (
        <>
          <div className="hub-detail-overlay" onClick={() => setSelectedTask(null)} />
          <div className="hub-detail-panel exec-detail-panel">
            <div className="hub-detail-header">
              <div>
                <h2>Execution Detail</h2>
                <div className="exec-id-row">
                  <span className="exec-id-mono">{selectedTask.id}</span>
                  <CopyButton text={selectedTask.id} label="Copy ID" />
                </div>
              </div>
              <button className="hub-modal__close" onClick={() => setSelectedTask(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stats bar */}
            {detailTask && (
              <div className="hub-detail-stats">
                <div className="hub-detail-stat">
                  <span className="stat-val"><StatusBadge status={detailTask.status} /></span>
                  <span className="stat-lbl">Status</span>
                </div>
                <div className="hub-detail-stat">
                  <span className="stat-val">
                    {detailTask.duration_seconds
                      ? formatDurationSeconds(detailTask.duration_seconds)
                      : formatDurationBetween(detailTask.started_at, detailTask.completed_at)}
                  </span>
                  <span className="stat-lbl">Duration</span>
                </div>
                <div className="hub-detail-stat">
                  <span className="stat-val">{formatTokens(detailTask.tokens_used)}</span>
                  <span className="stat-lbl">Tokens</span>
                </div>
                <div className="hub-detail-stat">
                  <span className="stat-val">{formatCost(detailTask.cost)}</span>
                  <span className="stat-lbl">Cost</span>
                </div>
              </div>
            )}

            {/* Overview */}
            <div className="hub-detail-section">
              <h3>Overview</h3>
              <div className="exec-overview-grid">
                <div className="exec-ov-label">Agent</div><div className="exec-ov-value">{detailTask?.agent_name || selectedTask.agent_name}</div>
                <div className="exec-ov-label">Type</div><div className="exec-ov-value">{detailTask?.agent_type || selectedTask.agent_type}</div>
                <div className="exec-ov-label">Task Type</div><div className="exec-ov-value">{detailTask?.type || selectedTask.type}</div>
                <div className="exec-ov-label">Created</div><div className="exec-ov-value">{formatDateFull(detailTask?.created_at || selectedTask.created_at)}</div>
                <div className="exec-ov-label">Started</div><div className="exec-ov-value">{formatDateFull(detailTask?.started_at || selectedTask.started_at)}</div>
                <div className="exec-ov-label">Completed</div><div className="exec-ov-value">{formatDateFull(detailTask?.completed_at || selectedTask.completed_at)}</div>
                {(() => {
                  const cs = getChannelSource(detailTask || selectedTask);
                  if (!cs) return null;
                  return (
                    <>
                      <div className="exec-ov-label">Source</div>
                      <div className="exec-ov-value">
                        <span style={{
                          fontSize: '0.6875rem',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          background: `${cs.color}20`,
                          color: cs.color,
                          fontWeight: 500,
                        }}>{cs.label}</span>
                      </div>
                    </>
                  );
                })()}
                {(() => {
                  const handoff = getHandoffInfo(detailTask || selectedTask);
                  if (!handoff) return null;
                  return (
                    <>
                      <div className="exec-ov-label">Lineage</div>
                      <div className="exec-ov-value">
                        <span className={`hub-hist-handoff ${handoff.type === 'child' ? 'child' : ''}`}>
                          {handoff.type === 'handoff' ? <>&rarr; Handed off to {handoff.label}</> : <>&larr; Child task</>}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Input */}
            {(() => {
              const inputText = parseInput(detailTask?.input || selectedTask.input);
              if (!inputText || inputText === '""' || inputText === '{}') return null;
              return (
                <div className="hub-detail-section">
                  <CodeBlock text={inputText} maxCollapsed={2000} label="Input / Prompt" />
                </div>
              );
            })()}

            {/* Error */}
            {(detailTask?.error || selectedTask.error) && (
              <div className="hub-detail-section">
                <div className="exec-error-block">
                  <div className="exec-code-header">
                    <span className="exec-code-label" style={{ color: '#ef4444' }}>Error</span>
                    <CopyButton text={detailTask?.error || selectedTask.error || ''} />
                  </div>
                  <pre className="exec-error-pre">{detailTask?.error || selectedTask.error}</pre>
                </div>
              </div>
            )}

            {/* Output */}
            {(() => {
              const outputText = parseOutput(detailTask?.output || selectedTask.output);
              if (!outputText) return null;
              return (
                <div className="hub-detail-section">
                  <CodeBlock text={outputText} maxCollapsed={3000} label="Output" />
                </div>
              );
            })()}

            {/* Logs */}
            <div className="hub-detail-section">
              <h3>
                Execution Log
                {selectedTaskDetail?.logs && selectedTaskDetail.logs.length > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px' }}>
                    ({selectedTaskDetail.logs.length})
                  </span>
                )}
                {isLiveExecution && (
                  <span style={{ marginLeft: '8px', fontSize: '0.65rem', color: '#4ade80', fontWeight: 500, verticalAlign: 'middle' }}>
                    ● LIVE
                  </span>
                )}
              </h3>
              <ExecutionLogViewer
                logs={selectedTaskDetail?.logs ?? []}
                isLive={isLiveExecution}
                maxHeight={420}
              />
            </div>

            {/* Child / Handoff Tasks */}
            {selectedTaskDetail?.childTasks && selectedTaskDetail.childTasks.length > 0 && (
              <div className="hub-detail-section">
                <h3>Handoff Tasks ({selectedTaskDetail.childTasks.length})</h3>
                {selectedTaskDetail.childTasks.map((child) => (
                  <div key={child.id} className="hub-detail-task-item">
                    <div className="hub-detail-task-header">
                      <span style={{ fontWeight: 600 }}>{child.agent_name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{child.type}</span>
                      <StatusBadge status={child.status} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {formatDate(child.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Interventions */}
            {selectedTaskDetail?.interventions && selectedTaskDetail.interventions.length > 0 && (
              <div className="hub-detail-section">
                <h3>Interventions ({selectedTaskDetail.interventions.length})</h3>
                {selectedTaskDetail.interventions.map((intervention) => (
                  <div key={intervention.id} className="hub-detail-task-item">
                    <div className="hub-detail-task-header">
                      <span style={{ fontWeight: 600 }}>{intervention.title}</span>
                      <StatusBadge status={intervention.status} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {intervention.type} &middot; {formatDate(intervention.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Metadata */}
            {detailTask?.metadata && Object.keys(detailTask.metadata).length > 0 && (
              <div className="hub-detail-section">
                <CodeBlock text={JSON.stringify(detailTask.metadata, null, 2)} maxCollapsed={1500} label="Metadata" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
