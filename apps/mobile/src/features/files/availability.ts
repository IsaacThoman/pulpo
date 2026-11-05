import type { MobileConfig } from '@pulpo/contracts'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { ApiError, mobileApi } from '../../api/client'
import { useSessionStore } from '../../store/session'
import { editorBundleFor } from './editor/bundles'
import { EDITOR_BUNDLE } from './editor/editorBundle.generated'

/** Files as the instance advertises it; older servers omit it, and then Files stays hidden. */
export function filesCapability(config: MobileConfig | null | undefined): { enabled: boolean; docSchemaVersion: number | null; liveFormats: Record<string, number> | null } {
  const files = config?.capabilities.files
  return { enabled: files?.enabled === true, docSchemaVersion: files?.docSchemaVersion ?? null, liveFormats: files?.liveFormats ?? null }
}

/**
 * Whether this app ships an editor for a live format that speaks the server's schema for it.
 * Servers from before live formats edit Markdown only.
 */
export function formatSupported(config: MobileConfig | null | undefined, format: string | null | undefined): boolean {
  const bundle = editorBundleFor(format)
  if (!bundle) return false
  const { docSchemaVersion, liveFormats } = filesCapability(config)
  const id = format ?? 'markdown'
  const serverVersion = liveFormats?.[id] ?? (id === 'markdown' ? docSchemaVersion : null)
  return serverVersion === null ? id === 'markdown' : serverVersion === bundle.schemaVersion
}

export function useFilesEnabled(): boolean {
  return useSessionStore((state) => filesCapability(state.config).enabled)
}

/**
 * Whether this app's bundled editor speaks the server's document schema. When it does not, the
 * server would refuse to sync, so documents open read only until the app is updated.
 */
export function useDocSchemaSupported(format?: string | null): boolean {
  return useSessionStore((state) => {
    if (format && format !== 'markdown') return formatSupported(state.config, format)
    const { docSchemaVersion } = filesCapability(state.config)
    return docSchemaVersion === null || docSchemaVersion === EDITOR_BUNDLE.schemaVersion
  })
}

let refreshing: Promise<void> | null = null

/** Reloads the instance configuration, e.g. after an administrator turned Files on or off. */
export function refreshFilesCapability(): Promise<void> {
  refreshing ??= (async () => {
    const { instanceUrl, token } = useSessionStore.getState()
    try {
      const config = await mobileApi.config()
      const current = useSessionStore.getState()
      if (current.instanceUrl === instanceUrl && current.token === token) useSessionStore.setState({ config })
    } catch {
      // Keep the configuration already known.
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Files failed because an administrator turned it off; the app hides it once the config says so. */
export function isFilesDisabledError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'files_disabled'
}

/** Keeps the Files capability current while the app is used (it can change at any time). */
export function useFilesCapabilityRefresh(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshFilesCapability()
    })
    return () => subscription.remove()
  }, [])
}
