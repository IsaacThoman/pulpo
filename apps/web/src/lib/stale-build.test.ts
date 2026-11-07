// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('stale build reload', () => {
  const reload = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    reload.mockReset()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recognizes chunk load failures from each browser engine', async () => {
    const { isChunkLoadError } = await import('./stale-build')
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://pulpo.baby/assets/FriendsPage-a1b2.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://pulpo.baby/assets/x.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true)
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('reloads once, then refuses within the guard window', async () => {
    const { reloadForStaleBuild, isReloadingForStaleBuild } = await import('./stale-build')
    const storage = memoryStorage()
    expect(reloadForStaleBuild(storage, 1_000_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(isReloadingForStaleBuild()).toBe(true)

    // The reloaded page starts with fresh module state but the same session storage.
    vi.resetModules()
    const fresh = await import('./stale-build')
    expect(fresh.reloadForStaleBuild(storage, 1_005_000)).toBe(false)
    expect(fresh.reloadForStaleBuild(storage, 1_011_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload when session storage is unavailable', async () => {
    const { reloadForStaleBuild } = await import('./stale-build')
    const storage = memoryStorage()
    storage.getItem = () => { throw new Error('SecurityError') }
    expect(reloadForStaleBuild(storage)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('cancels the Vite preload error only when it reloads', async () => {
    const { installStaleBuildReload } = await import('./stale-build')
    const storage = memoryStorage()
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(storage)
    installStaleBuildReload()

    const first = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
