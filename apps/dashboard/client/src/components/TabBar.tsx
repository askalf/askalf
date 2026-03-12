/**
 * Reusable tab navigation bar.
 * Replaces 8+ duplicate tab navigation patterns across the dashboard.
 */

interface Tab {
  key: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  /** CSS class applied to each tab button (default: 'ud-sub-tab') */
  tabClassName?: string;
  ariaLabel?: string;
}

export default function TabBar({ tabs, active, onChange, className, tabClassName = 'ud-sub-tab', ariaLabel }: TabBarProps) {
  return (
    <div className={className} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={`${tabClassName} ${active === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
