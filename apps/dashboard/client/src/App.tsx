import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import ErrorBoundary from './components/ErrorBoundary';
import CookieConsent from './components/CookieConsent';
import WsToastBridge from './components/WsToastBridge';

// Lazy-loaded: auth
const Login = lazy(() => import('./pages/Login'));

// Lazy-loaded: app
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const UnifiedDashboard = lazy(() => import('./pages/UnifiedDashboard'));

// Lazy-loaded: static pages
const NotFound = lazy(() => import('./pages/NotFound'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const Docs = lazy(() => import('./pages/Docs'));
const Status = lazy(() => import('./pages/Status'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-logo">
        <span style={{
          fontSize: '1.5rem',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          color: '#a78bfa',
        }}>askalf</span>
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <ScrollToTop />
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      {/* Auth */}
      <Route path="/login" element={<Login />} />

      {/* Main app */}
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/command-center" element={<UnifiedDashboard />} />
        <Route path="/command-center/:tab" element={<UnifiedDashboard />} />

        {/* Legacy redirects */}
        <Route path="/agents" element={<Navigate to="/command-center" replace />} />
        <Route path="/repos" element={<Navigate to="/command-center/deploy" replace />} />
        <Route path="/git-space" element={<Navigate to="/command-center/deploy" replace />} />
        <Route path="/settings" element={<Navigate to="/command-center/settings" replace />} />
        <Route path="/settings/:tab" element={<Navigate to="/command-center/settings" replace />} />
      </Route>

      {/* Public pages */}
      <Route path="/" element={<Navigate to="/command-center" replace />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/status" element={<Status />} />

      {/* Legacy redirects */}
      <Route path="/app/*" element={<Navigate to="/command-center" replace />} />
      <Route path="/admin/*" element={<Navigate to="/command-center" replace />} />
      <Route path="/chat" element={<Navigate to="/command-center" replace />} />
      <Route path="/chat/*" element={<Navigate to="/command-center" replace />} />

      {/* Catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    <WsToastBridge />
    <CookieConsent />
    </ErrorBoundary>
  );
}
