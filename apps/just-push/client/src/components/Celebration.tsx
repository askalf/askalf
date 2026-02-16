export default function Celebration({ message }: { message?: string }) {
  return (
    <div className="jp-celebration">
      <div className="jp-celebration-check">
        <svg width="48" height="48" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="22" fill="none" stroke="var(--crystal)" strokeWidth="2" opacity="0.3" />
          <path
            d="M14 24l7 7 13-13"
            fill="none"
            stroke="var(--crystal)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="jp-celebration-path"
          />
        </svg>
      </div>
      <h3 className="jp-celebration-title">{message || 'Merged successfully!'}</h3>
      <p className="jp-celebration-text">Changes are now on the main branch.</p>
    </div>
  );
}
