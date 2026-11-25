import { defaultSearchAccountPreferences, type SearchAccountPreferences } from '@pulpo/contracts/search'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { accountPreferences, loadPreferences, preferencesStorageKey, readAccountPreferences, savePreferences, type Preferences } from './preferences'

const accountKeyPrefix = 'pulpo-search-account-settings-v1:'
const migrationOwnerKey = 'pulpo-search-settings-migrated-account'
type PreferencePatch = Partial<SearchAccountPreferences>

export type SearchPreferencesSyncStatus = 'browser' | 'syncing' | 'synced' | 'offline'

interface CacheEntry {
  confirmed?: SearchAccountPreferences
  pending: PreferencePatch
}

interface AccountState {
  userId: string
  preferences: SearchAccountPreferences
  initial: SearchAccountPreferences | undefined
  status: Exclude<SearchPreferencesSyncStatus, 'browser'>
}

function sameValue(a: unknown, b: unknown) {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function loadCache(key: string): CacheEntry | undefined {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    if (!isRecord(value) || !isRecord(value.pending)) return
    const storedPatch = value.pending
    const pending = Object.fromEntries(Object.entries(readAccountPreferences(storedPatch))
      .filter(([field]) => Object.hasOwn(storedPatch, field))) as PreferencePatch
    return { confirmed: isRecord(value.confirmed) ? readAccountPreferences(value.confirmed) : undefined, pending }
  } catch {
    return undefined
  }
}

function saveCache(key: string, entry: CacheEntry) {
  try {
    window.localStorage.setItem(key, JSON.stringify(entry))
    return true
  } catch {
    // The in-memory entry still holds preferences and edits for this tab.
    return false
  }
}

function legacyPreferences(userId: string): SearchAccountPreferences | undefined {
  const candidate = accountPreferences(loadPreferences())
  if (sameValue(candidate, defaultSearchAccountPreferences)) return
  try {
    const owner = window.localStorage.getItem(migrationOwnerKey)
    if (owner && owner !== userId) return
    window.localStorage.setItem(migrationOwnerKey, userId)
    return candidate
  } catch {
    return undefined
  }
}

export function useSearchPreferences(userId: string | undefined) {
  const [browser, setBrowser] = useState(loadPreferences)
  const [account, setAccount] = useState<AccountState>()
  const accountActions = useRef<{ userId: string; patch: (patch: PreferencePatch) => void; sync: () => void }>(null)
  const current = account?.userId === userId ? account : undefined
  const preferences = userId ? { ...browser, ...(current?.preferences ?? defaultSearchAccountPreferences) } : browser

  useEffect(() => {
    const syncBrowser = (event: StorageEvent) => {
      if (event.key === null || event.key === preferencesStorageKey) setBrowser(loadPreferences())
    }
    window.addEventListener('storage', syncBrowser)
    return () => window.removeEventListener('storage', syncBrowser)
  }, [])

  useEffect(() => {
    if (!userId) {
      setAccount(undefined)
      return
    }
    const accountId = userId
    const key = accountKeyPrefix + accountId
    let entry = loadCache(key) ?? { pending: {} }
    const legacy = entry.confirmed ? undefined : legacyPreferences(accountId)
    let initial: SearchAccountPreferences | undefined
    let status: AccountState['status'] = 'syncing'
    let request: AbortController | undefined
    let disposed = false
    let followUp = false
    let storageAvailable = true
    const latestCache = () => (storageAvailable ? loadCache(key) : undefined) ?? entry
    const persist = () => { storageAvailable = saveCache(key, entry) }
    const readPreferences = () => ({ ...(entry.confirmed ?? legacy ?? defaultSearchAccountPreferences), ...entry.pending })
    const publish = () => setAccount({ userId: accountId, preferences: readPreferences(), initial, status })

    async function sync() {
      if (request || disposed) return
      const controller = new AbortController()
      request = controller
      const timeout = window.setTimeout(() => controller.abort(), 6_000)
      entry = latestCache()
      const sent = entry.pending
      const seed = entry.confirmed ? undefined : legacy
      status = 'syncing'
      publish()
      try {
        const result = seed || Object.keys(sent).length
          ? await api.updatePreferences(accountId, sent, seed, controller.signal)
          : await api.preferences(accountId, controller.signal)
        if (disposed) return
        // Allow edits made during the request to survive the server response.
        const pending = Object.fromEntries(Object.entries(latestCache().pending).filter(([field, value]) =>
          !Object.hasOwn(sent, field) || !sameValue(sent[field as keyof PreferencePatch], value))) as PreferencePatch
        entry = { confirmed: result.preferences ?? defaultSearchAccountPreferences, pending }
        persist()
        status = 'synced'
      } catch {
        status = 'offline'
      } finally {
        window.clearTimeout(timeout)
        request = undefined
        if (!disposed) {
          initial ??= readPreferences()
          publish()
          if (followUp) {
            followUp = false
            void sync()
          }
        }
      }
    }

    const refresh = () => { void sync() }
    const syncCache = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return
      entry = latestCache()
      publish()
    }
    accountActions.current = {
      userId: accountId,
      sync: refresh,
      patch(patch) {
        entry = latestCache()
        entry = { ...entry, pending: { ...entry.pending, ...patch } }
        persist()
        publish()
        if (request) followUp = true
        else refresh()
      },
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('storage', syncCache)
    refresh()
    return () => {
      disposed = true
      request?.abort()
      accountActions.current = null
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('storage', syncCache)
    }
  }, [userId])

  function update(next: Preferences) {
    const localChanged = next.theme !== preferences.theme || next.rememberRecentQueries !== preferences.rememberRecentQueries
    if (!userId || localChanged) {
      const local = userId ? { ...browser, theme: next.theme, rememberRecentQueries: next.rememberRecentQueries } : next
      savePreferences(local)
      setBrowser(local)
    }
    if (userId && accountActions.current?.userId === userId) {
      const patch = Object.fromEntries(Object.entries(accountPreferences(next)).filter(([field, value]) =>
        !sameValue(preferences[field as keyof SearchAccountPreferences], value))) as PreferencePatch
      if (Object.keys(patch).length) accountActions.current.patch(patch)
    }
  }

  const syncStatus: SearchPreferencesSyncStatus = userId ? current?.status ?? 'syncing' : 'browser'
  return {
    preferences,
    initialAccountPreferences: current?.initial,
    update,
    syncStatus,
    retrySync: () => accountActions.current?.sync(),
  }
}
