import { isSearchFaviconHost } from '@pulpo/contracts/search'

export interface SearchFavicon {
  type: string
  data: Buffer
}

const maxBytes = 64 * 1024
const timeoutMs = 1500
const hitTtl = 24 * 60 * 60 * 1000
const missTtl = 60 * 60 * 1000
// Timeouts and network errors are likely transient, so they retry sooner than a real 404.
const errorTtl = 5 * 60 * 1000
const maxEntries = 2000
const maxCacheBytes = 16 * 1024 * 1024
const imageTypes = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// Both sources are fetched server side, so neither sees the searcher's IP. gstatic returns a small
// 32px PNG (a 16px icon at 2x) and 404s unknown domains; DuckDuckGo covers what it misses.
const sources = [
  (host: string) => 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://' + host + '&size=32',
  (host: string) => 'https://icons.duckduckgo.com/ip3/' + host + '.ico',
]

type Result = SearchFavicon | 'miss' | 'error'

// Looks up the global lazily so tests that stub fetch after import still reach the stub.
export function createSearchFaviconFetcher(fetcher: typeof fetch = (input, init) => fetch(input, init), now = Date.now) {
  const cache = new Map<string, { icon: SearchFavicon | null, expires: number }>()
  const pending = new Map<string, Promise<SearchFavicon | null>>()
  let cacheBytes = 0

  const remove = (host: string) => {
    const entry = cache.get(host)
    if (!entry) return
    cache.delete(host)
    cacheBytes -= entry.icon?.data.byteLength ?? 0
  }

  const store = (host: string, icon: SearchFavicon | null, ttl: number) => {
    remove(host)
    cache.set(host, { icon, expires: now() + ttl })
    cacheBytes += icon?.data.byteLength ?? 0
    for (const oldest of cache.keys()) {
      if (cache.size <= maxEntries && cacheBytes <= maxCacheBytes) break
      remove(oldest)
    }
  }

  async function load(url: string): Promise<Result> {
    try {
      const response = await fetcher(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'image/*' },
      })
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (!response.ok || !type || !imageTypes.has(type) || Number(response.headers.get('content-length')) > maxBytes || !response.body) {
        await response.body?.cancel()
        return 'miss'
      }
      const reader = response.body.getReader()
      const parts: Uint8Array[] = []
      let size = 0
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          return 'miss'
        }
        parts.push(next.value)
      }
      return size ? { type, data: Buffer.concat(parts, size) } : 'miss'
    } catch {
      return 'error'
    }
  }

  async function resolve(host: string) {
    let failed = false
    for (const source of sources) {
      const result = await load(source(host))
      if (typeof result === 'object') {
        store(host, result, hitTtl)
        return result
      }
      failed ||= result === 'error'
    }
    store(host, null, failed ? errorTtl : missTtl)
    return null
  }

  return function fetchSearchFavicon(host: string): Promise<SearchFavicon | null> {
    if (!isSearchFaviconHost(host)) return Promise.resolve(null)
    const cached = cache.get(host)
    if (cached && cached.expires > now()) {
      // Re-insert so Map order tracks recency for LRU eviction.
      cache.delete(host)
      cache.set(host, cached)
      return Promise.resolve(cached.icon)
    }
    const inflight = pending.get(host)
    if (inflight) return inflight
    const promise = resolve(host).finally(() => pending.delete(host))
    pending.set(host, promise)
    return promise
  }
}

export const fetchSearchFavicon = createSearchFaviconFetcher()
