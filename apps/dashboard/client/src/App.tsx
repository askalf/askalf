import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import Layout from './components/layout/Layout';
import Landing from './pages/Landing';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import PlatformAnalytics from './pages/PlatformAnalytics';
import Memory from './pages/Memory';
import Integrations from './pages/Integrations';
import UserAdmin from './pages/UserAdmin';
import BackupAdmin from './pages/BackupAdmin';
import ShardLibrary from './pages/ShardLibrary';
import ShardPacks from './pages/ShardPacks';
import ShardStats from './pages/ShardStats';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';

import OurSolution from './pages/OurSolution';
import About from './pages/About';
import Help from './pages/Help';
import Convergence from './pages/Convergence';
import Tickets from './pages/Tickets';
import Agents from './pages/Agents';
import Reports from './pages/Reports';
import Tasks from './pages/Tasks';
import AdminLayout from './components/admin/AdminLayout';
import { ComingSoon } from './components/ComingSoon';

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

export default function App() {
  return (
    <ComingSoon>
    <ScrollToTop />
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
        <Route path="hub/tickets" element={<Tickets />} />
        <Route path="hub/agents" element={<Agents />} />
        <Route path="hub/reports" element={<Reports />} />
        <Route path="hub/tasks" element={<Tasks />} />
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
        {/* Library, Packs & Stats - visible to all for transparency */}
        <Route path="library" element={<ShardLibrary />} />
        <Route path="packs" element={<ShardPacks />} />
        <Route path="shard-stats" element={<ShardStats />} />
        <Route path="convergence" element={<AdminRoute><Convergence /></AdminRoute>} />
        {/* Pro+ features - hidden from free tier */}
        <Route path="integrations" element={<ProRoute><Integrations /></ProRoute>} />
        {/* Admin-only route */}
        <Route path="memory" element={<AdminRoute><Memory /></AdminRoute>} />
      </Route>

      {/* Legacy routes - redirect to new structure */}
      <Route path="/chat" element={<ProtectedRoute><Navigate to="/app/chat" replace /></ProtectedRoute>} />
      <Route path="/chat/:conversationId" element={<ProtectedRoute><Navigate to="/app/chat" replace /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Navigate to="/app/settings" replace /></ProtectedRoute>} />
      <Route path="/settings/:tab" element={<ProtectedRoute><Navigate to="/app/settings" replace /></ProtectedRoute>} />
      <Route path="/library" element={<ProtectedRoute><Navigate to="/app/library" replace /></ProtectedRoute>} />
      <Route path="/integrations" element={<ProtectedRoute><Navigate to="/app/integrations" replace /></ProtectedRoute>} />
      <Route path="/memory" element={<AdminRoute><Navigate to="/app/memory" replace /></AdminRoute>} />
    </Routes>
    </ComingSoon>
  );
}
