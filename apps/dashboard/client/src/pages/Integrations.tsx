import { useEffect, useState } from 'react';
import { useSelfApi, type Connection, type Credential } from '../hooks/useSelfApi';
import './Integrations.css';

const PROVIDERS = [
  { id: 'google', name: 'Google', icon: 'G', desc: 'Gmail, Calendar, Drive, Contacts', color: '#4285f4' },
  { id: 'microsoft', name: 'Microsoft', icon: 'M', desc: 'Outlook, Calendar, OneDrive', color: '#00a4ef' },
  { id: 'github', name: 'GitHub', icon: 'GH', desc: 'Repos, Issues, Organizations', color: '#8b5cf6' },
];

const AI_PROVIDERS = [
  { id: 'claude', name: 'Claude', icon: 'C', desc: 'Anthropic API key', color: '#d97706' },
  { id: 'openai', name: 'OpenAI', icon: 'O', desc: 'OpenAI API key', color: '#10b981' },
];

const formatDate = (iso: string) => {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function Integrations() {
  const api = useSelfApi();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState<Record<string, string>>({});
  const [showKeyInput, setShowKeyInput] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Integrations — Forge';
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [conns, creds] = await Promise.all([
        api.fetchConnections(),
        api.fetchCredentials(),
      ]);
      setConnections(conns);
      setCredentials(creds);
    } catch (err) {
      console.error('Failed to load integrations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (provider: string) => {
    setConnecting(provider);
    try {
      const url = await api.getAuthUrl(provider);
      window.location.href = url;
    } catch (err) {
      console.error('Failed to get auth URL:', err);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    setDisconnecting(provider);
    try {
      await api.disconnectProvider(provider);
      setConnections((prev) => prev.filter((c) => c.provider !== provider));
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnecting(null);
    }
  };

  const handleSaveKey = async (provider: string) => {
    const value = keyInput[provider]?.trim();
    if (!value) return;
    setSavingKey(provider);
    try {
      await api.saveCredential(provider, 'api_key', value);
      await loadData();
      setKeyInput((prev) => ({ ...prev, [provider]: '' }));
      setShowKeyInput(null);
    } catch (err) {
      console.error('Failed to save credential:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    try {
      await api.deleteCredential(provider);
      setCredentials((prev) => prev.filter((c) => c.provider !== provider));
    } catch (err) {
      console.error('Failed to delete credential:', err);
    }
  };

  const getConnection = (provider: string) =>
    connections.find((c) => c.provider === provider && c.status === 'active');

  const getCredential = (provider: string) =>
    credentials.find((c) => c.provider === provider && c.status === 'active');

  if (loading) {
    return (
      <div className="intg-page">
        <div className="intg-loading">Loading integrations...</div>
      </div>
    );
  }

  return (
    <div className="intg-page">
      <header className="intg-header">
        <h1>Integrations</h1>
        <p>Connect services and manage API keys for Self</p>
      </header>

      {/* OAuth Connections */}
      <section className="intg-section">
        <h2>Connections</h2>
        <div className="intg-grid">
          {PROVIDERS.map((p) => {
            const conn = getConnection(p.id);
            return (
              <div key={p.id} className={`intg-card ${conn ? 'connected' : ''}`}>
                <div className="intg-card-header">
                  <span className="intg-card-icon" style={{ background: p.color }}>{p.icon}</span>
                  <div className="intg-card-info">
                    <strong>{p.name}</strong>
                    <span>{p.desc}</span>
                  </div>
                </div>
                <div className="intg-card-footer">
                  {conn ? (
                    <>
                      <span className="intg-status intg-status--active">Connected {formatDate(conn.connected_at)}</span>
                      <button
                        className="intg-btn intg-btn--danger"
                        onClick={() => handleDisconnect(p.id)}
                        disabled={disconnecting === p.id}
                      >
                        {disconnecting === p.id ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="intg-btn intg-btn--primary"
                      onClick={() => handleConnect(p.id)}
                      disabled={connecting === p.id}
                    >
                      {connecting === p.id ? 'Redirecting...' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* AI Credentials */}
      <section className="intg-section">
        <h2>AI Keys</h2>
        <div className="intg-grid">
          {AI_PROVIDERS.map((p) => {
            const cred = getCredential(p.id);
            return (
              <div key={p.id} className={`intg-card ${cred ? 'connected' : ''}`}>
                <div className="intg-card-header">
                  <span className="intg-card-icon" style={{ background: p.color }}>{p.icon}</span>
                  <div className="intg-card-info">
                    <strong>{p.name}</strong>
                    <span>{p.desc}</span>
                  </div>
                </div>
                <div className="intg-card-footer">
                  {cred ? (
                    <>
                      <span className="intg-status intg-status--active">
                        Active &middot; ****{cred.last4}
                      </span>
                      <button className="intg-btn intg-btn--danger" onClick={() => handleDeleteKey(p.id)}>
                        Remove
                      </button>
                    </>
                  ) : showKeyInput === p.id ? (
                    <div className="intg-key-input">
                      <input
                        type="password"
                        placeholder={`Paste ${p.name} API key...`}
                        value={keyInput[p.id] || ''}
                        onChange={(e) => setKeyInput((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        autoFocus
                      />
                      <button
                        className="intg-btn intg-btn--primary"
                        onClick={() => handleSaveKey(p.id)}
                        disabled={savingKey === p.id || !keyInput[p.id]?.trim()}
                      >
                        {savingKey === p.id ? 'Saving...' : 'Save'}
                      </button>
                      <button className="intg-btn" onClick={() => setShowKeyInput(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="intg-btn intg-btn--primary" onClick={() => setShowKeyInput(p.id)}>
                      Add Key
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
