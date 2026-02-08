import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import './Integrations.css';

// ============================================
// TYPES
// ============================================

interface Connector {
  provider: string;
  configured: boolean;
  apiKeyPreview?: string;
  baseUrl?: string;
  lastTested?: string;
  testSuccess?: boolean;
}

interface ModelPreferences {
  primaryModel: string;
  embeddingModel: string;
  fastModel: string;
}

interface APIKey {
  id: string;
  name: string;
  keyPreview: string;
  scopes: string[];
  lastUsed: string | null;
  createdAt: string;
  expiresAt: string | null;
}

const API_BASE = window.location.hostname.includes('askalf.org')
  ? 'https://api.askalf.org'
  : 'http://localhost:3000';

type IntegrationTab = 'connectors' | 'api-keys';

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', icon: '🤖', desc: 'GPT-4, GPT-4o, o1, o3 models', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', icon: '🧠', desc: 'Claude Opus, Sonnet, Haiku models', placeholder: 'sk-ant-...' },
  { id: 'google', name: 'Google AI', icon: '🔮', desc: 'Gemini Pro, Flash models', placeholder: 'AIza...' },
  { id: 'xai', name: 'Grok (xAI)', icon: '⚡', desc: 'Grok models', placeholder: 'xai-...' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', desc: 'Local models (no API key needed)', placeholder: 'http://localhost:11434', isUrl: true },
];

// Plans that have BYOK access (AI Connectors)
const BYOK_PLANS = ['pro', 'team', 'enterprise', 'lifetime'];
// Plans that have API key access
const API_KEY_PLANS = ['basic', 'pro', 'team', 'enterprise', 'lifetime'];

export default function Integrations() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuthStore();

  // Check access levels
  const userPlan = user?.plan || 'free';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const hasByokAccess = BYOK_PLANS.includes(userPlan) || isAdmin;
  const hasApiKeyAccess = API_KEY_PLANS.includes(userPlan) || isAdmin;

  // Default to api-keys for non-Pro users, connectors for Pro+
  const [activeTab, setActiveTab] = useState<IntegrationTab>('api-keys');
  const [tabInitialized, setTabInitialized] = useState(false);

  // Set initial tab once auth is loaded
  useEffect(() => {
    if (!authLoading && !tabInitialized) {
      setActiveTab(hasByokAccess ? 'connectors' : 'api-keys');
      setTabInitialized(true);
    }
  }, [authLoading, hasByokAccess, tabInitialized]);

  // Connector state
  const [connectors, setConnectors] = useState<Record<string, Connector>>({});
  const [connectorsLoading, setConnectorsLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; message: string } | null>(null);

  // Model preferences (for future use)
  const [_preferences, setPreferences] = useState<ModelPreferences>({
    primaryModel: 'system',
    embeddingModel: 'system',
    fastModel: 'system',
  });

  // API Keys state
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['read', 'write', 'execute']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Load data on mount and tab change
  useEffect(() => {
    if (activeTab === 'connectors' && hasByokAccess) {
      fetchConnectors();
    } else if (activeTab === 'api-keys') {
      fetchAPIKeys();
    }
  }, [activeTab, hasByokAccess]);

  // ============================================
  // CONNECTORS API
  // ============================================

  const fetchConnectors = async () => {
    setConnectorsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/connectors`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const connectorsMap: Record<string, Connector> = {};
        // Map API response fields to frontend Connector interface
        (data.connectors || []).forEach((c: {
          provider: string;
          hasApiKey?: boolean;
          apiKeyLast4?: string;
          baseUrl?: string;
          lastValidatedAt?: string;
          validationStatus?: string;
        }) => {
          connectorsMap[c.provider] = {
            provider: c.provider,
            configured: c.hasApiKey || false,
            apiKeyPreview: c.apiKeyLast4 ? `****${c.apiKeyLast4}` : undefined,
            baseUrl: c.baseUrl,
            lastTested: c.lastValidatedAt,
            testSuccess: c.validationStatus === 'valid',
          };
        });
        setConnectors(connectorsMap);
        if (data.preferences) {
          setPreferences(data.preferences);
        }
      }
    } catch (err) {
      console.error('Failed to fetch connectors:', err);
    } finally {
      setConnectorsLoading(false);
    }
  };

  const saveConnector = async (provider: string) => {
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    try {
      const isOllama = provider === 'ollama';
      const body = isOllama ? { baseUrl: apiKeyInput.trim() } : { apiKey: apiKeyInput.trim() };

      const res = await fetch(`${API_BASE}/api/v1/connectors/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save connector');
      }

      setEditingProvider(null);
      setApiKeyInput('');
      fetchConnectors();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save connector');
    } finally {
      setSaving(false);
    }
  };

  const testConnector = async (provider: string) => {
    setTesting(provider);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/connectors/${provider}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      setTestResult({
        provider,
        success: data.success,
        message: data.message || (data.success ? 'Connection successful!' : 'Connection failed'),
      });
    } catch (err) {
      setTestResult({
        provider,
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTesting(null);
    }
  };

  const deleteConnector = async (provider: string) => {
    if (!window.confirm(`Remove ${provider} connector? You'll need to reconfigure it to use again.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/connectors/${provider}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete connector');
      fetchConnectors();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete connector');
    }
  };

  // ============================================
  // API KEYS API
  // ============================================

  const fetchAPIKeys = async () => {
    setApiKeysLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/keys`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setApiKeysLoading(false);
    }
  };

  const createAPIKey = async () => {
    if (!newKeyName.trim()) {
      setKeyError('Name is required');
      return;
    }
    setKeyError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create API key');

      setCreatedKey(data.key);
      setNewKeyName('');
      fetchAPIKeys();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  };

  const revokeAPIKey = async (id: string) => {
    if (!window.confirm('Revoke this API key? Any applications using it will stop working.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to revoke API key');
      fetchAPIKeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke API key');
    }
  };

  // ============================================
  // HELPERS
  // ============================================

  const formatDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : 'Never');

  // ============================================
  // RENDER
  // ============================================

  // Wait for auth to load before rendering to prevent plan flicker
  if (authLoading) {
    return (
      <div className="integrations-page">
        <div className="loading-state">Loading...</div>
      </div>
    );
  }

  // Free users don't have access to integrations
  if (!hasApiKeyAccess) {
    return (
      <div className="integrations-page">
        <div className="integrations-header">
          <button className="back-btn" onClick={() => navigate('/app/chat')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div>
            <h1>Integrations</h1>
            <p>Manage AI connectors and API keys</p>
          </div>
        </div>
        <div className="upgrade-notice">
          <div className="upgrade-icon">🔒</div>
          <h2>Upgrade Required</h2>
          <p>Integrations are available on Basic plan and above.</p>
          <p className="upgrade-detail">
            <strong>Basic:</strong> Create ALF API keys for programmatic access<br />
            <strong>Pro+:</strong> Bring your own AI keys (OpenAI, Anthropic, etc.)
          </p>
          <button className="upgrade-btn" onClick={() => navigate('/settings/billing')}>
            View Plans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="integrations-page">
      {/* Header */}
      <div className="integrations-header">
        <button className="back-btn" onClick={() => navigate('/app/chat')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div>
          <h1>Integrations</h1>
          <p>Manage AI connectors and API keys</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="integrations-tabs">
        {hasByokAccess && (
          <button
            className={`tab-btn ${activeTab === 'connectors' ? 'active' : ''}`}
            onClick={() => setActiveTab('connectors')}
          >
            <span className="tab-icon">🔌</span>
            AI Connectors
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === 'api-keys' ? 'active' : ''}`}
          onClick={() => setActiveTab('api-keys')}
        >
          <span className="tab-icon">🔑</span>
          API Keys
        </button>
      </div>

      {/* ============================================
          AI CONNECTORS TAB (Pro+ only)
          ============================================ */}
      {activeTab === 'connectors' && hasByokAccess && (
        <div className="connectors-content">
          {/* Info Card */}
          <div className="info-card">
            <h3>Bring Your Own Keys (BYOK)</h3>
            <p style={{ marginBottom: '1rem' }}>
              Connect your own API keys to use unlimited messages with zero markup.
              Your $25/month Pro subscription pays for the platform — interface, memory system, shards, and switching — not the tokens.
            </p>
            <ul>
              <li><strong>Pro Plan Required:</strong> BYOK is available on Pro ($25/mo) and higher tiers.</li>
              <li><strong>Zero Markup:</strong> Pay OpenAI, Anthropic, or Google directly at their rates.</li>
              <li><strong>Unlimited Messages:</strong> No daily credit cap when using your own keys.</li>
              <li><strong>Shards Still FREE:</strong> Every shard hit saves tokens — even with BYOK.</li>
            </ul>
          </div>

          {/* Connectors List */}
          {connectorsLoading ? (
            <div className="loading-state">Loading connectors...</div>
          ) : (
            <div className="connectors-list">
              {PROVIDERS.map((provider) => {
                const connector = connectors[provider.id];
                const isConfigured = connector?.configured;
                const isEditing = editingProvider === provider.id;

                return (
                  <div key={provider.id} className={`connector-card ${isConfigured ? 'configured' : ''}`}>
                    <div className="connector-header">
                      <div className="connector-info">
                        <span className="connector-icon">{provider.icon}</span>
                        <div>
                          <h3>{provider.name}</h3>
                          <p>{provider.desc}</p>
                        </div>
                      </div>
                      <span className={`status-badge ${isConfigured ? 'success' : 'pending'}`}>
                        {isConfigured ? 'Configured' : 'Not Configured'}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="connector-edit">
                        <input
                          type={provider.isUrl ? 'text' : 'password'}
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder={provider.placeholder}
                          className="connector-input"
                          autoFocus
                        />
                        <div className="connector-actions">
                          <button className="btn-save" onClick={() => saveConnector(provider.id)} disabled={saving}>
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button className="btn-cancel" onClick={() => { setEditingProvider(null); setApiKeyInput(''); }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="connector-body">
                        {isConfigured && connector.apiKeyPreview && (
                          <code className="key-preview">{connector.apiKeyPreview}</code>
                        )}
                        {isConfigured && connector.baseUrl && (
                          <code className="key-preview">{connector.baseUrl}</code>
                        )}

                        {testResult?.provider === provider.id && (
                          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                            {testResult.success ? '✓' : '✗'} {testResult.message}
                          </div>
                        )}

                        <div className="connector-actions">
                          {isConfigured ? (
                            <>
                              <button
                                className="btn-test"
                                onClick={() => testConnector(provider.id)}
                                disabled={testing === provider.id}
                              >
                                {testing === provider.id ? 'Testing...' : 'Test'}
                              </button>
                              <button className="btn-edit" onClick={() => { setEditingProvider(provider.id); setApiKeyInput(''); }}>
                                Update
                              </button>
                              <button className="btn-delete" onClick={() => deleteConnector(provider.id)}>
                                Remove
                              </button>
                            </>
                          ) : (
                            <button className="btn-configure" onClick={() => { setEditingProvider(provider.id); setApiKeyInput(''); }}>
                              Configure
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================
          API KEYS TAB
          ============================================ */}
      {activeTab === 'api-keys' && (
        <div className="api-keys-content">
          {/* Info Card */}
          <div className="info-card">
            <h3>Ask ALF API Keys</h3>
            <p>Create API keys to access Ask ALF programmatically. Use these to integrate ALF's chat, memory, and shard capabilities into your own applications, CLI tools, or automation scripts.</p>
          </div>

          {/* Create Key Section */}
          {showCreateKey ? (
            <div className="create-key-card">
              <h3>Create New API Key</h3>
              {keyError && <div className="key-error">{keyError}</div>}

              {createdKey ? (
                <div className="created-key-display">
                  <p><strong>Your new API key (copy it now - it won't be shown again):</strong></p>
                  <code className="created-key">{createdKey}</code>
                  <button className="btn-copy" onClick={() => { navigator.clipboard.writeText(createdKey); alert('Copied!'); }}>
                    Copy to Clipboard
                  </button>
                  <button className="btn-done" onClick={() => { setCreatedKey(null); setShowCreateKey(false); }}>
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="form-field">
                    <label>Key Name</label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g., My App, CLI Tool, etc."
                    />
                  </div>
                  <div className="form-field">
                    <label>Permissions</label>
                    <div className="scope-checkboxes">
                      {['read', 'write', 'execute'].map((scope) => (
                        <label key={scope} className="scope-checkbox">
                          <input
                            type="checkbox"
                            checked={newKeyScopes.includes(scope)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewKeyScopes([...newKeyScopes, scope]);
                              } else {
                                setNewKeyScopes(newKeyScopes.filter((s) => s !== scope));
                              }
                            }}
                          />
                          <span>{scope.charAt(0).toUpperCase() + scope.slice(1)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="create-key-actions">
                    <button className="btn-create" onClick={createAPIKey}>Create Key</button>
                    <button className="btn-cancel" onClick={() => setShowCreateKey(false)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button className="btn-new-key" onClick={() => setShowCreateKey(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create New API Key
            </button>
          )}

          {/* Keys List */}
          {apiKeysLoading ? (
            <div className="loading-state">Loading API keys...</div>
          ) : apiKeys.length === 0 ? (
            <div className="empty-state">No API keys created yet</div>
          ) : (
            <div className="api-keys-list">
              <table className="keys-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Scopes</th>
                    <th>Last Used</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td className="key-name">{key.name}</td>
                      <td><code className="key-preview">{key.keyPreview}</code></td>
                      <td>
                        <div className="scope-badges">
                          {key.scopes.map((s) => (
                            <span key={s} className="scope-badge">{s}</span>
                          ))}
                        </div>
                      </td>
                      <td className="date-cell">{formatDate(key.lastUsed)}</td>
                      <td className="date-cell">{formatDate(key.createdAt)}</td>
                      <td>
                        <button className="btn-revoke" onClick={() => revokeAPIKey(key.id)}>Revoke</button>
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
