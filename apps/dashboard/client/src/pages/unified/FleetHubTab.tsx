import { useState, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import TabBar from '../../components/TabBar';
import type { ForgeEvent } from '../../constants/status';

const FleetTab = lazy(() => import('./FleetTab'));
const BuilderTab = lazy(() => import('./BuilderTab'));
const DevicesPanel = lazy(() => import('./DevicesPanel'));
const OutputsPanel = lazy(() => import('./OutputsPanel'));

type SubTab = 'agents' | 'builder' | 'devices' | 'outputs';

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
          { key: 'outputs', label: 'Outputs' },
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
            {sub === 'outputs' && <OutputsPanel />}
            {sub === 'builder' && <BuilderTab prefilledTemplate={null} />}
            {sub === 'devices' && <DevicesPanel />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
