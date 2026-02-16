import { useState } from 'react';

interface ExpandableProps {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function Expandable({ title, badge, defaultOpen = false, children }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`jp-expand ${open ? 'jp-expand--open' : ''}`}>
      <button className="jp-expand-header" onClick={() => setOpen(!open)}>
        <span className="jp-expand-title">
          {title}
          {badge !== undefined && <span className="jp-expand-badge">{badge}</span>}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`jp-expand-chevron ${open ? 'jp-expand-chevron--open' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="jp-expand-body">{children}</div>}
    </div>
  );
}
