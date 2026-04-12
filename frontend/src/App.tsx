import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';

import { useAuthStore } from '@/stores/authStore';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui/toast';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
const VerifyEmailPage = lazy(() => import('@/pages/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
// const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const TransactionsPage = lazy(() => import('@/pages/TransactionsPage'));
// const SocialGiftsPage = lazy(() => import('@/pages/SocialGiftsPage'));
const CategoriesPage = lazy(() => import('@/pages/CategoriesPage'));
const StatisticsPage = lazy(() => import('@/pages/StatisticsPage'));
// const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export default function App() {
  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuth>
                <LoginPage />
              </RedirectIfAuth>
            }
          />
          <Route
            path="/register"
            element={
              <RedirectIfAuth>
                <RegisterPage />
              </RedirectIfAuth>
            }
          />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/forgot-password"
            element={
              <RedirectIfAuth>
                <ForgotPasswordPage />
              </RedirectIfAuth>
            }
          />
          <Route
            path="/reset-password"
            element={
              <RedirectIfAuth>
                <ResetPasswordPage />
              </RedirectIfAuth>
            }
          />

          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<TransactionsPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="statistics" element={<StatisticsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <Toaster />
    </>
  );
}
