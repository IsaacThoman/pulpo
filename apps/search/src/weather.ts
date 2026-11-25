import { useEffect, useState } from 'react'
import { api, type WeatherAlerts, type WeatherResponse } from './api'

export function weatherLocation(query: string) {
  const requested = /^weather\s+(?:in\s+|for\s+)?(.+?)\??$/iu.exec(query.trim())?.[1]
    ?? /^(.+?)\s+weather\??$/iu.exec(query.trim())?.[1]
  if (requested && requested.length <= 150 && /^[\p{L}\p{M}][\p{L}\p{M}\d ,.'’()-]+$/u.test(requested)) return requested
}

export function useWeatherAnswer(location: string | undefined, userId: string | undefined) {
  const [current, setCurrent] = useState<{ location: string; userId: string; result: WeatherResponse | null }>()
  useEffect(() => {
    if (!location || !userId) return
    const controller = new AbortController()
    api.weather(location, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setCurrent({ location, userId, result })
      })
      .catch(() => {
        if (!controller.signal.aborted) setCurrent({ location, userId, result: null })
      })
    return () => controller.abort()
  }, [location, userId])
  return current?.location === location && current?.userId === userId ? current?.result : undefined
}

export function useWeatherAlerts(location: string | undefined, userId: string | undefined) {
  const [current, setCurrent] = useState<{ location: string; userId: string; result: WeatherAlerts }>()
  useEffect(() => {
    if (!location || !userId) return
    const controller = new AbortController()
    api.weatherAlerts(location, controller.signal).then(result => {
      if (!controller.signal.aborted) setCurrent({ location, userId, result })
    }).catch(() => {})
    return () => controller.abort()
  }, [location, userId])
  return current?.location === location && current?.userId === userId ? current?.result : undefined
}
