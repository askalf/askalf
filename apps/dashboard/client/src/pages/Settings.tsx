import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import { useSelfApi, type Credential } from '../hooks/useSelfApi';
import './Settings.css';

type SettingsTab = 'profile' | 'appearance' | 'ai-keys' | 'security';

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'profile';
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    ['profile', 'appearance', 'ai-keys', 'security'].includes(initialTab) ? initialTab : 'profile'
  );
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Settings — Forge'; }, []);

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
            className={`settings-nav-item ${activeTab === 'ai-keys' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai-keys')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            AI Keys
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
        </nav>

        <div className="settings-content">
          {activeTab === 'profile' && <ProfileTab user={user} />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'ai-keys' && <AIKeysTab />}
          {activeTab === 'security' && <SecurityTab />}
        </div>
      </div>
    </div>
  );
}

// Determine API base URL based on current hostname
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3005';
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

const AI_PROVIDERS = [
  { id: 'claude', name: 'Claude (Anthropic)', placeholder: 'sk-ant-...', color: '#d97706' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...', color: '#7c3aed' },
];

function AIKeysTab() {
  const api = useSelfApi();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.fetchCredentials()
      .then(setCredentials)
      .catch(() => setMessage({ type: 'error', text: 'Failed to load credentials' }))
      .finally(() => setLoading(false));
  }, []);

  const getCred = (provider: string) =>
    credentials.find((c) => c.provider === provider && c.status === 'active');

  const handleSave = async (provider: string) => {
    const value = keyInputs[provider]?.trim();
    if (!value) return;
    setSaving(provider);
    setMessage(null);
    try {
      const result = await api.saveCredential(provider, 'api_key', value);
      setCredentials((prev) => {
        const filtered = prev.filter((c) => c.provider !== provider);
        return [...filtered, { provider, credential_type: 'api_key', last4: result.last4, status: 'active', created_at: new Date().toISOString() }];
      });
      setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      setEditing(null);
      setMessage({ type: 'success', text: `${provider === 'claude' ? 'Claude' : 'OpenAI'} API key saved` });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save key' });
    } finally {
      setSaving(null);
    }
  };

  const handleRemove = async (provider: string) => {
    setMessage(null);
    try {
      await api.deleteCredential(provider);
      setCredentials((prev) => prev.filter((c) => c.provider !== provider));
      setMessage({ type: 'success', text: 'Key removed' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove key' });
    }
  };

  return (
    <div className="settings-section">
      <h2>AI Keys</h2>
      <p className="settings-section-desc">
        Add your own API keys for Self. Your key is encrypted at rest and never exposed.
        If no key is set, the platform key is used.
      </p>

      {message && (
        <div className={`settings-message settings-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="settings-field-hint">Loading...</p>
      ) : (
        <div className="settings-form">
          {AI_PROVIDERS.map((p) => {
            const cred = getCred(p.id);
            return (
              <div key={p.id} className="settings-ai-key-card">
                <div className="settings-ai-key-header">
                  <span className="settings-ai-key-dot" style={{ background: p.color }} />
                  <strong>{p.name}</strong>
                  {cred && <span className="settings-ai-key-active">****{cred.last4}</span>}
                </div>

                {cred && editing !== p.id ? (
                  <div className="settings-ai-key-actions">
                    <button className="settings-ai-key-btn" onClick={() => setEditing(p.id)}>
                      Replace
                    </button>
                    <button className="settings-ai-key-btn settings-ai-key-btn--danger" onClick={() => handleRemove(p.id)}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="settings-ai-key-input">
                    <input
                      type="password"
                      placeholder={p.placeholder}
                      value={keyInputs[p.id] || ''}
                      onChange={(e) => setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      autoFocus={editing === p.id}
                    />
                    <button
                      className="settings-save-btn"
                      onClick={() => handleSave(p.id)}
                      disabled={saving === p.id || !keyInputs[p.id]?.trim()}
                      style={{ margin: 0 }}
                    >
                      {saving === p.id ? 'Saving...' : 'Save Key'}
                    </button>
                    {editing === p.id && (
                      <button className="settings-ai-key-btn" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
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
