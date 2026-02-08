interface Props {
  onNext: () => void;
}

export default function StepMeetSelf({ onNext }: Props) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-icon">&#129302;</div>
      <h2 className="onboarding-title">Meet SELF</h2>
      <p className="onboarding-text">
        SELF is your personal AI agent. Unlike a chatbot, SELF works autonomously on your behalf
        — handling tasks, monitoring situations, and taking action while you focus on what matters.
      </p>
      <p className="onboarding-text">
        You stay in control. You decide how much autonomy SELF has, what integrations it can access,
        and what budget it can spend. Think of it as a tireless digital teammate that gets smarter
        over time.
      </p>
      <div className="onboarding-actions">
        <button className="btn btn-primary btn-lg" onClick={onNext}>
          Get Started
        </button>
      </div>
    </div>
  );
}
