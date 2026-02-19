import { useState, useEffect } from 'react';
import './CookieConsent.css';

const CONSENT_KEY = 'orcastr8r_cookie_consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
      <div className="cookie-banner-inner">
        <p className="cookie-banner-text">
          We use cookies for authentication and session management only. No tracking, no ads.{' '}
          <a href="/privacy" className="cookie-banner-link">Privacy Policy</a>
        </p>
        <button className="cookie-banner-accept" onClick={accept}>
          Got it
        </button>
      </div>
    </div>
  );
}
