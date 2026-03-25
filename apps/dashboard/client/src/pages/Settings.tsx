import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { relativeTime } from '../utils/format';
import './Settings.css';

type SettingsTab = 'general' | 'api-keys' | 'costs' | 'integrations' | 'channels' | 'devices' | 'preferences' | 'infrastructure' | 'migration';

const VALID_TABS: SettingsTab[] = ['general', 'api-keys', 'costs', 'integrations', 'channels', 'devices', 'preferences', 'infrastructure', 'migration'];

// ── Natural Language Settings Assistant ──

const NL_PATTERNS: Array<{ pattern: RegExp; tab: SettingsTab; message: string }> = [
  { pattern: /slack/i, tab: 'channels', message: 'Opening Channels — configure your Slack connection there.' },
  { pattern: /discord/i, tab: 'channels', message: 'Opening Channels — set up your Discord bot there.' },
  { pattern: /telegram/i, tab: 'channels', message: 'Opening Channels — configure Telegram bot there.' },
  { pattern: /whatsapp/i, tab: 'channels', message: 'Opening Channels — set up WhatsApp there.' },
  { pattern: /channel/i, tab: 'channels', message: 'Opening Channels settings.' },
  { pattern: /anthropic|claude.*key|api.*key/i, tab: 'api-keys', message: 'Opening Keys & Providers — add or update your API keys there.' },
  { pattern: /openai|gpt.*key/i, tab: 'api-keys', message: 'Opening Keys & Providers — configure your OpenAI key there.' },
  { pattern: /key|provider/i, tab: 'api-keys', message: 'Opening Keys & Providers.' },
  { pattern: /theme|dark.*mode|light.*mode|appearance|color/i, tab: 'general', message: 'Opening Appearance — pick your theme.' },
  { pattern: /budget|cost|limit|spend/i, tab: 'costs', message: 'Opening Cost Controls — set budgets and limits there.' },
  { pattern: /github|gitlab|bitbucket|repo/i, tab: 'integrations', message: 'Opening Integrations — connect your source control there.' },
  { pattern: /integrat/i, tab: 'integrations', message: 'Opening Integrations.' },
  { pattern: /profile|name|email|password/i, tab: 'general', message: 'Opening Profile settings.' },
  { pattern: /device|session/i, tab: 'devices', message: 'Opening Devices — manage active sessions there.' },
  { pattern: /migrat|openclaw|import/i, tab: 'migration', message: 'Opening Migration — import from OpenClaw there.' },
];

function SettingsAssistant({ onNavigateTab }: { onNavigateTab: (tab: SettingsTab) => void }) {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    for (const { pattern, tab, message } of NL_PATTERNS) {
      if (pattern.test(trimmed)) {
        setResponse(message);
        onNavigateTab(tab);
        setInput('');
        setTimeout(() => setResponse(null), 4000);
        return;
      }
    }

    setResponse("I'm not sure what setting you need. Try something like \"connect Slack\" or \"update my API key\".");
    setTimeout(() => setResponse(null), 4000);
    setInput('');
  }, [input, onNavigateTab]);

  return (
    <div className="settings-assistant">
      <div className="settings-assistant-inner">
        <svg className="settings-assistant-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <input
          ref={inputRef}
          className="settings-assistant-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder='Tell Alf what you need... "connect Slack", "set my API key", "change theme"'
        />
        {input.trim() && (
          <button className="settings-assistant-go" onClick={handleSubmit}>Go</button>
        )}
      </div>
      {response && (
        <div className="settings-assistant-response">{response}</div>
      )}
    </div>
  );
}

export default function SettingsPage({ embedded }: { embedded?: boolean }) {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'general';
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    VALID_TABS.includes(initialTab) ? initialTab : 'general'
  );
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Settings — AskAlf'; }, []);

  return (
    <div className="settings-page">
      {!embedded && (
        <div className="settings-header">
          <button className="settings-back-btn" onClick={() => navigate('/command-center')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1>Settings</h1>
          <p>Manage your account and preferences</p>
        </div>
      )}

      <SettingsAssistant onNavigateTab={setActiveTab} />

      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            General
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'api-keys' ? 'active' : ''}`}
            onClick={() => setActiveTab('api-keys')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Keys &amp; Providers
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'costs' ? 'active' : ''}`}
            onClick={() => setActiveTab('costs')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Cost Controls
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'integrations' ? 'active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Integrations
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'channels' ? 'active' : ''}`}
            onClick={() => setActiveTab('channels')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Channels
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'devices' ? 'active' : ''}`}
            onClick={() => setActiveTab('devices')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            Devices
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'preferences' ? 'active' : ''}`}
            onClick={() => setActiveTab('preferences')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Alf Learns
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'infrastructure' ? 'active' : ''}`}
            onClick={() => setActiveTab('infrastructure')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
            Infrastructure
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'migration' ? 'active' : ''}`}
            onClick={() => setActiveTab('migration')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Migration
          </button>
        </nav>

        <div className="settings-content">
          {activeTab === 'general' && <><ProfileTab user={user} /><AppearanceTab /></>}
          {activeTab === 'api-keys' && <><AIKeysTab /><ForgeApiKeysTab /></>}
          {activeTab === 'costs' && <CostControlsTab />}
          {activeTab === 'integrations' && <IntegrationsTab />}
          {activeTab === 'channels' && <ChannelsTab />}
          {activeTab === 'devices' && <DevicesTab />}
          {activeTab === 'preferences' && <PreferencesTab />}
          {activeTab === 'infrastructure' && <InfrastructureTab />}
          {activeTab === 'migration' && <MigrationTab />}
        </div>
      </div>
    </div>
  );
}

// Determine API base URL based on current hostname
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

const API_BASE = getApiUrl();

interface ProfileUser {
  email: string;
  name?: string;
  displayName?: string;
}

function ProfileTab({ user }: { user: ProfileUser | null }) {
  const [name, setName] = useState(user?.name || '');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [_email] = useState(user?.email || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { checkAuth } = useAuthStore();

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name,
          displayName: displayName,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      await checkAuth();
      setSaveMessage({ type: 'success', text: 'Profile saved!' });
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h2>Profile Information</h2>
      <p className="settings-section-desc">
        Update your personal information
      </p>

      {saveMessage && (
        <div className={`settings-message settings-message-${saveMessage.type}`}>
          {saveMessage.text}
        </div>
      )}

      <div className="settings-form">
        <div className="settings-field">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
          />
          <p className="settings-field-hint">Your full name</p>
        </div>

        <div className="settings-field">
          <label>Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
          />
          <p className="settings-field-hint">Shown in the UI and personalized interactions</p>
        </div>


        <button
          className="settings-save-btn"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}


function AppearanceTab() {
  const {
    theme,
    fontSize,
    fontFamily,
    reducedMotion,
    setTheme,
    setFontSize,
    setFontFamily,
    setReducedMotion,
  } = useThemeStore();

  return (
    <div className="settings-section">
      <h2>Appearance</h2>
      <p className="settings-section-desc">
        Customize the dashboard appearance
      </p>

      <div className="settings-form">
        <div className="settings-field">
          <label>Theme</label>
          <div className="settings-toggle-group">
            <button
              className={`settings-toggle ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => setTheme('dark')}
            >
              🌙 Dark
            </button>
            <button
              className={`settings-toggle ${theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme('light')}
            >
              ☀️ Light
            </button>
            <button
              className={`settings-toggle ${theme === 'claw' ? 'active' : ''}`}
              onClick={() => setTheme('claw')}
            >
              🦀 Claw
            </button>
            <button
              className={`settings-toggle ${theme === 'system' ? 'active' : ''}`}
              onClick={() => setTheme('system')}
            >
              💻 System
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label>Font Size</label>
          <div className="settings-toggle-group">
            <button
              className={`settings-toggle ${fontSize === 'small' ? 'active' : ''}`}
              onClick={() => setFontSize('small')}
            >
              Small
            </button>
            <button
              className={`settings-toggle ${fontSize === 'medium' ? 'active' : ''}`}
              onClick={() => setFontSize('medium')}
            >
              Medium
            </button>
            <button
              className={`settings-toggle ${fontSize === 'large' ? 'active' : ''}`}
              onClick={() => setFontSize('large')}
            >
              Large
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label>Font Family</label>
          <div className="settings-toggle-group">
            <button
              className={`settings-toggle ${fontFamily === 'inter' ? 'active' : ''}`}
              onClick={() => setFontFamily('inter')}
            >
              Inter
            </button>
            <button
              className={`settings-toggle ${fontFamily === 'system' ? 'active' : ''}`}
              onClick={() => setFontFamily('system')}
            >
              System
            </button>
            <button
              className={`settings-toggle ${fontFamily === 'mono' ? 'active' : ''}`}
              onClick={() => setFontFamily('mono')}
            >
              Monospace
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => setReducedMotion(e.target.checked)}
            />
            <span>Reduce motion</span>
          </label>
          <p className="settings-field-hint">
            Minimize animations for accessibility
          </p>
        </div>
      </div>
    </div>
  );
}

interface ProviderKeyInfo {
  provider_type: string;
  has_key: boolean;
  key_hint: string | null;
  label: string | null;
  is_active: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
}

interface SystemProvider {
  id: string;
  name: string;
  type: string;
  is_enabled: boolean;
  health_status: string;
  auth_source: 'db' | 'env' | 'oauth' | 'none';
  has_key: boolean;
  key_hint: string | null;
}

interface OAuthHealth {
  status: 'healthy' | 'expiring' | 'expired' | 'unknown';
  expiresAt: number | null;
  expiresIn: string | null;
}

const AI_PROVIDERS = [
  { type: 'anthropic', name: 'Anthropic', desc: 'Claude models — powers Claude Code terminal + agent executions', prefix: 'sk-ant-' },
  { type: 'openai', name: 'OpenAI', desc: 'GPT models — powers Codex terminal, semantic memory embeddings, and chat fallback', prefix: 'sk-' },
  { type: 'ollama', name: 'Ollama', desc: 'Local models — Llama, Mistral, Phi, Qwen, CodeLlama, and more. No API key needed.', prefix: '' },
  { type: 'xai', name: 'xAI', desc: 'Grok models', prefix: '' },
  { type: 'deepseek', name: 'DeepSeek', desc: 'DeepSeek models', prefix: '' },
];

const AUTH_SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  oauth: { label: 'OAuth Token', color: '#22c55e' },
  env: { label: 'System (.env)', color: '#3b82f6' },
  db: { label: 'API Key', color: '#a78bfa' },
  none: { label: 'Not configured', color: '#6b7280' },
};

function AIKeysTab() {
  const [userKeys, setUserKeys] = useState<ProviderKeyInfo[]>([]);
  const [systemProviders, setSystemProviders] = useState<SystemProvider[]>([]);
  const [oauthHealth, setOauthHealth] = useState<OAuthHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, 'success' | 'error'>>({});
  const [refreshingOAuth, setRefreshingOAuth] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [userRes, sysRes, oauthRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/forge/user-providers`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/forge/providers`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/forge/credentials/health`, { credentials: 'include' }),
      ]);
      if (userRes.ok) {
        const data = await userRes.json() as { keys: ProviderKeyInfo[] };
        setUserKeys(data.keys);
      }
      if (sysRes.ok) {
        const data = await sysRes.json() as { providers: SystemProvider[] };
        setSystemProviders(data.providers);
      }
      if (oauthRes.ok) {
        const data = await oauthRes.json() as OAuthHealth;
        setOauthHealth(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSaveKey = async (providerType: string) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: keyInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to save key');
      }
      setEditingProvider(null);
      setKeyInput('');
      setMessage({ type: 'success', text: `${providerType} key saved` });
      fetchAll();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (providerType: string) => {
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to remove key');
      setMessage({ type: 'success', text: `${providerType} key removed` });
      fetchAll();
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove key' });
    }
  };

  const handleVerifyKey = async (providerType: string) => {
    setVerifying(providerType);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/user-providers/${providerType}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setMessage({ type: 'error', text: `Verification request failed: ${res.status}` });
        setVerifyResults(prev => ({ ...prev, [providerType]: 'error' }));
        return;
      }
      const data = await res.json() as { status: string; error?: string };
      if (data.status === 'valid') {
        setMessage({ type: 'success', text: `${providerType} key verified` });
        setVerifyResults(prev => ({ ...prev, [providerType]: 'success' }));
        fetchAll();
      } else {
        setMessage({ type: 'error', text: `Key invalid: ${data.error || 'verification failed'}` });
        setVerifyResults(prev => ({ ...prev, [providerType]: 'error' }));
      }
    } catch {
      setMessage({ type: 'error', text: 'Verification failed' });
      setVerifyResults(prev => ({ ...prev, [providerType]: 'error' }));
    } finally {
      setVerifying(null);
    }
  };

  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthCode, setOauthCode] = useState('');
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  // Codex OAuth
  const [codexConnecting, setCodexConnecting] = useState(false);
  const [codexUserCode, setCodexUserCode] = useState<string | null>(null);
  const [codexVerifyUrl, setCodexVerifyUrl] = useState<string | null>(null);
  const [codexPolling, setCodexPolling] = useState(false);
  const [codexStatus, setCodexStatus] = useState<'unknown' | 'healthy' | 'no_credentials'>('unknown');

  const handleOAuthConnect = async () => {
    setOauthConnecting(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/oauth/start`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to start OAuth flow');
      const data = await res.json() as { authUrl: string; state: string };
      setOauthState(data.state);
      setShowCodeInput(true);
      // Open auth URL in new tab
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      setMessage({ type: 'success', text: 'Authorization page opened — authorize and paste the code below' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to start OAuth' });
    } finally {
      setOauthConnecting(false);
    }
  };

  const handleOAuthExchange = async () => {
    if (!oauthCode.trim() || !oauthState) return;
    setExchanging(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/oauth/exchange`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oauthCode.trim(), state: oauthState }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setMessage({ type: 'success', text: 'Claude OAuth connected successfully!' });
        setOauthHealth({ status: 'healthy', expiresAt: null, expiresIn: null });
        setShowCodeInput(false);
        setOauthCode('');
        setOauthState(null);
        fetchAll();
      } else {
        setMessage({ type: 'error', text: data.error || 'Token exchange failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to exchange code' });
    } finally {
      setExchanging(false);
    }
  };

  // Codex OAuth device flow
  const handleCodexConnect = async () => {
    setCodexConnecting(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/oauth/codex/start`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to start Codex auth');
      const data = await res.json() as { userCode: string; verificationUrl: string };
      setCodexUserCode(data.userCode);
      setCodexVerifyUrl(data.verificationUrl);
      window.open(data.verificationUrl, '_blank', 'noopener,noreferrer');
      setMessage({ type: 'success', text: 'Authorization page opened — sign in with your OpenAI account' });
      // Start polling
      setCodexPolling(true);
      const poll = async () => {
        for (let i = 0; i < 60; i++) { // 5 min max
          await new Promise(r => setTimeout(r, 5000));
          try {
            const pollRes = await fetch(`${API_BASE}/api/v1/forge/oauth/codex/poll`, {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userCode: data.userCode }),
            });
            const pollData = await pollRes.json() as { status: string; message?: string; error?: string };
            if (pollData.status === 'authorized') {
              setMessage({ type: 'success', text: 'Codex connected!' });
              setCodexStatus('healthy');
              setCodexUserCode(null);
              setCodexVerifyUrl(null);
              setCodexPolling(false);
              return;
            }
            if (pollData.error) {
              setMessage({ type: 'error', text: pollData.error });
              setCodexPolling(false);
              return;
            }
          } catch { /* keep polling */ }
        }
        setMessage({ type: 'error', text: 'Authorization timed out' });
        setCodexPolling(false);
      };
      poll();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setCodexConnecting(false);
    }
  };

  // Check Codex status on load
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/forge/oauth/codex/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.status) setCodexStatus(data.status); })
      .catch(() => {});
  }, []);

  const handleRefreshOAuth = async () => {
    setRefreshingOAuth(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/credentials/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json() as { refreshed: boolean; error?: string };
      if (data.refreshed) {
        setMessage({ type: 'success', text: 'OAuth token refreshed' });
        setOauthHealth({ status: 'healthy', expiresAt: null, expiresIn: null });
        fetchAll();
      } else {
        setMessage({ type: 'error', text: data.error || 'Refresh failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to refresh OAuth token' });
    } finally {
      setRefreshingOAuth(false);
    }
  };

  const getUserKeyInfo = (type: string) => userKeys.find((k) => k.provider_type === type);
  const getSystemProvider = (type: string) => systemProviders.find((p) => p.type === type);

  if (loading) {
    return (
      <div className="settings-section">
        <h2>Keys & Providers</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  const oauthColor = oauthHealth?.status === 'healthy' ? '#22c55e' : oauthHealth?.status === 'expiring' ? '#f59e0b' : oauthHealth?.status === 'expired' ? '#ef4444' : '#6b7280';
  const oauthLabel = oauthHealth?.status === 'healthy' ? 'Healthy' : oauthHealth?.status === 'expiring' ? 'Expiring Soon' : oauthHealth?.status === 'expired' ? 'Expired' : 'Not Connected';

  return (
    <div className="settings-section">
      <h2>Keys & Providers</h2>
      <p className="settings-section-desc">
        Manage how AskAlf authenticates with AI providers. OAuth is primary, API keys are fallback.
        Priority: User Key &gt; System Key (.env) &gt; OAuth Token.
      </p>

      {/* OAuth Section */}
      <div className="settings-provider-card" style={{ borderLeft: `3px solid ${oauthColor}` }}>
        <div className="settings-provider-header">
          <div className="settings-provider-info">
            <span className="settings-provider-name">Anthropic OAuth</span>
            <span className="settings-provider-desc">Primary authentication — Claude CLI token shared with the platform</span>
          </div>
          <div className="settings-provider-status">
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: oauthColor, marginRight: 6 }} />
            <span className={`settings-provider-badge ${oauthHealth?.status === 'healthy' ? 'settings-provider-active' : 'settings-provider-inactive'}`}>
              {oauthLabel}
            </span>
          </div>
        </div>
        {oauthHealth?.expiresIn && (
          <div className="settings-provider-meta">Expires in: {oauthHealth.expiresIn}</div>
        )}
        <div className="settings-provider-actions">
          {oauthHealth?.status === 'healthy' || oauthHealth?.status === 'expiring' ? (
            <button
              className="settings-btn-sm"
              onClick={handleRefreshOAuth}
              disabled={refreshingOAuth}
            >
              {refreshingOAuth ? 'Refreshing...' : 'Refresh Token'}
            </button>
          ) : (
            <button
              className="settings-save-btn"
              onClick={handleOAuthConnect}
              disabled={oauthConnecting}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10,17 15,12 10,7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              {oauthConnecting ? 'Opening...' : 'Connect with Claude'}
            </button>
          )}
        </div>

        {/* Code input after OAuth redirect */}
        {showCodeInput && (
          <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--surface)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 10 }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Authorize on claude.ai, then paste the code from the redirect URL below:
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={oauthCode}
                onChange={(e) => setOauthCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleOAuthExchange(); }}
                placeholder="Paste authorization code here..."
                autoFocus
                style={{ flex: 1, padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}
              />
              <button
                className="settings-save-btn"
                onClick={handleOAuthExchange}
                disabled={exchanging || !oauthCode.trim()}
                style={{ padding: '8px 16px' }}
              >
                {exchanging ? 'Connecting...' : 'Connect'}
              </button>
              <button
                className="settings-btn-sm"
                onClick={() => { setShowCodeInput(false); setOauthCode(''); setOauthState(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {/* Codex / OpenAI OAuth Section */}
      <div className="settings-provider-card" style={{ borderLeft: `3px solid ${codexStatus === 'healthy' ? '#22c55e' : '#6b7280'}` }}>
        <div className="settings-provider-header">
          <div className="settings-provider-info">
            <span className="settings-provider-name">OpenAI Codex</span>
            <span className="settings-provider-desc">ChatGPT OAuth — powers Codex terminal sessions via device authorization</span>
          </div>
          <div className="settings-provider-status">
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: codexStatus === 'healthy' ? '#22c55e' : '#6b7280', marginRight: 6 }} />
            <span className={`settings-provider-badge ${codexStatus === 'healthy' ? 'settings-provider-active' : 'settings-provider-inactive'}`}>
              {codexStatus === 'healthy' ? 'Connected' : 'Not Connected'}
            </span>
          </div>
        </div>
        <div className="settings-provider-actions">
          {codexStatus !== 'healthy' && !codexPolling && (
            <button
              className="settings-save-btn"
              onClick={handleCodexConnect}
              disabled={codexConnecting}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10,17 15,12 10,7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              {codexConnecting ? 'Starting...' : 'Connect with OpenAI'}
            </button>
          )}
          {codexPolling && (
            <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 600 }}>
              Waiting for authorization... (code: {codexUserCode})
            </span>
          )}
        </div>
        {codexUserCode && codexVerifyUrl && !codexPolling && (
          <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Visit <a href={codexVerifyUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed' }}>{codexVerifyUrl}</a> and enter code: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{codexUserCode}</strong>
          </div>
        )}
      </div>

      {/* Provider Cards */}
      <div className="settings-form">
        {AI_PROVIDERS.map((provider) => {
          const userInfo = getUserKeyInfo(provider.type);
          const sysInfo = getSystemProvider(provider.type);
          const isEditing = editingProvider === provider.type;
          const authSource = sysInfo?.auth_source || 'none';
          const sourceInfo = AUTH_SOURCE_LABELS[authSource] || AUTH_SOURCE_LABELS.none;

          // Determine effective status
          const hasUserKey = !!userInfo;
          const hasSystemKey = sysInfo?.has_key || false;
          const isConnected = hasUserKey || hasSystemKey || (provider.type === 'anthropic' && oauthHealth?.status === 'healthy');

          return (
            <div key={provider.type} className="settings-provider-card">
              <div className="settings-provider-header">
                <div className="settings-provider-info">
                  <span className="settings-provider-name">{provider.name}</span>
                  <span className="settings-provider-desc">{provider.desc}</span>
                </div>
                <div className="settings-provider-status">
                  {isConnected ? (
                    <>
                      {sysInfo?.key_hint && <span className="settings-provider-hint">{sysInfo.key_hint}</span>}
                      <span className="settings-provider-badge settings-provider-active">Connected</span>
                    </>
                  ) : (
                    <span className="settings-provider-badge settings-provider-inactive">Not set</span>
                  )}
                </div>
              </div>

              {/* Auth source indicator */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {provider.type === 'anthropic' && oauthHealth?.status === 'healthy' && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>OAuth Active</span>
                )}
                {hasSystemKey && authSource === 'env' && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>System .env</span>
                )}
                {hasSystemKey && authSource === 'db' && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}>System DB Key</span>
                )}
                {hasUserKey && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>User Override</span>
                )}
                {!isConnected && (
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(107,114,128,0.1)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.2)' }}>{sourceInfo.label}</span>
                )}
              </div>

              {isEditing ? (
                <div className="settings-provider-edit">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={provider.type === 'ollama' ? 'http://localhost:11434' : provider.prefix ? `${provider.prefix}...` : 'Paste your API key'}
                    autoFocus
                  />
                  <div className="settings-provider-edit-actions">
                    <button
                      className="settings-save-btn"
                      onClick={() => handleSaveKey(provider.type)}
                      disabled={saving || !keyInput.trim()}
                    >
                      {saving ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      className="settings-btn-sm"
                      onClick={() => { setEditingProvider(null); setKeyInput(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="settings-provider-actions">
                  <button
                    className="settings-btn-sm"
                    onClick={() => { setEditingProvider(provider.type); setKeyInput(''); }}
                  >
                    {hasUserKey ? 'Update Key' : 'Add Key'}
                  </button>
                  {hasUserKey && (
                    <>
                      <button
                        className="settings-btn-sm"
                        onClick={() => handleVerifyKey(provider.type)}
                        disabled={verifying === provider.type}
                      >
                        {verifying === provider.type ? 'Verifying...' : 'Verify'}
                      </button>
                      {verifyResults[provider.type] && (
                        <span className={`settings-test-result settings-test-result-${verifyResults[provider.type]}`}>
                          {verifyResults[provider.type] === 'success' ? '\u2713' : '\u2717'}
                        </span>
                      )}
                      <button
                        className="settings-btn-sm settings-btn-danger"
                        onClick={() => handleDeleteKey(provider.type)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              )}

              {userInfo?.last_verified_at && (
                <div className="settings-provider-meta">
                  Last verified: {new Date(userInfo.last_verified_at).toLocaleDateString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// Integrations Tab
// ============================================

interface Integration {
  id: string;
  provider: string;
  provider_username: string | null;
  display_name: string | null;
  status: string;
  scopes: string[] | null;
  repos_synced_at: string | null;
  created_at: string;
  repo_count: number;
}

interface AvailableProvider {
  provider: string;
  configured: boolean;
  type?: 'oauth' | 'api_key';
}

interface ProviderDef {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: JSX.Element;
}

const PROVIDER_CATEGORIES = [
  { id: 'source', label: 'Source Control' },
  { id: 'crm', label: 'CRM & Sales' },
  { id: 'ecommerce', label: 'E-Commerce & Payments' },
  { id: 'marketing', label: 'Marketing & Ads' },
  { id: 'social', label: 'Social Media' },
  { id: 'productivity', label: 'Productivity & Docs' },
  { id: 'cloud', label: 'Cloud & Infrastructure' },
  { id: 'cicd', label: 'CI/CD & Deploy' },
  { id: 'pm', label: 'Project Management' },
  { id: 'monitoring', label: 'Monitoring & Observability' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'finance', label: 'Finance & HR' },
  { id: 'storage', label: 'Storage & CDN' },
];

const ALL_PROVIDERS: ProviderDef[] = [
  // Source Control
  { id: 'github', name: 'GitHub', description: 'Repos, PRs, issues, actions', category: 'source', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg> },
  { id: 'gitlab', name: 'GitLab', description: 'Repos, merge requests, CI pipelines', category: 'source', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/></svg> },
  { id: 'bitbucket', name: 'Bitbucket', description: 'Repos, pull requests, pipelines', category: 'source', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646L23.99 2.104a.768.768 0 0 0-.768-.891zm13.142 13.477H9.957L8.857 8.891h6.167z"/></svg> },

  // Cloud & Infrastructure
  { id: 'aws', name: 'AWS', description: 'EC2, S3, Lambda, CloudWatch', category: 'cloud', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.18 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.032-.863.104-.296.072-.583.16-.863.272a2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.024c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.28-.144.616-.264 1.01-.36a4.84 4.84 0 0 1 1.244-.152c.95 0 1.644.216 2.091.647.44.43.662 1.085.662 1.963v2.586zm-3.24 1.214c.263 0 .534-.048.822-.144.287-.096.543-.271.758-.51.128-.152.224-.32.272-.512.047-.191.08-.423.08-.694v-.335a6.66 6.66 0 0 0-.735-.136 6.02 6.02 0 0 0-.75-.048c-.535 0-.926.104-1.19.32-.263.215-.39.518-.39.917 0 .375.095.655.295.846.191.2.47.296.838.296zm6.41.862c-.144 0-.24-.024-.304-.08-.064-.048-.12-.16-.168-.311L7.586 5.55a1.398 1.398 0 0 1-.072-.32c0-.128.064-.2.191-.2h.783c.151 0 .255.025.31.08.065.048.113.16.16.312l1.342 5.284 1.245-5.284c.04-.16.088-.264.151-.312a.549.549 0 0 1 .32-.08h.638c.152 0 .256.025.32.08.063.048.12.16.151.312l1.261 5.348 1.381-5.348c.048-.16.104-.264.16-.312a.52.52 0 0 1 .311-.08h.743c.128 0 .2.064.2.2 0 .04-.009.08-.017.128a1.137 1.137 0 0 1-.056.2l-1.923 6.17c-.048.16-.104.264-.168.312a.549.549 0 0 1-.32.08h-.687c-.152 0-.256-.024-.32-.08-.063-.056-.12-.16-.15-.32L13.545 6.9l-1.23 5.14c-.047.16-.087.264-.15.32-.064.056-.176.08-.32.08zm10.256.215c-.415 0-.83-.048-1.229-.143-.399-.096-.71-.2-.918-.32-.128-.071-.216-.151-.248-.223a.504.504 0 0 1-.048-.224v-.407c0-.167.064-.247.183-.247.048 0 .096.008.144.024s.12.064.2.107c.271.135.566.248.878.335.32.088.631.136.95.136.503 0 .894-.088 1.165-.264a.86.86 0 0 0 .415-.758.777.777 0 0 0-.215-.559c-.144-.151-.415-.287-.807-.414l-1.157-.36c-.583-.183-1.014-.454-1.277-.813a1.902 1.902 0 0 1-.4-1.158c0-.335.073-.63.216-.886.144-.255.335-.479.575-.654.24-.184.51-.32.83-.415.32-.096.655-.136 1.006-.136.176 0 .359.008.535.032.183.024.35.056.518.088.16.04.312.08.455.127.144.048.256.096.336.144a.69.69 0 0 1 .24.2.43.43 0 0 1 .071.263v.375c0 .168-.064.256-.184.256a.83.83 0 0 1-.303-.096 3.652 3.652 0 0 0-1.532-.311c-.455 0-.815.071-1.062.223-.248.152-.375.383-.375.71 0 .224.08.416.24.567.159.152.454.304.878.44l1.134.358c.574.184.99.44 1.237.767.247.327.367.702.367 1.117 0 .343-.072.655-.207.926-.144.272-.336.511-.583.703-.248.2-.543.343-.886.447-.36.111-.734.167-1.142.167zM21.698 16.207c-2.626 1.94-6.442 2.969-9.722 2.969-4.598 0-8.74-1.7-11.87-4.526-.247-.223-.024-.527.27-.351 3.384 1.963 7.559 3.153 11.877 3.153 2.914 0 6.114-.607 9.06-1.852.439-.2.814.287.385.607z"/><path d="M22.792 14.961c-.336-.43-2.22-.207-3.074-.103-.255.032-.295-.192-.063-.36 1.5-1.053 3.967-.75 4.254-.399.287.36-.08 2.826-1.485 4.007-.216.184-.423.088-.327-.151.32-.79 1.03-2.57.695-2.994z"/></svg> },
  { id: 'gcp', name: 'Google Cloud', description: 'Compute, Cloud Run, BigQuery', category: 'cloud', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.003a6.542 6.542 0 0 0 3.624 1.108h12.07a6.662 6.662 0 0 0 4.86-2.065 6.552 6.552 0 0 0-.09-9.166l.008.006A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c2.423-.04 4.646 1.902 4.965 4.342h1.064a3.28 3.28 0 0 1 3.276 3.276 3.28 3.28 0 0 1-3.276 3.276H6.332a3.267 3.267 0 0 1-2.14-.8 3.279 3.279 0 0 1 1.49-5.6v-.013a5.215 5.215 0 0 1 6.15-4.481z"/></svg> },
  { id: 'azure', name: 'Azure', description: 'VMs, Functions, DevOps', category: 'cloud', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5.483 21.3H24L14.025 4.013l-3.038 8.347 5.836 6.938L5.483 21.3zM13.23 2.7L6.105 8.677 0 19.253h5.505l7.725-16.553z"/></svg> },
  { id: 'digitalocean', name: 'DigitalOcean', description: 'Droplets, App Platform, Spaces', category: 'cloud', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.04 0C5.408-.02.005 5.37.005 11.992h4.638c0-4.923 4.882-8.731 10.064-6.855a6.95 6.95 0 0 1 4.147 4.148c1.889 5.177-1.924 10.055-6.84 10.064v-4.61H7.391v4.623h4.623V24c7.726 0 13.695-7.236 11.135-15.2A11.08 11.08 0 0 0 15.239.897 12.607 12.607 0 0 0 12.04 0zm-.615 19.339H7.39v4.036h4.036v-4.036zm-4.035 4.036H4.38v3.009H7.39v-3.009z"/></svg> },

  // CI/CD & Deploy
  { id: 'vercel', name: 'Vercel', description: 'Deployments, serverless, edge functions', category: 'cicd', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M24 22.525H0l12-21.05 12 21.05z"/></svg> },
  { id: 'netlify', name: 'Netlify', description: 'Sites, builds, serverless functions', category: 'cicd', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.934 8.519a1.044 1.044 0 0 1 .303.23l2.349-1.045-.652-1.542-2.779 1.24a.96.96 0 0 1-.217.376l.996.741zm4.06 7.777l-1.355-.577a1.06 1.06 0 0 1-.391.256l.477 2.873 1.636-.475-.367-2.077zm-3.741-4.119l.652 1.542 2.793-1.227-.652-1.542-2.793 1.227zm-1.293-5.7l-.65-1.542-2.794 1.228.652 1.542 2.792-1.228zM3.523 7.08l2.349 1.044a1.06 1.06 0 0 1 .302-.23l.996-.74a.96.96 0 0 1-.217-.377L4.174 5.537l-.651 1.543zm6.385 2.58a1.07 1.07 0 0 1-.246-.4l-1.14-.038-.177-.17-.091.07-2.794 1.228.652 1.542 3.554-1.562a1.07 1.07 0 0 1 .242-.67zm3.706-3.942l-.107-.032a1.048 1.048 0 0 1-.907.128l-.535 1.26a1.07 1.07 0 0 1 .478.537l1.097.037.205.167.085-.064 2.087-.917-.652-1.542-1.751.426zm5.56 5.29l-2.793 1.228.651 1.542 2.793-1.228-.651-1.542zm-12.97-.18a1.07 1.07 0 0 1-.47-.541l-1.096-.037-.206-.168-.085.065-2.087.916.652 1.542 1.755-.431.103.031a1.048 1.048 0 0 1 .907-.127l.536-1.26-.009.01zm14.553-1.593l-2.793 1.228.651 1.542 2.794-1.228-.652-1.542zm-5.1-5.14l2.794-1.228-.651-1.542-2.794 1.228.651 1.542zM3.17 8.737L.963 9.708l.652 1.542 2.207-.971-.652-1.542zm.652 1.542l-.652-1.542L.963 9.708l.652 1.542 2.207-.971zM7.88 14.96a1.06 1.06 0 0 1 .386-.255l-.475-2.874-1.637.476.37 2.077 1.356.576zm4.042 1.438a1.046 1.046 0 0 1-.646-.394l-1.08.163-.228-.122-.064.091-2.349 1.045.652 1.542 2.779-1.24a.96.96 0 0 1 .217-.376l-.996-.741.715.032zm3.984 3.742l-2.349-1.044a1.06 1.06 0 0 1-.303.229l-.996.741a.96.96 0 0 1 .217.376l2.779 1.24.652-1.542zm-4.31.575a1.06 1.06 0 0 1-.386.255l.477 2.873 1.636-.475-.37-2.077-1.357-.576zm-.124-1.804a1.046 1.046 0 0 1 .647.394l1.078-.163.229.122.064-.091 2.349-1.044-.651-1.543-2.78 1.24a.96.96 0 0 1-.217.377l.996.74-.715-.032z"/></svg> },
  { id: 'railway', name: 'Railway', description: 'App hosting, databases, cron', category: 'cicd', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M.113 14.725c.016.074.098.13.183.13h5.96c.079 0 .17-.06.17-.138v-.37c-.006-.079-.011-.185-.023-.295-.142-1.332-.536-3.07-1.39-4.636-1.283-2.353-3.312-3.746-5.027-3.746A.12.12 0 0 0 0 5.783c.068 2.14.108 8.86.113 8.942zm11.502.13h5.975c.074 0 .114-.068.114-.13V8.23a.118.118 0 0 0-.12-.118c-.842.034-4.036.336-5.9 6.552-.028.085-.006.19.074.19h-.143zm-6.218 0h5.954c.079 0 .17-.068.17-.136v-1.383c0-.085-.011-.175-.028-.265-.426-2.353-2.063-4.42-5.977-5.108-.085-.017-.17.034-.17.125v6.631a.12.12 0 0 0 .051.136zm-5.283 3.53a21.985 21.985 0 0 0 5.686 3.476c4.112 1.832 9.275 2.082 12.602-.591.662-.534 1.18-1.12 1.598-1.733a.14.14 0 0 0-.017-.164.12.12 0 0 0-.091-.04H.204a.14.14 0 0 0-.136.107.141.141 0 0 0 .046.147v-.006l.006.006-.006-.006v.005z"/></svg> },
  { id: 'flyio', name: 'Fly.io', description: 'Edge compute, machines, volumes', category: 'cicd', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.5 16.5h-9a1.5 1.5 0 0 1-1.5-1.5V9a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 9v6a1.5 1.5 0 0 1-1.5 1.5z"/></svg> },

  // Project Management
  { id: 'jira', name: 'Jira', description: 'Issues, sprints, boards, workflows', category: 'pm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24.013 12.5V1.005A1.005 1.005 0 0 0 23.013 0z"/></svg> },
  { id: 'linear', name: 'Linear', description: 'Issues, projects, cycles, roadmaps', category: 'pm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.513 12.833a.29.29 0 0 1-.083-.229c.093-1.768.603-3.419 1.395-4.863a.289.289 0 0 1 .413-.098l8.119 5.485a.29.29 0 0 1 .002.48l-1.382.935a.287.287 0 0 1-.326.004L2.513 12.833zm2.59-6.483a.29.29 0 0 1-.01-.408 10.862 10.862 0 0 1 3.596-2.77.29.29 0 0 1 .346.072l5.325 6.508a.29.29 0 0 1-.059.424l-1.348.912a.288.288 0 0 1-.35-.018L5.103 6.35zm5.399-3.893a.29.29 0 0 1 .115-.376A10.758 10.758 0 0 1 17.653 1.5a.29.29 0 0 1 .253.295l-.237 8.498a.289.289 0 0 1-.445.234l-1.348-.912a.29.29 0 0 1-.127-.22l-.367-6.518a.29.29 0 0 0-.492-.187L10.5 7.5l.002-5.043zM1.785 14.55a.29.29 0 0 1 .076-.389.287.287 0 0 1 .168-.055h.002l1.612.035a.29.29 0 0 1 .2.094l7.093 8.132a.289.289 0 0 1-.05.424 10.828 10.828 0 0 1-4.63 1.717.289.289 0 0 1-.312-.193L1.785 14.55z"/></svg> },
  { id: 'notion', name: 'Notion', description: 'Pages, databases, knowledge base', category: 'pm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.28 2.16c-.466-.373-.746-.28-1.586-.14l-12.609.839c-.466.046-.56.28-.373.466l.747.883zm.793 3.079v13.904c0 .747.373 1.027 1.213.98l14.523-.84c.84-.046.933-.56.933-1.166V6.354c0-.606-.233-.933-.746-.886l-15.177.84c-.56.046-.746.326-.746.979zm14.337.7c.093.42 0 .84-.42.886l-.7.14v10.264c-.606.327-1.166.514-1.633.514-.746 0-.933-.234-1.493-.933l-4.573-7.186v6.953l1.446.327s0 .84-1.166.84l-3.22.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.233 4.76 7.28v-6.44l-1.213-.14c-.094-.514.28-.886.747-.933l3.227-.186z"/></svg> },
  { id: 'asana', name: 'Asana', description: 'Tasks, projects, timelines, goals', category: 'pm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18.78 12.653c-2.882 0-5.22 2.337-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.337 5.22-5.22-2.337-5.22-5.22-5.22zM5.22 12.653C2.338 12.653 0 14.99 0 17.873S2.337 23.093 5.22 23.093s5.22-2.337 5.22-5.22-2.337-5.22-5.22-5.22zM12 .907c-2.882 0-5.22 2.337-5.22 5.22S9.118 11.347 12 11.347s5.22-2.337 5.22-5.22S14.882.907 12 .907z"/></svg> },

  // Monitoring & Observability
  { id: 'datadog', name: 'Datadog', description: 'Metrics, traces, logs, alerts', category: 'monitoring', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.496 17.631a.749.749 0 0 1-.916-.144l-2.197-2.362-1.624 1.275a.748.748 0 0 1-.754.087L9.08 15.1l-2.713 2.975a.75.75 0 1 1-1.109-1.012l3.188-3.496a.749.749 0 0 1 .754-.174l2.925 1.388 1.478-1.16-2.07-2.227a.75.75 0 0 1 .05-1.06l3.176-2.842a.75.75 0 0 1 1 1.118L13.014 11l2.32 2.496a.75.75 0 0 1-.034 1.048l-.803.63 1.916 2.061a.75.75 0 0 1-.917 1.396z"/></svg> },
  { id: 'sentry', name: 'Sentry', description: 'Error tracking, performance, releases', category: 'monitoring', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.91 2.505c-.873-1.553-3.066-1.553-3.94 0L7.791 6.3a11.838 11.838 0 0 1 4.848 3.537A11.838 11.838 0 0 1 14.23 6.3L13.91 2.505zM5.97 6.968C4.2 9.6 3.527 12.78 4.162 15.838h3.565c-.396-2.09.08-4.267 1.343-6.012A11.835 11.835 0 0 0 5.97 6.968zm12.06 0a11.835 11.835 0 0 0-3.1 2.858c1.263 1.745 1.739 3.922 1.343 6.012h3.565c.635-3.058-.038-6.238-1.808-8.87z"/></svg> },
  { id: 'pagerduty', name: 'PagerDuty', description: 'Incident response, on-call, alerts', category: 'monitoring', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.965 1.18C15.085.164 13.769 0 10.683 0H3.73v14.55h6.926c2.743 0 4.8-.164 6.61-1.37 1.975-1.303 3.004-3.47 3.004-6.07 0-2.847-1.33-4.886-3.305-5.93zM12.198 10.07c-.96.547-2.147.63-3.593.63H7.39V3.5h1.47c1.392 0 2.46.11 3.32.657.906.575 1.448 1.636 1.448 2.88 0 1.387-.672 2.487-1.43 3.033zM3.73 17.616h3.66V24H3.73z"/></svg> },
  { id: 'grafana', name: 'Grafana', description: 'Dashboards, alerting, visualization', category: 'monitoring', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 21.6c-5.302 0-9.6-4.298-9.6-9.6S6.698 2.4 12 2.4s9.6 4.298 9.6 9.6-4.298 9.6-9.6 9.6zm-1.2-14.4h2.4v9.6h-2.4V7.2zm-3.6 2.4h2.4v7.2H7.2V9.6zm7.2-1.2h2.4v8.4h-2.4V8.4z"/></svg> },

  // Storage & CDN
  { id: 'cloudflare', name: 'Cloudflare', description: 'R2 storage, Workers, DNS, CDN', category: 'storage', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.509 16.516c.204-.578.118-.789-.21-.986-.306-.183-.616-.276-1.727-.309l-8.669.028c-.098 0-.2-.044-.252-.132a.29.29 0 0 1-.024-.28l.212-.605c.104-.296.392-.502.708-.516l9.107-.044c1.441-.068 2.986-.976 3.524-2.586l.675-2.018a.313.313 0 0 0 .012-.136C18.96 4.99 15.714 2 11.769 2 8.332 2 5.413 4.196 4.503 7.205c-.71-.533-1.608-.803-2.558-.708-1.748.176-3.14 1.603-3.282 3.356a3.456 3.456 0 0 0 .1 1.18C-1.1 12.751.283 14.473 2.16 14.473l.6-.002c.097 0 .18-.064.208-.152l.58-1.65c.204-.577.118-.789-.21-.985-.306-.184-.616-.277-1.727-.31l-.285.005c-.68.004-1.19-.58-.99-1.226a1.86 1.86 0 0 1 1.781-1.252c.326 0 .637.085.907.237a.27.27 0 0 0 .376-.132c.558-1.285 1.25-2.326 2.327-3.1A6.387 6.387 0 0 1 9.465 4.47a6.4 6.4 0 0 1 6.07 3.02c.1.16.324.216.5.136.524-.244 1.124-.332 1.764-.225 1.274.214 2.305 1.2 2.567 2.464.104.496.1.98-.002 1.426-.04.16.048.324.2.384.89.35 1.552 1.14 1.652 2.09.146 1.392-.887 2.575-2.253 2.69H5.097c-.098 0-.2.044-.252.132a.29.29 0 0 0-.024.28l.3.853c.104.296.392.502.708.516h14.03c1.703-.107 3.097-1.402 3.297-3.098a3.247 3.247 0 0 0-1.447-3.153c-.304-.204-.66-.356-1.04-.44a.282.282 0 0 0-.32.192l-.84 2.369z"/></svg> },
  { id: 's3', name: 'Amazon S3', description: 'Object storage, buckets, file hosting', category: 'storage', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0L1.608 6v12L12 24l10.392-6V6L12 0zm-1.073 1.445h.001a1.8 1.8 0 0 1 2.138 0l7.534 4.35a1.794 1.794 0 0 1 .9 1.556v8.652a1.794 1.794 0 0 1-.9 1.556l-7.534 4.35a1.8 1.8 0 0 1-2.138 0l-7.534-4.35A1.794 1.794 0 0 1 2.5 16.003V7.35c0-.641.341-1.234.893-1.555l7.534-4.35zM12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6z"/></svg> },
  { id: 'supabase', name: 'Supabase', description: 'Database, auth, storage, functions', category: 'storage', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.7 21.794c-.485.607-1.478.222-1.5-.582l-.315-10.86h7.818c1.246 0 1.928 1.447 1.13 2.395l-7.134 9.047zM10.3 2.206c.485-.607 1.478-.222 1.5.582l.1 10.86H4.2c-1.246 0-1.928-1.447-1.13-2.395L10.3 2.206z"/></svg> },

  // CRM & Sales
  { id: 'salesforce', name: 'Salesforce', description: 'Leads, contacts, opportunities, reports', category: 'crm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10.006 5.415a4.195 4.195 0 0 1 3.045-1.312c1.56 0 2.954.9 3.69 2.258a4.97 4.97 0 0 1 2.091-.46c2.766 0 5.008 2.24 5.008 5.004 0 2.763-2.242 5.003-5.008 5.003a5.02 5.02 0 0 1-1.31-.176 3.7 3.7 0 0 1-3.293 2.023 3.69 3.69 0 0 1-1.907-.53A4.41 4.41 0 0 1 8.24 19.77a4.14 4.14 0 0 1-.544.037c-1.278 0-2.42-.586-3.168-1.504A4.584 4.584 0 0 1 3.2 18.56c-2.53 0-4.58-2.048-4.58-4.575 0-1.73.966-3.236 2.39-4.01a4.053 4.053 0 0 1-.2-1.258c0-2.244 1.82-4.063 4.065-4.063 1.217 0 2.31.536 3.054 1.383a4.15 4.15 0 0 1 2.077-1.622z"/></svg> },
  { id: 'hubspot', name: 'HubSpot', description: 'Contacts, deals, tickets, marketing', category: 'crm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.984v-.066A2.2 2.2 0 0 0 17.231.834h-.066a2.2 2.2 0 0 0-2.2 2.2v.066c0 .862.5 1.608 1.227 1.966v2.862a5.94 5.94 0 0 0-2.878 1.45l-7.654-5.964a2.582 2.582 0 0 0 .072-.588 2.553 2.553 0 1 0-2.553 2.553c.462 0 .893-.128 1.268-.342l7.532 5.87a5.965 5.965 0 0 0-.535 2.472 5.965 5.965 0 0 0 .602 2.613l-2.36 2.36a2.07 2.07 0 0 0-.623-.103 2.09 2.09 0 1 0 2.09 2.09c0-.222-.037-.435-.098-.637l2.296-2.296a5.98 5.98 0 1 0 3.565-9.478z"/></svg> },
  { id: 'pipedrive', name: 'Pipedrive', description: 'Deals, contacts, activities, pipelines', category: 'crm', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg> },

  // E-Commerce & Payments
  { id: 'shopify', name: 'Shopify', description: 'Products, orders, customers, inventory', category: 'ecommerce', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.209-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104zm-1.332-17.94a3.147 3.147 0 0 0-.439-.021c-.377 0-.754.037-1.123.112.235-.954.651-1.903 1.325-2.443.282-.226.667-.452 1.105-.548a4.674 4.674 0 0 0-.868 2.9zm-1.584.39c-1.199.35-2.505.732-3.793 1.11.367-1.4 1.07-2.768 2.42-3.422a1.983 1.983 0 0 1 .282-.125c.322.67.469 1.605.469 1.605l.622.832zm-1.665-3.413c.183 0 .354.024.519.07-1.618.762-2.362 2.678-2.7 4.044l-2.455.718c.001 0 1.273-4.832 4.636-4.832z"/></svg> },
  { id: 'stripe', name: 'Stripe', description: 'Payments, subscriptions, invoices', category: 'ecommerce', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305z"/></svg> },
  { id: 'woocommerce', name: 'WooCommerce', description: 'Products, orders, coupons, reports', category: 'ecommerce', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.227 4.857A2.228 2.228 0 0 0 0 7.094v7.457c0 1.236 1.001 2.237 2.237 2.237h4.261l-1.003 3.401 4.608-3.401h11.66A2.237 2.237 0 0 0 24 14.551V7.094a2.228 2.228 0 0 0-2.227-2.237H2.227z"/></svg> },
  { id: 'square', name: 'Square', description: 'Payments, catalog, customers, orders', category: 'ecommerce', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4.01 0A4.01 4.01 0 0 0 0 4.01v15.98A4.01 4.01 0 0 0 4.01 24h15.98A4.01 4.01 0 0 0 24 19.99V4.01A4.01 4.01 0 0 0 19.99 0zm2.186 5.079h11.608A1.117 1.117 0 0 1 18.92 6.2v11.6a1.117 1.117 0 0 1-1.116 1.121H6.196a1.117 1.117 0 0 1-1.116-1.121V6.2a1.117 1.117 0 0 1 1.116-1.121z"/></svg> },

  // Marketing & Ads
  { id: 'mailchimp', name: 'Mailchimp', description: 'Email campaigns, audiences, automations', category: 'marketing', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 17.08c-.744.904-2.059 1.246-3.122 1.246-1.41 0-2.435-.53-3.082-1.323-.667.545-1.566.843-2.63.843-2.1 0-3.487-1.178-3.487-3.287 0-2.04 1.504-3.4 3.72-3.4.476 0 .942.058 1.387.173v-.34c0-.97-.523-1.496-1.636-1.496-.81 0-1.46.285-2.088.76l-1.053-1.453c.93-.72 2.11-1.126 3.44-1.126 2.494 0 3.77 1.2 3.77 3.44v3.48c0 .63.202.88.643.88.16 0 .34-.04.52-.12l.48 1.34a4.62 4.62 0 0 1-1.562.383z"/></svg> },
  { id: 'google_ads', name: 'Google Ads', description: 'Campaigns, keywords, conversions', category: 'marketing', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.654 17.28l7.14-12.36 4.157 2.4-7.14 12.36zM20.346 17.28L13.2 4.92l4.16-2.4 7.14 12.36zM7.5 20.4a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg> },
  { id: 'meta_ads', name: 'Meta Ads', description: 'Facebook & Instagram ads, audiences', category: 'marketing', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z"/></svg> },
  { id: 'sendgrid', name: 'SendGrid', description: 'Transactional email, templates, analytics', category: 'marketing', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7.96 16.053h8.093v7.947H7.96zM16.053.013H7.96v8.093h8.093zm7.934 8.08h-7.934v8.106h7.934zM.013 8.106v8.054h7.947V8.106z"/></svg> },

  // Social Media
  { id: 'twitter', name: 'X / Twitter', description: 'Posts, mentions, DMs, analytics', category: 'social', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
  { id: 'instagram', name: 'Instagram', description: 'Posts, stories, comments, insights', category: 'social', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg> },
  { id: 'linkedin', name: 'LinkedIn', description: 'Posts, company pages, analytics', category: 'social', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> },
  { id: 'buffer', name: 'Buffer', description: 'Schedule posts, manage channels, analytics', category: 'social', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M23.784 18.24c.287.142.287.267 0 .374l-11.357 5.223c-.287.144-.573.144-.86 0L.24 18.614c-.287-.107-.287-.232 0-.374l2.722-1.31c.287-.107.573-.107.86 0l7.748 3.56c.287.143.573.143.86 0l7.748-3.56c.287-.107.573-.107.86 0l2.746 1.31zm0-6.12c.287.143.287.268 0 .375l-11.357 5.223c-.287.143-.573.143-.86 0L.24 12.495c-.287-.107-.287-.232 0-.375l2.722-1.31c.287-.106.573-.106.86 0l7.748 3.562c.287.142.573.142.86 0l7.748-3.562c.287-.106.573-.106.86 0l2.746 1.31zm-11.784-.852L.24 6.046C-.048 5.903-.048 5.778.24 5.67L11.573.448c.287-.143.573-.143.86 0L23.784 5.67c.287.107.287.232 0 .375L12.427 11.27c-.287.106-.573.106-.86 0l.433-.002z"/></svg> },

  // Productivity & Docs
  { id: 'google_workspace', name: 'Google Workspace', description: 'Gmail, Drive, Calendar, Sheets', category: 'productivity', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
  { id: 'microsoft365', name: 'Microsoft 365', description: 'Outlook, OneDrive, Teams, Excel', category: 'productivity', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M0 0v11.408h11.408V0zm12.594 0v11.408H24V0zM0 12.594V24h11.408V12.594zm12.594 0V24H24V12.594z"/></svg> },
  { id: 'airtable', name: 'Airtable', description: 'Bases, records, automations, views', category: 'productivity', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M11.505 2.143L2.198 5.63c-.269.1-.27.47-.002.572l9.35 3.545c.283.107.6.107.883 0l9.349-3.545c.268-.101.267-.471-.002-.572l-9.307-3.487a1.15 1.15 0 0 0-.964 0zM2.05 8.502v8.07c0 .274.2.507.47.606l8.928 3.268a.71.71 0 0 0 .532 0c.013-.005.025-.013.038-.018V11.74L2.53 8.327c-.297-.113-.48.009-.48.175zm10.975 3.238v8.688c.013.005.025.013.038.018a.71.71 0 0 0 .531 0l8.929-3.268c.27-.099.47-.332.47-.606v-8.07c0-.166-.183-.288-.48-.175l-9.488 3.413z"/></svg> },
  { id: 'google_sheets', name: 'Google Sheets', description: 'Spreadsheets, formulas, data sync', category: 'productivity', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zM10 18h-3v-1.5h3V18zm0-3h-3v-1.5h3V15zm0-3h-3v-1.5h3V12zm7 6h-5v-1.5h5V18zm0-3h-5v-1.5h5V15zm0-3h-5v-1.5h5V12zm-2.273-6V.545L20.182 6h-5.455z"/></svg> },

  // Analytics
  { id: 'google_analytics', name: 'Google Analytics', description: 'Traffic, conversions, audiences, reports', category: 'analytics', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M22.84 2.998v17.958c.003 1.738-1.412 3.147-3.15 3.15a3.14 3.14 0 0 1-3.15-3.15v-17.96A3.143 3.143 0 0 1 19.688-.15c1.74-.004 3.153 1.408 3.153 3.148zM14.318 8.973v11.983c.003 1.738-1.412 3.147-3.15 3.15a3.14 3.14 0 0 1-3.15-3.15V8.973a3.143 3.143 0 0 1 3.148-3.148c1.74-.004 3.153 1.408 3.153 3.148zM5.826 18.168a3.14 3.14 0 0 1-3.15 3.15A3.143 3.143 0 0 1-.47 18.168a3.143 3.143 0 0 1 3.147-3.148c1.74-.004 3.153 1.408 3.15 3.148z"/></svg> },
  { id: 'mixpanel', name: 'Mixpanel', description: 'Events, funnels, retention, cohorts', category: 'analytics', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-2 17a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm4-4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0-6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg> },
  { id: 'plausible', name: 'Plausible', description: 'Privacy-friendly web analytics', category: 'analytics', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.078.016a11.985 11.985 0 0 0-8.955 4.535L12 12l8.877-7.449A11.985 11.985 0 0 0 12.078.016zM3.123 4.551A11.985 11.985 0 0 0 .016 12.078 11.985 11.985 0 0 0 4.551 20.96L12 12 3.123 4.551zm17.754 0L12 12l7.449 8.877a11.985 11.985 0 0 0 4.535-8.955 11.985 11.985 0 0 0-3.107-7.371zM4.551 20.96a11.985 11.985 0 0 0 7.527 3.024 11.985 11.985 0 0 0 8.799-4.861L12 12l-7.449 8.96z"/></svg> },

  // Finance & HR
  { id: 'quickbooks', name: 'QuickBooks', description: 'Invoices, expenses, reports, payroll', category: 'finance', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.108 18.214H8.766V5.786h3.255c2.655 0 4.593 1.643 4.593 4.317 0 2.657-1.938 4.298-4.593 4.298h-1.13v3.813zm1.13-5.707c1.45 0 2.327-.906 2.327-2.404s-.877-2.423-2.327-2.423h-1.13v4.827h1.13z"/></svg> },
  { id: 'xero', name: 'Xero', description: 'Accounting, invoicing, bank feeds', category: 'finance', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.243 16.243L12 12l-4.243 4.243-1.414-1.414L10.586 12 6.343 7.757l1.414-1.414L12 10.586l4.243-4.243 1.414 1.414L13.414 12l4.243 4.243-1.414 1.414z"/></svg> },
  { id: 'gusto', name: 'Gusto', description: 'Payroll, benefits, HR, compliance', category: 'finance', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg> },
  { id: 'wise', name: 'Wise', description: 'International transfers, multi-currency', category: 'finance', icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.477.517L4.89 23.483h4.04l2.543-7.697h5.049l2.588 7.697h4.001L15.477.517h-3zm1.527 4.84l1.91 5.794h-3.828l1.918-5.794z"/></svg> },
];

const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(ALL_PROVIDERS.map(p => [p.id, p.name]));

const PROVIDER_ICONS: Record<string, JSX.Element> = Object.fromEntries(ALL_PROVIDERS.map(p => [p.id, p.icon]));

const API_KEY_FIELDS: Record<string, { key: string; label: string; placeholder?: string; sensitive?: boolean }[]> = {
  aws: [{ key: 'access_key_id', label: 'Access Key ID' }, { key: 'secret_access_key', label: 'Secret Access Key', sensitive: true }, { key: 'region', label: 'Region', placeholder: 'us-east-1' }],
  gcp: [{ key: 'service_account_json', label: 'Service Account JSON', sensitive: true }, { key: 'project_id', label: 'Project ID' }],
  azure: [{ key: 'tenant_id', label: 'Tenant ID' }, { key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', sensitive: true }, { key: 'subscription_id', label: 'Subscription ID' }],
  digitalocean: [{ key: 'api_token', label: 'API Token', sensitive: true }],
  vercel: [{ key: 'api_token', label: 'API Token', sensitive: true }, { key: 'team_id', label: 'Team ID (optional)' }],
  netlify: [{ key: 'api_token', label: 'Personal Access Token', sensitive: true }],
  railway: [{ key: 'api_token', label: 'API Token', sensitive: true }],
  flyio: [{ key: 'api_token', label: 'API Token', sensitive: true }, { key: 'org_slug', label: 'Org Slug' }],
  jira: [{ key: 'domain', label: 'Domain', placeholder: 'mycompany.atlassian.net' }, { key: 'email', label: 'Email' }, { key: 'api_token', label: 'API Token', sensitive: true }],
  linear: [{ key: 'api_key', label: 'API Key', sensitive: true }],
  notion: [{ key: 'api_key', label: 'Integration Token', sensitive: true }],
  asana: [{ key: 'api_token', label: 'Personal Access Token', sensitive: true }],
  datadog: [{ key: 'api_key', label: 'API Key', sensitive: true }, { key: 'app_key', label: 'Application Key', sensitive: true }, { key: 'site', label: 'Site', placeholder: 'datadoghq.com' }],
  sentry: [{ key: 'auth_token', label: 'Auth Token', sensitive: true }, { key: 'org_slug', label: 'Org Slug' }],
  pagerduty: [{ key: 'api_key', label: 'API Key', sensitive: true }],
  grafana: [{ key: 'url', label: 'Grafana URL', placeholder: 'https://grafana.example.com' }, { key: 'api_key', label: 'API Key', sensitive: true }],
  cloudflare: [{ key: 'api_token', label: 'API Token', sensitive: true }, { key: 'account_id', label: 'Account ID' }],
  s3: [{ key: 'access_key_id', label: 'Access Key ID' }, { key: 'secret_access_key', label: 'Secret Access Key', sensitive: true }, { key: 'region', label: 'Region' }, { key: 'bucket', label: 'Bucket' }],
  supabase: [{ key: 'url', label: 'Project URL', placeholder: 'https://xxx.supabase.co' }, { key: 'anon_key', label: 'Anon Key' }, { key: 'service_role_key', label: 'Service Role Key', sensitive: true }],
  // CRM
  salesforce: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', sensitive: true }, { key: 'instance_url', label: 'Instance URL', placeholder: 'https://yourorg.my.salesforce.com' }],
  hubspot: [{ key: 'api_key', label: 'Private App Token', sensitive: true }],
  pipedrive: [{ key: 'api_token', label: 'API Token', sensitive: true }, { key: 'domain', label: 'Company Domain', placeholder: 'yourcompany' }],
  // E-Commerce
  shopify: [{ key: 'store_url', label: 'Store URL', placeholder: 'yourstore.myshopify.com' }, { key: 'api_key', label: 'Admin API Access Token', sensitive: true }],
  stripe: [{ key: 'secret_key', label: 'Secret Key', sensitive: true, placeholder: 'sk_live_...' }],
  woocommerce: [{ key: 'url', label: 'Store URL', placeholder: 'https://yourstore.com' }, { key: 'consumer_key', label: 'Consumer Key' }, { key: 'consumer_secret', label: 'Consumer Secret', sensitive: true }],
  square: [{ key: 'access_token', label: 'Access Token', sensitive: true }, { key: 'environment', label: 'Environment', placeholder: 'production' }],
  // Marketing
  mailchimp: [{ key: 'api_key', label: 'API Key', sensitive: true }, { key: 'server_prefix', label: 'Server Prefix', placeholder: 'us1' }],
  google_ads: [{ key: 'developer_token', label: 'Developer Token', sensitive: true }, { key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', sensitive: true }],
  meta_ads: [{ key: 'access_token', label: 'Long-Lived Access Token', sensitive: true }, { key: 'ad_account_id', label: 'Ad Account ID' }],
  sendgrid: [{ key: 'api_key', label: 'API Key', sensitive: true }],
  // Social
  twitter: [{ key: 'api_key', label: 'API Key (Consumer Key)' }, { key: 'api_secret', label: 'API Secret (Consumer Secret)', sensitive: true }, { key: 'bearer_token', label: 'Bearer Token', sensitive: true }, { key: 'access_token', label: 'Access Token' }, { key: 'access_token_secret', label: 'Access Token Secret', sensitive: true }],
  instagram: [{ key: 'access_token', label: 'Long-Lived Access Token', sensitive: true }],
  linkedin: [{ key: 'access_token', label: 'Access Token', sensitive: true }],
  buffer: [{ key: 'access_token', label: 'Access Token', sensitive: true }],
  // Productivity
  google_workspace: [{ key: 'service_account_json', label: 'Service Account JSON', sensitive: true }],
  microsoft365: [{ key: 'tenant_id', label: 'Tenant ID' }, { key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', sensitive: true }],
  airtable: [{ key: 'api_key', label: 'Personal Access Token', sensitive: true }],
  google_sheets: [{ key: 'service_account_json', label: 'Service Account JSON', sensitive: true }],
  // Analytics
  google_analytics: [{ key: 'property_id', label: 'Property ID' }, { key: 'service_account_json', label: 'Service Account JSON', sensitive: true }],
  mixpanel: [{ key: 'project_token', label: 'Project Token' }, { key: 'api_secret', label: 'API Secret', sensitive: true }],
  plausible: [{ key: 'api_key', label: 'API Key', sensitive: true }, { key: 'site_id', label: 'Site ID', placeholder: 'yoursite.com' }],
  // Finance
  quickbooks: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', sensitive: true }, { key: 'realm_id', label: 'Company ID' }],
  xero: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', sensitive: true }],
  gusto: [{ key: 'api_token', label: 'API Token', sensitive: true }],
  wise: [{ key: 'api_token', label: 'API Token', sensitive: true }, { key: 'profile_id', label: 'Profile ID' }],
};

function getApiKeyFields(providerId: string) {
  return API_KEY_FIELDS[providerId] ?? [{ key: 'api_key', label: 'API Key', sensitive: true }];
}

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [available, setAvailable] = useState<AvailableProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, 'success' | 'error'>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedRepos, setExpandedRepos] = useState<string | null>(null);
  const [repos, setRepos] = useState<Array<{ id: string; repo_full_name: string; is_private: boolean; language: string | null }>>([]);
  const [expandedApiKey, setExpandedApiKey] = useState<string | null>(null);
  const [apiKeyForms, setApiKeyForms] = useState<Record<string, Record<string, string>>>({});
  const [apiKeySaving, setApiKeySaving] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // Check URL for success/error messages from OAuth callback
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      setMessage({ type: 'success', text: `Connected to ${PROVIDER_LABELS[connected] ?? connected}` });
    } else if (error) {
      const errorMessages: Record<string, string> = {
        oauth_denied: 'Connection was cancelled',
        state_invalid: 'Session expired, please try again',
        connect_failed: 'Failed to connect, please try again',
        missing_params: 'Connection error, please try again',
        not_configured: 'This provider is not configured on the server',
      };
      setMessage({ type: 'error', text: errorMessages[error] ?? 'Connection error' });
    }

    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    setLoading(true);
    try {
      const [intgRes, availRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/integrations`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/integrations/available`, { credentials: 'include' }),
      ]);
      if (intgRes.ok) {
        const data = await intgRes.json() as { integrations: Integration[] };
        setIntegrations(data.integrations);
      }
      if (availRes.ok) {
        const data = await availRes.json() as { providers: AvailableProvider[] };
        setAvailable(data.providers);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (id: string, provider: string) => {
    if (!confirm(`Disconnect ${PROVIDER_LABELS[provider] ?? provider}? This will remove all cached repos.`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/integrations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
      setMessage({ type: 'success', text: `Disconnected ${PROVIDER_LABELS[provider] ?? provider}` });
    } catch {
      setMessage({ type: 'error', text: 'Failed to disconnect' });
    }
  };

  const handleSync = async (id: string) => {
    setSyncing(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/integrations/${id}/sync`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json() as { repos_synced: number };
      setMessage({ type: 'success', text: `Synced ${data.repos_synced} repos` });
      fetchData();
    } catch {
      setMessage({ type: 'error', text: 'Failed to sync repos' });
    } finally {
      setSyncing(null);
    }
  };

  const handleTestIntegration = async (id: string, provider: string) => {
    setTesting(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/integrations/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (data.success) {
        setMessage({ type: 'success', text: `${PROVIDER_LABELS[provider] ?? provider}: Credentials verified` });
        setTestResults(prev => ({ ...prev, [id]: 'success' }));
        fetchData();
      } else {
        setMessage({ type: 'error', text: data.message ?? data.error ?? 'Test failed' });
        setTestResults(prev => ({ ...prev, [id]: 'error' }));
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error testing integration' });
      setTestResults(prev => ({ ...prev, [id]: 'error' }));
    } finally {
      setTesting(null);
    }
  };

  const handleToggleRepos = async (id: string) => {
    if (expandedRepos === id) {
      setExpandedRepos(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/v1/integrations/${id}/repos`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { repos: Array<{ id: string; repo_full_name: string; is_private: boolean; language: string | null }> };
        setRepos(data.repos);
      }
    } catch { /* ignore */ }
    setExpandedRepos(id);
  };

  const connectedProviders = new Set(integrations.map((i) => i.provider));
  const availableSet = new Set(available.filter(p => p.configured).map(p => p.provider));
  const oauthProviders = new Set(['github', 'gitlab', 'bitbucket']);

  const handleApiKeyConnect = async (providerId: string) => {
    const config = apiKeyForms[providerId];
    if (!config || Object.values(config).every(v => !v)) return;

    setApiKeySaving(providerId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/integrations/connect/${providerId}/apikey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config }),
      });
      const data = await res.json() as { id?: string; testResult?: { success: boolean; message: string } };
      if (res.ok) {
        setMessage({ type: 'success', text: data.testResult?.message ?? `Connected to ${providerId}` });
        setExpandedApiKey(null);
        fetchData();
      } else {
        setMessage({ type: 'error', text: (data as { error?: string }).error ?? 'Connection failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setApiKeySaving(null);
    }
  };

  const updateApiKeyForm = (providerId: string, key: string, value: string) => {
    setApiKeyForms(prev => ({ ...prev, [providerId]: { ...(prev[providerId] ?? {}), [key]: value } }));
  };

  if (loading) {
    return (
      <div className="settings-section">
        <h2>Integrations</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2>Integrations</h2>
      <p className="settings-section-desc">
        Connect external services to unlock agent capabilities across your stack.
      </p>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>
            &times;
          </button>
        </div>
      )}

      {/* Connected Integrations */}
      {integrations.length > 0 && (
        <div className="settings-integrations-list" style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Connected</h3>
          {integrations.map((intg) => (
            <div key={intg.id} className="settings-integration-card">
              <div className="settings-integration-header">
                <div className="settings-integration-icon">
                  {PROVIDER_ICONS[intg.provider]}
                </div>
                <div className="settings-integration-info">
                  <span className="settings-integration-name">
                    {PROVIDER_LABELS[intg.provider] ?? intg.provider}
                  </span>
                  {intg.provider_username && (
                    <span className="settings-integration-username">@{intg.provider_username}</span>
                  )}
                </div>
                <div className="settings-integration-meta">
                  <span className={`settings-integration-status status-${intg.status}`}>
                    {intg.status}
                  </span>
                  <span className="settings-integration-repos">
                    {intg.repo_count} repos
                  </span>
                </div>
                <div className="settings-integration-actions">
                  <button
                    className="settings-btn-sm"
                    onClick={() => handleToggleRepos(intg.id)}
                    title="View repos"
                  >
                    {expandedRepos === intg.id ? 'Hide' : 'Repos'}
                  </button>
                  <button
                    className="settings-btn-sm"
                    onClick={() => handleTestIntegration(intg.id, intg.provider)}
                    disabled={testing === intg.id}
                    title="Test credentials"
                  >
                    {testing === intg.id ? 'Testing...' : 'Test'}
                  </button>
                  {testResults[intg.id] && (
                    <span className={`settings-test-result settings-test-result-${testResults[intg.id]}`}>
                      {testResults[intg.id] === 'success' ? '✓' : '✗'}
                    </span>
                  )}
                  <button
                    className="settings-btn-sm"
                    onClick={() => handleSync(intg.id)}
                    disabled={syncing === intg.id}
                    title="Sync repos"
                  >
                    {syncing === intg.id ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    className="settings-btn-sm settings-btn-danger"
                    onClick={() => handleDisconnect(intg.id, intg.provider)}
                    title="Disconnect"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {expandedRepos === intg.id && (
                <div className="settings-integration-repos-list">
                  {repos.length === 0 ? (
                    <p className="settings-integration-no-repos">No repos found. Try syncing.</p>
                  ) : (
                    repos.map((r) => (
                      <div key={r.id} className="settings-integration-repo-item">
                        <span className="settings-repo-name">{r.repo_full_name}</span>
                        {r.is_private && <span className="settings-repo-badge">private</span>}
                        {r.language && <span className="settings-repo-lang">{r.language}</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* All providers by category */}
      {PROVIDER_CATEGORIES.map((cat) => {
        const providers = ALL_PROVIDERS.filter(p => p.category === cat.id);
        if (!providers.length) return null;
        return (
          <div key={cat.id} className="settings-intg-category">
            <h3 className="settings-intg-category-label">{cat.label}</h3>
            <div className="settings-intg-grid">
              {providers.map((p) => {
                const isConnected = connectedProviders.has(p.id);
                const isAvailable = availableSet.has(p.id);
                const isOAuth = oauthProviders.has(p.id);
                const isExpanded = expandedApiKey === p.id;
                return (
                  <div
                    key={p.id}
                    className={`settings-intg-provider-card${isConnected ? ' connected' : ''}`}
                    style={{ cursor: !isConnected && !isOAuth ? 'pointer' : undefined }}
                    onClick={() => {
                      if (!isConnected && !isOAuth) setExpandedApiKey(isExpanded ? null : p.id);
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="settings-intg-provider-icon">{p.icon}</div>
                      <div className="settings-intg-provider-body">
                        <div className="settings-intg-provider-name">{p.name}</div>
                        <div className="settings-intg-provider-desc">{p.description}</div>
                      </div>
                      <div className="settings-intg-provider-action">
                        {isConnected ? (
                          <span className="settings-intg-badge connected">Connected</span>
                        ) : isOAuth && isAvailable ? (
                          <a
                            href={`${API_BASE}/api/v1/integrations/connect/${p.id}`}
                            className="settings-intg-connect-btn"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Connect
                          </a>
                        ) : isOAuth && !isAvailable ? (
                          <span className="settings-intg-badge upcoming" title={`Add ${p.id.toUpperCase()}_TOKEN to your .env file`}>Needs .env</span>
                        ) : (
                          <span className="settings-intg-badge upcoming">Configure</span>
                        )}
                      </div>
                    </div>
                    {isExpanded && !isConnected && (
                      <div onClick={(e) => e.stopPropagation()} className="settings-channel-form" style={{ marginTop: '0.75rem' }}>
                        <div className="settings-channel-fields">
                          {getApiKeyFields(p.id).map(f => (
                            <div key={f.key} className="settings-channel-field">
                              <label>{f.label}</label>
                              <input
                                type={f.sensitive ? 'password' : 'text'}
                                placeholder={f.placeholder ?? ''}
                                value={apiKeyForms[p.id]?.[f.key] ?? ''}
                                onChange={(e) => updateApiKeyForm(p.id, f.key, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <button
                            className="settings-btn-sm"
                            onClick={() => handleApiKeyConnect(p.id)}
                            disabled={apiKeySaving === p.id}
                          >
                            {apiKeySaving === p.id ? 'Connecting...' : 'Connect'}
                          </button>
                          <button className="settings-btn-sm" onClick={() => setExpandedApiKey(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// COST CONTROLS TAB
// ============================================

interface BudgetData {
  budgetLimitDaily: number | null;
  budgetLimitMonthly: number | null;
  spentToday: number;
  spentThisMonth: number;
}

function CostControlsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [advanced, setAdvanced] = useState(() => localStorage.getItem('askalf-cost-advanced') === 'true');
  const [dailyLimit, setDailyLimit] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [perExecutionLimit, setPerExecutionLimit] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('80');
  const [autoPause, setAutoPause] = useState(true);
  const [spentToday, setSpentToday] = useState(0);
  const [spentThisMonth, setSpentThisMonth] = useState(0);
  const [topWorkers, setTopWorkers] = useState<Array<{ name: string; cost: number; executions: number }>>([]);
  const [workerBudgets, setWorkerBudgets] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<Array<{ id: string; name: string; budget_limit: number | null }>>([]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [budgetRes, costRes, agentRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/forge/user-budget`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/admin/costs/summary`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/v1/forge/agents`, { credentials: 'include' }),
      ]);
      if (budgetRes.ok) {
        const data = await budgetRes.json() as BudgetData;
        setDailyLimit(data.budgetLimitDaily !== null ? String(data.budgetLimitDaily) : '');
        setMonthlyLimit(data.budgetLimitMonthly !== null ? String(data.budgetLimitMonthly) : '');
        setSpentToday(data.spentToday);
        setSpentThisMonth(data.spentThisMonth);
      }
      if (costRes.ok) {
        const data = await costRes.json() as { byAgent?: Array<{ name: string; cost: number; executions: number }> };
        setTopWorkers((data.byAgent || []).sort((a, b) => b.cost - a.cost).slice(0, 10));
      }
      if (agentRes.ok) {
        const data = await agentRes.json() as { agents: Array<{ id: string; name: string; budget_limit: number | null }> };
        setAgents(data.agents || []);
        const budgets: Record<string, string> = {};
        for (const a of (data.agents || [])) {
          if (a.budget_limit !== null) budgets[a.id] = String(a.budget_limit);
        }
        setWorkerBudgets(budgets);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const daily = dailyLimit.trim() ? parseFloat(dailyLimit) : null;
      const monthly = monthlyLimit.trim() ? parseFloat(monthlyLimit) : null;

      if (daily !== null && (isNaN(daily) || daily < 0)) {
        setMessage({ type: 'error', text: 'Daily limit must be a positive number' });
        setSaving(false);
        return;
      }
      if (monthly !== null && (isNaN(monthly) || monthly < 0)) {
        setMessage({ type: 'error', text: 'Monthly limit must be a positive number' });
        setSaving(false);
        return;
      }

      const res = await fetch(`${API_BASE}/api/v1/forge/user-budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ budgetLimitDaily: daily, budgetLimitMonthly: monthly }),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Budget limits saved' });
      } else {
        const err = await res.json() as { error?: string };
        setMessage({ type: 'error', text: err.error ?? 'Failed to save' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/user-budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ budgetLimitDaily: null, budgetLimitMonthly: null }),
      });
      if (res.ok) {
        setDailyLimit('');
        setMonthlyLimit('');
        setMessage({ type: 'success', text: 'Budget limits removed' });
      } else {
        setMessage({ type: 'error', text: 'Failed to clear budget limits' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to clear budget limits' });
    }
    setSaving(false);
  };

  const handleSaveWorkerBudget = async (agentId: string) => {
    const val = workerBudgets[agentId];
    const limit = val?.trim() ? parseFloat(val) : null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ budget_limit: limit }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Worker budget updated' });
      }
    } catch { /* ignore */ }
  };

  const toggleAdvanced = () => {
    const next = !advanced;
    setAdvanced(next);
    localStorage.setItem('askalf-cost-advanced', String(next));
  };

  if (loading) {
    return (
      <div className="settings-section">
        <h2>Cost Controls</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  const dailyPct = dailyLimit ? Math.min(100, (spentToday / parseFloat(dailyLimit)) * 100) : 0;
  const monthlyPct = monthlyLimit ? Math.min(100, (spentThisMonth / parseFloat(monthlyLimit)) * 100) : 0;

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Cost Controls</h2>
        <button
          onClick={toggleAdvanced}
          style={{
            position: 'relative', width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: advanced ? '#7c3aed' : 'var(--border)',
            transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: advanced ? 22 : 2, width: 20, height: 20, borderRadius: '50%',
            background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </button>
      </div>
      <p className="settings-section-desc" style={{ marginBottom: 16 }}>
        {advanced ? 'Advanced cost controls — per-worker budgets, alert thresholds, and spending breakdown.' : 'Set spending limits to prevent unexpected costs. Workers are blocked when limits are reached.'}
      </p>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {/* Spend overview */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>Today</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: dailyPct > 90 ? '#ef4444' : dailyPct > 70 ? '#f59e0b' : 'var(--text)' }}>
            ${spentToday.toFixed(2)}
            {dailyLimit && <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}> / ${parseFloat(dailyLimit).toFixed(0)}</span>}
          </div>
          {dailyLimit && (
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${dailyPct}%`, borderRadius: 2, background: dailyPct > 90 ? '#ef4444' : dailyPct > 70 ? '#f59e0b' : '#22c55e', transition: 'width 0.3s' }} />
            </div>
          )}
        </div>
        <div style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>This Month</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: monthlyPct > 90 ? '#ef4444' : monthlyPct > 70 ? '#f59e0b' : 'var(--text)' }}>
            ${spentThisMonth.toFixed(2)}
            {monthlyLimit && <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}> / ${parseFloat(monthlyLimit).toFixed(0)}</span>}
          </div>
          {monthlyLimit && (
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${monthlyPct}%`, borderRadius: 2, background: monthlyPct > 90 ? '#ef4444' : monthlyPct > 70 ? '#f59e0b' : '#22c55e', transition: 'width 0.3s' }} />
            </div>
          )}
        </div>
      </div>

      {/* Basic controls */}
      <div className="settings-form">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="settings-field">
            <label>Daily Limit (USD)</label>
            <input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} placeholder="No limit" min="0" step="0.5" />
          </div>
          <div className="settings-field">
            <label>Monthly Limit (USD)</label>
            <input type="number" value={monthlyLimit} onChange={(e) => setMonthlyLimit(e.target.value)} placeholder="No limit" min="0" step="1" />
          </div>
        </div>

        {/* Advanced controls */}
        {advanced && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div className="settings-field">
                <label>Default Per-Execution Limit (USD)</label>
                <input type="number" value={perExecutionLimit} onChange={(e) => setPerExecutionLimit(e.target.value)} placeholder="$1.00 (default)" min="0" step="0.25" />
                <p className="settings-field-hint">Max cost per single worker execution</p>
              </div>
              <div className="settings-field">
                <label>Alert Threshold (%)</label>
                <input type="number" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)} placeholder="80" min="0" max="100" step="5" />
                <p className="settings-field-hint">Warn when spend reaches this % of limit</p>
              </div>
            </div>

            <div className="settings-field" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <label style={{ marginBottom: 0 }}>Auto-Pause Workers</label>
                  <p className="settings-field-hint" style={{ margin: 0 }}>Pause all workers when budget limit is hit (vs. just blocking new executions)</p>
                </div>
                <button
                  onClick={() => setAutoPause(!autoPause)}
                  style={{
                    position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: autoPause ? '#22c55e' : 'var(--border)', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: autoPause ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }} />
                </button>
              </div>
            </div>

            {/* Top spenders */}
            {topWorkers.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Top Spenders (This Period)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {topWorkers.map((w, i) => {
                    const maxCost = topWorkers[0]?.cost || 1;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text)', minWidth: 120 }}>{w.name}</span>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(w.cost / maxCost) * 100}%`, borderRadius: 3, background: '#7c3aed' }} />
                        </div>
                        <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: 55, textAlign: 'right' }}>${w.cost.toFixed(2)}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{w.executions} runs</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Per-worker budgets */}
            {agents.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Per-Worker Budget Limits</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {agents.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text)', minWidth: 140 }}>{a.name}</span>
                      <input
                        type="number"
                        value={workerBudgets[a.id] ?? ''}
                        onChange={(e) => setWorkerBudgets(prev => ({ ...prev, [a.id]: e.target.value }))}
                        placeholder="No limit"
                        min="0"
                        step="0.5"
                        style={{ width: 100, padding: '4px 8px', fontSize: '0.8rem', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}
                      />
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>$/day</span>
                      <button
                        className="settings-btn-sm"
                        style={{ padding: '3px 10px', fontSize: '0.7rem' }}
                        onClick={() => handleSaveWorkerBudget(a.id)}
                      >
                        Set
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 16 }}>
          <button className="settings-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Limits'}
          </button>
          {(dailyLimit.trim() || monthlyLimit.trim()) && (
            <button className="settings-btn-sm" onClick={handleClear} disabled={saving}>Remove Limits</button>
          )}
        </div>
      </div>

      <div className="settings-cost-info">
        <div className="settings-cost-info-title">How cost controls work</div>
        <ul>
          <li>Daily and monthly limits apply across all workers combined</li>
          <li>When a limit is reached, new executions are blocked until the period resets</li>
          <li>Cost tracking resets daily at midnight UTC and monthly on the 1st</li>
          {advanced && <li>Per-worker budgets override the global per-execution default for individual workers</li>}
          {advanced && <li>Alert threshold triggers a notification before the hard limit blocks executions</li>}
          <li>For detailed spend breakdowns and forecasts, see the Costs tab in Operations</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================
// CHANNELS TAB
// ============================================

interface ChannelDef {
  type: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  fields: { key: string; label: string; placeholder: string; sensitive?: boolean }[];
}

const CHANNEL_CATEGORIES = [
  { id: 'messaging', label: 'Messaging Platforms' },
  { id: 'developer', label: 'Developer & Automation' },
  { id: 'email', label: 'Email & SMS' },
  { id: 'voice', label: 'Voice & Video' },
];

const CHANNEL_DEFS: ChannelDef[] = [
  // Messaging
  {
    type: 'slack',
    name: 'Slack',
    icon: '\u{1F4AC}',
    category: 'messaging',
    description: 'Workers respond directly in your Slack channels.',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-...', sensitive: true },
      { key: 'signing_secret', label: 'Signing Secret', placeholder: 'From Slack app settings', sensitive: true },
    ],
  },
  {
    type: 'discord',
    name: 'Discord',
    icon: '\u{1F3AE}',
    category: 'messaging',
    description: 'Slash commands that dispatch worker tasks.',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'Bot token from Discord Developer Portal', sensitive: true },
      { key: 'application_id', label: 'Application ID', placeholder: 'From Discord app settings' },
      { key: 'public_key', label: 'Public Key', placeholder: 'Ed25519 public key from app settings', sensitive: true },
    ],
  },
  {
    type: 'telegram',
    name: 'Telegram',
    icon: '\u{2708}\uFE0F',
    category: 'messaging',
    description: 'Chat with agents via a Telegram bot.',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'From @BotFather', sensitive: true },
    ],
  },
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    icon: '\u{1F4F1}',
    category: 'messaging',
    description: 'Agent messages through WhatsApp Business.',
    fields: [
      { key: 'phone_number_id', label: 'Phone Number ID', placeholder: 'From Meta Business settings' },
      { key: 'access_token', label: 'Access Token', placeholder: 'Permanent token from Meta', sensitive: true },
      { key: 'verify_token', label: 'Verify Token', placeholder: 'Your custom verification token' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'From Meta app settings', sensitive: true },
    ],
  },
  {
    type: 'teams',
    name: 'Microsoft Teams',
    icon: '\u{1F4BC}',
    category: 'messaging',
    description: 'Agents inside your Teams workspace.',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'From Azure Bot registration' },
      { key: 'app_password', label: 'App Password', placeholder: 'Bot Framework secret', sensitive: true },
      { key: 'tenant_id', label: 'Azure Tenant ID', placeholder: 'Your Azure AD tenant ID' },
    ],
  },

  // Developer & Automation
  {
    type: 'api',
    name: 'REST API',
    icon: '\u{1F310}',
    category: 'developer',
    description: 'Dispatch agents programmatically via API.',
    fields: [],
  },
  {
    type: 'webhooks',
    name: 'Webhooks',
    icon: '\u{26A1}',
    category: 'developer',
    description: 'HMAC-signed payloads to your endpoint.',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://your-app.com/webhook' },
      { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'Auto-generated if blank', sensitive: true },
    ],
  },
  {
    type: 'zapier',
    name: 'Zapier',
    icon: '\u{1F517}',
    category: 'developer',
    description: 'Trigger agents from any Zapier workflow.',
    fields: [
      { key: 'webhook_url', label: 'Zapier Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...' },
      { key: 'api_key', label: 'API Key', placeholder: 'For authenticating Zapier requests', sensitive: true },
    ],
  },
  {
    type: 'n8n',
    name: 'n8n',
    icon: '\u{2699}\uFE0F',
    category: 'developer',
    description: 'Self-hosted workflow automation.',
    fields: [
      { key: 'webhook_url', label: 'n8n Webhook URL', placeholder: 'https://your-n8n.com/webhook/...' },
      { key: 'api_key', label: 'API Key', placeholder: 'For authenticating n8n requests', sensitive: true },
    ],
  },
  {
    type: 'make',
    name: 'Make (Integromat)',
    icon: '\u{1F504}',
    category: 'developer',
    description: 'Visual automation scenarios.',
    fields: [
      { key: 'webhook_url', label: 'Make Webhook URL', placeholder: 'https://hook.make.com/...' },
      { key: 'api_key', label: 'API Key', placeholder: 'For authenticating Make requests', sensitive: true },
    ],
  },

  // Email & SMS
  {
    type: 'email',
    name: 'Email',
    icon: '\u{1F4E7}',
    category: 'email',
    description: 'Agents respond to inbound emails.',
    fields: [
      { key: 'inbound_address', label: 'Inbound Address', placeholder: 'agent@yourdomain.com' },
      { key: 'smtp_host', label: 'SMTP Host', placeholder: 'smtp.gmail.com' },
      { key: 'smtp_port', label: 'SMTP Port', placeholder: '587' },
      { key: 'smtp_user', label: 'SMTP User', placeholder: 'your@email.com' },
      { key: 'smtp_pass', label: 'SMTP Password', placeholder: 'App password', sensitive: true },
    ],
  },
  {
    type: 'twilio',
    name: 'Twilio SMS',
    icon: '\u{1F4DE}',
    category: 'email',
    description: 'Agent conversations over SMS.',
    fields: [
      { key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'auth_token', label: 'Auth Token', placeholder: 'Your Twilio auth token', sensitive: true },
      { key: 'phone_number', label: 'Phone Number', placeholder: '+1234567890' },
    ],
  },
  {
    type: 'sendgrid',
    name: 'SendGrid',
    icon: '\u{2709}\uFE0F',
    category: 'email',
    description: 'Transactional email delivery for agents.',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'SG.xxxxxxxxxxxxxxxx', sensitive: true },
      { key: 'from_email', label: 'From Email', placeholder: 'agent@yourdomain.com' },
      { key: 'from_name', label: 'From Name', placeholder: 'AskAlf Agent' },
    ],
  },

  // Voice & Video
  {
    type: 'twilio_voice',
    name: 'Twilio Voice',
    icon: '\u{1F4DE}',
    category: 'voice',
    description: 'Voice calls with AI agent responses.',
    fields: [
      { key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'auth_token', label: 'Auth Token', placeholder: 'Your Twilio auth token', sensitive: true },
      { key: 'phone_number', label: 'Phone Number', placeholder: '+1234567890' },
      { key: 'twiml_app_sid', label: 'TwiML App SID', placeholder: 'APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    type: 'zoom',
    name: 'Zoom',
    icon: '\u{1F3A5}',
    category: 'voice',
    description: 'Agent assistants in Zoom meetings.',
    fields: [
      { key: 'client_id', label: 'Client ID', placeholder: 'From Zoom Marketplace app' },
      { key: 'client_secret', label: 'Client Secret', placeholder: 'OAuth client secret', sensitive: true },
      { key: 'bot_jid', label: 'Bot JID', placeholder: 'v1xxxxxxxxxxxxxx@xmpp.zoom.us' },
      { key: 'verification_token', label: 'Verification Token', placeholder: 'Webhook verification token', sensitive: true },
    ],
  },
];

interface ChannelTestStatus {
  status: 'connected' | 'unchecked' | 'failed';
  lastChecked: string | null;
  detail?: string;
}

function ChannelsTab() {
  const [configs, setConfigs] = useState<Record<string, { id?: string; webhookUrl?: string; isActive?: boolean }>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [chMsg, setChMsg] = useState<{ type: string; channel: string; text: string } | null>(null);
  const [testStatuses, setTestStatuses] = useState<Record<string, ChannelTestStatus>>({});
  const [envChannels, setEnvChannels] = useState<Record<string, string[]>>({});
  const [healthSummary, setHealthSummary] = useState<{ total: number; connected: number; active: number } | null>(null);
  const [autoTest, setAutoTest] = useState<boolean>(() => {
    try { return localStorage.getItem('askalf_channel_autotest') === 'true'; } catch { return false; }
  });
  const [autoTestRan, setAutoTestRan] = useState(false);

  useEffect(() => {
    loadConfigs();
    loadHealth();
  }, []);

  const runTestForChannel = useCallback(async (channelType: string, configId: string): Promise<ChannelTestStatus> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/channels/configs/${configId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const now = new Date().toISOString();
      if (!res.ok) {
        return { status: 'failed', lastChecked: now, detail: `HTTP ${res.status}` };
      }
      const data = await res.json() as {
        success?: boolean; message?: string; error?: string;
        bot_username?: string; workspace_name?: string; server_name?: string;
        team_name?: string; guild_name?: string;
      };
      let detail: string | undefined;
      if (channelType === 'telegram' && data.bot_username) {
        detail = `@${data.bot_username}`;
      } else if (channelType === 'slack' && (data.workspace_name ?? data.team_name)) {
        detail = data.workspace_name ?? data.team_name;
      } else if (channelType === 'discord' && (data.server_name ?? data.guild_name)) {
        detail = data.server_name ?? data.guild_name;
      }
      return {
        status: data.success ? 'connected' : 'failed',
        lastChecked: now,
        detail: detail ?? (data.message || undefined),
      };
    } catch {
      return { status: 'failed', lastChecked: new Date().toISOString() };
    }
  }, []);

  // Auto-test all connected channels on page load
  useEffect(() => {
    if (!autoTest || autoTestRan) return;
    const configEntries = Object.entries(configs).filter(([, c]) => !!c.id);
    if (configEntries.length === 0) return;
    setAutoTestRan(true);
    (async () => {
      const results: Record<string, ChannelTestStatus> = {};
      await Promise.all(configEntries.map(async ([channelType, c]) => {
        results[channelType] = await runTestForChannel(channelType, c.id!);
      }));
      setTestStatuses(prev => ({ ...prev, ...results }));
    })();
  }, [autoTest, autoTestRan, configs, runTestForChannel]);

  const loadConfigs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/channels/configs`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { configs: Array<{ id: string; channel_type: string; is_active: boolean }> };
        const map: Record<string, { id: string; isActive: boolean }> = {};
        for (const c of data.configs) {
          map[c.channel_type] = { id: c.id, isActive: c.is_active };
        }
        setConfigs(map);
      }
    } catch { /* ignore */ }
  };

  const handleSave = async (channelType: string) => {
    setSaving(channelType);
    setChMsg(null);
    try {
      const formData = forms[channelType] ?? {};
      const res = await fetch(`${API_BASE}/api/v1/forge/channels/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel_type: channelType, name: channelType, config: formData }),
      });
      if (res.ok) {
        const data = await res.json() as { id: string; webhookUrl?: string };
        setConfigs(prev => ({ ...prev, [channelType]: { id: data.id, webhookUrl: data.webhookUrl, isActive: true } }));
        setChMsg({ type: 'success', channel: channelType, text: data.webhookUrl ? `Saved. Webhook URL: ${data.webhookUrl}` : 'Saved successfully.' });
        setTestStatuses(prev => ({ ...prev, [channelType]: { status: 'unchecked', lastChecked: null } }));
        await loadConfigs();
      } else {
        const err = await res.json() as { error?: string; message?: string };
        setChMsg({ type: 'error', channel: channelType, text: err.message ?? err.error ?? 'Save failed' });
      }
    } catch (err) {
      setChMsg({ type: 'error', channel: channelType, text: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (channelType: string) => {
    const configId = configs[channelType]?.id;
    if (!configId) return;
    setTesting(channelType);
    setChMsg(null);
    try {
      const result = await runTestForChannel(channelType, configId);
      setTestStatuses(prev => ({ ...prev, [channelType]: result }));
      if (result.status === 'connected') {
        const detailSuffix = result.detail ? ` (${result.detail})` : '';
        setChMsg({ type: 'success', channel: channelType, text: `Test passed${detailSuffix}` });
      } else {
        setChMsg({ type: 'error', channel: channelType, text: result.detail ?? 'Test failed' });
      }
    } catch (err) {
      setTestStatuses(prev => ({ ...prev, [channelType]: { status: 'failed', lastChecked: new Date().toISOString() } }));
      setChMsg({ type: 'error', channel: channelType, text: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setTesting(null);
    }
  };

  const handleDisconnect = async (channelType: string) => {
    const configId = configs[channelType]?.id;
    if (!configId) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/channels/configs/${configId}`, {
        method: 'DELETE',
        headers: {},
        credentials: 'include',
      });
      if (res.ok) {
        setConfigs(prev => { const next = { ...prev }; delete next[channelType]; return next; });
        setTestStatuses(prev => { const next = { ...prev }; delete next[channelType]; return next; });
        setChMsg({ type: 'success', channel: channelType, text: 'Disconnected' });
      } else {
        setChMsg({ type: 'error', channel: channelType, text: `Disconnect failed: ${res.status}` });
      }
    } catch {
      setChMsg({ type: 'error', channel: channelType, text: 'Disconnect failed' });
    }
  };

  const loadHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/channels/health`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as {
          summary: { total: number; connected: number; active: number };
          channels: Array<{ type: string; source: string; envKeys: string[] }>;
        };
        setHealthSummary(data.summary);
        const envMap: Record<string, string[]> = {};
        for (const ch of data.channels) {
          if (ch.envKeys.length > 0) envMap[ch.type] = ch.envKeys;
        }
        setEnvChannels(envMap);
      }
    } catch { /* ignore */ }
  };

  const updateForm = (channelType: string, key: string, value: string) => {
    setForms(prev => ({ ...prev, [channelType]: { ...(prev[channelType] ?? {}), [key]: value } }));
  };

  const toggleAutoTest = () => {
    const next = !autoTest;
    setAutoTest(next);
    try { localStorage.setItem('askalf_channel_autotest', String(next)); } catch { /* ignore */ }
    if (next) setAutoTestRan(false);
  };

  // Channels with fields are "wired" (configurable now)
  const wiredChannels = new Set(['slack', 'discord', 'telegram', 'whatsapp', 'webhooks', 'teams', 'zapier', 'n8n', 'make', 'email', 'twilio', 'sendgrid', 'twilio_voice', 'zoom']);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  // Compute summary counts
  const configuredCount = Object.keys(configs).filter(k => !!configs[k]?.id).length;
  const connectedCount = Object.values(testStatuses).filter(s => s.status === 'connected').length;

  const formatCheckedTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="settings-section">
      <h2>Channels</h2>
      <p className="settings-section-desc">
        Connect platforms so your workers can receive messages and respond anywhere.
      </p>

      {/* Health summary */}
      {healthSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text)' }}>{healthSummary.total}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Available</div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#3b82f6' }}>{healthSummary.connected}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Configured</div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#22c55e' }}>{healthSummary.active}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active</div>
          </div>
        </div>
      )}

      {/* Status summary bar */}
      <div className="settings-channel-summary-bar">
        <div className="settings-channel-summary-stats">
          <span className="settings-channel-summary-count">
            {connectedCount}/{configuredCount} channels connected
          </span>
          {configuredCount > 0 && connectedCount === configuredCount && Object.keys(testStatuses).length > 0 && (
            <span className="settings-channel-summary-badge all-good">All healthy</span>
          )}
          {configuredCount > 0 && connectedCount < configuredCount && connectedCount > 0 && (
            <span className="settings-channel-summary-badge partial">Some issues</span>
          )}
          {configuredCount > 0 && connectedCount === 0 && Object.keys(testStatuses).length > 0 && (
            <span className="settings-channel-summary-badge failing">Check connections</span>
          )}
        </div>
        <label className="settings-channel-autotest-toggle" onClick={e => e.stopPropagation()}>
          <span>Auto-test on load</span>
          <button
            className={`settings-channel-toggle-btn${autoTest ? ' active' : ''}`}
            onClick={toggleAutoTest}
            role="switch"
            aria-checked={autoTest}
          >
            <span className="settings-channel-toggle-knob" />
          </button>
        </label>
      </div>

      {CHANNEL_CATEGORIES.map(cat => {
        const channels = CHANNEL_DEFS.filter(c => c.category === cat.id);
        if (!channels.length) return null;
        return (
          <div key={cat.id} className="settings-intg-category">
            <h3 className="settings-intg-category-label">{cat.label}</h3>
            <div className="settings-intg-grid">
              {channels.map(ch => {
                const config = configs[ch.type];
                const isConnected = !!config?.id;
                const hasEnv = !!envChannels[ch.type]?.length;
                const isWired = wiredChannels.has(ch.type);
                const isExpanded = expandedChannel === ch.type;
                const msg = chMsg?.channel === ch.type ? chMsg : null;
                const testStatus = testStatuses[ch.type];
                const isTesting = testing === ch.type;

                return (
                  <div
                    key={ch.type}
                    className={`settings-intg-provider-card settings-channel-card${isConnected || hasEnv ? ' connected' : ''}${!isWired ? ' upcoming' : ''}`}
                    style={{ cursor: isWired ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (!isWired || ch.type === 'api') return;
                      setExpandedChannel(isExpanded ? null : ch.type);
                    }}
                  >
                    <div className="settings-channel-header">
                      <span className="settings-channel-icon">{ch.icon}</span>
                      <div className="settings-intg-provider-body">
                        <div className="settings-intg-provider-name">{ch.name}</div>
                        <div className="settings-intg-provider-desc">{ch.description}</div>
                      </div>
                      <div className="settings-intg-provider-action" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {hasEnv && (
                          <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>.env</span>
                        )}
                        {isConnected ? (
                          <span className="settings-intg-badge connected">Connected</span>
                        ) : ch.type === 'api' ? (
                          <span className="settings-intg-badge connected">Built-in</span>
                        ) : hasEnv ? (
                          <span className="settings-intg-badge connected">System</span>
                        ) : (
                          <span className="settings-intg-badge upcoming">Configure</span>
                        )}
                      </div>
                    </div>

                    {/* Live status indicator for configured channels */}
                    {isConnected && (
                      <div className="settings-channel-status-row">
                        <div className="settings-channel-status-indicator">
                          <span className={`settings-channel-status-dot${isTesting ? ' testing' : testStatus ? (testStatus.status === 'connected' ? ' connected' : testStatus.status === 'failed' ? ' failed' : ' unchecked') : ' unchecked'}`} />
                          <span className="settings-channel-status-label">
                            {isTesting ? 'Testing...' : testStatus ? (testStatus.status === 'connected' ? 'Connected' : testStatus.status === 'failed' ? 'Failed' : 'Unchecked') : 'Unchecked'}
                          </span>
                        </div>
                        {testStatus?.detail && testStatus.status === 'connected' && (
                          <span className="settings-channel-status-detail">
                            {ch.type === 'telegram' ? `Bot: ${testStatus.detail}` : ch.type === 'slack' ? `Workspace: ${testStatus.detail}` : ch.type === 'discord' ? `Server: ${testStatus.detail}` : testStatus.detail}
                          </span>
                        )}
                        {testStatus?.lastChecked && (
                          <span className="settings-channel-status-time">
                            Checked {formatCheckedTime(testStatus.lastChecked)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Expanded config form */}
                    {isExpanded && isWired && ch.fields.length > 0 && (
                      <div onClick={e => e.stopPropagation()} className="settings-channel-form">
                        <div className="settings-channel-fields">
                          {ch.fields.map(f => (
                            <div key={f.key} className="settings-channel-field">
                              <label>{f.label}</label>
                              <input
                                type={f.sensitive ? 'password' : 'text'}
                                placeholder={f.placeholder}
                                value={forms[ch.type]?.[f.key] ?? ''}
                                onChange={(e) => updateForm(ch.type, f.key, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                        {msg && (
                          <div className={`settings-channel-msg ${msg.type}`}>
                            {msg.text}
                          </div>
                        )}
                        <div className="settings-channel-actions">
                          <button className="settings-intg-connect-btn" onClick={() => handleSave(ch.type)} disabled={saving === ch.type}>
                            {saving === ch.type ? 'Saving...' : isConnected ? 'Update' : 'Save'}
                          </button>
                          {isConnected && (
                            <button className="settings-btn-sm" onClick={() => handleTest(ch.type)} disabled={testing === ch.type}>
                              {testing === ch.type ? 'Testing...' : 'Test'}
                            </button>
                          )}
                          {isConnected && (
                            <button className="settings-btn-sm settings-btn-danger" onClick={() => handleDisconnect(ch.type)}>
                              Disconnect
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Devices Tab — Agent Bridge Device Management
// ============================================

interface DeviceInfo {
  id: string;
  device_name: string;
  hostname: string | null;
  os: string | null;
  status: 'online' | 'offline' | 'busy';
  platform_capabilities: Record<string, unknown>;
  last_seen_at: string | null;
  created_at: string;
  device_type: string;
  device_category: string;
  protocol: string;
  connection_config: Record<string, unknown>;
}

const DEVICE_CATEGORIES = [
  { id: 'compute', label: 'Compute' },
  { id: 'browser', label: 'Browser & Desktop' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'iot', label: 'IoT & Edge' },
];

interface DeviceTypeDef {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  available: boolean;
}

const DEVICE_TYPES: DeviceTypeDef[] = [
  // Compute
  { id: 'cli', name: 'CLI Agent', description: 'Shell access, file system, git ops', category: 'compute', icon: '\u{1F4BB}', available: true },
  { id: 'docker', name: 'Docker Host', description: 'Container management, builds, deploys', category: 'compute', icon: '\u{1F433}', available: true },
  { id: 'ssh', name: 'SSH Remote', description: 'Remote server access via SSH tunnel', category: 'compute', icon: '\u{1F510}', available: true },
  { id: 'k8s', name: 'Kubernetes', description: 'Cluster management, pod orchestration', category: 'compute', icon: '\u{2699}\uFE0F', available: true },

  // Browser & Desktop
  { id: 'browser', name: 'Browser Bridge', description: 'Web automation, screenshots, DOM', category: 'browser', icon: '\u{1F310}', available: true },
  { id: 'desktop', name: 'Desktop Control', description: 'Mouse, keyboard, screen capture', category: 'browser', icon: '\u{1F5A5}\uFE0F', available: true },
  { id: 'vscode', name: 'VS Code', description: 'Editor integration, workspace access', category: 'browser', icon: '\u{1F4DD}', available: true },

  // Mobile
  { id: 'android', name: 'Android', description: 'ADB bridge, app automation', category: 'mobile', icon: '\u{1F4F1}', available: true },
  { id: 'ios', name: 'iOS', description: 'Simulator/device testing, shortcuts', category: 'mobile', icon: '\u{1F34E}', available: true },

  // IoT & Edge
  { id: 'rpi', name: 'Raspberry Pi', description: 'GPIO, sensors, edge compute', category: 'iot', icon: '\u{1F353}', available: true },
  { id: 'arduino', name: 'Arduino / ESP32', description: 'Microcontroller programming', category: 'iot', icon: '\u{1F4A1}', available: true },
  { id: 'homeassistant', name: 'Home Assistant', description: 'Smart home automation', category: 'iot', icon: '\u{1F3E0}', available: true },
];

const DEVICE_TYPE_LABELS: Record<string, string> = {
  cli: 'CLI', docker: 'Docker', ssh: 'SSH', k8s: 'K8s', browser: 'Browser',
  desktop: 'Desktop', vscode: 'VS Code', android: 'Android', ios: 'iOS',
  rpi: 'RPi', arduino: 'Arduino', homeassistant: 'HA',
};

const SERVER_MANAGED_TYPES = ['docker', 'ssh', 'k8s', 'homeassistant'];

interface SetupForm {
  deviceType: string;
  deviceName: string;
  // Docker
  socketPath: string;
  defaultImage: string;
  // SSH
  host: string;
  port: string;
  username: string;
  privateKey: string;
  // K8s
  namespace: string;
  kubeconfig: string;
  image: string;
  // Home Assistant
  haUrl: string;
  haToken: string;
}

const defaultForm: SetupForm = {
  deviceType: '', deviceName: '',
  socketPath: '/var/run/docker.sock', defaultImage: 'node:22-alpine',
  host: '', port: '22', username: 'root', privateKey: '',
  namespace: 'default', kubeconfig: '', image: 'node:22-alpine',
  haUrl: '', haToken: '',
};

function DevicesTab() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [setupType, setSetupType] = useState<string | null>(null);
  const [form, setForm] = useState<SetupForm>(defaultForm);
  const [_testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => { fetchDevices(); }, []);

  const fetchDevices = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { devices: DeviceInfo[] };
        setDevices(data.devices);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleDisconnect = async (id: string) => {
    setActionLoading(id);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices/${id}/disconnect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setMessage({ type: 'success', text: 'Device disconnected' });
      fetchDevices();
    } catch {
      setMessage({ type: 'error', text: 'Failed to disconnect device' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (id: string) => {
    setActionLoading(id);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to remove');
      setMessage({ type: 'success', text: 'Device removed' });
      fetchDevices();
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove device' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetup = (typeId: string) => {
    if (SERVER_MANAGED_TYPES.includes(typeId)) {
      setSetupType(typeId);
      setForm({ ...defaultForm, deviceType: typeId, deviceName: '' });
      setTestResult(null);
    }
  };

  const handleRegister = async () => {
    setActionLoading('register');
    setMessage(null);
    const config: Record<string, unknown> = {};
    if (form.deviceType === 'docker') {
      config.socketPath = form.socketPath;
      config.defaultImage = form.defaultImage;
    } else if (form.deviceType === 'ssh') {
      config.host = form.host;
      config.port = parseInt(form.port) || 22;
      config.username = form.username;
      if (form.privateKey) config.privateKey = form.privateKey;
    } else if (form.deviceType === 'k8s') {
      config.namespace = form.namespace;
      config.image = form.image;
      if (form.kubeconfig) config.kubeconfig = form.kubeconfig;
    } else if (form.deviceType === 'homeassistant') {
      config.haUrl = form.haUrl;
      config.haToken = form.haToken;
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: form.deviceName || `${DEVICE_TYPE_LABELS[form.deviceType] || form.deviceType} Device`,
          deviceType: form.deviceType,
          connectionConfig: config,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' })) as { error?: string };
        throw new Error(err.error || 'Registration failed');
      }
      setMessage({ type: 'success', text: 'Device registered' });
      setSetupType(null);
      fetchDevices();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Registration failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleTestConnection = async (deviceId: string) => {
    setActionLoading(`test-${deviceId}`);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/devices/${deviceId}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await res.json() as { ok: boolean; message: string };
      setTestResult(result);
      setMessage({ type: result.ok ? 'success' : 'error', text: result.message });
    } catch {
      setMessage({ type: 'error', text: 'Connection test failed' });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="settings-section">
        <h2>Devices</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2>Devices</h2>
      <p className="settings-section-desc">
        Connect machines and environments so agents can control computers, containers, and hardware.
      </p>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>
            &times;
          </button>
        </div>
      )}

      {/* Quick Start */}
      <div className="settings-quickstart">
        <div className="settings-quickstart-title">Quick Start</div>
        <div className="settings-quickstart-steps">
          <div>1. <code>npm install -g @askalf/agent</code></div>
          <div>2. <code>askalf-agent connect &lt;your-api-key&gt;</code></div>
          <div>3. <code>askalf-agent daemon</code></div>
        </div>
      </div>

      {/* Connected devices */}
      {devices.length > 0 && (
        <div className="settings-intg-category">
          <h3 className="settings-intg-category-label">Connected</h3>
          <div className="settings-intg-grid">
            {devices.map((device) => {
              const typeDef = DEVICE_TYPES.find(dt => dt.id === (device.device_type || 'cli'));
              return (
                <div
                  key={device.id}
                  className="settings-intg-provider-card connected"
                >
                  <span
                    className={`settings-device-dot ${device.status}`}
                  />
                  <div className="settings-intg-provider-body">
                    <div className="settings-intg-provider-name">
                      {typeDef?.icon || ''} {device.device_name}
                      <span style={{ opacity: 0.5, fontSize: '0.8em', marginLeft: '6px' }}>
                        {DEVICE_TYPE_LABELS[device.device_type] || device.device_type || 'CLI'}
                      </span>
                    </div>
                    <div className="settings-intg-provider-desc">
                      {device.os}{device.hostname ? ` \u00B7 ${device.hostname}` : ''} \u00B7 {relativeTime(device.last_seen_at)}
                    </div>
                  </div>
                  <div className="settings-provider-actions">
                    {device.protocol === 'server-managed' && (
                      <button className="settings-btn-sm" onClick={() => handleTestConnection(device.id)} disabled={actionLoading === `test-${device.id}`}>
                        {actionLoading === `test-${device.id}` ? '...' : 'Test'}
                      </button>
                    )}
                    {device.status !== 'offline' && (
                      <button className="settings-btn-sm" onClick={() => handleDisconnect(device.id)} disabled={actionLoading === device.id}>
                        {actionLoading === device.id ? '...' : 'Disconnect'}
                      </button>
                    )}
                    <button className="settings-btn-sm settings-btn-danger" onClick={() => handleRemove(device.id)} disabled={actionLoading === device.id}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All device types by category */}
      {DEVICE_CATEGORIES.map(cat => {
        const types = DEVICE_TYPES.filter(d => d.category === cat.id);
        if (!types.length) return null;
        return (
          <div key={cat.id} className="settings-intg-category">
            <h3 className="settings-intg-category-label">{cat.label}</h3>
            <div className="settings-intg-grid">
              {types.map(dt => {
                const isConnected = devices.some(d => d.device_type === dt.id);
                const isServerManaged = SERVER_MANAGED_TYPES.includes(dt.id);
                return (
                  <div
                    key={dt.id}
                    className={`settings-intg-provider-card${isConnected ? ' connected' : ''}`}
                  >
                    <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{dt.icon}</span>
                    <div className="settings-intg-provider-body">
                      <div className="settings-intg-provider-name">{dt.name}</div>
                      <div className="settings-intg-provider-desc">{dt.description}</div>
                    </div>
                    <div className="settings-intg-provider-action">
                      {isConnected ? (
                        <span className="settings-intg-badge connected">Connected</span>
                      ) : isServerManaged ? (
                        <button className="settings-btn-sm" onClick={() => handleSetup(dt.id)}>
                          Setup
                        </button>
                      ) : (
                        <span className="settings-intg-badge" style={{ opacity: 0.6 }}>
                          {dt.id === 'cli' ? 'Via CLI' : 'Via App'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Setup Dialog for Server-Managed Devices */}
      {setupType && (
        <div className="settings-modal-overlay" onClick={() => setSetupType(null)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Setup {DEVICE_TYPE_LABELS[setupType] || setupType} Device</h3>
              <button className="settings-modal-close" onClick={() => setSetupType(null)}>&times;</button>
            </div>
            <div className="settings-modal-body">
              <label className="settings-field-label">Device Name</label>
              <input
                className="settings-input"
                value={form.deviceName}
                onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
                placeholder={`My ${DEVICE_TYPE_LABELS[setupType]} Device`}
              />

              {setupType === 'docker' && (
                <>
                  <label className="settings-field-label">Docker Socket Path</label>
                  <input
                    className="settings-input"
                    value={form.socketPath}
                    onChange={(e) => setForm({ ...form, socketPath: e.target.value })}
                    placeholder="/var/run/docker.sock"
                  />
                  <label className="settings-field-label">Default Image</label>
                  <input
                    className="settings-input"
                    value={form.defaultImage}
                    onChange={(e) => setForm({ ...form, defaultImage: e.target.value })}
                    placeholder="node:22-alpine"
                  />
                </>
              )}

              {setupType === 'ssh' && (
                <>
                  <label className="settings-field-label">Host</label>
                  <input
                    className="settings-input"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label className="settings-field-label">Username</label>
                      <input
                        className="settings-input"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        placeholder="root"
                      />
                    </div>
                    <div style={{ width: '80px' }}>
                      <label className="settings-field-label">Port</label>
                      <input
                        className="settings-input"
                        value={form.port}
                        onChange={(e) => setForm({ ...form, port: e.target.value })}
                        placeholder="22"
                      />
                    </div>
                  </div>
                  <label className="settings-field-label">Private Key (optional)</label>
                  <textarea
                    className="settings-input"
                    value={form.privateKey}
                    onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={4}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8em' }}
                  />
                </>
              )}

              {setupType === 'k8s' && (
                <>
                  <label className="settings-field-label">Namespace</label>
                  <input
                    className="settings-input"
                    value={form.namespace}
                    onChange={(e) => setForm({ ...form, namespace: e.target.value })}
                    placeholder="default"
                  />
                  <label className="settings-field-label">Job Image</label>
                  <input
                    className="settings-input"
                    value={form.image}
                    onChange={(e) => setForm({ ...form, image: e.target.value })}
                    placeholder="node:22-alpine"
                  />
                  <label className="settings-field-label">Kubeconfig (optional)</label>
                  <textarea
                    className="settings-input"
                    value={form.kubeconfig}
                    onChange={(e) => setForm({ ...form, kubeconfig: e.target.value })}
                    placeholder="Paste kubeconfig YAML (leave empty to use cluster default)"
                    rows={4}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8em' }}
                  />
                </>
              )}

              {setupType === 'homeassistant' && (
                <>
                  <label className="settings-field-label">Home Assistant URL</label>
                  <input
                    className="settings-input"
                    value={form.haUrl}
                    onChange={(e) => setForm({ ...form, haUrl: e.target.value })}
                    placeholder="http://homeassistant.local:8123"
                  />
                  <label className="settings-field-label">Long-Lived Access Token</label>
                  <input
                    className="settings-input"
                    type="password"
                    value={form.haToken}
                    onChange={(e) => setForm({ ...form, haToken: e.target.value })}
                    placeholder="eyJ..."
                  />
                </>
              )}
            </div>
            <div className="settings-modal-footer">
              <button className="settings-btn-sm" onClick={() => setSetupType(null)}>Cancel</button>
              <button
                className="settings-btn-sm settings-btn-primary"
                onClick={handleRegister}
                disabled={actionLoading === 'register'}
              >
                {actionLoading === 'register' ? 'Registering...' : 'Register Device'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Forge API Keys Tab ──

interface ForgeApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

function ForgeApiKeysTab() {
  const [keys, setKeys] = useState<ForgeApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyResult, setNewKeyResult] = useState<{ key: string; name: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchKeys(); }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/api-keys`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { api_keys: ForgeApiKey[] };
        setKeys(data.api_keys);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setSaving(true);
    setMessage(null);
    setNewKeyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create key');
      }
      const data = await res.json() as { key: string; name: string };
      setNewKeyResult({ key: data.key, name: data.name });
      setNewKeyName('');
      setCreating(false);
      fetchKeys();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create key' });
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: string, name: string) => {
    setMessage(null);
    setNewKeyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/api-keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to revoke key');
      setMessage({ type: 'success', text: `"${name}" revoked` });
      fetchKeys();
    } catch {
      setMessage({ type: 'error', text: 'Failed to revoke key' });
    }
  };

  const handleRotate = async (id: string, name: string) => {
    setMessage(null);
    setNewKeyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/api-keys/${id}/rotate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to rotate key');
      const data = await res.json() as { new_key: string };
      setNewKeyResult({ key: data.new_key, name });
      setMessage({ type: 'success', text: `"${name}" rotated. Old key valid for 24 hours.` });
      fetchKeys();
    } catch {
      setMessage({ type: 'error', text: 'Failed to rotate key' });
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setMessage({ type: 'success', text: 'Copied to clipboard' });
  };

  if (loading) {
    return (
      <div className="settings-section">
        <h2>API Keys</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  const activeKeys = keys.filter(k => k.is_active);

  return (
    <div className="settings-section">
      <h2>API Keys</h2>
      <p className="settings-section-desc">
        Generate keys to connect devices, external tools, and custom integrations to your AskAlf fleet.
        Use with <code style={{ fontSize: '.85em', background: 'rgba(124,58,237,.1)', padding: '1px 6px', borderRadius: '4px' }}>askalf-agent connect &lt;key&gt;</code> or the REST API.
      </p>

      {newKeyResult && (
        <div className="settings-message settings-message-success" style={{ wordBreak: 'break-all' }}>
          <div>
            <strong>New key for "{newKeyResult.name}"</strong> — copy it now, it won't be shown again.
            <div style={{ marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '.85em', background: 'rgba(0,0,0,.2)', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }} onClick={() => copyKey(newKeyResult.key)}>
              {newKeyResult.key}
              <span style={{ marginLeft: '8px', opacity: .5, fontSize: '.8em' }}>click to copy</span>
            </div>
          </div>
          <button className="settings-message-dismiss" onClick={() => setNewKeyResult(null)}>&times;</button>
        </div>
      )}

      {message && !newKeyResult && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {creating ? (
        <div className="settings-form" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. my-laptop, ci-runner)"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              style={{ flex: 1 }}
            />
            <button className="settings-save-btn" onClick={handleCreate} disabled={saving || !newKeyName.trim()}>
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button className="settings-btn-sm" onClick={() => { setCreating(false); setNewKeyName(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="settings-save-btn" onClick={() => setCreating(true)} style={{ marginBottom: '16px' }}>
          + Generate New Key
        </button>
      )}

      {activeKeys.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '.9rem' }}>No API keys yet. Generate one to connect devices to your fleet.</p>
      ) : (
        <div className="settings-form">
          {activeKeys.map((k) => (
            <div key={k.id} className="settings-provider-card">
              <div className="settings-provider-header">
                <div className="settings-provider-info">
                  <span className="settings-provider-name">{k.name}</span>
                  <span className="settings-provider-desc" style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em' }}>{k.key_prefix}...</span>
                </div>
                <div className="settings-provider-status">
                  {k.last_used_at && (
                    <span style={{ fontSize: '.75rem', color: 'var(--text-tertiary)' }}>
                      Last used {relativeTime(k.last_used_at)}
                    </span>
                  )}
                  <span className="settings-provider-badge settings-provider-active">Active</span>
                </div>
              </div>
              <div className="settings-provider-actions">
                <button className="settings-btn-sm" onClick={() => handleRotate(k.id, k.name)}>Rotate</button>
                <button className="settings-btn-sm" style={{ color: '#f87171' }} onClick={() => handleRevoke(k.id, k.name)}>Revoke</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Migration Tab — OpenClaw Import Wizard
// ============================================

interface OpenClawConfig {
  gateway?: {
    port?: number;
    bind?: string;
    auth?: { token?: string };
  };
  agents?: Array<{
    id?: string;
    name?: string;
    model?: string;
    provider?: string;
    skills?: string[];
    workspace?: string;
  }>;
  channels?: {
    whatsapp?: Record<string, unknown>;
    telegram?: Record<string, unknown>;
    discord?: Record<string, unknown>;
    slack?: Record<string, unknown>;
    [key: string]: Record<string, unknown> | undefined;
  };
  skills?: string[];
  memory?: {
    path?: string;
  };
}

interface MigrationPreview {
  agents: Array<{ name: string; model: string; provider: string; skills: string[] }>;
  channels: Array<{ type: string; hasCredentials: boolean }>;
  skills: string[];
  gatewayToken: boolean;
  gatewayUrl: string | null;
}

interface MigrationResult {
  success: boolean;
  summary: {
    agents_imported: number;
    channels_imported: number;
    skills_matched: number;
    gateway_stored: boolean;
  };
  errors?: string[];
}

// ============================================
// INFRASTRUCTURE TAB
// ============================================

interface InfraStatus {
  vpn: { enabled: boolean; provider: string | null; type: string | null; countries: string | null; status: string; publicIp: string | null };
  searxng: { enabled: boolean; url: string; vpnRouted: boolean; status: string; engineCount: number | null };
  autoheal: { enabled: boolean; status: string; containersMonitored: number };
  redis: { status: string; memory: string | null };
  postgres: { status: string; size: string | null };
}

function InfrastructureTab() {
  const [infra, setInfra] = useState<InfraStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // VPN config form
  const [vpnProvider, setVpnProvider] = useState('protonvpn');
  const [vpnType, setVpnType] = useState('wireguard');
  const [vpnKey, setVpnKey] = useState('');
  const [vpnCountries, setVpnCountries] = useState('Switzerland');
  const [showVpnConfig, setShowVpnConfig] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/infrastructure/status`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as InfraStatus;
        setInfra(data);
        if (data.vpn.provider) setVpnProvider(data.vpn.provider);
        if (data.vpn.type) setVpnType(data.vpn.type);
        if (data.vpn.countries) setVpnCountries(data.vpn.countries);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const statusColor = (s: string) => s === 'healthy' || s === 'connected' ? '#22c55e' : s === 'error' || s === 'unreachable' ? '#ef4444' : s === 'disabled' ? '#6b7280' : '#f59e0b';
  const statusLabel = (s: string) => s === 'healthy' || s === 'connected' ? 'Healthy' : s === 'error' ? 'Error' : s === 'unreachable' ? 'Unreachable' : s === 'disabled' ? 'Disabled' : 'Unknown';

  const handleSaveVpn = async () => {
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/infrastructure/vpn`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: vpnProvider, vpnType, wireguardKey: vpnKey, countries: vpnCountries, enabled: true }),
      });
      if (res.ok) {
        const data = await res.json() as { message: string; envVars: Record<string, string> };
        setMessage({ type: 'success', text: `${data.message} Add to .env: ${Object.entries(data.envVars).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join(', ')}` });
        setShowVpnConfig(false);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to update VPN config' });
    }
  };

  if (loading) {
    return <div className="settings-section"><h2>Infrastructure</h2><p className="settings-section-desc">Loading...</p></div>;
  }

  return (
    <div className="settings-section">
      <h2>Infrastructure</h2>
      <p className="settings-section-desc">
        System services powering your AskAlf instance — VPN tunneling, search engine, auto-recovery, database, and cache.
      </p>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {/* Service status grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 24 }}>
        {[
          { name: 'PostgreSQL', status: infra?.postgres.status || 'unknown', detail: infra?.postgres.size || 'Database', icon: '\u{1F4BE}' },
          { name: 'Redis', status: infra?.redis.status || 'unknown', detail: 'Cache & Events', icon: '\u{26A1}' },
          { name: 'SearXNG', status: infra?.searxng.status || 'unknown', detail: infra?.searxng.engineCount ? `${infra.searxng.engineCount} engines` : 'Search', icon: '\u{1F50D}' },
          { name: 'Autoheal', status: infra?.autoheal.status || 'unknown', detail: infra?.autoheal.containersMonitored ? `${infra.autoheal.containersMonitored} containers` : 'Recovery', icon: '\u{1F3E5}' },
          { name: 'VPN', status: infra?.vpn.status || 'disabled', detail: infra?.vpn.provider || 'Not configured', icon: '\u{1F510}' },
        ].map(svc => (
          <div key={svc.name} style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, borderLeft: `3px solid ${statusColor(svc.status)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: '1.1rem' }}>{svc.icon}</span>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>{svc.name}</span>
              <span style={{ marginLeft: 'auto', display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor(svc.status) }} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{svc.detail}</div>
            <div style={{ fontSize: '0.7rem', color: statusColor(svc.status), fontWeight: 600, marginTop: 2 }}>{statusLabel(svc.status)}</div>
          </div>
        ))}
      </div>

      {/* VPN Section */}
      <div className="settings-provider-card" style={{ borderLeft: `3px solid ${infra?.vpn.enabled ? '#22c55e' : '#6b7280'}` }}>
        <div className="settings-provider-header">
          <div className="settings-provider-info">
            <span className="settings-provider-name">VPN Tunneling (Gluetun)</span>
            <span className="settings-provider-desc">
              Route all outbound worker traffic through an encrypted VPN tunnel.
              {infra?.vpn.publicIp && <> Current IP: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{infra.vpn.publicIp}</strong></>}
            </span>
          </div>
          <div className="settings-provider-status">
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor(infra?.vpn.status || 'disabled'), marginRight: 6 }} />
            <span className={`settings-provider-badge ${infra?.vpn.enabled ? 'settings-provider-active' : 'settings-provider-inactive'}`}>
              {infra?.vpn.enabled ? (infra?.vpn.provider || 'Enabled') : 'Disabled'}
            </span>
          </div>
        </div>
        {infra?.vpn.enabled && infra?.vpn.countries && (
          <div className="settings-provider-meta">
            Provider: {infra.vpn.provider} &middot; Type: {infra.vpn.type} &middot; Countries: {infra.vpn.countries}
          </div>
        )}
        <div className="settings-provider-actions">
          <button className="settings-btn-sm" onClick={() => setShowVpnConfig(!showVpnConfig)}>
            {showVpnConfig ? 'Cancel' : infra?.vpn.enabled ? 'Reconfigure' : 'Enable VPN'}
          </button>
          {infra?.vpn.enabled && (
            <button className="settings-btn-sm" onClick={fetchStatus}>Check Status</button>
          )}
        </div>

        {showVpnConfig && (
          <div style={{ marginTop: 12, padding: '16px', background: 'var(--elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div className="settings-field">
                <label>VPN Provider</label>
                <select className="settings-input" value={vpnProvider} onChange={e => setVpnProvider(e.target.value)} style={{ fontSize: '0.85rem' }}>
                  <option value="protonvpn">ProtonVPN</option>
                  <option value="mullvad">Mullvad</option>
                  <option value="nordvpn">NordVPN</option>
                  <option value="surfshark">Surfshark</option>
                  <option value="expressvpn">ExpressVPN</option>
                  <option value="windscribe">Windscribe</option>
                  <option value="ivpn">IVPN</option>
                  <option value="airvpn">AirVPN</option>
                  <option value="custom">Custom / Other</option>
                </select>
              </div>
              <div className="settings-field">
                <label>Protocol</label>
                <select className="settings-input" value={vpnType} onChange={e => setVpnType(e.target.value)} style={{ fontSize: '0.85rem' }}>
                  <option value="wireguard">WireGuard</option>
                  <option value="openvpn">OpenVPN</option>
                </select>
              </div>
            </div>
            <div className="settings-field" style={{ marginBottom: 12 }}>
              <label>WireGuard Private Key</label>
              <input type="password" value={vpnKey} onChange={e => setVpnKey(e.target.value)} placeholder="From your VPN provider dashboard" style={{ fontSize: '0.85rem' }} />
            </div>
            <div className="settings-field" style={{ marginBottom: 12 }}>
              <label>Server Countries</label>
              <input type="text" value={vpnCountries} onChange={e => setVpnCountries(e.target.value)} placeholder="Switzerland,Sweden,Netherlands" style={{ fontSize: '0.85rem' }} />
              <p className="settings-field-hint">Comma-separated. Gluetun picks the best server from these countries.</p>
            </div>
            <button className="settings-save-btn" onClick={handleSaveVpn}>Save VPN Config</button>
          </div>
        )}
      </div>

      {/* SearXNG Section */}
      <div className="settings-provider-card" style={{ borderLeft: `3px solid ${statusColor(infra?.searxng.status || 'unknown')}`, marginTop: 10 }}>
        <div className="settings-provider-header">
          <div className="settings-provider-info">
            <span className="settings-provider-name">SearXNG Search Engine</span>
            <span className="settings-provider-desc">Self-hosted meta search — aggregates Google, Bing, DuckDuckGo, and {infra?.searxng.engineCount ? `${infra.searxng.engineCount - 3}+ more` : 'many more'} engines</span>
          </div>
          <div className="settings-provider-status" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {infra?.searxng.vpnRouted && (
              <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>VPN Routed</span>
            )}
            <span className={`settings-provider-badge ${infra?.searxng.status === 'healthy' ? 'settings-provider-active' : 'settings-provider-inactive'}`}>
              {infra?.searxng.engineCount ? `${infra.searxng.engineCount} engines` : statusLabel(infra?.searxng.status || 'unknown')}
            </span>
          </div>
        </div>
      </div>

      {/* Autoheal Section */}
      <div className="settings-provider-card" style={{ borderLeft: `3px solid ${statusColor(infra?.autoheal.status || 'unknown')}`, marginTop: 10 }}>
        <div className="settings-provider-header">
          <div className="settings-provider-info">
            <span className="settings-provider-name">Autoheal</span>
            <span className="settings-provider-desc">Automatic container recovery — restarts failed containers when health checks fail</span>
          </div>
          <div className="settings-provider-status">
            <span className={`settings-provider-badge ${infra?.autoheal.status === 'healthy' ? 'settings-provider-active' : 'settings-provider-inactive'}`}>
              {infra?.autoheal.containersMonitored ? `${infra.autoheal.containersMonitored} monitored` : statusLabel(infra?.autoheal.status || 'unknown')}
            </span>
          </div>
        </div>
      </div>

      {/* Database & Cache */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div className="settings-provider-card" style={{ borderLeft: `3px solid ${statusColor(infra?.postgres.status || 'unknown')}` }}>
          <div className="settings-provider-header">
            <div className="settings-provider-info">
              <span className="settings-provider-name">PostgreSQL + pgvector</span>
              <span className="settings-provider-desc">{infra?.postgres.size || 'Database'} &middot; Semantic vector search</span>
            </div>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor(infra?.postgres.status || 'unknown') }} />
          </div>
        </div>
        <div className="settings-provider-card" style={{ borderLeft: `3px solid ${statusColor(infra?.redis.status || 'unknown')}` }}>
          <div className="settings-provider-header">
            <div className="settings-provider-info">
              <span className="settings-provider-name">Redis</span>
              <span className="settings-provider-desc">Event bus, cache, pub/sub</span>
            </div>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor(infra?.redis.status || 'unknown') }} />
          </div>
        </div>
      </div>

      {/* Ollama Management */}
      <OllamaManager />
    </div>
  );
}

function OllamaManager() {
  const [data, setData] = useState<{ connected: boolean; url: string; models: Array<{ name: string; size: string | null; parameterSize: string | null; quantization: string | null; family: string | null }>; version: string | null; error: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pullModel, setPullModel] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchOllama = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/infrastructure/ollama`, { credentials: 'include' });
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchOllama(); }, [fetchOllama]);

  const handlePull = async () => {
    if (!pullModel.trim()) return;
    setPulling(true);
    setPullMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/infrastructure/ollama/pull`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: pullModel.trim() }),
      });
      if (res.ok) {
        setPullMsg({ type: 'success', text: `Pulled ${pullModel.trim()}` });
        setPullModel('');
        fetchOllama();
      } else {
        const err = await res.json().catch(() => ({ error: 'Pull failed' })) as { error?: string };
        setPullMsg({ type: 'error', text: err.error || 'Pull failed' });
      }
    } catch {
      setPullMsg({ type: 'error', text: 'Network error' });
    }
    setPulling(false);
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/infrastructure/ollama/models/${encodeURIComponent(name)}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (res.ok) fetchOllama();
    } catch { /* ignore */ }
  };

  if (loading) return null;
  if (!data) return null;

  const popularModels = ['llama3:8b', 'llama3:70b', 'mistral:7b', 'mixtral:8x7b', 'codellama:13b', 'phi3:mini', 'qwen2:7b', 'gemma2:9b'];

  return (
    <div style={{ marginTop: 16 }}>
      <div className="settings-provider-card" style={{ borderLeft: `3px solid ${data.connected ? '#22c55e' : '#6b7280'}` }}>
        <div className="settings-provider-header">
          <div className="settings-provider-info">
            <span className="settings-provider-name">Ollama — Local Models</span>
            <span className="settings-provider-desc">
              {data.connected ? `Connected to ${data.url}` : `Not connected (${data.url})`}
              {data.version && ` — v${data.version}`}
            </span>
          </div>
          <div className="settings-provider-status">
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: data.connected ? '#22c55e' : '#6b7280', marginRight: 6 }} />
            <span className={`settings-provider-badge ${data.connected ? 'settings-provider-active' : 'settings-provider-inactive'}`}>
              {data.connected ? `${data.models.length} models` : 'Offline'}
            </span>
          </div>
        </div>

        {data.connected && (
          <>
            {/* Pull model */}
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <input value={pullModel} onChange={e => setPullModel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handlePull(); }}
                placeholder="Model name (e.g., llama3:8b)"
                style={{ flex: 1, padding: '8px 12px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }} />
              <button onClick={handlePull} disabled={pulling || !pullModel.trim()}
                style={{ padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: !pullModel.trim() ? 0.4 : 1 }}>
                {pulling ? 'Pulling...' : 'Pull Model'}
              </button>
            </div>

            {/* Quick pull chips */}
            {!pullModel && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {popularModels.filter(m => !data.models.some(dm => dm.name === m)).map(m => (
                  <button key={m} onClick={() => setPullModel(m)}
                    style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 12, color: '#a78bfa', cursor: 'pointer' }}>
                    {m}
                  </button>
                ))}
              </div>
            )}

            {pullMsg && (
              <div style={{ marginTop: 6, fontSize: '0.8rem', color: pullMsg.type === 'success' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{pullMsg.text}</div>
            )}

            {/* Installed models */}
            {data.models.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Installed Models</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.models.map(m => (
                    <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', flex: 1, fontFamily: 'var(--font-mono)' }}>{m.name}</span>
                      {m.parameterSize && <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(124,58,237,0.08)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.15)' }}>{m.parameterSize}</span>}
                      {m.quantization && <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.15)' }}>{m.quantization}</span>}
                      {m.size && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.size}</span>}
                      <button onClick={() => handleDelete(m.name)}
                        style={{ padding: '3px 8px', fontSize: '0.65rem', background: 'transparent', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', opacity: 0.6 }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!data.connected && (
          <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Install Ollama at <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed' }}>ollama.com</a>, then set <code style={{ background: 'var(--elevated)', padding: '2px 6px', borderRadius: 4 }}>OLLAMA_BASE_URL=http://host.docker.internal:11434</code> in your .env file.
          </div>
        )}
      </div>
    </div>
  );
}

function MigrationTab() {
  const [configText, setConfigText] = useState('');
  const [filePath, setFilePath] = useState('');
  const [inputMode, setInputMode] = useState<'upload' | 'path'>('upload');
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const parseConfig = (text: string) => {
    setParseError(null);
    setPreview(null);
    setResult(null);
    setMessage(null);

    if (!text.trim()) return;

    try {
      const config: OpenClawConfig = JSON.parse(text);

      const agents = (config.agents ?? []).map(a => ({
        name: a.name ?? a.id ?? 'unnamed',
        model: a.model ?? 'unknown',
        provider: a.provider ?? 'unknown',
        skills: a.skills ?? [],
      }));

      const channels: MigrationPreview['channels'] = [];
      if (config.channels) {
        for (const [type, creds] of Object.entries(config.channels)) {
          if (creds && typeof creds === 'object' && Object.keys(creds).length > 0) {
            channels.push({ type, hasCredentials: true });
          }
        }
      }

      const skills = config.skills ?? [];
      const gatewayToken = !!config.gateway?.auth?.token;
      const gatewayBind = config.gateway?.bind ?? 'localhost';
      const gatewayPort = config.gateway?.port;
      const gatewayUrl = gatewayPort ? `http://${gatewayBind}:${gatewayPort}` : null;

      setPreview({ agents, channels, skills, gatewayToken, gatewayUrl });
      setConfigText(text);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setConfigText(text);
      parseConfig(text);
    };
    reader.onerror = () => setParseError('Failed to read file');
    reader.readAsText(file);
  };

  const handlePathLoad = async () => {
    if (!filePath.trim()) return;
    setParseError(null);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/migrate/openclaw/read-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: filePath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to read file' })) as { error?: string };
        setParseError(err.error ?? `Failed to read file (${res.status})`);
        return;
      }
      const data = await res.json() as { content: string };
      setConfigText(data.content);
      parseConfig(data.content);
    } catch {
      setParseError('Network error reading config file');
    }
  };

  const handleImport = async () => {
    if (!configText) return;
    setImporting(true);
    setMessage(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/migrate/openclaw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config: JSON.parse(configText) }),
      });
      const data = await res.json() as MigrationResult;
      setResult(data);
      if (data.success) {
        setMessage({ type: 'success', text: 'OpenClaw configuration imported successfully.' });
      } else {
        setMessage({ type: 'error', text: data.errors?.join('; ') ?? 'Import failed' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import request failed' });
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setConfigText('');
    setFilePath('');
    setPreview(null);
    setParseError(null);
    setResult(null);
    setMessage(null);
  };

  return (
    <div className="settings-section">
      <h2>Migration</h2>
      <p className="settings-section-desc">
        Import your OpenClaw configuration into AskAlf. Upload your <code>openclaw.json</code> or provide its file path to migrate agents, channels, skills, and gateway settings.
      </p>

      {/* Input mode toggle */}
      {!preview && !result && (
        <div className="migration-input-area">
          <div className="migration-mode-toggle">
            <button
              className={`migration-mode-btn ${inputMode === 'upload' ? 'active' : ''}`}
              onClick={() => setInputMode('upload')}
            >
              Upload File
            </button>
            <button
              className={`migration-mode-btn ${inputMode === 'path' ? 'active' : ''}`}
              onClick={() => setInputMode('path')}
            >
              File Path
            </button>
          </div>

          {inputMode === 'upload' ? (
            <div className="migration-upload-zone">
              <label className="migration-file-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17,8 12,3 7,8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Choose <code>openclaw.json</code> or drop it here</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          ) : (
            <div className="migration-path-input">
              <div className="settings-field">
                <label>Path to openclaw.json</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="~/.openclaw/openclaw.json"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePathLoad()}
                  />
                  <button className="settings-save-btn" onClick={handlePathLoad}>
                    Load
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Paste JSON fallback */}
          <div className="migration-paste-area">
            <div className="settings-field">
              <label>Or paste JSON directly</label>
              <textarea
                className="migration-textarea"
                placeholder='{"gateway": {...}, "agents": [...], "channels": {...}}'
                rows={6}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
              />
            </div>
            <button
              className="settings-save-btn"
              onClick={() => parseConfig(configText)}
              disabled={!configText.trim()}
            >
              Parse Config
            </button>
          </div>
        </div>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="settings-error" style={{ marginBottom: '16px' }}>
          <strong>Parse Error:</strong> {parseError}
        </div>
      )}

      {/* Preview */}
      {preview && !result && (
        <div className="migration-preview">
          <h3>Import Preview</h3>
          <div className="migration-preview-grid">
            {/* Agents */}
            <div className="migration-preview-card">
              <div className="migration-preview-card-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span className="migration-preview-card-title">Agents</span>
                <span className="migration-preview-badge">{preview.agents.length}</span>
              </div>
              {preview.agents.length > 0 ? (
                <ul className="migration-preview-list">
                  {preview.agents.map((a, i) => (
                    <li key={i}>
                      <strong>{a.name}</strong>
                      <span className="migration-preview-meta">{a.provider}/{a.model}</span>
                      {a.skills.length > 0 && (
                        <span className="migration-preview-meta">{a.skills.length} skill{a.skills.length > 1 ? 's' : ''}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="migration-preview-empty">No agents found</p>
              )}
            </div>

            {/* Channels */}
            <div className="migration-preview-card">
              <div className="migration-preview-card-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
                <span className="migration-preview-card-title">Channels</span>
                <span className="migration-preview-badge">{preview.channels.length}</span>
              </div>
              {preview.channels.length > 0 ? (
                <ul className="migration-preview-list">
                  {preview.channels.map((ch, i) => (
                    <li key={i}>
                      <strong>{ch.type}</strong>
                      {ch.hasCredentials && <span className="migration-preview-tag">credentials</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="migration-preview-empty">No channels configured</p>
              )}
            </div>

            {/* Skills */}
            <div className="migration-preview-card">
              <div className="migration-preview-card-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span className="migration-preview-card-title">Skills</span>
                <span className="migration-preview-badge">{preview.skills.length}</span>
              </div>
              {preview.skills.length > 0 ? (
                <ul className="migration-preview-list">
                  {preview.skills.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="migration-preview-empty">No skills listed</p>
              )}
            </div>

            {/* Gateway */}
            <div className="migration-preview-card">
              <div className="migration-preview-card-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                  <line x1="6" y1="6" x2="6.01" y2="6" />
                  <line x1="6" y1="18" x2="6.01" y2="18" />
                </svg>
                <span className="migration-preview-card-title">Gateway</span>
              </div>
              <ul className="migration-preview-list">
                <li>
                  <strong>URL:</strong> {preview.gatewayUrl ?? 'Not configured'}
                </li>
                <li>
                  <strong>Auth Token:</strong> {preview.gatewayToken ? 'Present' : 'Not set'}
                </li>
              </ul>
            </div>
          </div>

          {/* Actions */}
          <div className="migration-actions">
            <button
              className="settings-save-btn"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Import to AskAlf'}
            </button>
            <button className="settings-btn-sm" onClick={handleReset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="migration-result">
          {message && (
            <div className={`migration-result-banner ${message.type}`}>
              {message.type === 'success' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22,4 12,14.01 9,11.01" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              <span>{message.text}</span>
            </div>
          )}

          {result.summary && (
            <div className="migration-summary-grid">
              <div className="migration-summary-item">
                <span className="migration-summary-count">{result.summary.agents_imported}</span>
                <span className="migration-summary-label">Agents Imported</span>
              </div>
              <div className="migration-summary-item">
                <span className="migration-summary-count">{result.summary.channels_imported}</span>
                <span className="migration-summary-label">Channels Imported</span>
              </div>
              <div className="migration-summary-item">
                <span className="migration-summary-count">{result.summary.skills_matched}</span>
                <span className="migration-summary-label">Skills Matched</span>
              </div>
              <div className="migration-summary-item">
                <span className="migration-summary-count">{result.summary.gateway_stored ? 'Yes' : 'No'}</span>
                <span className="migration-summary-label">Gateway Stored</span>
              </div>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="settings-error" style={{ marginTop: '16px' }}>
              <strong>Warnings:</strong>
              <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="migration-actions" style={{ marginTop: '20px' }}>
            <button className="settings-save-btn" onClick={handleReset}>
              Import Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// PREFERENCES TAB — Alf Learns Your Style
// ============================================

interface UserPreference {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  created_at: string;
}

function PreferencesTab() {
  const [prefs, setPrefs] = useState<UserPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState('general');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/preferences`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { preferences: UserPreference[] };
        setPrefs(data.preferences ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/v1/forge/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory, key: newKey.trim(), value: newValue.trim() }),
      });
      setNewKey('');
      setNewValue('');
      await fetchPrefs();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE}/api/v1/forge/preferences/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
    setPrefs(p => p.filter(x => x.id !== id));
  };

  const categories = [...new Set(prefs.map(p => p.category))];

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Alf Learns Your Style</h2>
        <p className="settings-section-desc">
          Alf remembers your preferences and applies them to every task. Explicit preferences
          (set by you) always override observed ones (learned from your behavior).
        </p>
      </div>

      <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text)' }}>
          Teach Alf a preference
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '8px', alignItems: 'end' }}>
          <div>
            <label className="settings-label" style={{ fontSize: '0.7rem' }}>Category</label>
            <select className="settings-input" value={newCategory} onChange={e => setNewCategory(e.target.value)} style={{ fontSize: '0.8rem' }}>
              <option value="general">General</option>
              <option value="communication">Communication</option>
              <option value="tone">Tone & Voice</option>
              <option value="model">AI Model</option>
              <option value="schedule">Schedule & Timing</option>
              <option value="budget">Budget & Spending</option>
              <option value="content">Content & Writing</option>
              <option value="brand">Brand & Identity</option>
              <option value="workflow">Workflow & Process</option>
              <option value="notifications">Notifications</option>
              <option value="privacy">Privacy & Data</option>
              <option value="coding_style">Coding Style</option>
            </select>
          </div>
          <div>
            <label className="settings-label" style={{ fontSize: '0.7rem' }}>Preference</label>
            <input className="settings-input" value={newKey} onChange={e => setNewKey(e.target.value)}
              placeholder="e.g. language, timezone, format" style={{ fontSize: '0.8rem' }} />
          </div>
          <div>
            <label className="settings-label" style={{ fontSize: '0.7rem' }}>Value</label>
            <input className="settings-input" value={newValue} onChange={e => setNewValue(e.target.value)}
              placeholder="e.g. English, America/New_York, bullet points" style={{ fontSize: '0.8rem' }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} />
          </div>
          <button className="settings-btn-primary" onClick={handleAdd} disabled={saving || !newKey.trim() || !newValue.trim()}
            style={{ fontSize: '0.8rem', padding: '8px 16px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading preferences...</div>
      ) : prefs.length === 0 ? (
        <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          No preferences yet. Alf will learn your style as you use the platform, or teach Alf directly above.
        </div>
      ) : (
        categories.map(cat => (
          <div key={cat} style={{ marginBottom: '1rem' }}>
            <h4 style={{
              fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-muted)', marginBottom: '8px', paddingLeft: '2px',
            }}>
              {cat}
            </h4>
            {prefs.filter(p => p.category === cat).map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '8px', marginBottom: '4px', fontSize: '0.82rem',
              }}>
                <span style={{ fontWeight: 600, color: 'var(--text)', minWidth: '140px' }}>{p.key}</span>
                <span style={{ flex: 1, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{p.value}</span>
                <span style={{
                  fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                  background: p.source === 'explicit' ? 'rgba(124,58,237,0.12)' : 'rgba(16,185,129,0.12)',
                  color: p.source === 'explicit' ? '#a78bfa' : '#10b981',
                }}>
                  {p.source === 'explicit' ? 'you set this' : 'learned'}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {Math.round(p.confidence * 100)}%
                </span>
                <button onClick={() => handleDelete(p.id)} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.9rem', padding: '2px 6px',
                }} title="Remove">
                  &times;
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
