import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'

let refreshPromise: Promise<void> | null = null

export async function refreshInstanceFeatures(force = false): Promise<void> {
  if (force && refreshPromise) await refreshPromise
  if (!refreshPromise) {
    refreshPromise = (async () => {
      await useAuth.getState().refreshSettings()
      useCatalog.getState().setCodexEnabled(useAuth.getState().codexEnabled)
      await useCatalog.getState().load()
      useAuth.setState({ codexEnabled: useCatalog.getState().codexEnabled })
    })().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}
