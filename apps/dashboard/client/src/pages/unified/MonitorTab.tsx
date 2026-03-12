import { useState, lazy, Suspense } from 'react';
import TabBar from '../../components/TabBar';

const CostDashboard = lazy(() => import('../forge/CostDashboard'));
const ExecutionHistory = lazy(() => import('../hub/ExecutionHistory'));
const AgentTimeline = lazy(() => import('../hub/AgentTimeline'));
const ProviderHealthPage = lazy(() => import('../forge/ProviderHealth'));
const GuardrailsManager = lazy(() => import('../forge/GuardrailsManager'));
const AuditLog = lazy(() => import('../forge/AuditLog'));

type Sub = 'costs' | 'executions' | 'timeline' | 'providers' | 'guardrails' | 'audit';

export default function MonitorTab() {
  const [sub, setSub] = useState<Sub>('costs');

  const labels: Record<Sub, string> = {
    costs: 'Costs',
    executions: 'Executions',
    timeline: 'Timeline',
    providers: 'Providers',
    guardrails: 'Guardrails',
    audit: 'Audit',
  };

  return (
    <div>
      <TabBar
        tabs={(['costs', 'executions', 'timeline', 'providers', 'guardrails', 'audit'] as Sub[]).map(s => ({ key: s, label: labels[s] }))}
        active={sub}
        onChange={(k) => setSub(k as Sub)}
        className="ud-sub-tabs"
        ariaLabel="Monitor sections"
      />
      <Suspense fallback={<div className="ud-loading">Loading...</div>}>
        {sub === 'costs' && <CostDashboard />}
        {sub === 'executions' && <ExecutionHistory />}
        {sub === 'timeline' && <AgentTimeline />}
        {sub === 'providers' && <ProviderHealthPage />}
        {sub === 'guardrails' && <GuardrailsManager />}
        {sub === 'audit' && <AuditLog />}
      </Suspense>
    </div>
  );
}
