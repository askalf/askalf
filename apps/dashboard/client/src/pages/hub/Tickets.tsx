import { useState } from 'react';
import { useHubStore } from '../../stores/hub';
import TicketSystem from './TicketSystem';
import InterventionGateway from './InterventionGateway';

type SubTab = 'tickets' | 'interventions';

export default function Tickets() {
  const [subTab, setSubTab] = useState<SubTab>('tickets');
  const interventions = useHubStore((s) => s.interventions);

  return (
    <>
      <div className="hub-sub-nav">
        <button
          className={subTab === 'tickets' ? 'active' : ''}
          onClick={() => setSubTab('tickets')}
        >
          Tickets
        </button>
        <button
          className={subTab === 'interventions' ? 'active' : ''}
          onClick={() => setSubTab('interventions')}
        >
          Interventions
          {interventions.length > 0 && (
            <span className="hub-nav-badge">{interventions.length}</span>
          )}
        </button>
      </div>
      {subTab === 'tickets' ? <TicketSystem /> : <InterventionGateway />}
    </>
  );
}
