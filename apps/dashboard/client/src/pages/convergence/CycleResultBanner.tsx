import { cycleSummary } from '../../hooks/useConvergenceApi';

interface CycleResultBannerProps {
  success: boolean;
  result: unknown;
}

export default function CycleResultBanner({ success, result }: CycleResultBannerProps) {
  return (
    <div className={`convergence-cycle-result ${success ? 'result-success' : 'result-failure'}`}>
      {success ? 'Success' : 'Failed'}
      {result != null && typeof result === 'object' ? (
        <span className="convergence-cycle-result-detail">
          {cycleSummary(result as Record<string, unknown>)}
        </span>
      ) : null}
    </div>
  );
}
