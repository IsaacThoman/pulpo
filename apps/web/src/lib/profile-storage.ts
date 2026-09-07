import { dataProfileScope } from '@pulpo/client-core'
import type { StateStorage } from 'zustand/middleware'

export function profileStorageKey(key: string): string {
  const scope = dataProfileScope()
  return scope ? `${key}:${scope.instance}:${scope.userId}:${scope.profileId}` : key
}
function storage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : globalThis.localStorage } catch { return undefined }
}

export const profileStorage: StateStorage = {
  getItem: (key) => {
    const scoped = profileStorageKey(key)
    const current = storage()?.getItem(scoped) ?? null
    const scope = dataProfileScope()
    if (current !== null || !scope || scope.profileId !== scope.userId) return current
    const legacy = storage()?.getItem(key) ?? null
    if (legacy !== null) storage()?.setItem(scoped, legacy)
    return legacy
  },
  setItem: (key, value) => storage()?.setItem(profileStorageKey(key), value),
  removeItem: (key) => storage()?.removeItem(profileStorageKey(key)),
}
