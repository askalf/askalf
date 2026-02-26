import { useEffect, useState, useCallback } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import StatCard from './shared/StatCard';
import StatusBadge from './shared/StatusBadge';
import PaginationBar from './shared/PaginationBar';
import FilterBar from './shared/FilterBar';

const formatDate = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatDateFull = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDuration = (start: string | null, end: string | null) => {
  if (!start || !end) return '-';
  const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const formatDurationSeconds = (seconds: number | null | undefined) => {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const formatCost = (cost: number | undefined) => {
  if (cost === undefined || cost === null) return '-';
  return `$${cost.toFixed(4)}`;
};

const formatTokens = (tokens: number | undefined) => {
  if (!tokens) return '-';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
}

const getHandoffInfo = (task: { handoff_to_agent_name?: string | null; parent_task_id?: string | null; metadata?: Record<string, unknown> }) => {
  if (task.handoff_to_agent_name) return { type: 'handoff' as const, label: task.handoff_to_agent_name };
  if (task.parent_task_id) return { type: 'child' as const, label: 'Child' };
  const source = task.metadata?.source as string | undefined;
  if (source === 'fleet-dispatch') return { type: 'handoff' as const, label: (task.metadata?.planId as string)?.slice(0, 8) ?? 'Fleet' };
  const parentId = task.metadata?.parent_execution_id as string | undefined;
  if (parentId) return { type: 'child' as const, label: 'Child' };
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

  const [expandedLogs, setExpandedLogs] = useState(false);

  useEffect(() => { fetchTasks(); fetchTaskStats(); }, [fetchTasks, fetchTaskStats]);
  useEffect(() => { fetchTasks(); }, [page, statusFilter, fetchTasks]);

  const pollTasks = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchTaskStats()]);
  }, [fetchTasks, fetchTaskStats]);
  usePolling(pollTasks, 15000);

  useEffect(() => {
    if (selectedTask) {
      fetchTaskDetail(selectedTask.id);
      setExpandedLogs(false);
    }
  }, [selectedTask, fetchTaskDetail]);

  const detailTask = selectedTaskDetail?.task || selectedTask;

  return (
    <>
      {/* Stats */}
      {taskStats && (
        <div className="hub-hist-stats">
          <StatCard value={taskStats.totals.total} label="Total Tasks" />
          <StatCard value={taskStats.totals.in_progress} label="In Progress" variant={taskStats.totals.in_progress > 0 ? 'warning' : 'default'} />
          <StatCard value={taskStats.totals.completed} label="Completed" variant="success" />
          <StatCard value={taskStats.totals.failed} label="Failed" variant={taskStats.totals.failed > 0 ? 'danger' : 'default'} />
          <StatCard value={taskStats.totals.handoffs} label="Handoffs" />
        </div>
      )}

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
      <div className="hub-hist-table-wrap">
        {loading.tasks ? (
          <div className="hub-loading">Loading tasks...</div>
        ) : (
          <table className="hub-hist-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Type</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Cost</th>
                <th>Tokens</th>
                <th>Handoff</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const handoff = getHandoffInfo(task);
                return (
                  <tr key={task.id} onClick={() => setSelectedTask(task)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="hub-hist-agent-cell">
                        <span className="hub-hist-agent-name">{task.agent_name}</span>
                        <span className="hub-hist-agent-type">{task.agent_type}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{task.type}</td>
                    <td><StatusBadge status={task.status} /></td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatDate(task.started_at || task.created_at)}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {task.duration_seconds ? formatDurationSeconds(task.duration_seconds) : formatDuration(task.started_at, task.completed_at)}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{formatCost(task.cost)}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatTokens(task.tokens_used)}</td>
                    <td>
                      {handoff ? (
                        <span className={`hub-hist-handoff ${handoff.type === 'child' ? 'child' : ''}`}>
                          {handoff.type === 'handoff' ? <>&rarr; {handoff.label}</> : <>&larr; {handoff.label}</>}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No tasks found</td>
                </tr>
              )}
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
                      : formatDuration(detailTask.started_at, detailTask.completed_at)}
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
            {selectedTaskDetail?.logs && selectedTaskDetail.logs.length > 0 && (
              <div className="hub-detail-section">
                <div className="hub-hist-section-header">
                  <h3>Execution Log ({selectedTaskDetail.logs.length})</h3>
                  {selectedTaskDetail.logs.length > 5 && (
                    <button className="hub-btn hub-btn--sm" onClick={() => setExpandedLogs(!expandedLogs)}>
                      {expandedLogs ? 'Show Less' : `Show All (${selectedTaskDetail.logs.length})`}
                    </button>
                  )}
                </div>
                {(expandedLogs ? selectedTaskDetail.logs : selectedTaskDetail.logs.slice(0, 5)).map((log) => (
                  <div key={log.id} className="hub-detail-log-item">
                    <span className="hub-detail-log-time">{formatDate(log.created_at)}</span>
                    <span className={`hub-detail-log-level ${log.level}`}>{log.level}</span>
                    <span className="hub-detail-log-msg">{log.message}</span>
                    {log.metadata && !!(log.metadata as Record<string, unknown>).tool_calls && (
                      <div className="hub-hist-log-tools">
                        {(((log.metadata as Record<string, unknown>).tool_calls) as Array<{ name?: string; tool?: string }>)?.map((tc, i) => (
                          <span key={i} className="hub-hist-tool-badge">{tc.name || tc.tool || 'tool'}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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
    </>
  );
}
