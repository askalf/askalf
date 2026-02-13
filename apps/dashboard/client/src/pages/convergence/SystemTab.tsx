import { useConvergenceStore } from '../../stores/convergence';
import { formatUptime } from '../../hooks/useConvergenceApi';

export default function SystemTab() {
  const { workerHealth } = useConvergenceStore();

  return (
    <>
      {/* Worker Health */}
      <h3 className="convergence-section-title">Worker Health</h3>
      {workerHealth ? (
        <div className="convergence-worker-card">
          <div className="convergence-worker-status">
            <span className={`convergence-status-dot ${workerHealth.status === 'healthy' || workerHealth.status === 'ok' ? 'dot-healthy' : 'dot-unhealthy'}`} />
            <span className="convergence-worker-status-text">
              {workerHealth.status === 'healthy' || workerHealth.status === 'ok' ? 'Healthy' : workerHealth.status}
            </span>
          </div>
          {workerHealth.uptime != null && (
            <div className="convergence-worker-metric">
              <span className="convergence-worker-metric-label">Uptime</span>
              <span className="convergence-worker-metric-value">{formatUptime(workerHealth.uptime)}</span>
            </div>
          )}
          {workerHealth.jobs && (
            <div className="convergence-worker-metrics-grid">
              <div className="convergence-worker-metric">
                <span className="convergence-worker-metric-value">{workerHealth.jobs.processed}</span>
                <span className="convergence-worker-metric-label">Processed</span>
              </div>
              <div className="convergence-worker-metric">
                <span className="convergence-worker-metric-value">{workerHealth.jobs.failed}</span>
                <span className="convergence-worker-metric-label">Failed</span>
              </div>
              <div className="convergence-worker-metric">
                <span className="convergence-worker-metric-value">{workerHealth.jobs.active}</span>
                <span className="convergence-worker-metric-label">Active</span>
              </div>
            </div>
          )}
          {workerHealth.error && (
            <div className="convergence-worker-error">{workerHealth.error}</div>
          )}
        </div>
      ) : (
        <p className="convergence-no-data">Loading worker health...</p>
      )}

      {/* Queue Status */}
      {workerHealth?.queues && Object.keys(workerHealth.queues).length > 0 && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Queue Status</h3>
          <div className="convergence-queue-grid">
            {Object.entries(workerHealth.queues).map(([name, q]) => (
              <div key={name} className="convergence-queue-card">
                <div className="convergence-queue-name">{name}</div>
                <div className="convergence-queue-metrics">
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value">{q.active}</span> active
                  </span>
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value">{q.waiting}</span> waiting
                  </span>
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value">{q.completed}</span> done
                  </span>
                  <span className="convergence-queue-metric">
                    <span className="convergence-queue-metric-value convergence-queue-failed">{q.failed}</span> failed
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Circuit Breakers */}
      {workerHealth?.circuitBreakers && Object.keys(workerHealth.circuitBreakers).length > 0 && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Circuit Breakers</h3>
          <div className="convergence-breaker-grid">
            {Object.entries(workerHealth.circuitBreakers).map(([name, cb]) => (
              <div key={name} className={`convergence-breaker-chip ${cb.isOpen ? 'breaker-open' : 'breaker-closed'}`}>
                <span className={`convergence-status-dot ${cb.isOpen ? 'dot-unhealthy' : 'dot-healthy'}`} />
                <span className="convergence-breaker-name">{name}</span>
                <span className="convergence-breaker-state">{cb.isOpen ? 'open' : 'closed'}</span>
                {cb.failures > 0 && <span className="convergence-breaker-failures">({cb.failures} failures)</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Config Display */}
      {workerHealth?.config && Object.keys(workerHealth.config).length > 0 && (
        <>
          <h3 className="convergence-section-title" style={{ marginTop: 32 }}>Configuration</h3>
          <div className="convergence-config-card">
            {Object.entries(workerHealth.config).map(([key, value]) => (
              <div key={key} className="convergence-config-row">
                <span className="convergence-config-key">{key}</span>
                <span className="convergence-config-value">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
