import { useState, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForgeEvent = { category: string; type: string; data?: any; receivedAt: number; [key: string]: unknown };

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
      <div className="ud-sub-tabs" role="tablist" aria-label="Ops sub-navigation">
        {([
          { key: 'tickets' as SubTab, label: 'Tickets' },
          { key: 'monitor' as SubTab, label: 'Monitor' },
          { key: 'orchestrator' as SubTab, label: 'Orchestrator' },
          { key: 'workflows' as SubTab, label: 'Workflows' },
          { key: 'deploy' as SubTab, label: 'Deploy' },
        ]).map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={sub === t.key}
            className={`ud-sub-tab ${sub === t.key ? 'active' : ''}`}
            onClick={() => setSub(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
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
