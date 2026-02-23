import { useEffect, useState } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import type { Agent } from '../../hooks/useHubApi';

interface AgentFleetCompactProps {
  forgeEvents: Array<{ category: string; type: string; [key: string]: unknown }>;
  onViewFleet?: () => void;
}

export default function AgentFleetCompact({ forgeEvents, onViewFleet }: AgentFleetCompactProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    hubApi.agents.list().then((data) => setAgents(data.agents)).catch(() => {});
    const timer = setInterval(() => {
      hubApi.agents.list().then((data) => setAgents(data.agents)).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Update agent statuses from WS events
  useEffect(() => {
    if (forgeEvents.length === 0) return;
    const latest = forgeEvents[0];
    if (latest?.category === 'agent' && latest.agentId) {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === latest.agentId
            ? { ...a, status: (latest.status as Agent['status']) || a.status }
            : a
        )
      );
    }
  }, [forgeEvents]);

  const activeAgents = agents.filter((a) => !a.is_decommissioned);
  const sortedAgents = [...activeAgents].sort((a, b) => {
    const statusOrder: Record<string, number> = { running: 0, idle: 1, paused: 2, error: 3 };
    return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
  });

  const statusDot = (status: Agent['status']) => {
    const colors: Record<string, string> = {
      running: '#22c55e',
      idle: '#6b7280',
      paused: '#eab308',
      error: '#ef4444',
    };
    return colors[status] || '#6b7280';
  };

  const shortName = (name: string) => {
    const words = name.split(/[\s_-]+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="ud-sidebar-panel">
      <div className="ud-sidebar-panel-header">
        <span>Agent Fleet</span>
        <span className="ud-sidebar-count">{activeAgents.length}</span>
        {onViewFleet && (
          <button
            onClick={onViewFleet}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#8b5cf6', cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
          >Fleet &rarr;</button>
        )}
      </div>
      <div className="ud-agent-list">
        {sortedAgents.map((agent) => (
          <div key={agent.id} className="ud-agent-row">
            <button
              className={`ud-agent-card ${expandedId === agent.id ? 'expanded' : ''}`}
              onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
            >
              <span className="ud-agent-abbr">{shortName(agent.name)}</span>
              <span className="ud-agent-dot" style={{ background: statusDot(agent.status) }} />
              <span className="ud-agent-info">
                <span className="ud-agent-name">{agent.name}</span>
                <span className="ud-agent-detail">
                  {agent.status === 'running' && agent.current_task
                    ? agent.current_task
                    : agent.status}
                </span>
              </span>
            </button>
            {expandedId === agent.id && (
              <div className="ud-agent-expanded">
                <div className="ud-agent-meta">
                  <span>Type: {agent.type}</span>
                  <span>Tasks: {agent.tasks_completed} done / {agent.tasks_failed} failed</span>
                  {agent.last_run_at && (
                    <span>Last run: {new Date(agent.last_run_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {sortedAgents.length === 0 && (
          <div className="ud-empty">No agents configured</div>
        )}
      </div>
    </div>
  );
}
