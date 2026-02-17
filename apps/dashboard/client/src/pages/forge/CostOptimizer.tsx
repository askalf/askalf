import { useState, useEffect } from 'react';
import { hubApi } from '../../hooks/useHubApi';
import StatCard from '../hub/shared/StatCard';
import './forge-observe.css';

interface CostProfile {
  capability: string;
  model_id: string;
  avg_cost: number;
  avg_tokens: number;
  avg_quality: number;
  sample_count: number;
}

export default function CostOptimizer() {
  const [profiles, setProfiles] = useState<CostProfile[]>([]);
  const [savings, setSavings] = useState({ totalSamples: 0, avgCostReduction: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await hubApi.costOptimizer.dashboard();
      setProfiles(Array.isArray(data.profiles) ? data.profiles as CostProfile[] : []);
      setSavings(data.savings ?? { totalSamples: 0, avgCostReduction: 0 });
    } catch { /* ignore */ }
    setLoading(false);
  };

  // Group profiles by capability
  const byCapability = new Map<string, CostProfile[]>();
  for (const p of profiles) {
    const list = byCapability.get(p.capability) ?? [];
    list.push(p);
    byCapability.set(p.capability, list);
  }

  return (
    <div className="fo-overview">
      <div className="fo-stats">
        <StatCard value={profiles.length} label="Cost Profiles" />
        <StatCard value={savings.totalSamples} label="Total Samples" />
        <StatCard value={`${(savings.avgCostReduction * 100).toFixed(0)}%`} label="Avg Savings Potential" variant={savings.avgCostReduction > 0.2 ? 'success' : 'default'} />
        <StatCard value={byCapability.size} label="Capabilities Tracked" />
      </div>

      <div className="fo-section">
        <div className="fo-section-header">
          <h3>Cost Optimization by Capability</h3>
          <button className="hub-btn hub-btn--sm" onClick={loadData}>Refresh</button>
        </div>

        {loading && <div className="fo-empty">Loading cost profiles...</div>}
        {!loading && profiles.length === 0 && <div className="fo-empty">No cost data yet. Cost profiles are built automatically as agents execute tasks.</div>}

        {Array.from(byCapability.entries()).map(([capability, caps]) => (
          <div key={capability} className="fo-card" style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>{capability}</h4>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ opacity: 0.5, textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>Model</th>
                  <th style={{ padding: '4px 8px' }}>Avg Cost</th>
                  <th style={{ padding: '4px 8px' }}>Avg Tokens</th>
                  <th style={{ padding: '4px 8px' }}>Quality</th>
                  <th style={{ padding: '4px 8px' }}>Samples</th>
                </tr>
              </thead>
              <tbody>
                {caps.sort((a, b) => a.avg_cost - b.avg_cost).map((p, i) => (
                  <tr key={p.model_id} style={{ background: i === 0 ? 'rgba(74,222,128,0.05)' : undefined }}>
                    <td style={{ padding: '4px 8px' }}>
                      {p.model_id.replace('claude-', '').replace(/-\d{8}$/, '')}
                      {i === 0 && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#4ade80' }}>cheapest</span>}
                    </td>
                    <td style={{ padding: '4px 8px' }}>${p.avg_cost.toFixed(4)}</td>
                    <td style={{ padding: '4px 8px' }}>{Math.round(p.avg_tokens)}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '40px', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.1)' }}>
                          <div style={{ width: `${p.avg_quality * 100}%`, height: '100%', borderRadius: '3px', background: p.avg_quality > 0.7 ? '#4ade80' : p.avg_quality > 0.4 ? '#eab308' : '#ef4444' }} />
                        </div>
                        {(p.avg_quality * 100).toFixed(0)}%
                      </div>
                    </td>
                    <td style={{ padding: '4px 8px' }}>{p.sample_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
