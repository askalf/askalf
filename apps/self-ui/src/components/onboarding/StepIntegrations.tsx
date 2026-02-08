import { useState } from 'react';

interface Integration {
  id: string;
  name: string;
  icon: string;
  description: string;
}

interface Props {
  available: Integration[];
  selected: string[];
  onToggle: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepIntegrations({ available, selected, onToggle, onNext, onBack }: Props) {
  const [_hover, setHover] = useState<string | null>(null);

  return (
    <div className="onboarding-step">
      <div className="onboarding-icon">&#128268;</div>
      <h2 className="onboarding-title">Connect Integrations</h2>
      <p className="onboarding-text">
        Optional: connect services so SELF can work with your tools. You can add more later.
      </p>

      {available.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          No integrations available yet. You can configure them later in Settings.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {available.map((int) => (
            <button
              key={int.id}
              className={`card${selected.includes(int.id) ? ' card-elevated' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-md)',
                cursor: 'pointer',
                border: selected.includes(int.id) ? '1px solid var(--crystal)' : undefined,
                textAlign: 'left',
              }}
              onClick={() => onToggle(int.id)}
              onMouseEnter={() => setHover(int.id)}
              onMouseLeave={() => setHover(null)}
            >
              <span style={{ fontSize: '1.5rem' }}>{int.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{int.name}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{int.description}</div>
              </div>
              {selected.includes(int.id) && (
                <span className="badge badge-success">Selected</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="onboarding-actions">
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
        <button className="btn btn-primary" onClick={onNext}>
          {selected.length > 0 ? 'Continue' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
