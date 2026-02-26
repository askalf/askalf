import { useEffect, useRef } from 'react';
import { useHubStore } from '../../stores/hub';
import FleetCoordination from '../hub/FleetCoordination';
import '../hub/FleetCoordination.css';
import './CoordinatorTab.css';

interface ForgeEvent {
  category: string;
  type: string;
  receivedAt: number;
  [key: string]: unknown;
}

export default function CoordinatorTab({ wsEvents = [] }: { wsEvents?: ForgeEvent[] }) {
  const fetchAgents = useHubStore((s) => s.fetchAgents);
  const fetchSessions = useHubStore((s) => s.fetchCoordinationSessions);
  const fetchStats = useHubStore((s) => s.fetchCoordinationStats);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // WS-accelerated refresh on coordination events
  const latestEventTs = useRef(0);
  useEffect(() => {
    if (wsEvents.length === 0) return;
    const latest = wsEvents[0];
    if (!latest || latest.receivedAt <= latestEventTs.current) return;
    latestEventTs.current = latest.receivedAt;

    if (latest.category === 'coordination') {
      fetchSessions();
      fetchStats();
    }
  }, [wsEvents, fetchSessions, fetchStats]);

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
