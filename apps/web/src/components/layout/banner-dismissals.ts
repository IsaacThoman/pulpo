const STORAGE_KEY = 'pulpo.banners.dismissed'

export function readDismissedBannerIds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeDismissedBannerIds(ids: Iterable<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // Storage can be full or disabled; dismissal then lasts for this session only.
  }
}

export function dismissBanner(id: string): void {
  writeDismissedBannerIds(new Set([...readDismissedBannerIds(), id]))
}

/** Drops remembered dismissals for banners the server no longer returns so storage stays bounded. */
export function pruneDismissedBannerIds(activeIds: readonly string[]): void {
  const dismissed = readDismissedBannerIds()
  const kept = activeIds.filter((id) => dismissed.has(id))
  if (kept.length !== dismissed.size) writeDismissedBannerIds(kept)
}
