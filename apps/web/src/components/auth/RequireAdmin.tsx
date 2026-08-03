import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/stores/auth'

export function RequireAdmin() {
  const role = useAuth((state) => state.user?.role)
  return role === 'admin' ? <Outlet /> : <Navigate to="/" replace />
}
