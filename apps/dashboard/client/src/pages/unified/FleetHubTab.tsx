import { useState, useCallback, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import TabBar from '../../components/TabBar';
import type { ForgeEvent } from '../../constants/status';

const FleetTab = lazy(() => import('./FleetTab'));
const BuilderTab = lazy(() => import('./BuilderTab'));
const TemplatesTab = lazy(() => import('./TemplatesTab'));
const DelegationGraph = lazy(() => import('./DelegationGraph'));

type SubTab = 'agents' | 'builder' | 'skills' | 'delegation';

interface FleetHubTabProps {
  wsEvents?: ForgeEvent[];
}

export default function FleetHubTab({ wsEvents = [] }: FleetHubTabProps) {
  const [sub, setSub] = useState<SubTab>('agents');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [builderTemplate, setBuilderTemplate] = useState<any>(null);

  const handleUseTemplate = useCallback((template: unknown) => {
    setBuilderTemplate(template);
    setSub('builder');
  }, []);

  return (
    <div className="ud-composite-tab">
      <TabBar
        tabs={[
          { key: 'agents', label: 'Agents' },
          { key: 'builder', label: 'Builder' },
          { key: 'skills', label: 'Skills' },
          { key: 'delegation', label: 'Delegation' },
        ]}
        active={sub}
        onChange={(k) => setSub(k as SubTab)}
        className="ud-sub-tabs"
        ariaLabel="Fleet sub-navigation"
      />
      <div className="ud-sub-content">
        <ErrorBoundary inline>
          <Suspense fallback={<div className="ud-loading">Loading...</div>}>
            {sub === 'agents' && <FleetTab wsEvents={wsEvents} />}
            {sub === 'builder' && <BuilderTab prefilledTemplate={builderTemplate} />}
            {sub === 'skills' && <TemplatesTab onUseTemplate={handleUseTemplate} />}
            {sub === 'delegation' && <DelegationGraph />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
