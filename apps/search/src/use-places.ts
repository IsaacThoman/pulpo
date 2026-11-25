import { useEffect, useRef, useState } from 'react'
import { api, SearchApiError } from './api'
import type { PlaceQuery, PlaceResponse } from './places'

export function usePlaces(input: PlaceQuery | undefined, userId: string | undefined) {
  const { query, location, openNow } = input ?? {}
  const [current, setCurrent] = useState<{ key: string; result: PlaceResponse | SearchApiError }>()
  const cache = useRef(new Map<string, { result: PlaceResponse; expiresAt: number }>())
  const [attempt, setAttempt] = useState(0)
  const key = query && userId ? JSON.stringify([userId, query, location, openNow]) : undefined
  useEffect(() => cache.current.clear(), [userId])
  useEffect(() => {
    if (!key || !query) return
    const cached = cache.current.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      setCurrent({ key, result: cached.result })
      return
    }
    setCurrent(undefined)
    const controller = new AbortController()
    api.places({ query, location, openNow }, controller.signal).then(result => {
      if (controller.signal.aborted) return
      cache.current.delete(key)
      if (cache.current.size >= 12) {
        const oldest = cache.current.keys().next().value
        if (oldest) cache.current.delete(oldest)
      }
      cache.current.set(key, { result, expiresAt: Date.now() + 120_000 })
      setCurrent({ key, result })
    }).catch(error => {
      if (!controller.signal.aborted) setCurrent({
        key, result: error instanceof SearchApiError ? error : new SearchApiError('Place search is temporarily unavailable.', 0),
      })
    })
    return () => controller.abort()
  }, [key, location, openNow, query, attempt])
  return {
    result: current?.key === key ? current?.result : undefined,
    retry: () => {
      if (key) cache.current.delete(key)
      setCurrent(undefined)
      setAttempt(value => value + 1)
    },
  }
}
