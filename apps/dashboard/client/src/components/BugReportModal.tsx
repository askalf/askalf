import { useState } from 'react';
import { useAuthStore } from '../stores/auth';
import './BugReportModal.css';

const API_BASE = (() => {
  const host = window.location.hostname;
  if (host.includes('orcastr8r.com')) return '';
  return 'http://localhost:3001';
})();

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
  const { user } = useAuthStore();
  const [form, setForm] = useState({
    category: 'bug',
    title: '',
    description: '',
    email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!form.description.trim()) {
      setError('Please describe the issue');
      return;
    }
    if (!user && !form.email.trim()) {
      setError('Please enter your email');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/v1/bug-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: form.title.trim() || undefined,
          description: form.description.trim(),
          category: form.category,
          email: user ? undefined : form.email.trim(),
          page: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to submit report');
      }
    } catch (err) {
      setError('Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setForm({ category: 'bug', title: '', description: '', email: '' });
    setSubmitted(false);
    setError('');
    onClose();
  };

  return (
    <div className="bug-modal-overlay" onClick={handleClose}>
      <div className="bug-modal" onClick={e => e.stopPropagation()}>
        {submitted ? (
          <div className="bug-modal-success">
            <div className="success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2>Thanks for your feedback!</h2>
            <p>We've received your report and will look into it.</p>
            <button className="bug-modal-btn primary" onClick={handleClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="bug-modal-header">
              <h2>Report an Issue</h2>
              <button className="bug-modal-close" onClick={handleClose}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bug-modal-body">
              <div className="bug-form-group">
                <label>Type</label>
                <div className="bug-type-chips">
                  {[
                    { value: 'bug', label: 'Bug', icon: '🐛' },
                    { value: 'feature', label: 'Feature Request', icon: '💡' },
                    { value: 'question', label: 'Question', icon: '❓' },
                    { value: 'other', label: 'Other', icon: '📝' },
                  ].map(type => (
                    <button
                      key={type.value}
                      className={`bug-type-chip ${form.category === type.value ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, category: type.value })}
                    >
                      <span className="chip-icon">{type.icon}</span>
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {!user && (
                <div className="bug-form-group">
                  <label>Your Email <span className="required">*</span></label>
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                  />
                </div>
              )}

              <div className="bug-form-group">
                <label>Subject <span className="optional">(optional)</span></label>
                <input
                  type="text"
                  placeholder="Brief summary of the issue"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </div>

              <div className="bug-form-group">
                <label>Description <span className="required">*</span></label>
                <textarea
                  placeholder="Please describe the issue in detail. Include steps to reproduce if applicable."
                  rows={5}
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {error && <div className="bug-form-error">{error}</div>}
            </div>

            <div className="bug-modal-footer">
              <button className="bug-modal-btn secondary" onClick={handleClose}>Cancel</button>
              <button
                className="bug-modal-btn primary"
                onClick={handleSubmit}
                disabled={submitting || !form.description.trim()}
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
