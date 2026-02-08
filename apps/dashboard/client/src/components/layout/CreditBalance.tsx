import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth';

// Determine API base URL
const getApiUrl = () => {
  const host = window.location.hostname;
  if (host.includes('askalf.org')) return 'https://api.askalf.org';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
  return '';
};

const API_BASE = getApiUrl();

interface CreditStatus {
  credits: {
    daily: {
      used: number;
      limit: number;
      remaining: number;
    };
    banked: number;
    bundle: number;
    total: number;
  };
  messages: number;
  tier: string;
  byok: {
    enabled: boolean;
    hasKeys: boolean;
    unlimited: boolean;
  };
  rolloverEnabled: boolean;
  maxBanked: number;
  resetsAt: string;
}

export default function CreditBalance() {
  const { user } = useAuthStore();
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    // Admin accounts are unlimited — no need to fetch credit status
    if (isAdmin) {
      setLoading(false);
      return;
    }

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/credits/status`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // Silently fail - balance just won't show
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [user, isAdmin]);

  // Don't render if no user (auth still loading)
  if (!user) return null;

  // Admin accounts — show unlimited badge
  if (isAdmin) {
    return (
      <div className="credit-balance unlimited" title="Unlimited credits">
        <svg className="credit-balance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.267-8-5.096 0-5.096 8 0 8 5.134 0 7.172-8 12.267-8z" />
        </svg>
        <span className="credit-balance-amount">Unlimited</span>
      </div>
    );
  }

  // Show loading placeholder
  if (loading) {
    return (
      <div className="credit-balance loading" title="Loading credits...">
        <svg className="credit-balance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span className="credit-balance-amount">--</span>
      </div>
    );
  }

  // If status failed to load, don't show anything
  if (!status) return null;

  // BYOK unlimited users
  if (status?.byok.unlimited) {
    return (
      <div className="credit-balance unlimited" title="Unlimited - Using your own API keys">
        <svg className="credit-balance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        <span className="credit-balance-amount">BYOK</span>
      </div>
    );
  }

  // Free tier - show daily credits remaining
  if (status?.tier === 'free') {
    const creditsLeft = status.credits.daily.remaining ?? 0;
    return (
      <div
        className={`credit-balance ${creditsLeft <= 20 ? 'low' : ''}`}
        title={`${creditsLeft} credits remaining today (resets at midnight UTC)`}
      >
        <svg className="credit-balance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span className="credit-balance-amount">{creditsLeft}</span>
        <span className="credit-balance-label">credits</span>
      </div>
    );
  }

  // Paid tiers - show credits (daily + banked + bundle)
  const dailyRemaining = status?.credits.daily.remaining ?? 0;
  const bankedCredits = status?.credits.banked ?? 0;
  const bundleCredits = status?.credits.bundle ?? 0;
  const totalCredits = dailyRemaining + bankedCredits + bundleCredits;

  // Determine display
  let displayValue: string;
  let displayLabel: string;
  let tooltipText: string;

  if (totalCredits > 0) {
    displayValue = totalCredits.toString();
    // Build tooltip with breakdown
    const parts: string[] = [];
    if (dailyRemaining > 0) parts.push(`${dailyRemaining} daily`);
    if (bankedCredits > 0) parts.push(`${bankedCredits} banked`);
    if (bundleCredits > 0) parts.push(`${bundleCredits} bundle`);
    tooltipText = parts.join(' + ') + ' credits';
    displayLabel = bankedCredits > 0 ? 'total' : 'credits';
  } else {
    displayValue = '0';
    displayLabel = '';
    tooltipText = 'No credits remaining - wait for daily reset or buy more';
  }

  return (
    <div
      className={`credit-balance ${totalCredits <= 10 ? 'low' : ''} ${totalCredits === 0 ? 'empty' : ''}`}
      title={tooltipText}
    >
      <svg className="credit-balance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      <span className="credit-balance-amount">{displayValue}</span>
      {displayLabel && <span className="credit-balance-label">{displayLabel}</span>}
    </div>
  );
}
