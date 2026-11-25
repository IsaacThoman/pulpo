import { useEffect, useState } from 'react'
import { api } from './api'
import type { PlaceQuery, PlaceResponse } from './places'

export function usePlaces(input: PlaceQuery | undefined, userId: string | undefined) {
  const { query, location, openNow } = input ?? {}
  const [current, setCurrent] = useState<{ key: string; result: PlaceResponse | null }>()
  const key = query && userId ? JSON.stringify([userId, query, location, openNow]) : undefined
  useEffect(() => {
    if (!key || !query) return
    const controller = new AbortController()
    api.places({ query, location, openNow }, controller.signal).then(result => {
      if (!controller.signal.aborted) setCurrent({ key, result })
    }).catch(() => {
      if (!controller.signal.aborted) setCurrent({ key, result: null })
    })
    return () => controller.abort()
  }, [key, location, openNow, query])
  return current?.key === key ? current?.result : undefined
}
