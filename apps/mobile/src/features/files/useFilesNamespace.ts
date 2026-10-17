import { cacheNamespace } from '../../data/database'
import { useSessionStore } from '../../store/session'

/** The signed-in account's cache namespace; Files screens only exist while one is signed in. */
export function useFilesNamespace(): string {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const userId = useSessionStore((state) => state.user?.id)
  return userId ? cacheNamespace(instanceUrl, userId) : ''
}
