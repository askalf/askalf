import AnimatedNumber from './AnimatedNumber';

export default function ConvergenceRing({ percent }: { percent: number }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="convergence-ring-container">
      <svg className="convergence-ring-svg" viewBox="0 0 120 120" width="120" height="120">
        <defs>
          <linearGradient id="convergenceRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle className="convergence-ring-bg" cx="60" cy="60" r={radius} />
        <circle
          className="convergence-ring-progress"
          cx="60" cy="60" r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="convergence-ring-value">
        <div className="convergence-ring-percent">
          <AnimatedNumber value={Math.round(percent)} />
        </div>
        <div className="convergence-ring-unit">%</div>
      </div>
    </div>
  );
}
