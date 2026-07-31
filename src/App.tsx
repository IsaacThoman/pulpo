import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { ChatPage } from '@/pages/ChatPage'
import { UsageLayout } from '@/pages/usage/UsageLayout'
import { PersonalPage } from '@/pages/usage/PersonalPage'
import { LeaderboardPage } from '@/pages/usage/LeaderboardPage'
import { AnalyticsPage } from '@/pages/usage/AnalyticsPage'
import { ApiKeysPage } from '@/pages/ApiKeysPage'
import { AdminLayout } from '@/pages/admin/AdminLayout'
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage'
import { AdminProvidersPage } from '@/pages/admin/AdminProvidersPage'
import { AdminLabsPage } from '@/pages/admin/AdminLabsPage'
import { AdminModelsPage } from '@/pages/admin/AdminModelsPage'
import { AdminSettingsPage } from '@/pages/admin/settings/AdminSettingsPage'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { PendingPage } from '@/pages/auth/PendingPage'
import { useAuth } from '@/stores/auth'

export default function App() {
  const bootstrap = useAuth((state) => state.bootstrap)
  useEffect(() => { void bootstrap() }, [bootstrap])

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
        </Route>
        <Route path="pending" element={<PendingPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<ChatPage />} />
            <Route path="c/:chatId" element={<ChatPage />} />
            <Route path="usage" element={<UsageLayout />}>
              <Route index element={<PersonalPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
            </Route>
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="providers" element={<AdminProvidersPage />} />
              <Route path="labs" element={<AdminLabsPage />} />
              <Route path="models" element={<AdminModelsPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
