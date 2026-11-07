// A deploy replaces every hashed file in /assets. A tab opened before the deploy still references
// the old names, so its next lazy page or modal 404s. Reloading at the current URL fetches the new
// index.html and its new chunks; a short guard stops a reload loop when an asset is really missing.

const RELOAD_KEY = 'pulpo:stale-build-reload'
const RELOAD_GUARD_MS = 10_000

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /unable to preload css/i, // Vite CSS preload
]

let reloading = false

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/** True once a stale-build reload has started; the page is about to be replaced. */
export function isReloadingForStaleBuild(): boolean {
  return reloading
}

/**
 * Reload once to pick up the current build. Returns false, without reloading, when a reload
 * already happened in the last few seconds or session storage is unavailable to track that.
 */
export function reloadForStaleBuild(storage: Storage = window.sessionStorage, now = Date.now()): boolean {
  if (reloading) return true
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0)
    if (now - last < RELOAD_GUARD_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
  } catch {
    return false
  }
  reloading = true
  window.location.reload()
  return true
}

/** Vite dispatches `vite:preloadError` when a dynamic import or its preloaded deps fail to load. */
export function installStaleBuildReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleBuild()) event.preventDefault()
  })
}
