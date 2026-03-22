import { useState, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import TabBar from '../../components/TabBar';
import type { ForgeEvent } from '../../constants/status';

const OperationsTab = lazy(() => import('./OperationsTab'));
const CostDashboard = lazy(() => import('../forge/CostDashboard'));
const ExecutionHistory = lazy(() => import('../hub/ExecutionHistory'));
const RevenueDashboard = lazy(() => import('../forge/RevenueDashboard'));
const AuditLog = lazy(() => import('../forge/AuditLog'));

type SubTab = 'tickets' | 'costs' | 'history' | 'revenue' | 'audit';

interface OpsTabProps {
  wsEvents?: ForgeEvent[];
}

export default function OpsTab({ wsEvents: _wsEvents = [] }: OpsTabProps) {
  const [sub, setSub] = useState<SubTab>('tickets');

  return (
    <div className="ud-composite-tab">
      <TabBar
        tabs={[
          { key: 'tickets', label: 'Tickets' },
          { key: 'costs', label: 'Costs' },
          { key: 'history', label: 'History' },
          { key: 'revenue', label: 'Revenue' },
          { key: 'audit', label: 'Audit' },
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
            {sub === 'history' && <ExecutionHistory />}
            {sub === 'revenue' && <RevenueDashboard />}
            {sub === 'audit' && <AuditLog />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
