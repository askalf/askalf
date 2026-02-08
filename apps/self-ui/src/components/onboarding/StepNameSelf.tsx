import { useState } from 'react';

interface Props {
  value: string;
  onChange: (name: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepNameSelf({ value, onChange, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleNext = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Give your SELF a name');
      return;
    }
    if (trimmed.length > 32) {
      setError('Name must be 32 characters or less');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="onboarding-step">
      <div className="onboarding-icon">&#9997;&#65039;</div>
      <h2 className="onboarding-title">Name Your SELF</h2>
      <p className="onboarding-text">
        Give your AI agent a name. This is how it will identify itself in conversations
        and activity logs.
      </p>
      <input
        className="input"
        type="text"
        placeholder="e.g. Atlas, Friday, Jarvis..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (error) setError('');
        }}
        onKeyDown={(e) => e.key === 'Enter' && handleNext()}
        autoFocus
        maxLength={32}
      />
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', marginTop: 'var(--space-sm)' }}>
          {error}
        </p>
      )}
      <div className="onboarding-actions">
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
        <button className="btn btn-primary" onClick={handleNext}>Continue</button>
      </div>
    </div>
  );
}
