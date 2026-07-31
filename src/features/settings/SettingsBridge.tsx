import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'

const persistedKeys = [
  'theme', 'language', 'sendWithEnter', 'streamResponses', 'showReasoning',
  'chatWidth', 'notifications', 'customInstructions', 'nickname', 'memoryEnabled', 'generation',
  'localChatLimit',
] as const

function settingsSnapshot() {
  const state = useSettings.getState()
  return Object.fromEntries(persistedKeys.map((key) => [key, state[key]]))
}

export function SettingsBridge() {
  const userId = useAuth((state) => state.user?.id)
  const hydrated = useRef(false)
  const query = useQuery({
    queryKey: ['settings', userId],
    queryFn: () => apiRequest<{ values: Record<string, unknown> }>('/api/settings'),
    enabled: Boolean(userId),
  })

  useEffect(() => {
    if (!query.data) return
    if (Object.keys(query.data.values).length) useSettings.setState(query.data.values)
    hydrated.current = true
  }, [query.data])

  useEffect(() => {
    if (!userId) return
    let timer: number | undefined
    const unsubscribe = useSettings.subscribe(() => {
      if (!hydrated.current) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void apiRequest('/api/settings', { method: 'PATCH', body: settingsSnapshot() })
      }, 500)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      hydrated.current = false
    }
  }, [userId])

  return null
}
