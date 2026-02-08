import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { useSelfStore } from './stores/self';
import Layout from './components/layout/Layout';
import LoadingScreen from './components/common/LoadingScreen';
import ErrorBoundary from './components/common/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import ChatPage from './pages/ChatPage';
import ActivityPage from './pages/ActivityPage';
import IntegrationsPage from './pages/IntegrationsPage';
import ApprovalsPage from './pages/ApprovalsPage';
import SettingsPage from './pages/SettingsPage';
import BudgetPage from './pages/BudgetPage';
import OnboardingPage from './pages/OnboardingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error } = useAuthStore();
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) return <LoadingScreen />;
  if (error) return <LoadingScreen message={error} />;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;

  return <>{children}</>;
}

function SelfGuard({ children }: { children: React.ReactNode }) {
  const { exists, isLoading } = useSelfStore();
  const { fetchSelf } = useSelfStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchSelf();
  }, [fetchSelf]);

  useEffect(() => {
    if (!isLoading && !exists) {
      navigate('/onboarding', { replace: true });
    }
  }, [isLoading, exists, navigate]);

  if (isLoading) return <LoadingScreen />;
  if (!exists) return null;

  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { exists, isLoading } = useSelfStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && exists && location.pathname === '/onboarding') {
      navigate('/', { replace: true });
    }
  }, [isLoading, exists, navigate, location.pathname]);

  if (isLoading) return <LoadingScreen />;

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
        <Route path="/register" element={<GuestGuard><RegisterPage /></GuestGuard>} />
        <Route path="/forgot-password" element={<GuestGuard><ForgotPasswordPage /></GuestGuard>} />
        <Route path="/reset-password" element={<GuestGuard><ResetPasswordPage /></GuestGuard>} />

        {/* Authenticated routes */}
        <Route
          path="/onboarding"
          element={
            <AuthGuard>
              <OnboardingGuard>
                <OnboardingPage />
              </OnboardingGuard>
            </AuthGuard>
          }
        />
        <Route
          element={
            <AuthGuard>
              <SelfGuard>
                <Layout />
              </SelfGuard>
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:conversationId" element={<ChatPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
