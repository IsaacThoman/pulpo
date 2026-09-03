const REALTIME_CLIENT_ID_KEY = 'pulpo-tab-id'
let memoryClientId: string | null = null

/** Stable for the lifetime of one browser tab, including composer remounts. */
export function webRealtimeClientId(): string {
  if (memoryClientId) return memoryClientId
  if (typeof sessionStorage !== 'undefined') {
    const existing = sessionStorage.getItem(REALTIME_CLIENT_ID_KEY)
    if (existing) {
      memoryClientId = existing
      return existing
    }
  }
  memoryClientId = crypto.randomUUID()
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(REALTIME_CLIENT_ID_KEY, memoryClientId)
  return memoryClientId
}
