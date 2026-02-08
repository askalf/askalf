const levels = [
  { value: 1, label: 'Notify', desc: 'SELF notifies you before every action and waits for your approval.' },
  { value: 2, label: 'Suggest', desc: 'SELF suggests actions and executes low-risk ones automatically.' },
  { value: 3, label: 'Balanced', desc: 'SELF handles routine tasks independently, asks for important decisions.' },
  { value: 4, label: 'Proactive', desc: 'SELF acts on most things autonomously, only asks for high-stakes decisions.' },
  { value: 5, label: 'Autopilot', desc: 'Full autonomy. SELF acts on your behalf with minimal interruption.' },
];

interface Props {
  value: number;
  onChange: (value: number) => void;
}

export default function AutonomySlider({ value, onChange }: Props) {
  const current = levels.find((l) => l.value === value) || levels[2];

  return (
    <div className="autonomy-slider">
      <input
        type="range"
        className="autonomy-slider-input"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="autonomy-slider-labels">
        {levels.map((l) => (
          <span
            key={l.value}
            className={`autonomy-slider-label${l.value === value ? ' active' : ''}`}
          >
            {l.label}
          </span>
        ))}
      </div>
      <div className="autonomy-level-desc">{current.desc}</div>
    </div>
  );
}
