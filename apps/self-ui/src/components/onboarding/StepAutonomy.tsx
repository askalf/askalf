import AutonomySlider from '../common/AutonomySlider';

interface Props {
  value: number;
  onChange: (level: number) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepAutonomy({ value, onChange, onNext, onBack }: Props) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-icon">&#127911;</div>
      <h2 className="onboarding-title">Set Autonomy Level</h2>
      <p className="onboarding-text">
        How independently should SELF act? You can always change this later in Settings.
      </p>
      <AutonomySlider value={value} onChange={onChange} />
      <div className="onboarding-actions">
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
        <button className="btn btn-primary" onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}
