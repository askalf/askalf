interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  filters?: Array<{
    value: string;
    onChange: (value: string) => void;
    options: FilterOption[];
    label?: string;
  }>;
  tabs?: Array<{
    value: string;
    label: string;
    active: boolean;
    onClick: () => void;
    badge?: number;
  }>;
}

export default function FilterBar({ searchValue, searchPlaceholder, onSearchChange, filters, tabs }: FilterBarProps) {
  return (
    <div className="hub-filter-bar">
      {tabs && tabs.length > 0 && (
        <div className="hub-filter-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={tab.active ? 'active' : ''}
              onClick={tab.onClick}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="hub-filter-badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {filters && filters.map((f, i) => (
        <select key={i} value={f.value} onChange={(e) => f.onChange(e.target.value)}>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      {onSearchChange && (
        <div className="hub-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder={searchPlaceholder || 'Search...'}
            value={searchValue || ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchValue && (
            <button className="hub-search__clear" onClick={() => onSearchChange('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
