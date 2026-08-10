import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { RequireAdmin } from '@/components/auth/RequireAdmin'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { useAuth } from '@/stores/auth'

const ChatPage = lazy(() => import('@/pages/ChatPage').then((module) => ({ default: module.ChatPage })))
const UsageLayout = lazy(() => import('@/pages/usage/UsageLayout').then((module) => ({ default: module.UsageLayout })))
const PersonalPage = lazy(() => import('@/pages/usage/PersonalPage').then((module) => ({ default: module.PersonalPage })))
const LeaderboardPage = lazy(() => import('@/pages/usage/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage })))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeysPage').then((module) => ({ default: module.ApiKeysPage })))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout').then((module) => ({ default: module.AdminLayout })))
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })))
const AdminProvidersPage = lazy(() => import('@/pages/admin/AdminProvidersPage').then((module) => ({ default: module.AdminProvidersPage })))
const AdminLabsPage = lazy(() => import('@/pages/admin/AdminLabsPage').then((module) => ({ default: module.AdminLabsPage })))
const AdminIconsPage = lazy(() => import('@/pages/admin/AdminIconsPage').then((module) => ({ default: module.AdminIconsPage })))
const AdminModelsPage = lazy(() => import('@/pages/admin/AdminModelsPage').then((module) => ({ default: module.AdminModelsPage })))
const AdminUsagePage = lazy(() => import('@/pages/admin/AdminUsagePage').then((module) => ({ default: module.AdminUsagePage })))
const AdminUsageLayout = lazy(() => import('@/pages/admin/AdminUsageLayout').then((module) => ({ default: module.AdminUsageLayout })))
const AdminWorkspacesPage = lazy(() => import('@/pages/admin/AdminWorkspacesPage').then((module) => ({ default: module.AdminWorkspacesPage })))
const AdminSettingsPage = lazy(() => import('@/pages/admin/settings/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage })))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then((module) => ({ default: module.LoginPage })))
const SetupPage = lazy(() => import('@/pages/auth/SetupPage').then((module) => ({ default: module.SetupPage })))
const SignupPage = lazy(() => import('@/pages/auth/SignupPage').then((module) => ({ default: module.SignupPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })))
const PendingPage = lazy(() => import('@/pages/auth/PendingPage').then((module) => ({ default: module.PendingPage })))
const SharedChatPage = lazy(() => import('@/pages/SharedChatPage').then((module) => ({ default: module.SharedChatPage })))
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })))
const SupportPage = lazy(() => import('@/pages/SupportPage').then((module) => ({ default: module.SupportPage })))

export default function App() {
  const bootstrap = useAuth((state) => state.bootstrap)
  useEffect(() => { void bootstrap() }, [bootstrap])

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading Pulpo…</div>}>
        <Routes>
        <Route element={<AuthLayout />}>
          <Route path="setup" element={<SetupPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>
        <Route path="pending" element={<PendingPage />} />
        <Route path="share/:token" element={<SharedChatPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="support" element={<SupportPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<ChatPage />} />
            <Route path="c/:chatId" element={<ChatPage />} />
            <Route path="usage" element={<UsageLayout />}>
              <Route index element={<PersonalPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
            </Route>
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route element={<RequireAdmin />}>
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="users" replace />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="providers" element={<AdminProvidersPage />} />
                <Route path="labs" element={<AdminLabsPage />} />
                <Route path="icons" element={<AdminIconsPage />} />
                <Route path="models" element={<AdminModelsPage />} />
                <Route path="usage" element={<AdminUsageLayout />}>
                  <Route index element={<AdminUsagePage />} />
                  <Route path="workspaces" element={<AdminWorkspacesPage />} />
                </Route>
                <Route path="settings" element={<AdminSettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
