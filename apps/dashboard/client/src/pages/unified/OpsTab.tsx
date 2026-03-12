import { useState, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import TabBar from '../../components/TabBar';
import type { ForgeEvent } from '../../constants/status';

const OperationsTab = lazy(() => import('./OperationsTab'));
const MonitorTab = lazy(() => import('./MonitorTab'));
const PushPanel = lazy(() => import('../forge/PushPanel'));
const WorkflowBuilder = lazy(() => import('../forge/WorkflowBuilder'));
const CoordinatorTab = lazy(() => import('./CoordinatorTab'));

type SubTab = 'tickets' | 'monitor' | 'orchestrator' | 'workflows' | 'deploy';

interface OpsTabProps {
  wsEvents?: ForgeEvent[];
}

export default function OpsTab({ wsEvents = [] }: OpsTabProps) {
  const [sub, setSub] = useState<SubTab>('tickets');

  return (
    <div className="ud-composite-tab">
      <TabBar
        tabs={[
          { key: 'tickets', label: 'Tickets' },
          { key: 'monitor', label: 'Monitor' },
          { key: 'orchestrator', label: 'Orchestrator' },
          { key: 'workflows', label: 'Workflows' },
          { key: 'deploy', label: 'Deploy' },
        ]}
        active={sub}
        onChange={(k) => setSub(k as SubTab)}
        className="ud-sub-tabs"
        ariaLabel="Ops sub-navigation"
      />
      <div className="ud-sub-content">
        <ErrorBoundary inline>
          <Suspense fallback={<div className="ud-loading">Loading...</div>}>
            {sub === 'tickets' && <OperationsTab />}
            {sub === 'monitor' && <MonitorTab />}
            {sub === 'orchestrator' && <CoordinatorTab wsEvents={wsEvents} />}
            {sub === 'workflows' && <WorkflowBuilder />}
            {sub === 'deploy' && <PushPanel wsEvents={wsEvents} />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
