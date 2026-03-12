import { useEffect, useRef } from 'react';
import { useHubStore } from '../../stores/hub';
import { useToast } from '../../components/Toast';
import type { ForgeEvent } from '../../constants/status';
import FleetCoordination from '../hub/FleetCoordination';
import '../hub/FleetCoordination.css';
import './CoordinatorTab.css';

export default function CoordinatorTab({ wsEvents = [] }: { wsEvents?: ForgeEvent[] }) {
  const { addToast } = useToast();
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const fetchSessions = useHubStore((s) => s.fetchCoordinationSessions);
  const fetchStats = useHubStore((s) => s.fetchCoordinationStats);
  const coordinationSessions = useHubStore((s) => s.coordinationSessions);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // WS-accelerated refresh + optimistic updates on coordination events
  const latestEventTs = useRef(0);
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (!latest || latest.receivedAt <= latestEventTs.current) return;
    latestEventTs.current = latest.receivedAt;

    if (latest.category === 'coordination') {
      const eventType = (latest.event as string) || (latest.type as string) || '';

      // Optimistic update: immediately reflect status change in the sessions list
      if (latest.sessionId && (eventType === 'completed' || eventType === 'failed')) {
        const newStatus = eventType === 'completed' ? 'completed' : 'failed';
        useHubStore.setState({
          coordinationSessions: coordinationSessions.map((s) =>
            s.id === latest.sessionId ? { ...s, status: newStatus as typeof s.status } : s
          ),
        });
      }

      // Full re-fetch for consistency
      fetchSessions().catch(() => addToast('Failed to refresh coordination sessions', 'error'));
      fetchStats().catch(() => addToast('Failed to refresh coordination stats', 'error'));
    }
  }, [wsEvents, fetchSessions, fetchStats, addToast, coordinationSessions]);

  return (
    <div className="coordinator-tab">
      <div className="coordinator-header">
        <div className="coordinator-title-row">
          <span className="coordinator-icon">&#x2B21;</span>
          <h2 className="coordinator-title">Orchestrator</h2>
        </div>
        <p className="coordinator-subtitle">Pipeline &middot; Fan-Out &middot; Consensus</p>
      </div>
      <div className="coordinator-content">
        <FleetCoordination />
      </div>
    </div>
  );
}
