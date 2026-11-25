import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { LandingPage } from '@/pages/LandingPage'
import { searchHandoffReturn } from '@/lib/auth-return'

export function RequireAuth() {
  const user = useAuth((s) => s.user)
  const checkingSession = useAuth((s) => s.checkingSession)
  const bootstrap = useAuth((s) => s.bootstrap)
  const location = useLocation()

  useEffect(() => { void bootstrap() }, [bootstrap])

  // Visitors without a cached profile are almost always signed out, so the root shows the
  // landing page (matching the pre-rendered HTML) instead of a spinner while the session is checked.
  if (!user && location.pathname === '/' && !isDesktopRuntime()) return <LandingPage />

  if (!user && checkingSession) {
    return <div className="flex h-dvh items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  if (!user) {
    const from = searchHandoffReturn(location.pathname, location.hash) ?? location.pathname
    return <Navigate to="/login" replace state={{ from }} />
  }

  if (user.role === 'pending') {
    return <Navigate to="/pending" replace />
  }

  return <Outlet />
}
