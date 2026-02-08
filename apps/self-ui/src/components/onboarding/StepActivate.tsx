interface Props {
  name: string;
  autonomyLevel: number;
  isActivating: boolean;
  onActivate: () => void;
  onBack: () => void;
}

const autonomyLabels: Record<number, string> = {
  1: 'Notify Only',
  2: 'Suggest',
  3: 'Balanced',
  4: 'Proactive',
  5: 'Autopilot',
};

export default function StepActivate({ name, autonomyLevel, isActivating, onActivate, onBack }: Props) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-icon">&#9889;</div>
      <h2 className="onboarding-title">Activate {name}</h2>
      <p className="onboarding-text">
        Everything looks good. Here's a summary of your SELF configuration:
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Name</span>
          <span style={{ fontWeight: 600 }}>{name}</span>
        </div>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Autonomy</span>
          <span style={{ fontWeight: 600 }}>Level {autonomyLevel} — {autonomyLabels[autonomyLevel]}</span>
        </div>
      </div>

      <div className="onboarding-actions">
        <button className="btn btn-secondary" onClick={onBack} disabled={isActivating}>Back</button>
        <button className="btn btn-primary btn-lg" onClick={onActivate} disabled={isActivating}>
          {isActivating ? 'Activating...' : 'Activate SELF'}
        </button>
      </div>
    </div>
  );
}
