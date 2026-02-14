import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import './Settings.css';

type SettingsTab = 'profile' | 'billing' | 'appearance' | 'security';

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'profile';
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    ['profile', 'billing', 'appearance', 'security'].includes(initialTab) ? initialTab : 'profile'
  );
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Settings — Ask ALF'; }, []);

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
        <p>Manage your account, billing, and preferences</p>
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
            className={`settings-nav-item ${activeTab === 'billing' ? 'active' : ''}`}
            onClick={() => setActiveTab('billing')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <path d="M1 10h22" />
            </svg>
            Billing & Usage
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
        </nav>

        <div className="settings-content">
          {activeTab === 'profile' && <ProfileTab user={user} />}
          {activeTab === 'billing' && <BillingTab user={user} />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'security' && <SecurityTab />}
        </div>
      </div>
    </div>
  );
}

// Determine API base URL based on current hostname
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
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
          <label>Preferred Name (for ALF)</label>
          <input
            type="text"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            placeholder="What should ALF call you?"
          />
          <p className="settings-field-hint">ALF will use this name when responding to you</p>
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

interface CreditStatus {
  credits: {
    daily: { used: number; limit: number; remaining: number };
    bundle: number;
    total: number;
  };
  messages: number;
  tier: string;
  byok: { enabled: boolean; hasKeys: boolean; unlimited: boolean };
  resetsAt: string;
}

interface BillingUser {
  plan?: string;
  planDisplayName?: string;
  role?: string;
}

function BillingTab({ }: { user: BillingUser | null }) {
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const creditRes = await fetch(`${API_BASE}/api/v1/credits/status`, { credentials: 'include' });

        if (creditRes.ok) {
          setCreditStatus(await creditRes.json());
        } else {
          const errorData = await creditRes.json().catch(() => ({}));
          if (creditRes.status === 401) {
            setError('Please log in to view billing information');
          } else {
            setError(errorData.error || `Failed to load credits: ${creditRes.status}`);
          }
        }
      } catch (err) {
        console.error('Billing data fetch error:', err);
        setError('Failed to load billing data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  // Calculate reset time display
  const getResetTime = () => {
    if (!creditStatus?.resetsAt) return 'midnight UTC';
    const resetDate = new Date(creditStatus.resetsAt);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffHours > 0) return `${diffHours}h ${diffMins}m`;
    return `${diffMins}m`;
  };

  // Calculate usage percentage
  const usagePercent = creditStatus
    ? Math.round((creditStatus.credits.daily.used / creditStatus.credits.daily.limit) * 100)
    : 0;

  return (
    <div className="settings-section billing-section">
      <h2>Billing & Usage</h2>
      <p className="settings-section-desc">
        Monitor your daily credit usage
      </p>

      {/* Current Plan Card */}
      <div className="billing-plan-card">
        <div className="billing-plan-header">
          <div className="billing-plan-info">
            <span className="billing-plan-label">Current Plan</span>
            <span className="billing-plan-name">Free</span>
          </div>
          <div className="billing-plan-badge" data-plan="free">
            Free Tier
          </div>
        </div>
        <p className="billing-plan-features">50 credits/day &middot; All models &middot; Unlimited Knowledge Shard hits</p>
      </div>

      {/* Usage Stats */}
      <div className="billing-usage-section">
        <h3>Today's Usage</h3>

        {isLoading ? (
          <div className="billing-loading">Loading usage data...</div>
        ) : error ? (
          <div className="billing-error">{error}</div>
        ) : creditStatus ? (
          <>
            <div className="billing-usage-card">
              <div className="billing-usage-header">
                <span className="billing-usage-label">Daily Credits</span>
                <span className="billing-usage-reset">Resets in {getResetTime()}</span>
              </div>
              <div className="billing-usage-bar-container">
                <div
                  className="billing-usage-bar"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  data-status={usagePercent >= 90 ? 'critical' : usagePercent >= 70 ? 'warning' : 'normal'}
                />
              </div>
              <div className="billing-usage-stats">
                <span className="billing-usage-used">
                  {creditStatus.credits.daily.used} / {creditStatus.credits.daily.limit} credits used
                </span>
                <span className="billing-usage-remaining">
                  {creditStatus.credits.daily.remaining} remaining
                </span>
              </div>
            </div>

            <div className="billing-stats-grid">
              <div className="billing-stat-item">
                <span className="billing-stat-value">{creditStatus.messages}</span>
                <span className="billing-stat-label">Messages Today</span>
              </div>
              <div className="billing-stat-item">
                <span className="billing-stat-value">{creditStatus.credits.daily.remaining}</span>
                <span className="billing-stat-label">Credits Remaining</span>
              </div>
            </div>

            {creditStatus.byok.unlimited && (
              <div className="billing-byok-badge">
                <span>BYOK Active</span>
                <span className="billing-byok-desc">Unlimited messages with your API keys</span>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* How Credits Work */}
      <div className="billing-credits-info">
        <h3>How Credits Work</h3>
        <p className="billing-credits-desc">
          Credits are consumed per message based on model tier:
        </p>
        <div className="billing-credits-tiers">
          <div className="billing-credit-tier">
            <span className="billing-credit-cost">1</span>
            <span className="billing-credit-label">credit</span>
            <span className="billing-credit-name">Fast Models</span>
            <span className="billing-credit-models">GPT-4o Mini, Claude 3.5 Haiku, Gemini 2.0 Flash, Grok 2 Mini</span>
          </div>
          <div className="billing-credit-tier">
            <span className="billing-credit-cost">2</span>
            <span className="billing-credit-label">credits</span>
            <span className="billing-credit-name">Standard Models</span>
            <span className="billing-credit-models">GPT-5, Claude Sonnet 4, Gemini 2.0 Pro, Grok 3</span>
          </div>
          <div className="billing-credit-tier">
            <span className="billing-credit-cost">10</span>
            <span className="billing-credit-label">credits</span>
            <span className="billing-credit-name">Reasoning Models</span>
            <span className="billing-credit-models">GPT-5.2 / o3, Claude Opus 4.5, Gemini 3 Pro, Grok 4.1</span>
          </div>
        </div>
        <p className="billing-credits-note">
          <strong>Knowledge Shard hits = 0 credits.</strong> When ALF already knows the answer, you pay nothing.
        </p>
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
        Customize how Ask ALF looks and feels
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

interface MemoryStats {
  preferences: {
    preferredName: string | null;
    communicationStyle: string;
    tone: string;
    detailLevel: string;
    interests: string[];
    domains: string[];
    goals: string[];
    customInstructions: string | null;
    aboutUser: Record<string, unknown>;
  };
  episodes: {
    total: number;
    positive: number;
    negative: number;
    samples: Array<{ id: string; summary: string; type: string; valence: string | null; created_at: string }>;
  };
  facts: {
    total: number;
    categories: number;
    samples: Array<{ id: string; statement: string; category: string | null; confidence: number }>;
  };
  contexts: {
    total: number;
    samples: Array<{ id: string; summary: string | null; content_type: string; status: string; original_tokens: number | null; created_at: string }>;
  };
}

function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  // ALF Memory state
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [showFactsModal, setShowFactsModal] = useState(false);
  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [showEpisodesModal, setShowEpisodesModal] = useState(false);
  const [showContextsModal, setShowContextsModal] = useState(false);

  // Fetch memory stats on mount
  useEffect(() => {
    const fetchMemory = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/user/memory`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setMemoryStats(data);
        } else {
          setMemoryError('Failed to load memory data');
        }
      } catch {
        setMemoryError('Failed to load memory data');
      } finally {
        setMemoryLoading(false);
      }
    };
    fetchMemory();
  }, []);

  const refreshMemory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/user/memory`, { credentials: 'include' });
      if (res.ok) {
        setMemoryStats(await res.json());
      }
    } catch { /* ignore */ }
  };

  const handleRemovePreferenceItem = async (field: string, value: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/user/memory/preference-item`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      });
      if (res.ok) await refreshMemory();
    } catch { /* ignore */ }
  };

  const handleRemoveItem = async (type: 'facts' | 'episodes' | 'contexts', id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/user/memory/${type}/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) await refreshMemory();
    } catch { /* ignore */ }
  };

  const handleResetMemory = async (type: 'preferences' | 'facts' | 'episodes' | 'contexts' | 'all') => {
    const confirmMessages: Record<string, string> = {
      preferences: 'Reset all your ALF preferences to defaults? This includes communication style, interests, and custom instructions.',
      facts: 'Clear all facts ALF has learned about you? This cannot be undone.',
      episodes: 'Clear your interaction history with ALF? This cannot be undone.',
      contexts: 'Clear all working contexts? This cannot be undone.',
      all: 'Reset EVERYTHING ALF knows about you? This will clear preferences, facts, episodes, and contexts. This cannot be undone.',
    };

    if (!window.confirm(confirmMessages[type])) return;

    setIsResetting(type);
    try {
      const res = await fetch(`${API_BASE}/api/user/memory/${type}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        alert(data.message || 'Memory cleared successfully');
        // Refresh memory stats
        const refreshRes = await fetch(`${API_BASE}/api/user/memory`, { credentials: 'include' });
        if (refreshRes.ok) {
          setMemoryStats(await refreshRes.json());
        }
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to reset memory');
      }
    } catch {
      alert('Failed to reset memory');
    } finally {
      setIsResetting(null);
    }
  };

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

  const hasPreferences = memoryStats && (
    memoryStats.preferences.interests.length > 0 ||
    memoryStats.preferences.domains.length > 0 ||
    memoryStats.preferences.goals.length > 0 ||
    memoryStats.preferences.customInstructions ||
    Object.keys(memoryStats.preferences.aboutUser).length > 0
  );

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

      <div className="settings-data-section">
        <h3>Data & Privacy</h3>
        <p className="settings-data-note">
          Your data stays with you across plan changes — downgrade to Free and keep everything.
          You're always in control: delete anything below whenever you want.
        </p>

        {/* ALF Memory Section */}
        <div className="settings-memory-section">
          <h4>ALF's Memory About You</h4>
          {memoryLoading ? (
            <p className="settings-memory-loading">Loading memory data...</p>
          ) : memoryError ? (
            <p className="settings-memory-error">{memoryError}</p>
          ) : memoryStats ? (
            <>
              {/* Facts About You - from ALF profile */}
              <div className="settings-data-item">
                <div>
                  <p className="settings-data-label">Facts About You</p>
                  <p className="settings-data-desc">
                    {(() => {
                      const aboutCount = Object.keys(memoryStats.preferences.aboutUser).length;
                      const parts = [];
                      if (aboutCount > 0) parts.push(`${aboutCount} personal fact${aboutCount !== 1 ? 's' : ''}`);
                      if (memoryStats.preferences.interests.length > 0) parts.push(`${memoryStats.preferences.interests.length} interest${memoryStats.preferences.interests.length !== 1 ? 's' : ''}`);
                      if (memoryStats.preferences.domains.length > 0) parts.push(`${memoryStats.preferences.domains.length} domain${memoryStats.preferences.domains.length !== 1 ? 's' : ''}`);
                      if (memoryStats.preferences.goals.length > 0) parts.push(`${memoryStats.preferences.goals.length} goal${memoryStats.preferences.goals.length !== 1 ? 's' : ''}`);
                      return parts.length > 0 ? parts.join(', ') : 'No facts learned yet';
                    })()}
                    {hasPreferences && (
                      <button
                        className="settings-view-link"
                        onClick={() => setShowPrefsModal(true)}
                      >
                        View
                      </button>
                    )}
                  </p>
                </div>
                <button
                  className="settings-clear-btn"
                  onClick={() => handleResetMemory('preferences')}
                  disabled={isResetting === 'preferences' || !hasPreferences}
                >
                  {isResetting === 'preferences' ? 'Resetting...' : 'Reset'}
                </button>
              </div>

              {/* Communication Preferences */}
              <div className="settings-data-item">
                <div>
                  <p className="settings-data-label">Communication Style</p>
                  <p className="settings-data-desc">
                    {memoryStats.preferences.tone} tone, {memoryStats.preferences.communicationStyle} style, {memoryStats.preferences.detailLevel} detail
                  </p>
                </div>
              </div>

              {/* Knowledge Facts - from semantic memory */}
              <div className="settings-data-item">
                <div>
                  <p className="settings-data-label">Knowledge Base</p>
                  <p className="settings-data-desc">
                    {memoryStats.facts.total} fact{memoryStats.facts.total !== 1 ? 's' : ''} in {memoryStats.facts.categories} categor{memoryStats.facts.categories !== 1 ? 'ies' : 'y'}
                    {memoryStats.facts.total > 0 && (
                      <button
                        className="settings-view-link"
                        onClick={() => setShowFactsModal(true)}
                      >
                        View
                      </button>
                    )}
                  </p>
                </div>
                <button
                  className="settings-clear-btn"
                  onClick={() => handleResetMemory('facts')}
                  disabled={isResetting === 'facts' || memoryStats.facts.total === 0}
                >
                  {isResetting === 'facts' ? 'Clearing...' : 'Clear'}
                </button>
              </div>

              {/* Episodes */}
              <div className="settings-data-item">
                <div>
                  <p className="settings-data-label">Interaction History</p>
                  <p className="settings-data-desc">
                    {memoryStats.episodes.total} episode{memoryStats.episodes.total !== 1 ? 's' : ''} ({memoryStats.episodes.positive} positive, {memoryStats.episodes.negative} negative)
                    {memoryStats.episodes.total > 0 && (
                      <button
                        className="settings-view-link"
                        onClick={() => setShowEpisodesModal(true)}
                      >
                        View
                      </button>
                    )}
                  </p>
                </div>
                <button
                  className="settings-clear-btn"
                  onClick={() => handleResetMemory('episodes')}
                  disabled={isResetting === 'episodes' || memoryStats.episodes.total === 0}
                >
                  {isResetting === 'episodes' ? 'Clearing...' : 'Clear'}
                </button>
              </div>

              {/* Contexts */}
              <div className="settings-data-item">
                <div>
                  <p className="settings-data-label">Working Contexts</p>
                  <p className="settings-data-desc">
                    {memoryStats.contexts.total} context{memoryStats.contexts.total !== 1 ? 's' : ''} stored
                    {memoryStats.contexts.total > 0 && (
                      <button
                        className="settings-view-link"
                        onClick={() => setShowContextsModal(true)}
                      >
                        View
                      </button>
                    )}
                  </p>
                </div>
                <button
                  className="settings-clear-btn"
                  onClick={() => handleResetMemory('contexts')}
                  disabled={isResetting === 'contexts' || memoryStats.contexts.total === 0}
                >
                  {isResetting === 'contexts' ? 'Clearing...' : 'Clear'}
                </button>
              </div>

              {/* Reset All */}
              <div className="settings-data-item reset-all">
                <div>
                  <p className="settings-data-label">Full Memory Reset</p>
                  <p className="settings-data-desc">
                    Clear everything ALF has learned about you
                  </p>
                </div>
                <button
                  className="settings-danger-btn-small"
                  onClick={() => handleResetMemory('all')}
                  disabled={isResetting === 'all'}
                >
                  {isResetting === 'all' ? 'Resetting...' : 'Reset All'}
                </button>
              </div>
            </>
          ) : null}
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

      {/* Facts Modal */}
      {showFactsModal && memoryStats && (
        <div className="settings-modal-overlay" onClick={() => setShowFactsModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Facts ALF Knows About You</h3>
              <button className="settings-modal-close" onClick={() => setShowFactsModal(false)}>×</button>
            </div>
            <div className="settings-modal-content">
              {memoryStats.facts.samples.length > 0 ? (
                <ul className="settings-facts-list">
                  {memoryStats.facts.samples.map((fact, i) => (
                    <li key={fact.id || i} className="settings-fact-item">
                      <div className="settings-fact-content">
                        <span className="settings-fact-statement">{fact.statement}</span>
                        {fact.category && (
                          <span className="settings-fact-category">{fact.category}</span>
                        )}
                      </div>
                      <button
                        className="settings-item-remove"
                        onClick={() => handleRemoveItem('facts', fact.id)}
                        title="Remove this fact"
                      >×</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No facts learned yet.</p>
              )}
              {memoryStats.facts.total > memoryStats.facts.samples.length && (
                <p className="settings-facts-note">
                  Showing {memoryStats.facts.samples.length} of {memoryStats.facts.total} facts
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Facts About You Modal */}
      {showPrefsModal && memoryStats && (
        <div className="settings-modal-overlay" onClick={() => setShowPrefsModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Facts ALF Knows About You</h3>
              <button className="settings-modal-close" onClick={() => setShowPrefsModal(false)}>×</button>
            </div>
            <div className="settings-modal-content">
              {/* Personal Facts - show first */}
              {Object.keys(memoryStats.preferences.aboutUser).length > 0 && (
                <div className="settings-pref-section">
                  <h4>Personal Information</h4>
                  <ul className="settings-about-list">
                    {Object.entries(memoryStats.preferences.aboutUser).map(([key, value], i) => (
                      <li key={i} className="settings-about-item">
                        <span><strong>{key.replace(/_/g, ' ')}:</strong> {String(value)}</span>
                        <button
                          className="settings-item-remove"
                          onClick={() => handleRemovePreferenceItem('aboutUser', key)}
                          title="Remove this info"
                        >×</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {memoryStats.preferences.interests.length > 0 && (
                <div className="settings-pref-section">
                  <h4>Interests</h4>
                  <div className="settings-pref-tags">
                    {memoryStats.preferences.interests.map((interest, i) => (
                      <span key={i} className="settings-pref-tag">
                        {interest}
                        <button
                          className="settings-tag-remove"
                          onClick={() => handleRemovePreferenceItem('interests', interest)}
                          title="Remove"
                        >×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {memoryStats.preferences.domains.length > 0 && (
                <div className="settings-pref-section">
                  <h4>Professional Domains</h4>
                  <div className="settings-pref-tags">
                    {memoryStats.preferences.domains.map((domain, i) => (
                      <span key={i} className="settings-pref-tag">
                        {domain}
                        <button
                          className="settings-tag-remove"
                          onClick={() => handleRemovePreferenceItem('domains', domain)}
                          title="Remove"
                        >×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {memoryStats.preferences.goals.length > 0 && (
                <div className="settings-pref-section">
                  <h4>Goals</h4>
                  <div className="settings-pref-tags">
                    {memoryStats.preferences.goals.map((goal, i) => (
                      <span key={i} className="settings-pref-tag">
                        {goal}
                        <button
                          className="settings-tag-remove"
                          onClick={() => handleRemovePreferenceItem('goals', goal)}
                          title="Remove"
                        >×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {memoryStats.preferences.customInstructions && (
                <div className="settings-pref-section">
                  <h4>Custom Instructions</h4>
                  <div className="settings-pref-custom">
                    <p className="settings-pref-text">{memoryStats.preferences.customInstructions}</p>
                    <button
                      className="settings-item-remove"
                      onClick={() => handleRemovePreferenceItem('customInstructions', '')}
                      title="Clear custom instructions"
                    >×</button>
                  </div>
                </div>
              )}

              {/* Show message if nothing learned yet */}
              {Object.keys(memoryStats.preferences.aboutUser).length === 0 &&
               memoryStats.preferences.interests.length === 0 &&
               memoryStats.preferences.domains.length === 0 &&
               memoryStats.preferences.goals.length === 0 && (
                <p className="settings-empty-message">ALF hasn't learned any facts about you yet. Keep chatting and ALF will remember important details!</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Episodes Modal */}
      {showEpisodesModal && memoryStats && (
        <div className="settings-modal-overlay" onClick={() => setShowEpisodesModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Interaction History</h3>
              <button className="settings-modal-close" onClick={() => setShowEpisodesModal(false)}>×</button>
            </div>
            <div className="settings-modal-content">
              {memoryStats.episodes.samples && memoryStats.episodes.samples.length > 0 ? (
                <ul className="settings-episodes-list">
                  {memoryStats.episodes.samples.map((episode, i) => (
                    <li key={episode.id || i} className="settings-episode-item">
                      <div className="settings-episode-row">
                        <div className="settings-episode-main">
                          <div className="settings-episode-header">
                            <span className={`settings-episode-valence ${episode.valence || 'neutral'}`}>
                              {episode.valence === 'positive' ? '✓' : episode.valence === 'negative' ? '✗' : '○'}
                            </span>
                            <span className="settings-episode-type">{episode.type}</span>
                            <span className="settings-episode-date">
                              {new Date(episode.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="settings-episode-summary">{episode.summary}</p>
                        </div>
                        <button
                          className="settings-item-remove"
                          onClick={() => handleRemoveItem('episodes', episode.id)}
                          title="Remove this episode"
                        >×</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No interaction history yet.</p>
              )}
              {memoryStats.episodes.total > memoryStats.episodes.samples.length && (
                <p className="settings-episodes-note">
                  Showing {memoryStats.episodes.samples.length} of {memoryStats.episodes.total} episodes
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contexts Modal */}
      {showContextsModal && memoryStats && (
        <div className="settings-modal-overlay" onClick={() => setShowContextsModal(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Working Contexts</h3>
              <button className="settings-modal-close" onClick={() => setShowContextsModal(false)}>×</button>
            </div>
            <div className="settings-modal-content">
              {memoryStats.contexts.samples && memoryStats.contexts.samples.length > 0 ? (
                <ul className="settings-contexts-list">
                  {memoryStats.contexts.samples.map((context, i) => (
                    <li key={context.id || i} className="settings-context-item">
                      <div className="settings-context-row">
                        <div className="settings-context-main">
                          <div className="settings-context-header">
                            <span className={`settings-context-status ${context.status}`}>
                              {context.status}
                            </span>
                            <span className="settings-context-type">{context.content_type}</span>
                            {context.original_tokens && (
                              <span className="settings-context-tokens">{context.original_tokens} tokens</span>
                            )}
                            <span className="settings-context-date">
                              {new Date(context.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {context.summary && (
                            <p className="settings-context-summary">{context.summary}</p>
                          )}
                        </div>
                        <button
                          className="settings-item-remove"
                          onClick={() => handleRemoveItem('contexts', context.id)}
                          title="Remove this context"
                        >×</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No working contexts yet.</p>
              )}
              {memoryStats.contexts.total > memoryStats.contexts.samples.length && (
                <p className="settings-contexts-note">
                  Showing {memoryStats.contexts.samples.length} of {memoryStats.contexts.total} contexts
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
