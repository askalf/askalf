import { useState, lazy, Suspense } from 'react';

const CostDashboard = lazy(() => import('../forge/CostDashboard'));
const ExecutionHistory = lazy(() => import('../hub/ExecutionHistory'));
const ProviderHealthPage = lazy(() => import('../forge/ProviderHealth'));
const GuardrailsManager = lazy(() => import('../forge/GuardrailsManager'));
const AuditLog = lazy(() => import('../forge/AuditLog'));

type Sub = 'costs' | 'executions' | 'providers' | 'guardrails' | 'audit';

export default function MonitorTab() {
  const [sub, setSub] = useState<Sub>('costs');

  const labels: Record<Sub, string> = {
    costs: 'Costs',
    executions: 'Executions',
    providers: 'Providers',
    guardrails: 'Guardrails',
    audit: 'Audit',
  };

  return (
    <div>
      <div className="ud-sub-tabs" role="tablist" aria-label="Monitor sections">
        {(['costs', 'executions', 'providers', 'guardrails', 'audit'] as Sub[]).map((s) => (
          <button key={s} role="tab" aria-selected={sub === s} className={`ud-sub-tab ${sub === s ? 'active' : ''}`} onClick={() => setSub(s)}>
            {labels[s]}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="ud-loading">Loading...</div>}>
        {sub === 'costs' && <CostDashboard />}
        {sub === 'executions' && <ExecutionHistory />}
        {sub === 'providers' && <ProviderHealthPage />}
        {sub === 'guardrails' && <GuardrailsManager />}
        {sub === 'audit' && <AuditLog />}
      </Suspense>
    </div>
  );
}
