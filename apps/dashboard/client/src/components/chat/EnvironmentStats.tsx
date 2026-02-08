interface EnvironmentStatsProps {
  stats: {
    tokensSaved: number;
    waterSaved: number;
    powerSaved: number;
    shardHits: number;
  };
}

export default function EnvironmentStats({ stats }: EnvironmentStatsProps) {
  const dollarsSaved = (stats.tokensSaved * 0.003) / 1000;

  return (
    <div className="environment-stats">
      <div className="environment-stat">
        <span className="environment-stat-icon">💰</span>
        <span className="environment-stat-value">${dollarsSaved < 0.01 ? '<0.01' : dollarsSaved.toFixed(2)}</span>
        <span className="environment-stat-label">saved</span>
      </div>
      <div className="environment-stat">
        <span className="environment-stat-icon">💧</span>
        <span className="environment-stat-value">{formatWater(stats.waterSaved)}</span>
        <span className="environment-stat-label">saved</span>
      </div>
      <div className="environment-stat">
        <span className="environment-stat-icon">⚡</span>
        <span className="environment-stat-value">{formatPower(stats.powerSaved)}</span>
        <span className="environment-stat-label">saved</span>
      </div>
      <div className="environment-stat">
        <span className="environment-stat-icon">🌍</span>
        <span className="environment-stat-value">{stats.shardHits}</span>
        <span className="environment-stat-label">free answers</span>
      </div>
    </div>
  );
}

function formatWater(ml: number): string {
  if (ml >= 1000) {
    return `${(ml / 1000).toFixed(1)}L`;
  }
  return `${Math.round(ml)}ml`;
}

function formatPower(wh: number): string {
  if (wh >= 1000) {
    return `${(wh / 1000).toFixed(1)}kWh`;
  }
  return `${Math.round(wh)}Wh`;
}
