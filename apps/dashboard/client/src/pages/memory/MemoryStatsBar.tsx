import { useMemoryStore } from '../../stores/memory';
import type { MemoryTier } from '../../hooks/useMemoryApi';

export default function MemoryStatsBar() {
  const { stats, activeTier, setActiveTier } = useMemoryStore();
  if (!stats) return null;

  const items: { tier: MemoryTier; icon: string; value: number; label: string }[] = [
    { tier: 'procedural', icon: '\u26A1', value: stats.shards.promoted, label: `Shards (${stats.traces} traces)` },
    { tier: 'episodic', icon: '\uD83D\uDCD6', value: stats.episodes, label: 'Episodes' },
    { tier: 'semantic', icon: '\uD83D\uDCDA', value: stats.facts, label: 'Facts' },
    { tier: 'working', icon: '\uD83E\uDDE0', value: stats.contexts, label: 'Contexts' },
  ];

  return (
    <div className="memory-stats">
      {items.map((item) => (
        <div
          key={item.tier}
          className={`memory-stat ${activeTier === item.tier ? 'active' : ''}`}
          onClick={() => setActiveTier(item.tier)}
        >
          <span className="stat-icon">{item.icon}</span>
          <div className="stat-info">
            <span className="stat-value">{item.value}</span>
            <span className="stat-label">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
