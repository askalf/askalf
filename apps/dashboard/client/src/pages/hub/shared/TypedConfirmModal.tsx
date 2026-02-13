import { useState } from 'react';
import Modal from './Modal';

interface TypedConfirmModalProps {
  title: string;
  message: string;
  requiredText: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function TypedConfirmModal({
  title,
  message,
  requiredText,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: TypedConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const matches = typed === requiredText;

  return (
    <Modal title={title} onClose={onCancel} size="small">
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 var(--space-md)' }}>
        {message}
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: '0 0 var(--space-md)' }}>
        Type <code style={{ background: 'var(--elevated)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, color: '#ef4444' }}>{requiredText}</code> to confirm:
      </p>
      <input
        type="text"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={requiredText}
        autoFocus
        style={{
          width: '100%',
          padding: '10px 14px',
          background: 'var(--deep)',
          border: `1px solid ${matches ? 'rgba(239, 68, 68, 0.5)' : 'var(--border)'}`,
          borderRadius: '8px',
          color: 'var(--text)',
          fontSize: '0.875rem',
          fontFamily: "'JetBrains Mono', monospace",
          marginBottom: 'var(--space-lg)',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)' }}>
        <button className="hub-btn" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          className="hub-btn hub-btn--danger"
          onClick={onConfirm}
          disabled={!matches || loading}
        >
          {loading ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
