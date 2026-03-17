import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { useAuthStore } from './stores/auth';

import WsToastBridge from './components/WsToastBridge';

const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const UnifiedDashboard = lazy(() => import('./pages/UnifiedDashboard'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const Docs = lazy(() => import('./pages/Docs'));
const Status = lazy(() => import('./pages/Status'));
const SecurityComparison = lazy(() => import('./pages/SecurityComparison'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-logo">
        <span style={{
          fontSize: '1.5rem',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontFamily: 'var(--font-mono)',
          color: '#a78bfa',
        }}>askalf</span>
      </div>
    </div>
  );
}

function OnboardingGate() {
  const onboardingCompleted = useAuthStore(s => s.onboardingCompleted);
  const isLoading = useAuthStore(s => s.isLoading);
  const location = useLocation();

  if (isLoading) return null;
  if (!onboardingCompleted && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
    <ScrollToTop />
    <OnboardingGate />
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />

      <Route element={<AdminLayout />}>
        <Route path="/command-center" element={<UnifiedDashboard />} />
        <Route path="/command-center/:tab" element={<UnifiedDashboard />} />
        <Route path="/agents" element={<Navigate to="/command-center" replace />} />
        <Route path="/repos" element={<Navigate to="/command-center/ops" replace />} />
        <Route path="/git-space" element={<Navigate to="/command-center/ops" replace />} />
        <Route path="/settings" element={<Navigate to="/command-center/settings" replace />} />
        <Route path="/settings/:tab" element={<Navigate to="/command-center/settings" replace />} />
      </Route>

      <Route path="/" element={<Navigate to="/command-center" replace />} />
      <Route path="/login" element={<Navigate to="/command-center" replace />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/security" element={<SecurityComparison />} />
      <Route path="/status" element={<Status />} />
      <Route path="/app/*" element={<Navigate to="/command-center" replace />} />
      <Route path="/admin/*" element={<Navigate to="/command-center" replace />} />
      <Route path="/chat" element={<Navigate to="/command-center" replace />} />
      <Route path="/chat/*" element={<Navigate to="/command-center" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    <WsToastBridge />
    </ErrorBoundary>
  );
}
