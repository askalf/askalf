import type { TabKey } from '../../hooks/useConvergenceApi';

export default function TabIcon({ tab }: { tab: TabKey }) {
  const icons: Record<TabKey, JSX.Element> = {
    overview: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    ),
    internals: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 4h12M2 8h12M2 12h12" />
        <circle cx="5" cy="4" r="1" fill="currentColor" />
        <circle cx="10" cy="8" r="1" fill="currentColor" />
        <circle cx="7" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
    engine: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
      </svg>
    ),
    metacognition: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="6" r="4" />
        <path d="M5 14c0-1.657 1.343-3 3-3s3 1.343 3 3" />
        <path d="M8 4v4M6 6h4" />
      </svg>
    ),
    system: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="8" rx="1" />
        <path d="M6 14h4M8 11v3" />
        <circle cx="8" cy="7" r="1" fill="currentColor" />
      </svg>
    ),
  };
  return <span className="convergence-tab-icon">{icons[tab]}</span>;
}
