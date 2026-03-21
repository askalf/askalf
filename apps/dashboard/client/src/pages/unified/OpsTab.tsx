import { useState, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import TabBar from '../../components/TabBar';
import type { ForgeEvent } from '../../constants/status';

const OperationsTab = lazy(() => import('./OperationsTab'));
const CostDashboard = lazy(() => import('../forge/CostDashboard'));
const ExecutionHistory = lazy(() => import('../hub/ExecutionHistory'));
const AgentTimeline = lazy(() => import('../hub/AgentTimeline'));
const ProviderHealthPage = lazy(() => import('../forge/ProviderHealth'));
const GuardrailsManager = lazy(() => import('../forge/GuardrailsManager'));
const AuditLog = lazy(() => import('../forge/AuditLog'));
const CoordinatorTab = lazy(() => import('./CoordinatorTab'));
const WorkflowBuilder = lazy(() => import('../forge/WorkflowBuilder'));
const PushPanel = lazy(() => import('../forge/PushPanel'));

type SubTab = 'tickets' | 'costs' | 'executions' | 'timeline' | 'providers' | 'guardrails' | 'audit' | 'orchestrator' | 'workflows' | 'automation';

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
          { key: 'costs', label: 'Costs' },
          { key: 'executions', label: 'Executions' },
          { key: 'timeline', label: 'Timeline' },
          { key: 'orchestrator', label: 'Orchestrator' },
          { key: 'providers', label: 'Providers' },
          { key: 'guardrails', label: 'Guardrails' },
          { key: 'audit', label: 'Audit' },
          { key: 'workflows', label: 'Workflows' },
          { key: 'automation', label: 'Automation' },
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
            {sub === 'costs' && <CostDashboard />}
            {sub === 'executions' && <ExecutionHistory />}
            {sub === 'timeline' && <AgentTimeline />}
            {sub === 'orchestrator' && <CoordinatorTab wsEvents={wsEvents} />}
            {sub === 'providers' && <ProviderHealthPage />}
            {sub === 'guardrails' && <GuardrailsManager />}
            {sub === 'audit' && <AuditLog />}
            {sub === 'workflows' && <WorkflowBuilder />}
            {sub === 'automation' && <PushPanel wsEvents={wsEvents} />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
