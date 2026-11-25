import { useEffect, useRef, useState } from 'react'
import { api, SearchApiError, type SearchInput, type SearchResponse } from './api'

interface CacheEntry {
  data: SearchResponse
  savedAt: number
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: SearchResponse }
  | { status: 'error'; error: SearchApiError }

export function useSearch(userId: string | undefined, search: SearchInput | null) {
  const cache = useRef(new Map<string, CacheEntry>())
  const [retry, setRetry] = useState(0)
  const [response, setResponse] = useState<{ key: string; value: SearchState }>()
  const serialized = search ? JSON.stringify(search) : ''
  const key = userId && serialized ? JSON.stringify([userId, serialized]) : ''

  useEffect(() => {
    cache.current.clear()
  }, [userId])

  useEffect(() => {
    if (!key) return
    const existing = cache.current.get(key)
    if (existing && Date.now() - existing.savedAt < 5 * 60_000) {
      setResponse({ key, value: { status: 'success', data: existing.data } })
      return
    }
    const controller = new AbortController()
    api.search(JSON.parse(serialized), controller.signal).then(data => {
      if (controller.signal.aborted) return
      cache.current.delete(key)
      if (cache.current.size >= 20) {
        const oldest = cache.current.keys().next().value
        if (oldest) cache.current.delete(oldest)
      }
      cache.current.set(key, { data, savedAt: Date.now() })
      setResponse({ key, value: { status: 'success', data } })
    }).catch(error => {
      if (!controller.signal.aborted) setResponse({ key, value: { status: 'error', error } })
    })
    return () => controller.abort()
  }, [key, retry, serialized])

  const state: SearchState = key
    ? response?.key === key ? response.value : { status: 'loading' }
    : { status: 'idle' }

  return {
    state,
    refresh: () => {
      cache.current.delete(key)
      setResponse(undefined)
      setRetry(value => value + 1)
    },
  }
}
