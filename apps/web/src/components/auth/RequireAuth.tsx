import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/stores/auth'

export function RequireAuth() {
  const user = useAuth((s) => s.user)
  const checkingSession = useAuth((s) => s.checkingSession)
  const bootstrap = useAuth((s) => s.bootstrap)
  const location = useLocation()

  useEffect(() => { void bootstrap() }, [bootstrap])

  if (!user && checkingSession) {
    return <div className="flex h-dvh items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (user.role === 'pending') {
    return <Navigate to="/pending" replace />
  }

  return <Outlet />
}
