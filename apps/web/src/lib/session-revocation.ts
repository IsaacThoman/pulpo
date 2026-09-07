import { ApiError, apiRequest } from './api'
import { useAuth } from '@/stores/auth'

/** Confirm that credentials expired before clearing state; network failures are not logout. */
export async function handleSessionConnectionError(error: Error): Promise<void> {
  if (error.message !== 'unauthorized') return
  const user = useAuth.getState().user
  if (!user) return
  try { await apiRequest('/api/me') }
  catch (next) {
    if (next instanceof ApiError && next.status === 401 && useAuth.getState().user === user) {
      await useAuth.getState().logout(true)
    }
  }
}
