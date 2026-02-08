import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelfStore } from '../../stores/self';
import { getOnboardingStatus, completeOnboarding } from '../../api/onboarding';
import { activateSelf } from '../../api/self';
import StepMeetSelf from './StepMeetSelf';
import StepNameSelf from './StepNameSelf';
import StepAutonomy from './StepAutonomy';
import StepIntegrations from './StepIntegrations';
import StepActivate from './StepActivate';

const TOTAL_STEPS = 5;

export default function OnboardingFlow() {
  const navigate = useNavigate();
  const { setSelf } = useSelfStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [autonomyLevel, setAutonomyLevel] = useState(3);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);
  const [availableIntegrations, setAvailableIntegrations] = useState<Array<{
    id: string;
    name: string;
    icon: string;
    description: string;
  }>>([]);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getOnboardingStatus()
      .then((status) => {
        setAvailableIntegrations(status.availableIntegrations || []);
      })
      .catch(() => {
        // Onboarding endpoint might not exist yet — that's fine
      });
  }, []);

  const toggleIntegration = (id: string) => {
    setSelectedIntegrations((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleActivate = async () => {
    setIsActivating(true);
    setError('');
    try {
      // Try completing onboarding via dedicated endpoint first
      await completeOnboarding({ name, autonomyLevel, integrations: selectedIntegrations }).catch(() => null);
      // Then activate SELF
      const result = await activateSelf({ name, autonomyLevel });
      setSelf(result.self);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
      setIsActivating(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-progress">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`onboarding-progress-dot${i === step ? ' active' : i < step ? ' done' : ''}`}
            />
          ))}
        </div>

        {error && (
          <div style={{ padding: 'var(--space-md)', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-md)' }}>
            {error}
          </div>
        )}

        {step === 0 && <StepMeetSelf onNext={() => setStep(1)} />}
        {step === 1 && <StepNameSelf value={name} onChange={setName} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <StepAutonomy value={autonomyLevel} onChange={setAutonomyLevel} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && (
          <StepIntegrations
            available={availableIntegrations}
            selected={selectedIntegrations}
            onToggle={toggleIntegration}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <StepActivate
            name={name}
            autonomyLevel={autonomyLevel}
            isActivating={isActivating}
            onActivate={handleActivate}
            onBack={() => setStep(3)}
          />
        )}
      </div>
    </div>
  );
}
