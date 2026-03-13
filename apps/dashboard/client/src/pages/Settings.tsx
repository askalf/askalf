import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { relativeTime } from '../utils/format';
import './Settings.css';

type SettingsTab = 'profile' | 'appearance' | 'security' | 'ai-keys' | 'costs' | 'integrations' | 'channels' | 'devices';

const VALID_TABS: SettingsTab[] = ['profile', 'appearance', 'security', 'ai-keys', 'costs', 'integrations', 'channels', 'devices'];

export default function SettingsPage({ embedded }: { embedded?: boolean }) {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'profile';
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    VALID_TABS.includes(initialTab) ? initialTab : 'profile'
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

      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Appearance
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Security
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'ai-keys' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai-keys')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            AI Keys
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
        </nav>

        <div className="settings-content">
          {activeTab === 'profile' && <ProfileTab user={user} />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'ai-keys' && <AIKeysTab />}
          {activeTab === 'costs' && <CostControlsTab />}
          {activeTab === 'integrations' && <IntegrationsTab />}
          {activeTab === 'channels' && <ChannelsTab />}
          {activeTab === 'devices' && <DevicesTab />}
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
  const [email] = useState(user?.email || '');
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

        <div className="settings-field">
          <label>Email Address</label>
          <input
            type="email"
            value={email}
            disabled
            className="settings-input-disabled"
          />
          <p className="settings-field-hint">Contact support to change your email</p>
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

function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);



  const handleChangePassword = async () => {
    setError('');
    setPwSuccess(false);

    if (!currentPassword) {
      setError('Current password is required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setError('Password must contain at least one lowercase letter');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError('Password must contain at least one number');
      return;
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
      setError('Password must contain at least one special character');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to change password');
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setPwSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h2>Security</h2>
      <p className="settings-section-desc">
        Manage your password and security settings
      </p>

      <div className="settings-form">
        <h3>Change Password</h3>

        {pwSuccess && (
          <div className="settings-message settings-message-success">
            Password changed successfully
            <button className="settings-message-dismiss" onClick={() => setPwSuccess(false)}>&times;</button>
          </div>
        )}

        {error && (
          <div className="settings-error">{error}</div>
        )}

        <div className="settings-field">
          <label>Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
          />
        </div>

        <div className="settings-field">
          <label>New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
          />
          <p className="settings-field-hint">
            Min 12 characters with uppercase, lowercase, number, and special character
          </p>
        </div>

        <div className="settings-field">
          <label>Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
        </div>

        <button
          className="settings-save-btn"
          onClick={handleChangePassword}
          disabled={isSaving || !currentPassword || !newPassword}
        >
          {isSaving ? 'Updating...' : 'Update Password'}
        </button>

      </div>


    </div>
  );
}

// ============================================
// AI Provider Keys Tab (BYOK)
// ============================================

interface ProviderKeyInfo {
  provider_type: string;
  has_key: boolean;
  key_hint: string | null;
  label: string | null;
  is_active: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
}

const AI_PROVIDERS = [
  { type: 'anthropic', name: 'Anthropic', desc: 'Claude models', prefix: 'sk-ant-' },
  { type: 'openai', name: 'OpenAI', desc: 'GPT models', prefix: 'sk-' },
  { type: 'xai', name: 'xAI', desc: 'Grok models', prefix: '' },
  { type: 'deepseek', name: 'DeepSeek', desc: 'DeepSeek models', prefix: '' },
];

function AIKeysTab() {
  const [keys, setKeys] = useState<ProviderKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, 'success' | 'error'>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { fetchKeys(); }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/user-providers`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { keys: ProviderKeyInfo[] };
        setKeys(data.keys);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

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
      fetchKeys();
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
      fetchKeys();
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
        fetchKeys();
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

  const getKeyInfo = (type: string) => keys.find((k) => k.provider_type === type);

  if (loading) {
    return (
      <div className="settings-section">
        <h2>AI Provider Keys</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2>AI Provider Keys</h2>
      <p className="settings-section-desc">
        Add your own API keys to power agent executions. Your keys are encrypted at rest
        and only used when you run agents.
      </p>

      <div className="settings-oauth-banner">
        <div className="settings-oauth-banner-icon">🔗</div>
        <div className="settings-oauth-banner-content">
          <span className="settings-oauth-banner-title">OAuth Connect</span>
          <span className="settings-oauth-banner-desc">
            Import your Anthropic OAuth token via the Terminal tab — run <code>/connect</code> for instructions.
          </span>
        </div>
        <span className="settings-oauth-banner-badge" style={{ background: '#059669' }}>Available</span>
      </div>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>
            &times;
          </button>
        </div>
      )}

      <div className="settings-form">
        {AI_PROVIDERS.map((provider) => {
          const info = getKeyInfo(provider.type);
          const isEditing = editingProvider === provider.type;

          return (
            <div key={provider.type} className="settings-provider-card">
              <div className="settings-provider-header">
                <div className="settings-provider-info">
                  <span className="settings-provider-name">{provider.name}</span>
                  <span className="settings-provider-desc">{provider.desc}</span>
                </div>
                <div className="settings-provider-status">
                  {info ? (
                    <>
                      <span className="settings-provider-hint">{info.key_hint}</span>
                      <span className="settings-provider-badge settings-provider-active">Connected</span>
                    </>
                  ) : (
                    <span className="settings-provider-badge settings-provider-inactive">Not set</span>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="settings-provider-edit">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={provider.prefix ? `${provider.prefix}...` : 'Paste your API key'}
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
                    {info ? 'Update Key' : 'Add Key'}
                  </button>
                  {info && (
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
                          {verifyResults[provider.type] === 'success' ? '✓' : '✗'}
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

              {info?.last_verified_at && (
                <div className="settings-provider-meta">
                  Last verified: {new Date(info.last_verified_at).toLocaleDateString()}
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
  { id: 'cloud', label: 'Cloud & Infrastructure' },
  { id: 'cicd', label: 'CI/CD & Deploy' },
  { id: 'pm', label: 'Project Management' },
  { id: 'monitoring', label: 'Monitoring & Observability' },
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

interface AgentCostRow { agentId: string; agentName: string; totalCost: number; totalEvents: number }
interface GuardrailRow { id: string; name: string; type: string; config: Record<string, unknown>; is_enabled: boolean; is_global: boolean; agent_ids: string[] }

function CostControlsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dailyLimit, setDailyLimit] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [spentToday, setSpentToday] = useState(0);
  const [spentThisMonth, setSpentThisMonth] = useState(0);
  const [agentCosts, setAgentCosts] = useState<AgentCostRow[]>([]);
  const [costGuardrails, setCostGuardrails] = useState<GuardrailRow[]>([]);

  useEffect(() => {
    fetchBudget();
    fetchCostBreakdown();
    fetchGuardrails();
  }, []);

  const fetchBudget = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/forge/user-budget`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as BudgetData;
        setDailyLimit(data.budgetLimitDaily !== null ? String(data.budgetLimitDaily) : '');
        setMonthlyLimit(data.budgetLimitMonthly !== null ? String(data.budgetLimitMonthly) : '');
        setSpentToday(data.spentToday);
        setSpentThisMonth(data.spentThisMonth);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchCostBreakdown = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/costs?days=1`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { byAgent?: AgentCostRow[] };
        if (data.byAgent) setAgentCosts(data.byAgent.sort((a, b) => b.totalCost - a.totalCost));
      }
    } catch { /* ignore */ }
  };

  const fetchGuardrails = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/guardrails`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { guardrails?: GuardrailRow[] };
        if (data.guardrails) setCostGuardrails(data.guardrails.filter(g => g.type === 'cost_limit'));
      }
    } catch { /* ignore */ }
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

  const dailyPct = dailyLimit.trim() ? Math.min((spentToday / parseFloat(dailyLimit)) * 100, 100) : 0;
  const monthlyPct = monthlyLimit.trim() ? Math.min((spentThisMonth / parseFloat(monthlyLimit)) * 100, 100) : 0;

  if (loading) {
    return (
      <div className="settings-section">
        <h2>Cost Controls</h2>
        <p className="settings-section-desc">Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2>Cost Controls</h2>
      <p className="settings-section-desc">
        Set spending limits to prevent unexpected costs. Agents are blocked when limits are reached.
      </p>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
          <button className="settings-message-dismiss" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {/* Current spend summary */}
      <div className="settings-spend-grid">
        <div className="settings-spend-card">
          <div className="settings-spend-label">Spent Today</div>
          <div className="settings-spend-amount">${spentToday.toFixed(4)}</div>
          {dailyLimit.trim() && (
            <div>
              <div className="settings-spend-bar-track">
                <div
                  className="settings-spend-bar-fill"
                  style={{
                    width: `${dailyPct}%`,
                    background: dailyPct >= 90 ? '#ef4444' : dailyPct >= 70 ? '#f59e0b' : '#10b981',
                  }}
                />
              </div>
              <div className="settings-spend-bar-label">
                {dailyPct.toFixed(0)}% of ${parseFloat(dailyLimit).toFixed(2)} daily limit
              </div>
            </div>
          )}
        </div>
        <div className="settings-spend-card">
          <div className="settings-spend-label">Spent This Month</div>
          <div className="settings-spend-amount">${spentThisMonth.toFixed(4)}</div>
          {monthlyLimit.trim() && (
            <div>
              <div className="settings-spend-bar-track">
                <div
                  className="settings-spend-bar-fill"
                  style={{
                    width: `${monthlyPct}%`,
                    background: monthlyPct >= 90 ? '#ef4444' : monthlyPct >= 70 ? '#f59e0b' : '#10b981',
                  }}
                />
              </div>
              <div className="settings-spend-bar-label">
                {monthlyPct.toFixed(0)}% of ${parseFloat(monthlyLimit).toFixed(2)} monthly limit
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-form">
        <div className="settings-field">
          <label>Daily Budget Limit (USD)</label>
          <input
            type="number"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="No limit"
            min="0"
            step="0.5"
          />
          <p className="settings-field-hint">
            Maximum spending per day across all agents. Leave empty for no limit.
          </p>
        </div>

        <div className="settings-field">
          <label>Monthly Budget Limit (USD)</label>
          <input
            type="number"
            value={monthlyLimit}
            onChange={(e) => setMonthlyLimit(e.target.value)}
            placeholder="No limit"
            min="0"
            step="1"
          />
          <p className="settings-field-hint">
            Maximum spending per calendar month. Leave empty for no limit.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <button
            className="settings-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Limits'}
          </button>
          {(dailyLimit.trim() || monthlyLimit.trim()) && (
            <button
              className="settings-btn-sm"
              onClick={handleClear}
              disabled={saving}
            >
              Remove Limits
            </button>
          )}
        </div>
      </div>

      {/* Agent cost breakdown (today) */}
      {agentCosts.length > 0 && (
        <div className="settings-cost-info" style={{ marginTop: 'var(--space-lg)' }}>
          <div className="settings-cost-info-title">Agent Cost Breakdown (Today)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {agentCosts.map(ac => (
              <div key={ac.agentId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 500 }}>{ac.agentName || ac.agentId}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                  ${ac.totalCost.toFixed(4)} <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({ac.totalEvents} calls)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active cost guardrails */}
      {costGuardrails.length > 0 && (
        <div className="settings-cost-info" style={{ marginTop: 'var(--space-lg)' }}>
          <div className="settings-cost-info-title">Active Cost Guardrails</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {costGuardrails.map(g => (
              <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span style={{ fontWeight: 500 }}>{g.name}</span>
                  <span style={{ marginLeft: '8px', fontSize: '11px', color: g.is_enabled ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {g.is_enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
                  {g.config.maxCostPerDay ? `$${g.config.maxCostPerDay}/day` : ''}
                  {g.config.maxCostPerExecution ? ` $${g.config.maxCostPerExecution}/exec` : ''}
                  {g.is_global ? ' (global)' : ` (${g.agent_ids.length} agent${g.agent_ids.length !== 1 ? 's' : ''})`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="settings-cost-info">
        <div className="settings-cost-info-title">How cost controls work</div>
        <ul>
          <li>Each agent execution has a per-execution limit (default $1, set per agent)</li>
          <li>Daily and monthly limits apply across all your agents combined</li>
          <li>When a limit is reached, new executions are blocked until the period resets</li>
          <li>Cost tracking resets daily at midnight UTC and monthly on the 1st</li>
          <li>Cost guardrails provide per-agent and global enforcement rules</li>
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
    description: 'Agents respond directly in your Slack channels.',
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
    description: 'Slash commands that dispatch agent tasks.',
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

function ChannelsTab() {
  const [configs, setConfigs] = useState<Record<string, { id?: string; webhookUrl?: string; isActive?: boolean }>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [chMsg, setChMsg] = useState<{ type: string; channel: string; text: string } | null>(null);

  useEffect(() => {
    loadConfigs();
  }, []);

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
      const res = await fetch(`${API_BASE}/api/v1/forge/channels/configs/${configId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setChMsg({ type: 'error', channel: channelType, text: `Test request failed: ${res.status}` });
        return;
      }
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      setChMsg({ type: data.success ? 'success' : 'error', channel: channelType, text: data.message ?? data.error ?? (data.success ? 'Test passed' : 'Test failed') });
    } catch (err) {
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
        setChMsg({ type: 'success', channel: channelType, text: 'Disconnected' });
      } else {
        setChMsg({ type: 'error', channel: channelType, text: `Disconnect failed: ${res.status}` });
      }
    } catch {
      setChMsg({ type: 'error', channel: channelType, text: 'Disconnect failed' });
    }
  };

  const updateForm = (channelType: string, key: string, value: string) => {
    setForms(prev => ({ ...prev, [channelType]: { ...(prev[channelType] ?? {}), [key]: value } }));
  };

  // Channels with fields are "wired" (configurable now)
  const wiredChannels = new Set(['slack', 'discord', 'telegram', 'whatsapp', 'webhooks', 'teams', 'zapier', 'n8n', 'make', 'email', 'twilio', 'sendgrid', 'twilio_voice', 'zoom']);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  return (
    <div className="settings-section">
      <h2>Channels</h2>
      <p className="settings-section-desc">
        Connect platforms so your agents can receive messages and respond anywhere.
      </p>

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
                const isWired = wiredChannels.has(ch.type);
                const isExpanded = expandedChannel === ch.type;
                const msg = chMsg?.channel === ch.type ? chMsg : null;

                return (
                  <div
                    key={ch.type}
                    className={`settings-intg-provider-card settings-channel-card${isConnected ? ' connected' : ''}${!isWired ? ' upcoming' : ''}`}
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
                      <div className="settings-intg-provider-action">
                        {isConnected ? (
                          <span className="settings-intg-badge connected">Connected</span>
                        ) : ch.type === 'api' ? (
                          <span className="settings-intg-badge connected">Built-in</span>
                        ) : (
                          <span className="settings-intg-badge upcoming">Configure</span>
                        )}
                      </div>
                    </div>

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
          <div className="settings-intg-grid" style={{ gridTemplateColumns: '1fr' }}>
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
                    style={{ fontFamily: 'monospace', fontSize: '0.8em' }}
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
                    style={{ fontFamily: 'monospace', fontSize: '0.8em' }}
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
