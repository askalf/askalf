import { useEffect, useState } from 'react';
import { useAskAlfApi } from '../hooks/useAskAlfApi';
import type { AskAlfCredential, AskAlfPreferences } from '../hooks/useAskAlfApi';
import './AskAlf.css';

const PROVIDERS = [
  { id: 'claude', name: 'Claude', description: 'Anthropic\'s Claude models. Best for code, analysis, and technical tasks.', prefix: 'sk-ant-' },
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o and o1 models. Best for creative writing and general tasks.', prefix: 'sk-' },
];

export default function AskAlfIntegrations() {
  const api = useAskAlfApi();
  const [credentials, setCredentials] = useState<AskAlfCredential[]>([]);
  const [preferences, setPreferences] = useState<AskAlfPreferences>({ default_provider: 'auto', default_model: null });
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [creds, prefs] = await Promise.all([
        api.fetchCredentials(),
        api.fetchPreferences(),
      ]);
      setCredentials(creds);
      setPreferences(prefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(provider: string) {
    const value = keyInputs[provider]?.trim();
    if (!value || saving) return;

    setSaving(provider);
    setError(null);
    try {
      await api.saveCredential(provider, value);
      setKeyInputs((s) => ({ ...s, [provider]: '' }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(provider: string) {
    setError(null);
    try {
      await api.deleteCredential(provider);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove credential');
    }
  }

  async function handlePreferenceChange(defaultProvider: string) {
    try {
      const updated = await api.updatePreferences({ defaultProvider });
      setPreferences(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update preference');
    }
  }

  if (loading) {
    return (
      <div className="aai-page">
        <div className="aai-header">
          <h1>Ask Alf Integrations</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="aai-page">
      <div className="aai-header">
        <h1>Ask Alf Integrations</h1>
        <p>Connect your AI provider API keys and configure default routing</p>
      </div>

      {error && (
        <div className="aai-error" onClick={() => setError(null)}>
          {error} (click to dismiss)
        </div>
      )}

      {/* Default Provider Preference */}
      <div className="aai-section">
        <h2>Default Provider</h2>
        <p className="aai-section-desc">When set to Auto, the classifier analyzes your prompt and picks the best provider.</p>
        <select
          className="aai-pref-select"
          value={preferences.default_provider}
          onChange={(e) => handlePreferenceChange(e.target.value)}
        >
          <option value="auto">Auto (Classifier)</option>
          <option value="claude">Always Claude</option>
          <option value="openai">Always OpenAI</option>
        </select>
      </div>

      {/* Provider Cards */}
      <div className="aai-section">
        <h2>API Keys</h2>
        <p className="aai-section-desc">Add your own API keys to use your accounts. Without a key, the platform key will be used.</p>
        <div className="aai-cards">
          {PROVIDERS.map((p) => {
            const cred = credentials.find(c => c.provider === p.id);
            const hasKey = !!cred;

            return (
              <div key={p.id} className="aai-card">
                <div className="aai-card-header">
                  <span className={`aai-card-dot ${hasKey ? 'connected' : ''}`} />
                  <span className="aai-card-name">{p.name}</span>
                  {hasKey && <span className="aai-card-status">Connected</span>}
                </div>
                <p className="aai-card-desc">{p.description}</p>
                {hasKey ? (
                  <div className="aai-card-connected">
                    <span className="aai-card-last4">Key ending in ...{cred.last4}</span>
                    <button className="aai-card-remove" onClick={() => handleDelete(p.id)}>Remove</button>
                  </div>
                ) : (
                  <div className="aai-card-input">
                    <input
                      type="password"
                      placeholder={`${p.prefix}...`}
                      value={keyInputs[p.id] || ''}
                      onChange={(e) => setKeyInputs((s) => ({ ...s, [p.id]: e.target.value }))}
                    />
                    <button
                      className="aai-card-save"
                      onClick={() => handleSave(p.id)}
                      disabled={!keyInputs[p.id]?.trim() || saving === p.id}
                    >
                      {saving === p.id ? '...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
