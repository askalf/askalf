import { lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import type { ForgeEvent } from '../../constants/status';

const OperationsTab = lazy(() => import('./OperationsTab'));

interface OpsTabProps {
  wsEvents?: ForgeEvent[];
}

export default function OpsTab({ wsEvents: _wsEvents = [] }: OpsTabProps) {
  return (
    <ErrorBoundary inline>
      <Suspense fallback={<div style={{ padding: 20 }}>Loading operations...</div>}>
        <OperationsTab />
      </Suspense>
    </ErrorBoundary>
  );
}
