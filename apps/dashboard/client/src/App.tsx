import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import ErrorBoundary from './components/ErrorBoundary';
import CookieConsent from './components/CookieConsent';
import WsToastBridge from './components/WsToastBridge';

// Lazy-loaded: auth pages
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const Register = lazy(() => import('./pages/Register'));
const Landing = lazy(() => import('./pages/Landing'));
const Onboard = lazy(() => import('./pages/Onboard'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const Docs = lazy(() => import('./pages/Docs'));
const Status = lazy(() => import('./pages/Status'));
const Try = lazy(() => import('./pages/Try'));

// Lazy-loaded: app layout (full-width wrapper)
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));

// Lazy-loaded: app pages
const UnifiedDashboard = lazy(() => import('./pages/UnifiedDashboard'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified === false) return <Navigate to="/verify-email" replace />;
  if (!user.onboardingCompleted) return <Navigate to="/onboard" replace />;

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
      {/* Auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/register" element={<Register />} />
      <Route path="/onboard" element={<Onboard />} />

      {/* Main app with sidebar layout */}
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* Ask Alf — dev project, super_admin only */}


        {/* Unified Dashboard — all tabs */}
        <Route path="/command-center" element={<UnifiedDashboard />} />
        <Route path="/command-center/:tab" element={<UnifiedDashboard />} />

        {/* Legacy redirect */}
        <Route path="/agents" element={<Navigate to="/command-center" replace />} />
        {/* Git space → Push tab in Command Center */}
        <Route path="/repos" element={<Navigate to="/command-center/push" replace />} />
        <Route path="/git-space" element={<Navigate to="/command-center/push" replace />} />

        {/* Redirects: Settings & Users now live inside Command Center */}
        <Route path="/settings" element={<Navigate to="/command-center/settings" replace />} />
        <Route path="/settings/:tab" element={<Navigate to="/command-center/settings" replace />} />
        <Route path="/users" element={<Navigate to="/command-center/users" replace />} />
      </Route>

      {/* Public pages */}
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/status" element={<Status />} />
      <Route path="/try" element={<Try />} />

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
