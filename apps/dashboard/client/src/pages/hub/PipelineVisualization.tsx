import { useCallback, useEffect, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import { relativeTime, formatDuration, formatCost } from '../../utils/format';
import { STATUS_COLORS } from '../../constants/status';
import type { CoordinationSession, CoordinationTask } from '../../hooks/useHubApi';
import './PipelineVisualization.css';

interface PipelineNode {
  id: string;
  title: string;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: string;
  output?: string;
  error?: string;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <span className="pipeline-status-icon">✓</span>;
  if (status === 'failed') return <span className="pipeline-status-icon">✕</span>;
  if (status === 'running') return <span className="pipeline-status-icon running">⦿</span>;
  return <span className="pipeline-status-icon">○</span>;
}

function FlowNode({
  node,
  isSelected,
  onSelect,
}: {
  node: PipelineNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`pipeline-node ${node.status} ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
      style={{ background: STATUS_COLORS[node.status] || 'var(--text-muted)' }}
    >
      <div className="pipeline-node-inner">
        <div className="pipeline-node-status">
          <StatusIcon status={node.status} />
        </div>
        <div className="pipeline-node-info">
          <div className="pipeline-node-agent">{node.agent}</div>
          <div className="pipeline-node-title">{node.title}</div>
        </div>
      </div>
    </div>
  );
}

function FlowConnector({ isActive }: { isActive: boolean }) {
  return <div className={`pipeline-connector ${isActive ? 'active' : ''}`} />;
}

interface PipelineDetailProps {
  node: PipelineNode | null;
}

function PipelineDetail({ node }: PipelineDetailProps) {
  if (!node) {
    return <div className="pipeline-detail-empty">Select a step to view details</div>;
  }

  return (
    <div className="pipeline-detail">
      <div className="pipeline-detail-header">
        <h3>{node.title}</h3>
        <div className="pipeline-detail-status" style={{ background: STATUS_COLORS[node.status] }}>
          {node.status}
        </div>
      </div>

      <div className="pipeline-detail-agent">
        <span className="detail-label">Agent:</span>
        <span>{node.agent}</span>
      </div>

      {node.input && (
        <div className="pipeline-detail-section">
          <h4>Input</h4>
          <pre className="pipeline-detail-code">{node.input}</pre>
        </div>
      )}

      {node.output && (
        <div className="pipeline-detail-section">
          <h4>Output</h4>
          <pre className="pipeline-detail-code">{node.output}</pre>
        </div>
      )}

      {node.error && (
        <div className="pipeline-detail-section error">
          <h4>Error</h4>
          <pre className="pipeline-detail-code">{node.error}</pre>
        </div>
      )}
    </div>
  );
}

function PipelineFlowDiagram({ session }: { session: CoordinationSession }) {
  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);

  const nodes: PipelineNode[] = (session.plan?.tasks || []).map((task) => ({
    id: task.id,
    title: task.title,
    agent: task.assignedAgent,
    status: (task.status as PipelineNode['status']) || 'pending',
    input: undefined,
    output: task.result,
    error: task.error,
  }));

  const duration =
    session.completedAt && session.startedAt
      ? new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()
      : undefined;

  return (
    <div className="pipeline-flow-container">
      <div className="pipeline-flow-header">
        <div className="pipeline-flow-meta">
          <h3>{session.plan?.title || 'Pipeline Run'}</h3>
          <div className="pipeline-flow-metadata">
            <span className="meta-item">
              Pattern: <strong>{session.plan?.pattern || 'pipeline'}</strong>
            </span>
            {duration && (
              <span className="meta-item">
                Duration: <strong>{formatDuration(duration)}</strong>
              </span>
            )}
            <span className="meta-item">
              Status: <strong style={{ color: STATUS_COLORS[session.status] }}>{session.status}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="pipeline-flow-content">
        <div className="pipeline-flow-diagram">
          <div className="pipeline-flow-steps">
            {nodes.map((node, idx) => (
              <div key={node.id} className="pipeline-flow-step-group">
                <FlowNode
                  node={node}
                  isSelected={selectedNode?.id === node.id}
                  onSelect={() => setSelectedNode(node)}
                />
                {idx < nodes.length - 1 && <FlowConnector isActive={node.status === 'completed'} />}
              </div>
            ))}
          </div>
        </div>

        {nodes.length > 0 && (
          <div className="pipeline-flow-detail-panel">
            <PipelineDetail node={selectedNode} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function PipelineVisualization() {
  const sessions = useHubStore((s) => s.coordinationSessions);
  const fetchSessions = useHubStore((s) => s.fetchCoordinationSessions);
  const loading = useHubStore((s) => s.loading['coordinationSessions']);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Poll every 3s for active pipelines
  const poll = useCallback(() => {
    fetchSessions();
  }, [fetchSessions]);
  usePolling(poll, 3000);

  // Find first active session or most recent
  const activeSessions = sessions.filter((s) => s.status === 'active');
  const displaySession = activeSessions.length > 0 ? activeSessions[0] : sessions[0];

  return (
    <div className="pipeline-visualization">
      {loading && sessions.length === 0 && (
        <div className="pipeline-empty">Loading pipeline runs...</div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="pipeline-empty">No pipeline runs yet. Start a team session to visualize pipelines.</div>
      )}

      {displaySession && (
        <>
          <PipelineFlowDiagram session={displaySession} />

          <div className="pipeline-runs-list">
            <h3>Recent Pipeline Runs</h3>
            <div className="pipeline-runs-grid">
              {sessions.slice(0, 10).map((session) => {
                const duration =
                  session.completedAt && session.startedAt
                    ? new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()
                    : undefined;
                const taskCount = session.plan?.tasks.length || 0;
                const completedCount = session.plan?.tasks.filter((t) => t.status === 'completed').length || 0;

                return (
                  <div key={session.id} className="pipeline-run-card">
                    <div className="pipeline-run-header">
                      <span className="pipeline-run-title">{session.plan?.title || 'Untitled'}</span>
                      <div
                        className="pipeline-run-status"
                        style={{ background: STATUS_COLORS[session.status] }}
                      >
                        {session.status}
                      </div>
                    </div>
                    <div className="pipeline-run-meta">
                      <span>{completedCount}/{taskCount} tasks</span>
                      {duration && <span>{formatDuration(duration)}</span>}
                      <span>{relativeTime(session.startedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
