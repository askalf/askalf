import { useCallback, useEffect } from 'react';
import { useHubStore } from '../../stores/hub';
import { usePolling } from '../../hooks/usePolling';
import StatusBadge from '../hub/shared/StatusBadge';
import './forge-observe.css';

const relativeTime = (iso: string | null) => {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function ProviderHealth() {
  const providersList = useHubStore((s) => s.providersList);
  const providerHealth = useHubStore((s) => s.providerHealth);
  const expandedProvider = useHubStore((s) => s.expandedProvider);
  const providerModels = useHubStore((s) => s.providerModels);
  const setExpandedProvider = useHubStore((s) => s.setExpandedProvider);
  const fetchProviders = useHubStore((s) => s.fetchProviders);
  const fetchProviderHealth = useHubStore((s) => s.fetchProviderHealth);
  const fetchProviderModels = useHubStore((s) => s.fetchProviderModels);
  const runProviderHealthCheck = useHubStore((s) => s.runProviderHealthCheck);
  const loading = useHubStore((s) => s.loading);

  const poll = useCallback(() => {
    fetchProviders();
    fetchProviderHealth();
  }, [fetchProviders, fetchProviderHealth]);
  usePolling(poll, 30000);

  // When a provider is expanded, load its models
  useEffect(() => {
    if (expandedProvider && !providerModels[expandedProvider]) {
      fetchProviderModels(expandedProvider);
    }
  }, [expandedProvider, providerModels, fetchProviderModels]);

  const healthDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'fobs-health-dot--ok';
      case 'degraded': return 'fobs-health-dot--warn';
      case 'unhealthy': return 'fobs-health-dot--danger';
      default: return 'fobs-health-dot--unknown';
    }
  };

  return (
    <div className="fo-overview">
      {/* Overall Status */}
      {providerHealth && (
        <div className="fobs-overall-status">
          <span className={`fobs-health-dot ${healthDot(providerHealth.status)}`} />
          <span className="fobs-overall-label">
            System: <strong>{providerHealth.status}</strong>
          </span>
          <span className="fobs-provider-count">
            {providersList.length} provider{providersList.length !== 1 ? 's' : ''} configured
          </span>
          <button
            className="fo-action-btn"
            onClick={runProviderHealthCheck}
            disabled={!!loading['providerHealthCheck']}
            style={{ marginLeft: 'auto' }}
          >
            {loading['providerHealthCheck'] ? 'Checking...' : 'Check Now'}
          </button>
        </div>
      )}

      {/* Provider Cards */}
      {loading['providers'] && providersList.length === 0 ? (
        <p className="fo-empty">Loading providers...</p>
      ) : providersList.length === 0 ? (
        <p className="fo-empty">No providers configured</p>
      ) : (
        <div className="fobs-provider-grid">
          {providersList.map((provider) => {
            const isExpanded = expandedProvider === provider.id;
            const models = providerModels[provider.id] || [];

            return (
              <div
                key={provider.id}
                className={`fo-panel fobs-provider-card ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
              >
                <div className="fobs-provider-header" style={!provider.is_enabled ? { opacity: 0.5 } : undefined}>
                  <div className="fobs-provider-name-row">
                    <span className={`fobs-health-dot ${provider.is_enabled ? healthDot(provider.health_status) : 'fobs-health-dot--unknown'}`} />
                    <strong>{provider.name}</strong>
                    <span className="fobs-provider-type">{provider.type}</span>
                  </div>
                  <div className="fobs-provider-meta">
                    {!provider.is_enabled && (provider.config as Record<string, unknown>)?.coming_soon ? (
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', fontWeight: 500 }}>Coming Soon</span>
                    ) : (
                      <StatusBadge status={provider.is_enabled ? 'active' : 'paused'} />
                    )}
                    {provider.is_enabled && (
                      <span className="fobs-provider-check">
                        Checked {relativeTime(provider.last_health_check)}
                      </span>
                    )}
                  </div>
                </div>

                {provider.base_url && (
                  <div className="fobs-provider-url">{provider.base_url}</div>
                )}

                {isExpanded && (
                  <div className="fobs-provider-models" onClick={(e) => e.stopPropagation()}>
                    <div className="fobs-models-header">
                      Models ({models.length})
                    </div>
                    {models.length === 0 ? (
                      <p className="fo-empty">Loading models...</p>
                    ) : (
                      <div className="fobs-table-wrap">
                        <table className="fobs-table">
                          <thead>
                            <tr>
                              <th>Model</th>
                              <th>Context</th>
                              <th>In $/1k</th>
                              <th>Out $/1k</th>
                              <th>Caps</th>
                            </tr>
                          </thead>
                          <tbody>
                            {models.map((m) => (
                              <tr key={m.id}>
                                <td>
                                  <span className="fobs-model-name">{m.display_name || m.model_id}</span>
                                  {m.is_reasoning && <span className="fobs-badge fobs-badge--purple">reason</span>}
                                  {m.is_fast && <span className="fobs-badge fobs-badge--blue">fast</span>}
                                </td>
                                <td className="fobs-mono">{(m.context_window / 1000).toFixed(0)}k</td>
                                <td className="fobs-mono">${m.cost_per_1k_input}</td>
                                <td className="fobs-mono">${m.cost_per_1k_output}</td>
                                <td>
                                  {m.supports_tools && <span className="fobs-cap" title="Tools">T</span>}
                                  {m.supports_vision && <span className="fobs-cap" title="Vision">V</span>}
                                  {m.supports_streaming && <span className="fobs-cap" title="Streaming">S</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
