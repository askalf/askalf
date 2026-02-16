export default function EmptyState() {
  return (
    <div className="jp-empty">
      {/* Animated radar / scanning effect */}
      <div className="jp-empty-visual">
        <div className="jp-empty-rings">
          <div className="jp-empty-ring jp-empty-ring--1" />
          <div className="jp-empty-ring jp-empty-ring--2" />
          <div className="jp-empty-ring jp-empty-ring--3" />
        </div>
        <div className="jp-empty-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </div>
        <div className="jp-empty-sweep" />
      </div>

      <h2 className="jp-empty-title">All Clear</h2>
      <p className="jp-empty-text">
        No branches to review right now.
      </p>
      <p className="jp-empty-subtext">
        Agents will push changes here when they're ready.
      </p>

      <div className="jp-empty-hints">
        <div className="jp-empty-hint">
          <span className="jp-empty-hint-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </span>
          <span>Auto-refreshes every 30s</span>
        </div>
        <div className="jp-empty-hint">
          <span className="jp-empty-hint-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </span>
          <span>Review, merge &amp; deploy in one flow</span>
        </div>
      </div>
    </div>
  );
}
