import { useState, useEffect, useCallback } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import { usePolling } from '../../hooks/usePolling';
import StatCard from '../hub/shared/StatCard';

interface CycleInfo {
  cycle: string;
  intervalHours: number;
  lastRun: string | null;
  lastDurationMs: number;
  lastResult: Record<string, number>;
  runCount: number;
  lastError: string | null;
}

interface MetabolicStatus {
  startedAt: string;
  uptimeSeconds: number;
  cycles: CycleInfo[];
  memory: Record<string, number>;
}

const CYCLE_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  decay: { label: 'Decay', description: 'Prunes stale memories, reduces importance of unused knowledge', icon: '🧹' },
  lessons: { label: 'Lessons', description: 'Learns from agent failures, marks episodes as processed', icon: '📖' },
  promote: { label: 'Promote', description: 'Boosts high-performing procedures and frequently-accessed knowledge', icon: '⬆' },
  feedback: { label: 'Feedback', description: 'Processes user feedback into learning signals', icon: '💬' },
  'prompt-rewrite': { label: 'Prompt Rewrite', description: 'Proposes prompt revisions based on performance data', icon: '✏' },
  'goal-proposal': { label: 'Goal Proposal', description: 'Proposes new goals for agents based on history', icon: '🎯' },
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function nextRunIn(lastRun: string | null, intervalHours: number): string {
  if (!lastRun) return 'Pending';
  const nextMs = new Date(lastRun).getTime() + intervalHours * 3600000;
  const diff = nextMs - Date.now();
  if (diff <= 0) return 'Due now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
}

export default function MetabolicDashboard() {
  const [status, setStatus] = useState<MetabolicStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await hubApi.metabolic.status();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metabolic status');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  usePolling(fetchStatus, 30000);

  const totalMemories = status ? Object.values(status.memory).reduce((s, n) => s + n, 0) : 0;
  const totalRuns = status?.cycles.reduce((s, c) => s + c.runCount, 0) ?? 0;
  const hasErrors = status?.cycles.some((c) => c.lastError) ?? false;
  const activeCycles = status?.cycles.filter((c) => c.runCount > 0).length ?? 0;

  return (
    <div className="fo-overview">
      {/* Header Stats */}
      <div className="fo-stats">
        <StatCard
          value={status ? formatUptime(status.uptimeSeconds) : '-'}
          label="Forge Uptime"
          variant="success"
          large
        />
        <StatCard
          value={`${activeCycles}/${status?.cycles.length ?? 6}`}
          label="Active Cycles"
          variant={activeCycles > 0 ? 'success' : 'warning'}
        />
        <StatCard
          value={totalRuns}
          label="Total Cycle Runs"
        />
        <StatCard
          value={totalMemories}
          label="Total Memories"
          variant={totalMemories > 0 ? 'success' : 'default'}
        />
        <StatCard
          value={hasErrors ? 'Errors' : 'Healthy'}
          label="Cycle Health"
          variant={hasErrors ? 'danger' : 'success'}
          pulse={hasErrors}
        />
      </div>

      {error && (
        <div className="fo-card" style={{ borderLeft: '3px solid #ef4444', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', color: '#ef4444' }}>Failed to load metabolic status: {error}</span>
        </div>
      )}

      {loading && !status && (
        <div className="fo-empty">Loading metabolic status...</div>
      )}

      {/* Memory Tiers */}
      {status && (
        <div className="fo-section" style={{ marginBottom: '16px' }}>
          <div className="fo-section-header"><h3>Memory Tiers</h3></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {Object.entries(status.memory).map(([tier, count]) => (
              <div key={tier} className="fo-card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: count > 0 ? '#a78bfa' : 'rgba(255,255,255,0.3)' }}>
                  {count}
                </div>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, marginTop: '4px' }}>
                  {tier}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycle Cards */}
      {status && (
        <div className="fo-section">
          <div className="fo-section-header"><h3>Metabolic Cycles</h3></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '12px' }}>
            {status.cycles.map((cycle) => {
              const info = CYCLE_LABELS[cycle.cycle] ?? { label: cycle.cycle, description: '', icon: '🔄' };
              const hasError = !!cycle.lastError;
              const resultEntries = Object.entries(cycle.lastResult);

              return (
                <div
                  key={cycle.cycle}
                  className="fo-card"
                  style={{
                    borderLeft: `3px solid ${hasError ? '#ef4444' : cycle.runCount > 0 ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
                  }}
                >
                  {/* Cycle Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '18px' }}>{info.icon}</span>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{info.label}</div>
                        <div style={{ fontSize: '11px', opacity: 0.5 }}>{info.description}</div>
                      </div>
                    </div>
                    <span
                      className={`hub-badge hub-badge--${hasError ? 'danger' : cycle.runCount > 0 ? 'success' : 'default'}`}
                      style={{ fontSize: '10px' }}
                    >
                      {hasError ? 'Error' : cycle.runCount > 0 ? 'Active' : 'Pending'}
                    </span>
                  </div>

                  {/* Cycle Stats Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '12px', marginBottom: '8px' }}>
                    <div>
                      <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Interval</div>
                      <div style={{ fontWeight: 500 }}>
                        {cycle.intervalHours >= 1 ? `${cycle.intervalHours}h` : `${Math.round(cycle.intervalHours * 60)}m`}
                      </div>
                    </div>
                    <div>
                      <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Last Run</div>
                      <div style={{ fontWeight: 500 }}>{relativeTime(cycle.lastRun)}</div>
                    </div>
                    <div>
                      <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Next</div>
                      <div style={{ fontWeight: 500 }}>{nextRunIn(cycle.lastRun, cycle.intervalHours)}</div>
                    </div>
                    <div>
                      <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Runs</div>
                      <div style={{ fontWeight: 500 }}>{cycle.runCount}</div>
                    </div>
                    <div>
                      <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Duration</div>
                      <div style={{ fontWeight: 500 }}>{cycle.lastDurationMs > 0 ? `${cycle.lastDurationMs}ms` : '-'}</div>
                    </div>
                    <div>
                      <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Started</div>
                      <div style={{ fontWeight: 500 }}>{new Date(status.startedAt).toLocaleTimeString()}</div>
                    </div>
                  </div>

                  {/* Last Result */}
                  {resultEntries.length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', opacity: 0.5, marginBottom: '4px' }}>Last Result</div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {resultEntries.map(([key, val]) => (
                          <span key={key} style={{ fontSize: '12px' }}>
                            <span style={{ opacity: 0.6 }}>{key.replace(/([A-Z])/g, ' $1').trim()}: </span>
                            <span style={{ fontWeight: 600, color: val > 0 ? '#a78bfa' : 'inherit' }}>{val}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {hasError && (
                    <div style={{ borderTop: '1px solid rgba(239,68,68,0.2)', paddingTop: '8px', marginTop: '8px' }}>
                      <div style={{ fontSize: '11px', color: '#ef4444' }}>
                        {cycle.lastError}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
