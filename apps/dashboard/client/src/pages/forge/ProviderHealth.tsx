import { useCallback, useEffect, useState } from 'react';
import { useHubStore } from '../../stores/hub';
import { useAuthStore } from '../../stores/auth';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../components/Toast';
import type { Provider, AuthSource, UserProviderKey } from '../../hooks/useHubApi';
import { hubApi } from '../../hooks/useHubApi';
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

const AUTH_SOURCE_LABELS: Record<AuthSource, string> = {
  db: 'API Key (saved)',
  env: 'API Key (env)',
  oauth: 'CLI / OAuth',
  none: 'Not configured',
};

const AUTH_SOURCE_CLASSES: Record<AuthSource, string> = {
  db: 'prov-auth--db',
  env: 'prov-auth--env',
  oauth: 'prov-auth--oauth',
  none: 'prov-auth--none',
};

const PROVIDER_TYPE_ORDER = ['anthropic', 'openai', 'xai', 'deepseek', 'ollama', 'lmstudio', 'custom'];

const FEATURED_PROVIDERS = ['anthropic', 'openai'];

const PROVIDER_INFO: Record<string, { name: string; description: string; prefix: string }> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models — reasoning, coding, and analysis',
    prefix: 'sk-ant-',
  },
  openai: {
    name: 'OpenAI',
    description: 'GPT and o-series models',
    prefix: 'sk-',
  },
};

// ─── User-Facing Featured Card ─────────────────────────────────────

function FeaturedProviderCard({
  providerType,
  userKey,
  onRefresh,
}: {
  providerType: string;
  userKey: UserProviderKey | undefined;
  onRefresh: () => void;
}) {
  const { addToast } = useToast();
  const [editingKey, setEditingKey] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const info = PROVIDER_INFO[providerType];
  if (!info) return null;

  const isConnected = userKey?.has_key && userKey.is_active;

  const handleSave = async () => {
    const trimmed = keyValue.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await hubApi.userProviders.set(providerType, { api_key: trimmed });
      addToast(`${info.name} key saved`, 'success');
      setEditingKey(false);
      setKeyValue('');
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save key';
      addToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(`Remove your ${info.name} API key?`)) return;
    try {
      await hubApi.userProviders.remove(providerType);
      addToast(`${info.name} key removed`, 'info');
      onRefresh();
    } catch {
      addToast('Failed to remove key', 'error');
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await hubApi.userProviders.verify(providerType);
      if (res.status === 'valid') {
        addToast(`${info.name} key verified`, 'success');
        onRefresh();
      } else {
        addToast(`${info.name} key invalid: ${res.error || 'verification failed'}`, 'error');
      }
    } catch {
      addToast('Verification failed', 'error');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className={`uprov-card ${isConnected ? 'uprov-card--connected' : ''}`}>
      <div className="uprov-card-header">
        <div className="uprov-provider-icon">{providerType === 'anthropic' ? '◈' : '◉'}</div>
        <div className="uprov-provider-info">
          <h3 className="uprov-provider-name">{info.name}</h3>
          <p className="uprov-provider-desc">{info.description}</p>
        </div>
        <div className={`uprov-status ${isConnected ? 'uprov-status--connected' : 'uprov-status--none'}`}>
          <span className="uprov-status-dot" />
          {isConnected ? 'Connected' : 'Not configured'}
        </div>
      </div>

      <div className="uprov-card-body">
        {isConnected && !editingKey ? (
          <div className="uprov-key-display">
            <div className="uprov-key-row">
              <span className="uprov-key-label">API Key</span>
              <code className="uprov-key-hint">{userKey.key_hint}</code>
            </div>
            {userKey.last_verified_at && (
              <div className="uprov-key-meta">Verified {relativeTime(userKey.last_verified_at)}</div>
            )}
            <div className="uprov-key-actions">
              <button className="uprov-btn uprov-btn--verify" onClick={handleVerify} disabled={verifying}>
                {verifying ? 'Verifying...' : 'Verify'}
              </button>
              <button className="uprov-btn uprov-btn--change" onClick={() => setEditingKey(true)}>
                Change Key
              </button>
              <button className="uprov-btn uprov-btn--remove" onClick={handleRemove}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="uprov-key-edit">
            <div className="uprov-input-row">
              <input
                type={showKey ? 'text' : 'password'}
                className="uprov-key-input"
                placeholder={`Paste your ${info.name} API key (${info.prefix}...)`}
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                autoFocus={editingKey}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && keyValue.trim()) handleSave();
                  if (e.key === 'Escape') { setEditingKey(false); setKeyValue(''); }
                }}
              />
              <button
                className="uprov-btn uprov-btn--toggle-vis"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide' : 'Show'}
              >
                {showKey ? '◌' : '◉'}
              </button>
            </div>
            <div className="uprov-input-actions">
              <button
                className="uprov-btn uprov-btn--save"
                onClick={handleSave}
                disabled={!keyValue.trim() || saving}
              >
                {saving ? 'Saving...' : 'Save Key'}
              </button>
              {(editingKey && isConnected) && (
                <button className="uprov-btn uprov-btn--cancel" onClick={() => { setEditingKey(false); setKeyValue(''); }}>
                  Cancel
                </button>
              )}
            </div>
            <p className="uprov-key-note">Your key is encrypted at rest and used for agent executions.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin System Provider Card (existing pattern) ─────────────────

function SystemProviderCard({
  provider,
  isExpanded,
  onToggleExpand,
  models,
  onFetchModels,
}: {
  provider: Provider;
  isExpanded: boolean;
  onToggleExpand: () => void;
  models: { id: string; model_id: string; display_name: string; context_window: number; cost_per_1k_input: string; cost_per_1k_output: string; supports_tools: boolean; supports_vision: boolean; supports_streaming: boolean; is_reasoning: boolean; is_fast: boolean }[];
  onFetchModels: () => void;
}) {
  const updateProvider = useHubStore((s) => s.updateProvider);
  const [editingKey, setEditingKey] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isExpanded && models.length === 0) {
      onFetchModels();
    }
  }, [isExpanded, models.length, onFetchModels]);

  const healthDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'fobs-health-dot--ok';
      case 'degraded': return 'fobs-health-dot--warn';
      case 'unhealthy': case 'down': return 'fobs-health-dot--danger';
      default: return 'fobs-health-dot--unknown';
    }
  };

  const handleToggleEnabled = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await updateProvider(provider.id, { is_enabled: !provider.is_enabled });
  };

  const handleSaveKey = async () => {
    setSaving(true);
    const ok = await updateProvider(provider.id, { api_key: keyValue.trim() || null });
    setSaving(false);
    if (ok) { setEditingKey(false); setKeyValue(''); }
  };

  const handleClearKey = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Remove the stored system API key?')) return;
    await updateProvider(provider.id, { api_key: null });
  };

  const isLocal = provider.type === 'ollama' || provider.type === 'lmstudio';
  const comingSoon = !provider.is_enabled && (provider.config as Record<string, unknown>)?.coming_soon;

  return (
    <div className={`fo-panel prov-card ${isExpanded ? 'expanded' : ''}`}>
      <div className="prov-header" onClick={onToggleExpand} style={!provider.is_enabled && !comingSoon ? { opacity: 0.55 } : undefined}>
        <div className="prov-name-row">
          <span className={`fobs-health-dot ${provider.is_enabled ? healthDot(provider.health_status) : 'fobs-health-dot--unknown'}`} />
          <strong className="prov-name">{provider.name}</strong>
          <span className="fobs-provider-type">{provider.type}</span>
        </div>
        <div className="prov-header-right">
          <span className={`prov-auth-badge ${AUTH_SOURCE_CLASSES[provider.auth_source]}`}>{AUTH_SOURCE_LABELS[provider.auth_source]}</span>
          {comingSoon ? (
            <span className="prov-coming-soon">Coming Soon</span>
          ) : (
            <>
              <StatusBadge status={provider.is_enabled ? 'active' : 'paused'} />
              {provider.is_enabled && <span className="fobs-provider-check">Checked {relativeTime(provider.last_health_check)}</span>}
            </>
          )}
        </div>
      </div>

      <div className="prov-details" onClick={(e) => e.stopPropagation()}>
        <div className="prov-key-row">
          <div className="prov-key-info">
            <span className="prov-key-label">System Key:</span>
            {provider.has_key ? (
              <span className="prov-key-hint">{provider.key_hint}</span>
            ) : (
              <span className="prov-key-none">{isLocal ? 'Not needed (local)' : provider.auth_source === 'oauth' ? 'Using OAuth' : 'Not set'}</span>
            )}
          </div>
          {!isLocal && !comingSoon && (
            <div className="prov-key-actions">
              {editingKey ? (
                <div className="prov-key-edit">
                  <input type="password" className="fobs-input prov-key-input" placeholder={`Enter ${provider.type} API key...`} value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)} autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter' && keyValue.trim()) handleSaveKey(); if (e.key === 'Escape') { setEditingKey(false); setKeyValue(''); } }} />
                  <button className="fo-action-btn prov-save-btn" onClick={handleSaveKey} disabled={!keyValue.trim() || saving}>{saving ? 'Saving...' : 'Save'}</button>
                  <button className="fo-action-btn prov-cancel-btn" onClick={() => { setEditingKey(false); setKeyValue(''); }}>Cancel</button>
                </div>
              ) : (
                <>
                  <button className="fo-action-btn" onClick={() => setEditingKey(true)}>{provider.has_key && provider.auth_source === 'db' ? 'Change Key' : 'Set Key'}</button>
                  {provider.auth_source === 'db' && <button className="fo-action-btn prov-remove-btn" onClick={handleClearKey}>Remove</button>}
                </>
              )}
            </div>
          )}
        </div>

        {isLocal && (
          <div className="prov-key-row">
            <span className="prov-key-label">Base URL:</span>
            <span className="prov-key-hint fobs-mono">{provider.base_url || 'http://localhost:11434'}</span>
          </div>
        )}

        {!comingSoon && (
          <div className="prov-toggle-row">
            <button className={`prov-toggle-btn ${provider.is_enabled ? 'prov-toggle--on' : 'prov-toggle--off'}`} onClick={handleToggleEnabled}>
              {provider.is_enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="fobs-provider-models" onClick={(e) => e.stopPropagation()}>
          <div className="fobs-models-header">Models ({models.length})</div>
          {models.length === 0 ? (
            <p className="fo-empty">Loading models...</p>
          ) : (
            <div className="fobs-table-wrap">
              <table className="fobs-table">
                <thead>
                  <tr><th>Model</th><th>Context</th><th>In $/1k</th><th>Out $/1k</th><th>Caps</th></tr>
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
}

// ─── Main Component ────────────────────────────────────────────────

export default function ProviderHealth() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

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
  const userProviderKeys = useHubStore((s) => s.userProviderKeys);
  const fetchUserProviderKeys = useHubStore((s) => s.fetchUserProviderKeys);

  const [adminExpanded, setAdminExpanded] = useState(false);

  // Fetch user keys on mount
  useEffect(() => {
    fetchUserProviderKeys();
  }, [fetchUserProviderKeys]);

  // Poll admin providers (admin only)
  const adminPoll = useCallback(() => {
    if (isAdmin) {
      fetchProviders();
      fetchProviderHealth();
    }
  }, [isAdmin, fetchProviders, fetchProviderHealth]);
  usePolling(adminPoll, isAdmin ? 30000 : 0);

  // Sort system providers: enabled first, then by type order, exclude Google
  const sortedProviders = [...providersList]
    .filter((p) => p.type !== 'google')
    .sort((a, b) => {
      if (a.is_enabled !== b.is_enabled) return a.is_enabled ? -1 : 1;
      const aIdx = PROVIDER_TYPE_ORDER.indexOf(a.type);
      const bIdx = PROVIDER_TYPE_ORDER.indexOf(b.type);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

  const enabledCount = providersList.filter((p) => p.is_enabled && p.type !== 'google').length;
  const healthyCount = providersList.filter((p) => p.is_enabled && p.health_status === 'healthy' && p.type !== 'google').length;

  const healthDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'fobs-health-dot--ok';
      case 'degraded': return 'fobs-health-dot--warn';
      default: return 'fobs-health-dot--unknown';
    }
  };

  return (
    <div className="fo-overview">
      {/* ── Section A: Your API Keys (user-facing) ── */}
      <div className="uprov-section">
        <div className="uprov-section-header">
          <h2 className="uprov-section-title">Your API Keys</h2>
          <p className="uprov-section-desc">Connect your provider accounts to use your own models in agent executions</p>
        </div>

        <div className="uprov-featured-grid">
          {FEATURED_PROVIDERS.map((type) => (
            <FeaturedProviderCard
              key={type}
              providerType={type}
              userKey={userProviderKeys.find((k) => k.provider_type === type)}
              onRefresh={fetchUserProviderKeys}
            />
          ))}
        </div>
      </div>

      {/* ── Section B: System Providers (admin-only) ── */}
      {isAdmin && (
        <div className="uprov-admin-section">
          <button
            className={`uprov-admin-toggle ${adminExpanded ? 'uprov-admin-toggle--open' : ''}`}
            onClick={() => setAdminExpanded(!adminExpanded)}
          >
            <span className="uprov-admin-toggle-icon">{adminExpanded ? '▾' : '▸'}</span>
            <span className="uprov-admin-toggle-label">System Providers</span>
            {providerHealth && (
              <span className="uprov-admin-toggle-meta">
                <span className={`fobs-health-dot ${healthDot(providerHealth.status)}`} />
                {healthyCount}/{enabledCount} healthy
              </span>
            )}
          </button>

          {adminExpanded && (
            <div className="uprov-admin-content">
              {/* Overall Status Bar */}
              {providerHealth && (
                <div className="fobs-overall-status">
                  <span className={`fobs-health-dot ${healthDot(providerHealth.status)}`} />
                  <span className="fobs-overall-label">System: <strong>{providerHealth.status}</strong></span>
                  <span className="prov-summary">{healthyCount}/{enabledCount} healthy</span>
                  <button className="fo-action-btn" onClick={runProviderHealthCheck} disabled={!!loading['providerHealthCheck']} style={{ marginLeft: 'auto' }}>
                    {loading['providerHealthCheck'] ? 'Checking...' : 'Check Health'}
                  </button>
                </div>
              )}

              {loading['providers'] && providersList.length === 0 ? (
                <p className="fo-empty">Loading providers...</p>
              ) : sortedProviders.length === 0 ? (
                <p className="fo-empty">No providers configured</p>
              ) : (
                <div className="prov-grid">
                  {sortedProviders.map((provider) => (
                    <SystemProviderCard
                      key={provider.id}
                      provider={provider}
                      isExpanded={expandedProvider === provider.id}
                      onToggleExpand={() => setExpandedProvider(expandedProvider === provider.id ? null : provider.id)}
                      models={providerModels[provider.id] || []}
                      onFetchModels={() => fetchProviderModels(provider.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
