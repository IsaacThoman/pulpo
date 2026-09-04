import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { RequireAdmin } from '@/components/auth/RequireAdmin'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { DesktopInstancePage } from '@/components/desktop/DesktopInstancePage'
import { DesktopTitleBar } from '@/components/desktop/DesktopTitleBar'
import { desktopStartupSurface } from '@/lib/desktop-startup'
import { ui } from '@/i18n/ui'
import { LocaleBoundary } from '@/i18n/LocaleBoundary'

const ChatPage = lazy(() => import('@/pages/ChatPage').then((module) => ({ default: module.ChatPage })))
const NotesPage = lazy(() => import('@/pages/NotesPage').then((module) => ({ default: module.NotesPage })))
const UsageLayout = lazy(() => import('@/pages/usage/UsageLayout').then((module) => ({ default: module.UsageLayout })))
const PersonalPage = lazy(() => import('@/pages/usage/PersonalPage').then((module) => ({ default: module.PersonalPage })))
const LeaderboardPage = lazy(() => import('@/pages/usage/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage })))
const PoolPage = lazy(() => import('@/pages/PoolPage').then((module) => ({ default: module.PoolPage })))
const FriendsPage = lazy(() => import('@/pages/FriendsPage').then((module) => ({ default: module.FriendsPage })))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeysPage').then((module) => ({ default: module.ApiKeysPage })))
const BillingPage = lazy(() => import('@/pages/BillingPage').then((module) => ({ default: module.BillingPage })))
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
const AdminBillingPage = lazy(() => import('@/pages/admin/AdminBillingPage').then((module) => ({ default: module.AdminBillingPage })))
const AdminChatsPage = lazy(() => import('@/pages/admin/AdminChatsPage').then((module) => ({ default: module.AdminChatsPage })))
const AdminChatPage = lazy(() => import('@/pages/admin/AdminChatPage').then((module) => ({ default: module.AdminChatPage })))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then((module) => ({ default: module.LoginPage })))
const LoginOptionsPage = lazy(() => import('@/pages/auth/LoginOptionsPage').then((module) => ({ default: module.LoginOptionsPage })))
const SetupPage = lazy(() => import('@/pages/auth/SetupPage').then((module) => ({ default: module.SetupPage })))
const SignupPage = lazy(() => import('@/pages/auth/SignupPage').then((module) => ({ default: module.SignupPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })))
const PendingPage = lazy(() => import('@/pages/auth/PendingPage').then((module) => ({ default: module.PendingPage })))
const SharedChatPage = lazy(() => import('@/pages/SharedChatPage').then((module) => ({ default: module.SharedChatPage })))
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })))
const SupportPage = lazy(() => import('@/pages/SupportPage').then((module) => ({ default: module.SupportPage })))
const MobilePasskeyPage = lazy(() => import('@/pages/MobilePasskeyPage').then((module) => ({ default: module.MobilePasskeyPage })))
const MobilePasskeyEnrollmentPage = lazy(() => import('@/pages/MobilePasskeyPage').then((module) => ({ default: module.MobilePasskeyEnrollmentPage })))

function RequireBilling({ children }: { children: ReactNode }) {
  const checkingSession = useAuth((state) => state.checkingSession)
  const billingEnabled = useAuth((state) => state.billingEnabled)

  if (checkingSession) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">{ui("Loading billing…")}</div>
  }

  return billingEnabled ? children : <Navigate to="/usage" replace />
}

function LocalizedRoute({ children }: { children: ReactNode }) {
  return <LocaleBoundary>{children}</LocaleBoundary>
}

export default function App() {
  const bootstrap = useAuth((state) => state.bootstrap)
  const checkingSession = useAuth((state) => state.checkingSession)
  const instanceReady = useAuth((state) => state.instanceReady)
  const user = useAuth((state) => state.user)
  useEffect(() => { void bootstrap() }, [bootstrap])

  const startupSurface = desktopStartupSurface({
    desktop: isDesktopRuntime(),
    hasCachedUser: Boolean(user),
    checkingSession,
    instanceReady,
  })

  return (
    <BrowserRouter>
      <div className="desktop-shell h-full">
      <DesktopTitleBar />
      {startupSurface !== 'app' ? (
        startupSurface === 'connecting'
          ? <div className="grid h-full place-items-center text-sm text-muted-foreground">{ui("Connecting to Pulpo…")}</div>
          : <DesktopInstancePage />
      ) : <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">{ui("Loading Pulpo…")}</div>}>
        <Routes>
        <Route element={<LocalizedRoute><AuthLayout /></LocalizedRoute>}>
          <Route path="setup" element={<LocalizedRoute><SetupPage /></LocalizedRoute>} />
          <Route path="login" element={<LocalizedRoute><LoginPage /></LocalizedRoute>} />
          <Route path="login/options" element={<LocalizedRoute><LoginOptionsPage /></LocalizedRoute>} />
          <Route path="signup" element={<LocalizedRoute><SignupPage /></LocalizedRoute>} />
          <Route path="forgot-password" element={<LocalizedRoute><ForgotPasswordPage /></LocalizedRoute>} />
          <Route path="reset-password" element={<LocalizedRoute><ResetPasswordPage /></LocalizedRoute>} />
        </Route>
        <Route path="pending" element={<LocalizedRoute><PendingPage /></LocalizedRoute>} />
        <Route path="share/:token" element={<LocalizedRoute><SharedChatPage /></LocalizedRoute>} />
        <Route path="privacy" element={<LocalizedRoute><PrivacyPage /></LocalizedRoute>} />
        <Route path="support" element={<LocalizedRoute><SupportPage /></LocalizedRoute>} />
        <Route path="mobile/passkey" element={<LocalizedRoute><MobilePasskeyPage /></LocalizedRoute>} />
        <Route path="mobile/passkey/enroll" element={<LocalizedRoute><MobilePasskeyEnrollmentPage /></LocalizedRoute>} />

        <Route element={<RequireAuth />}>
          <Route element={<LocalizedRoute><AppLayout /></LocalizedRoute>}>
            <Route index element={<LocalizedRoute><ChatPage /></LocalizedRoute>} />
            <Route path="c/:chatId" element={<LocalizedRoute><ChatPage /></LocalizedRoute>} />
            <Route path="notes" element={<LocalizedRoute><NotesPage /></LocalizedRoute>} />
            <Route path="notes/trash" element={<LocalizedRoute><NotesPage /></LocalizedRoute>} />
            <Route path="notes/:noteId" element={<LocalizedRoute><NotesPage /></LocalizedRoute>} />
            <Route path="usage" element={<LocalizedRoute><UsageLayout /></LocalizedRoute>}>
              <Route index element={<LocalizedRoute><PersonalPage /></LocalizedRoute>} />
              <Route path="friends" element={<LocalizedRoute><LeaderboardPage /></LocalizedRoute>} />
              <Route path="pool" element={<LocalizedRoute><LeaderboardPage scope="pool" /></LocalizedRoute>} />
              <Route path="leaderboard" element={<Navigate to="/usage/friends" replace />} />
            </Route>
            <Route path="friends" element={<LocalizedRoute><FriendsPage /></LocalizedRoute>} />
            <Route path="friends/pool" element={<LocalizedRoute><PoolPage /></LocalizedRoute>} />
            <Route path="api-keys" element={<LocalizedRoute><ApiKeysPage /></LocalizedRoute>} />
            <Route path="billing" element={<LocalizedRoute><RequireBilling><BillingPage /></RequireBilling></LocalizedRoute>} />
            <Route element={<RequireAdmin />}>
              <Route path="admin" element={<LocalizedRoute><AdminLayout /></LocalizedRoute>}>
                <Route index element={<Navigate to="users" replace />} />
                <Route path="users" element={<LocalizedRoute><AdminUsersPage /></LocalizedRoute>} />
                <Route path="chats" element={<LocalizedRoute><AdminChatsPage /></LocalizedRoute>} />
                <Route path="chats/:chatId" element={<LocalizedRoute><AdminChatPage /></LocalizedRoute>} />
                <Route path="providers" element={<LocalizedRoute><AdminProvidersPage /></LocalizedRoute>} />
                <Route path="labs" element={<LocalizedRoute><AdminLabsPage /></LocalizedRoute>} />
                <Route path="icons" element={<LocalizedRoute><AdminIconsPage /></LocalizedRoute>} />
                <Route path="models" element={<LocalizedRoute><AdminModelsPage /></LocalizedRoute>} />
                <Route path="usage" element={<LocalizedRoute><AdminUsageLayout /></LocalizedRoute>}>
                  <Route index element={<LocalizedRoute><LeaderboardPage scope="instance" /></LocalizedRoute>} />
                  <Route path="requests" element={<LocalizedRoute><AdminUsagePage /></LocalizedRoute>} />
                  <Route path="workspaces" element={<LocalizedRoute><AdminWorkspacesPage /></LocalizedRoute>} />
                </Route>
                <Route path="billing" element={<LocalizedRoute><RequireBilling><AdminBillingPage /></RequireBilling></LocalizedRoute>} />
                <Route path="settings" element={<LocalizedRoute><AdminSettingsPage /></LocalizedRoute>} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
        </Routes>
      </Suspense>}
      </div>
    </BrowserRouter>
  )
}
