import { useAnalyticsStore } from '../../stores/analytics';
import { fmt, fmtPercent } from '../../hooks/useAnalyticsApi';

export default function MemorySection() {
  const metrics = useAnalyticsStore((s) => s.metrics);
  const memoryStats = useAnalyticsStore((s) => s.memoryStats);
  if (!metrics) return null;

  return (
    <div className="analytics-section">
      <h2>Memory System</h2>
      <div className="analytics-memory-grid">
        <div className="analytics-memory-card analytics-memory--procedural">
          <div className="analytics-memory-header"><span className="analytics-memory-dot" />Procedural</div>
          <div className="analytics-memory-val">{memoryStats ? fmt(memoryStats.procedural.shards.total) : fmt(metrics.shards.total)}</div>
          <div className="analytics-memory-detail">
            {memoryStats && `${memoryStats.procedural.shards.promoted} promoted · ${memoryStats.procedural.shards.shadow} shadow`}
          </div>
        </div>
        <div className="analytics-memory-card analytics-memory--episodic">
          <div className="analytics-memory-header"><span className="analytics-memory-dot" />Episodic</div>
          <div className="analytics-memory-val">{memoryStats ? fmt(memoryStats.episodic.total) : '-'}</div>
          <div className="analytics-memory-detail">
            {memoryStats && `${memoryStats.episodic.positive} positive · ${memoryStats.episodic.negative} negative`}
          </div>
        </div>
        <div className="analytics-memory-card analytics-memory--semantic">
          <div className="analytics-memory-header"><span className="analytics-memory-dot" />Semantic</div>
          <div className="analytics-memory-val">{memoryStats ? fmt(memoryStats.semantic.facts) : '-'}</div>
          <div className="analytics-memory-detail">
            {memoryStats && `${memoryStats.semantic.categories} categories · ${fmtPercent(memoryStats.semantic.avgConfidence * 100)} conf`}
          </div>
        </div>
        <div className="analytics-memory-card analytics-memory--working">
          <div className="analytics-memory-header"><span className="analytics-memory-dot" />Working</div>
          <div className="analytics-memory-val">{memoryStats ? fmt(memoryStats.working.total) : '-'}</div>
          <div className="analytics-memory-detail">
            {memoryStats && `${fmtPercent(memoryStats.working.avgCompression * 100)} compression`}
          </div>
        </div>
      </div>
    </div>
  );
}
