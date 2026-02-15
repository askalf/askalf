import { useState } from 'react';
import SchedulerControl from './SchedulerControl';
import FleetCoordination from './FleetCoordination';

type SubTab = 'schedules' | 'sessions';

export default function Threads() {
  const [subTab, setSubTab] = useState<SubTab>('schedules');

  return (
    <>
      <div className="hub-sub-nav">
        <button
          className={subTab === 'schedules' ? 'active' : ''}
          onClick={() => setSubTab('schedules')}
        >
          Schedules
        </button>
        <button
          className={subTab === 'sessions' ? 'active' : ''}
          onClick={() => setSubTab('sessions')}
        >
          Sessions
        </button>
      </div>
      {subTab === 'schedules' ? <SchedulerControl /> : <FleetCoordination />}
    </>
  );
}
