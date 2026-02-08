import { useLocation } from 'react-router-dom';

export function ComingSoon({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // Login and authenticated app areas are accessible
  if (location.pathname === '/login' || location.pathname.startsWith('/app') || location.pathname.startsWith('/admin')) {
    return <>{children}</>;
  }

  // SECURITY: Don't render actual content at all - prevents dev tools bypass
  // The children prop is intentionally NOT rendered to protect content
  return (
    <div className="coming-soon-wrapper">
      {/* Static placeholder - NO actual content rendered */}
      <div className="coming-soon-placeholder">
        <div className="coming-soon-fake-content">
          <div className="fake-header"></div>
          <div className="fake-hero">
            <div className="fake-line fake-line-lg"></div>
            <div className="fake-line fake-line-md"></div>
            <div className="fake-line fake-line-sm"></div>
          </div>
          <div className="fake-grid">
            <div className="fake-card"></div>
            <div className="fake-card"></div>
            <div className="fake-card"></div>
          </div>
        </div>
      </div>
      <div className="coming-soon-overlay">
        <div className="coming-soon-modal">
          <div className="coming-soon-icon">⏸️</div>
          <h1>On Hold</h1>
          <p>This project has been put on hold pending further notice.</p>
        </div>
      </div>
      <style>{`
        .coming-soon-wrapper {
          position: relative;
          min-height: 100vh;
          background: var(--bg-primary, #0a0a0f);
          overflow: hidden;
        }
        .coming-soon-placeholder {
          filter: blur(12px);
          pointer-events: none;
          user-select: none;
          opacity: 0.3;
        }
        .coming-soon-fake-content {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .fake-header {
          height: 60px;
          background: linear-gradient(90deg, #1a1a2e 0%, #2a2a4e 50%, #1a1a2e 100%);
          border-radius: 8px;
          margin-bottom: 60px;
        }
        .fake-hero {
          text-align: center;
          padding: 80px 0;
        }
        .fake-line {
          height: 24px;
          background: linear-gradient(90deg, #1a1a2e 0%, #2a2a4e 50%, #1a1a2e 100%);
          border-radius: 4px;
          margin: 16px auto;
        }
        .fake-line-lg { width: 60%; height: 48px; }
        .fake-line-md { width: 40%; }
        .fake-line-sm { width: 30%; height: 16px; }
        .fake-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
          padding: 40px 0;
        }
        .fake-card {
          height: 200px;
          background: linear-gradient(135deg, #1a1a2e 0%, #2a2a4e 100%);
          border-radius: 12px;
        }
        .coming-soon-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .coming-soon-modal {
          background: var(--surface, #1a1a2e);
          border: 1px solid var(--border, #333);
          border-radius: 16px;
          padding: 48px;
          text-align: center;
          max-width: 400px;
        }
        .coming-soon-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }
        .coming-soon-modal h1 {
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 12px;
          color: var(--text-primary, #fff);
        }
        .coming-soon-modal p {
          color: var(--text-secondary, #aaa);
          font-size: 16px;
        }
        @media (max-width: 768px) {
          .fake-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
