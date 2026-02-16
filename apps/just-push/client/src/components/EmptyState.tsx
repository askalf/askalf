export default function EmptyState() {
  return (
    <div className="jp-empty">
      <div className="jp-empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </div>
      <h2 className="jp-empty-title">All clear</h2>
      <p className="jp-empty-text">No branches to review right now. Agents will push changes here when they're ready.</p>
    </div>
  );
}
