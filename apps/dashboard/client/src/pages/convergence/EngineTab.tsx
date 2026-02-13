import { useConvergenceStore } from '../../stores/convergence';
import {
  CYCLES, LIFECYCLE_STAGES, timeAgo, formatDuration, cycleSummary,
  type CycleConfig,
} from '../../hooks/useConvergenceApi';
import ConfirmModal from '../hub/shared/ConfirmModal';
import TypedConfirmModal from '../hub/shared/TypedConfirmModal';
import CycleResultBanner from './CycleResultBanner';

export default function EngineTab() {
  const {
    data, cycleRunning, cycleResult, cycleHistory,
    confirmAction, typedConfirmAction,
    setConfirmAction, setTypedConfirmAction, triggerCycle,
  } = useConvergenceStore();

  if (!data) return null;

  const lastCrystallize = cycleHistory.find(r => r.event_type === 'crystallize');
  const promotedToday = data.maturity?.lifecycle.find(l => l.stage === 'promoted')?.count ?? 0;
  const lifecycleCounts = LIFECYCLE_STAGES.map(s => ({
    stage: s,
    count: data.maturity?.lifecycle.find(l => l.stage === s)?.count ?? 0,
  }));
  const decayRuns = cycleHistory.filter(r => r.event_type === 'decay');

  const handleCycleTrigger = (cycle: CycleConfig) => {
    if (cycle.danger === 'danger') {
      setTypedConfirmAction({ cycle });
    } else if (cycle.danger === 'warning' || cycle.danger === 'moderate') {
      setConfirmAction({ cycle, variant: 'warning' });
    } else {
      triggerCycle(cycle);
    }
  };

  const handleConfirm = () => {
    if (confirmAction) {
      triggerCycle(confirmAction.cycle);
      setConfirmAction(null);
    }
  };

  const handleTypedConfirm = () => {
    if (typedConfirmAction) {
      triggerCycle(typedConfirmAction.cycle);
      setTypedConfirmAction(null);
    }
  };

  return (
    <>
      {/* KPI Strip */}
      <div className="convergence-engine-kpi">
        <div className="convergence-kpi-card">
          <div className="convergence-kpi-value">{lastCrystallize ? timeAgo(lastCrystallize.created_at) : '--'}</div>
          <div className="convergence-kpi-label">Last Crystallize</div>
        </div>
        <div className="convergence-kpi-card">
          <div className="convergence-kpi-value">{promotedToday}</div>
          <div className="convergence-kpi-label">Promoted Shards</div>
        </div>
        <div className="convergence-kpi-card">
          <div className="convergence-kpi-value">{lifecycleCounts.map(l => l.count).join(' / ')}</div>
          <div className="convergence-kpi-label">{lifecycleCounts.map(l => l.stage.charAt(0).toUpperCase()).join(' / ')}</div>
        </div>
        <div className="convergence-kpi-card">
          <div className="convergence-kpi-value">{decayRuns.length}</div>
          <div className="convergence-kpi-label">Decay Runs</div>
        </div>
      </div>

      {/* Cycle Grid */}
      <h3 className="convergence-section-title">Cycle Controls</h3>
      <div className="convergence-cycle-grid">
        {CYCLES.map((cycle) => {
          const isRunning = cycleRunning === cycle.key;
          const lastResult = cycleResult?.cycle === cycle.key ? cycleResult : null;
          const lastRun = cycleHistory.find(r =>
            r.event_type === cycle.key ||
            r.event_type === cycle.name.toLowerCase() ||
            r.event_type.includes(cycle.key.replace('-', '_'))
          );

          return (
            <div key={cycle.key} className={`convergence-cycle-card cycle-${cycle.danger}`}>
              <div className="convergence-cycle-header">
                <span className="convergence-cycle-name">{cycle.name}</span>
                {cycle.danger !== 'safe' && (
                  <span className={`convergence-cycle-badge badge-${cycle.danger}`}>{cycle.danger}</span>
                )}
              </div>
              <p className="convergence-cycle-desc">{cycle.description}</p>
              {lastRun && (
                <div className="convergence-cycle-last-run">Last: {timeAgo(lastRun.created_at)}</div>
              )}
              <button
                className={`convergence-cycle-trigger trigger-${cycle.danger}`}
                onClick={() => handleCycleTrigger(cycle)}
                disabled={cycleRunning !== null}
              >
                {isRunning ? (
                  <><span className="cycle-spinner" /> Running...</>
                ) : (
                  `Run ${cycle.name}`
                )}
              </button>
              {lastResult && <CycleResultBanner success={lastResult.success} result={lastResult.result} />}
            </div>
          );
        })}
      </div>

      {/* History */}
      <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Recent Cycle History</h3>
      {cycleHistory.length === 0 ? (
        <p className="convergence-no-data">No cycle runs recorded yet.</p>
      ) : (
        <div className="convergence-history-scroll">
          <table className="convergence-topshards-table">
            <thead>
              <tr><th>Time</th><th>Cycle</th><th>Duration</th><th>Status</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {cycleHistory.map((run) => (
                <tr key={run.id}>
                  <td>{timeAgo(run.created_at)}</td>
                  <td><span className="convergence-topshards-category">{run.event_type}</span></td>
                  <td>{formatDuration(run.processing_time_ms)}</td>
                  <td>
                    <span className={`convergence-status-chip ${run.success ? 'status-success' : run.success === false ? 'status-failure' : 'status-unknown'}`}>
                      {run.success ? 'OK' : run.success === false ? 'FAIL' : '--'}
                    </span>
                  </td>
                  <td className="convergence-history-summary">{cycleSummary(run.analysis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Modals */}
      {confirmAction && (
        <ConfirmModal
          title={`Run ${confirmAction.cycle.name}?`}
          message={confirmAction.cycle.confirmMessage || `Are you sure you want to run ${confirmAction.cycle.name}?`}
          variant="warning"
          confirmLabel={`Run ${confirmAction.cycle.name}`}
          loading={cycleRunning !== null}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {typedConfirmAction && (
        <TypedConfirmModal
          title={`Run ${typedConfirmAction.cycle.name}?`}
          message={typedConfirmAction.cycle.confirmMessage || `DANGER: This will wipe procedural memory!`}
          requiredText={typedConfirmAction.cycle.requireTypedConfirm || 'RESEED_CONFIRMED'}
          confirmLabel={`Run ${typedConfirmAction.cycle.name}`}
          loading={cycleRunning !== null}
          onConfirm={handleTypedConfirm}
          onCancel={() => setTypedConfirmAction(null)}
        />
      )}
    </>
  );
}
