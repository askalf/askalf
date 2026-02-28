import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import './Settings.css';

type SettingsTab = 'profile' | 'appearance' | 'security' | 'ai-keys' | 'integrations';

const VALID_TABS: SettingsTab[] = ['profile', 'appearance', 'security', 'ai-keys', 'integrations'];

export default function SettingsPage() {
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
            className={`settings-nav-item ${activeTab === 'integrations' ? 'active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Integrations
          </button>
        </nav>

        <div className="settings-content">
          {activeTab === 'profile' && <ProfileTab user={user} />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'ai-keys' && <AIKeysTab />}
          {activeTab === 'integrations' && <IntegrationsTab />}
        </div>
      </div>
    </div>
  );
}

// Determine API base URL based on current hostname
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  return '';
};

const API_BASE = getApiUrl();

interface ProfileUser {
  email: string;
  displayName?: string;
  preferredName?: string;
}

function ProfileTab({ user }: { user: ProfileUser | null }) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [preferredName, setPreferredName] = useState(user?.preferredName || '');
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
          name: displayName,
          preferredName: preferredName
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      // Refresh auth state to get updated user data
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
          <label>Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
          <p className="settings-field-hint">Shown in the UI and your profile</p>
        </div>

        <div className="settings-field">
          <label>Preferred Name</label>
          <input
            type="text"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            placeholder="What should we call you?"
          />
          <p className="settings-field-hint">Used in personalized interactions</p>
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

  const handleChangePassword = async () => {
    setError('');

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
      alert('Password changed successfully');
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

        <div className="settings-mfa-section">
          <h3>Multi-Factor Authentication</h3>
          <div className="settings-mfa-options">
            <div className="settings-mfa-option">
              <div className="settings-mfa-info">
                <span className="settings-mfa-name">Authenticator App (TOTP)</span>
                <span className="settings-mfa-desc">Use an app like Google Authenticator or Authy</span>
              </div>
              <span className="settings-coming-soon-badge">Coming Soon</span>
            </div>
            <div className="settings-mfa-option">
              <div className="settings-mfa-info">
                <span className="settings-mfa-name">Passkey / WebAuthn</span>
                <span className="settings-mfa-desc">Sign in with fingerprint, face, or hardware key</span>
              </div>
              <span className="settings-coming-soon-badge">Coming Soon</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-danger-zone">
        <h3>Danger Zone</h3>
        <p>
          During the beta, account deletion is handled by our team to ensure data integrity.
          {' '}To request account deletion, contact{' '}
          <a href="mailto:support@askalf.org?subject=Account%20Deletion%20Request" style={{ color: 'var(--crystal)' }}>
            support@askalf.org
          </a>
        </p>
        <button className="settings-danger-btn" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
          Delete Account
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
      const data = await res.json() as { status: string; error?: string };
      if (data.status === 'valid') {
        setMessage({ type: 'success', text: `${providerType} key verified` });
        fetchKeys();
      } else {
        setMessage({ type: 'error', text: `Key invalid: ${data.error || 'verification failed'}` });
      }
    } catch {
      setMessage({ type: 'error', text: 'Verification failed' });
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
}

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

const PROVIDER_ICONS: Record<string, JSX.Element> = {
  github: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  ),
  gitlab: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
    </svg>
  ),
  bitbucket: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646L23.99 2.104a.768.768 0 0 0-.768-.891zm13.142 13.477H9.957L8.857 8.891h6.167z"/>
    </svg>
  ),
};

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [available, setAvailable] = useState<AvailableProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedRepos, setExpandedRepos] = useState<string | null>(null);
  const [repos, setRepos] = useState<Array<{ id: string; repo_full_name: string; is_private: boolean; language: string | null }>>([]);
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
  const connectableProviders = available.filter((p) => p.configured && !connectedProviders.has(p.provider));

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
        Connect your git providers to link repos for agent tasks
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
        <div className="settings-integrations-list">
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

      {/* Connect New */}
      {connectableProviders.length > 0 && (
        <div className="settings-form" style={{ marginTop: 'var(--space-xl)' }}>
          <h3>Connect a Provider</h3>
          <div className="settings-connect-buttons">
            {connectableProviders.map((p) => (
              <a
                key={p.provider}
                href={`${API_BASE}/api/v1/integrations/connect/${p.provider}`}
                className="settings-connect-btn"
              >
                {PROVIDER_ICONS[p.provider]}
                <span>Connect {PROVIDER_LABELS[p.provider] ?? p.provider}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {integrations.length === 0 && connectableProviders.length === 0 && (
        <div className="settings-empty">
          <p>No git providers are configured on this server. Ask your admin to set up GitHub, GitLab, or Bitbucket OAuth credentials.</p>
        </div>
      )}
    </div>
  );
}
