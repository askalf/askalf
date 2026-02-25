import { useEffect } from 'react';
import { useHubStore } from '../../stores/hub';
import FleetCoordination from '../hub/FleetCoordination';
import '../hub/FleetCoordination.css';
import './CoordinatorTab.css';

export default function CoordinatorTab() {
  const fetchAgents = useHubStore((s) => s.fetchAgents);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <div className="coordinator-tab">
      <div className="coordinator-header">
        <div className="coordinator-title-row">
          <span className="coordinator-icon">&#x2B21;</span>
          <h2 className="coordinator-title">Fleet Coordinator</h2>
        </div>
        <p className="coordinator-subtitle">Pipeline &middot; Fan-Out &middot; Consensus</p>
      </div>
      <div className="coordinator-content">
        <FleetCoordination />
      </div>
    </div>
  );
}
