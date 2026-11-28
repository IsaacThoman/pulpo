import { useEffect, useRef, useState } from 'react'
import { api, SearchApiError, type SearchRequest, type SearchResponse } from './api'

interface CacheEntry {
  data: SearchResponse
  savedAt: number
  /** How long the search took when it was fetched, in milliseconds. */
  elapsedMs?: number
}

interface Stored extends CacheEntry {
  key: string
  user: string
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: SearchResponse; elapsedMs?: number }
  | { status: 'error'; error: SearchApiError }

const cachedFor = 5 * 60_000
// Matches how long Load more keeps its batches, so a restored search has the first page its batches continue.
const storedFor = 30 * 60_000
const storageKey = 'pulpo-search-first-v1'
const storedSearches = 5
const maxStoredLength = 200_000

function readStored(): Stored[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value.filter((entry): entry is Stored => Boolean(entry) && typeof entry === 'object'
      && typeof entry.key === 'string' && typeof entry.user === 'string' && typeof entry.savedAt === 'number'
      && Date.now() - entry.savedAt < storedFor && Array.isArray(entry.data?.results)) : []
  } catch {
    return []
  }
}

function writeStored(entries: Stored[]) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(entries))
    return true
  } catch {
    return false
  }
}

/** Keeps first pages in this tab so going back or reloading shows them again without another paid search. */
function store(entry: Stored) {
  if (JSON.stringify(entry).length > maxStoredLength) return
  // Only the signed-in account's searches are kept, and a full storage keeps at least the newest one.
  const others = readStored().filter(item => item.key !== entry.key && item.user === entry.user)
  if (!writeStored([entry, ...others].slice(0, storedSearches))) writeStored([entry])
}

function forget(key: string) {
  const entries = readStored()
  if (entries.some(entry => entry.key === key)) writeStored(entries.filter(entry => entry.key !== key))
}

/**
 * Runs a search for one account. Results stay in memory for a few minutes; `restore` (reloading or going back)
 * also accepts this tab's saved copy for longer, since the reader is returning to results they already paid for.
 */
export function useSearch(userId: string | undefined, search: SearchRequest | null, restore = false) {
  const cache = useRef(new Map<string, CacheEntry>())
  const restoring = useRef(restore)
  restoring.current = restore
  const [retry, setRetry] = useState(0)
  const [response, setResponse] = useState<{ key: string; value: SearchState }>()
  const serialized = search ? JSON.stringify(search) : ''
  const key = userId && serialized ? JSON.stringify([userId, serialized]) : ''

  useEffect(() => {
    cache.current.clear()
  }, [userId])

  useEffect(() => {
    if (!key || !userId) return
    const returning = restoring.current
    const existing = cache.current.get(key) ?? (returning ? readStored().find(entry => entry.key === key) : undefined)
    if (existing && Date.now() - existing.savedAt < (returning ? storedFor : cachedFor)) {
      setResponse({ key, value: { status: 'success', data: existing.data, elapsedMs: existing.elapsedMs } })
      return
    }
    const controller = new AbortController()
    const input = JSON.parse(serialized) as SearchRequest
    const started = performance.now()
    let request: Promise<SearchResponse>
    if ('reusable' in input) {
      const { reusable: _reusable, ...fields } = input
      request = api.reusableImages(fields, controller.signal)
    } else {
      request = api.search(input, controller.signal)
    }
    request.then(data => {
      if (controller.signal.aborted) return
      const entry = { data, savedAt: Date.now(), elapsedMs: performance.now() - started }
      cache.current.delete(key)
      // A search an engine couldn't fully answer isn't kept, so returning to it asks again.
      if (!data.degraded) {
        if (cache.current.size >= 20) {
          const oldest = cache.current.keys().next().value
          if (oldest) cache.current.delete(oldest)
        }
        cache.current.set(key, entry)
        store({ ...entry, key, user: userId })
      }
      setResponse({ key, value: { status: 'success', data, elapsedMs: entry.elapsedMs } })
    }).catch(error => {
      if (controller.signal.aborted) return
      setResponse({ key, value: { status: 'error', error: error instanceof SearchApiError ? error
        : new SearchApiError('Pulpo Search returned an unexpected response.', 0) } })
    })
    return () => controller.abort()
  }, [key, retry, serialized, userId])

  const state: SearchState = key
    ? response?.key === key ? response.value : { status: 'loading' }
    : { status: 'idle' }

  return {
    state,
    refresh: () => {
      cache.current.delete(key)
      forget(key)
      setResponse(undefined)
      setRetry(value => value + 1)
    },
  }
}
