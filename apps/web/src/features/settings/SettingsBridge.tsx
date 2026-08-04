import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api'
import { enforceAttachmentQuota } from '@/lib/local-first/attachment-cache'
import { useAuth } from '@/stores/auth'
import { DEFAULT_SETTINGS, useSettings } from '@/stores/settings'

const persistedKeys = [
  'theme', 'language', 'sendWithEnter', 'streamResponses', 'showReasoning',
  'chatWidth', 'notifications', 'customInstructions', 'nickname', 'memoryEnabled', 'agentModeEnabled',
  'leaderboardVisible', 'leaderboardColor', 'generation',
  'localChatLimit',
  'localAttachmentCacheMb',
  'trashRetention',
  'defaultModelId',
] as const

function settingsSnapshot() {
  const state = useSettings.getState()
  return Object.fromEntries(persistedKeys.map((key) => [key, state[key]]))
}

export function SettingsBridge() {
  const userId = useAuth((state) => state.user?.id)
  const attachmentCacheMb = useSettings((state) => state.localAttachmentCacheMb)
  const hydrated = useRef(false)
  const applyingRemote = useRef(false)
  const query = useQuery({
    queryKey: ['settings', userId],
    queryFn: () => apiRequest<{ values: Record<string, unknown> }>('/api/settings'),
    enabled: Boolean(userId),
  })

  useEffect(() => {
    if (!userId || useSettings.getState().ownerUserId === userId) return
    useSettings.setState({ ...DEFAULT_SETTINGS, ownerUserId: userId })
  }, [userId])

  useEffect(() => {
    if (userId) void enforceAttachmentQuota(userId, attachmentCacheMb)
  }, [userId, attachmentCacheMb])

  useEffect(() => {
    if (!query.data || !userId) return
    applyingRemote.current = true
    try {
      useSettings.setState({ ...DEFAULT_SETTINGS, ...query.data.values, ownerUserId: userId })
    } finally {
      applyingRemote.current = false
    }
    hydrated.current = true
  }, [query.data, userId])

  useEffect(() => {
    if (!userId) return
    let timer: number | undefined
    const unsubscribe = useSettings.subscribe(() => {
      if (!hydrated.current || applyingRemote.current) return
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
