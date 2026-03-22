import { useState, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import TabBar from '../../components/TabBar';
import type { ForgeEvent } from '../../constants/status';

const FleetTab = lazy(() => import('./FleetTab'));
const BuilderTab = lazy(() => import('./BuilderTab'));
const DevicesPanel = lazy(() => import('./DevicesPanel'));

type SubTab = 'agents' | 'builder' | 'devices';

interface FleetHubTabProps {
  wsEvents?: ForgeEvent[];
}

export default function FleetHubTab({ wsEvents = [] }: FleetHubTabProps) {
  const [sub, setSub] = useState<SubTab>('agents');

  return (
    <div className="ud-composite-tab">
      <TabBar
        tabs={[
          { key: 'agents', label: 'Workers' },
          { key: 'builder', label: 'Create Worker' },
          { key: 'devices', label: 'Devices' },
        ]}
        active={sub}
        onChange={(k) => setSub(k as SubTab)}
        className="ud-sub-tabs"
        ariaLabel="Team sub-navigation"
      />
      <div className="ud-sub-content">
        <ErrorBoundary inline>
          <Suspense fallback={<div className="ud-loading">Loading...</div>}>
            {sub === 'agents' && <FleetTab wsEvents={wsEvents} />}
            {sub === 'builder' && <BuilderTab prefilledTemplate={null} />}
            {sub === 'devices' && <DevicesPanel />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
