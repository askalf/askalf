import { useState, lazy, Suspense } from 'react';

const FleetMemory = lazy(() => import('../hub/FleetMemory'));
const GraphTab = lazy(() => import('./GraphTab'));

type Sub = 'memory' | 'graph';

export default function KnowledgeTab() {
  const [sub, setSub] = useState<Sub>('memory');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="ud-sub-tabs">
        <button className={`ud-sub-tab ${sub === 'memory' ? 'active' : ''}`} onClick={() => setSub('memory')}>
          Memory
        </button>
        <button className={`ud-sub-tab ${sub === 'graph' ? 'active' : ''}`} onClick={() => setSub('graph')}>
          Graph
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Suspense fallback={<div className="ud-loading">Loading...</div>}>
          {sub === 'memory' && <FleetMemory />}
          {sub === 'graph' && <GraphTab />}
        </Suspense>
      </div>
    </div>
  );
}
