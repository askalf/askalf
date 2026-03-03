import { useState, lazy, Suspense } from 'react';

const InterventionGateway = lazy(() => import('../hub/InterventionGateway'));
const Tickets = lazy(() => import('../hub/Tickets'));
const ContentFeed = lazy(() => import('../hub/ContentFeed'));

type Sub = 'tickets' | 'interventions' | 'content';

export default function OperationsTab() {
  const [sub, setSub] = useState<Sub>('tickets');

  return (
    <div>
      <div className="ud-sub-tabs">
        {(['tickets', 'interventions', 'content'] as Sub[]).map((s) => (
          <button key={s} className={`ud-sub-tab ${sub === s ? 'active' : ''}`} onClick={() => setSub(s)}>
            {s === 'tickets' ? 'Tickets' : s === 'interventions' ? 'Interventions' : 'Content'}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="ud-loading">Loading...</div>}>
        {sub === 'tickets' && <Tickets />}
        {sub === 'interventions' && <InterventionGateway />}
        {sub === 'content' && <ContentFeed />}
      </Suspense>
    </div>
  );
}
