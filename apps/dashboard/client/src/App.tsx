import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';

// Lazy-loaded: auth pages
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const Register = lazy(() => import('./pages/Register'));
const Landing = lazy(() => import('./pages/Landing'));

// Lazy-loaded: app layout (shared sidebar)
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));

// Lazy-loaded: app pages
const AskAlf = lazy(() => import('./pages/AskAlf'));
const AskAlfIntegrations = lazy(() => import('./pages/AskAlfIntegrations'));
const Self = lazy(() => import('./pages/Self'));
const Integrations = lazy(() => import('./pages/Integrations'));
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const Settings = lazy(() => import('./pages/Settings'));

// Lazy-loaded: admin-only pages
const UserAdmin = lazy(() => import('./pages/UserAdmin'));

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

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin' && user.role !== 'super_admin') return <Navigate to="/command-center" replace />;

  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'super_admin') return <Navigate to="/command-center" replace />;

  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-logo">
        <div style={{ fontSize: '2rem' }}>{'\u{1F528}'}</div>
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
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

      {/* Main app with sidebar layout */}
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* Ask Alf — dev project, super_admin only */}
        <Route path="/ask-alf" element={<SuperAdminRoute><AskAlf /></SuperAdminRoute>} />
        <Route path="/ask-alf/integrations" element={<SuperAdminRoute><AskAlfIntegrations /></SuperAdminRoute>} />

        {/* Self — dev project, super_admin only */}
        <Route path="/self" element={<SuperAdminRoute><Self /></SuperAdminRoute>} />
        <Route path="/integrations" element={<SuperAdminRoute><Integrations /></SuperAdminRoute>} />

        {/* Forge — agent orchestration */}
        <Route path="/command-center" element={<CommandCenter />} />
        <Route path="/command-center/:tab" element={<CommandCenter />} />

        {/* Legacy redirect */}
        <Route path="/agents" element={<Navigate to="/command-center" replace />} />
        {/* Git space → Push tab in Command Center */}
        <Route path="/repos" element={<Navigate to="/command-center/push" replace />} />
        <Route path="/git-space" element={<Navigate to="/command-center/push" replace />} />

        {/* Platform */}
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:tab" element={<Settings />} />

        {/* Admin-only */}
        <Route path="/users" element={<AdminRoute><UserAdmin /></AdminRoute>} />
      </Route>

      {/* Public landing page */}
      <Route path="/" element={<Landing />} />

      {/* Legacy redirects */}
      <Route path="/app/*" element={<Navigate to="/command-center" replace />} />
      <Route path="/admin/*" element={<Navigate to="/command-center" replace />} />
      <Route path="/chat" element={<Navigate to="/command-center" replace />} />
      <Route path="/chat/*" element={<Navigate to="/command-center" replace />} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/command-center" replace />} />
    </Routes>
    </Suspense>
    </>
  );
}
