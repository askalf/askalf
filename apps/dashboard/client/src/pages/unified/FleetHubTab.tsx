import { useState, useCallback, lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import type { ForgeEvent } from '../../constants/status';

const FleetTab = lazy(() => import('./FleetTab'));
const BuilderTab = lazy(() => import('./BuilderTab'));
const TemplatesTab = lazy(() => import('./TemplatesTab'));

type SubTab = 'agents' | 'builder' | 'skills';

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
      <div className="ud-sub-tabs" role="tablist" aria-label="Fleet sub-navigation">
        {([
          { key: 'agents' as SubTab, label: 'Agents' },
          { key: 'builder' as SubTab, label: 'Builder' },
          { key: 'skills' as SubTab, label: 'Skills' },
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
            {sub === 'agents' && <FleetTab wsEvents={wsEvents} />}
            {sub === 'builder' && <BuilderTab prefilledTemplate={builderTemplate} />}
            {sub === 'skills' && <TemplatesTab onUseTemplate={handleUseTemplate} />}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
