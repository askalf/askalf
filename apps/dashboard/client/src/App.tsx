import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import Layout from './components/layout/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import { ComingSoon } from './components/ComingSoon';

// Lazy-loaded: auth pages (low traffic)
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));

// Lazy-loaded: authenticated app pages
const Chat = lazy(() => import('./pages/Chat'));
const Settings = lazy(() => import('./pages/Settings'));
const Brain = lazy(() => import('./pages/Brain'));
const Integrations = lazy(() => import('./pages/Integrations'));

// Lazy-loaded: public info pages
const OurSolution = lazy(() => import('./pages/OurSolution'));
const About = lazy(() => import('./pages/About'));
const Help = lazy(() => import('./pages/Help'));

// Lazy-loaded: admin-only pages
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const PlatformAnalytics = lazy(() => import('./pages/PlatformAnalytics'));
const Memory = lazy(() => import('./pages/Memory'));
const UserAdmin = lazy(() => import('./pages/UserAdmin'));
const BackupAdmin = lazy(() => import('./pages/BackupAdmin'));
const Convergence = lazy(() => import('./pages/Convergence'));
const OrchestrationHub = lazy(() => import('./pages/OrchestrationHub'));
const GitSpace = lazy(() => import('./pages/GitSpace'));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading application">
        <div className="loading-logo">
          <span className="animate-ufo-float" style={{ fontSize: '3rem' }} aria-hidden="true">👽</span>
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Enforce email verification - unverified users cannot access the app
  if (user.emailVerified === false) {
    return <Navigate to="/verify-email" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading application">
        <div className="loading-logo">
          <span className="animate-ufo-float" style={{ fontSize: '3rem' }} aria-hidden="true">👽</span>
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return <Navigate to="/chat" replace />;
  }

  return <>{children}</>;
}

// Pro+ route guard - requires paid plan for advanced features
function ProRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading application">
        <div className="loading-logo">
          <span className="animate-ufo-float" style={{ fontSize: '3rem' }} aria-hidden="true">👽</span>
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Admins always have access
  if (user.role === 'admin' || user.role === 'super_admin') {
    return <>{children}</>;
  }

  // Check for pro+ plans
  const proPlusPlans = ['basic', 'pro', 'team', 'enterprise', 'lifetime'];
  if (!user.plan || !proPlusPlans.includes(user.plan)) {
    // Redirect free users to chat with a hint
    return <Navigate to="/chat?upgrade=true" replace />;
  }

  return <>{children}</>;
}

function LazyFallback() {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label="Loading page">
      <div className="loading-logo">
        <span className="animate-ufo-float" style={{ fontSize: '3rem' }} aria-hidden="true">👽</span>
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ComingSoon>
    <ScrollToTop />
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      {/* Public landing */}
      <Route path="/" element={<Landing />} />

      {/* Auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />

      {/* Public pages - unblurred */}
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/our-solution" element={<OurSolution />} />
      <Route path="/about" element={<About />} />
      <Route path="/help" element={<Help />} />

      {/* Admin panel with sidebar navigation */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route path="analytics" element={<PlatformAnalytics />} />
        <Route path="users" element={<UserAdmin />} />
        <Route path="backups" element={<BackupAdmin />} />
        <Route path="hub" element={<OrchestrationHub />} />
        <Route path="git-space" element={<GitSpace />} />
        <Route path="memory" element={<Memory />} />
        <Route path="convergence" element={<Convergence />} />
        {/* Legacy redirects for old bookmarks */}
        <Route path="hub/agents" element={<Navigate to="/admin/hub" replace />} />
        <Route path="hub/tasks" element={<Navigate to="/admin/hub" replace />} />
        <Route path="hub/reports" element={<Navigate to="/admin/hub" replace />} />
        <Route path="hub/tickets" element={<Navigate to="/admin/hub" replace />} />
      </Route>

      {/* Authenticated app with layout */}
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Chat />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:conversationId" element={<Chat />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/:tab" element={<Settings />} />
        {/* My Brain - unified hub for Library, Packs & Stats */}
        <Route path="brain" element={<Brain />} />
        <Route path="library" element={<Navigate to="/app/brain?tab=browse" replace />} />
        <Route path="packs" element={<Navigate to="/app/brain?tab=packs" replace />} />
        <Route path="shard-stats" element={<Navigate to="/app/brain" replace />} />
        {/* Pro+ features - hidden from free tier */}
        <Route path="integrations" element={<ProRoute><Integrations /></ProRoute>} />
      </Route>

      {/* Legacy routes - redirect to new structure */}
      <Route path="/chat" element={<ProtectedRoute><Navigate to="/app/chat" replace /></ProtectedRoute>} />
      <Route path="/chat/:conversationId" element={<ProtectedRoute><Navigate to="/app/chat" replace /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Navigate to="/app/settings" replace /></ProtectedRoute>} />
      <Route path="/settings/:tab" element={<ProtectedRoute><Navigate to="/app/settings" replace /></ProtectedRoute>} />
      <Route path="/library" element={<ProtectedRoute><Navigate to="/app/brain?tab=browse" replace /></ProtectedRoute>} />
      <Route path="/integrations" element={<ProtectedRoute><Navigate to="/app/integrations" replace /></ProtectedRoute>} />
      <Route path="/memory" element={<AdminRoute><Navigate to="/admin/memory" replace /></AdminRoute>} />
    </Routes>
    </Suspense>
    </ComingSoon>
  );
}
