import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';

// Lazy-loaded: auth pages
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));

// Lazy-loaded: app layout (shared sidebar)
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));

// Lazy-loaded: orchestration pages
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const OrchestrationHub = lazy(() => import('./pages/OrchestrationHub'));
const GitSpace = lazy(() => import('./pages/GitSpace'));
const Memory = lazy(() => import('./pages/Memory'));
const Convergence = lazy(() => import('./pages/Convergence'));
const Settings = lazy(() => import('./pages/Settings'));

// Lazy-loaded: admin-only pages
const UserAdmin = lazy(() => import('./pages/UserAdmin'));
const BackupAdmin = lazy(() => import('./pages/BackupAdmin'));

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

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-logo">
        <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--crystal)', letterSpacing: '-0.02em' }}>F</div>
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

      {/* Main app with sidebar layout */}
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* Home */}
        <Route path="/command-center" element={<CommandCenter />} />

        {/* Orchestration */}
        <Route path="/agents" element={<OrchestrationHub />} />
        <Route path="/git-space" element={<GitSpace />} />

        {/* Knowledge */}
        <Route path="/memory" element={<Memory />} />
        <Route path="/convergence" element={<Convergence />} />

        {/* Platform */}
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:tab" element={<Settings />} />

        {/* Admin-only */}
        <Route path="/users" element={<AdminRoute><UserAdmin /></AdminRoute>} />
        <Route path="/backups" element={<AdminRoute><BackupAdmin /></AdminRoute>} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/command-center" replace />} />

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
