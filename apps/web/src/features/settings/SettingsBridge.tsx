import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { modelPreferencesSchema } from '@pulpo/contracts'
import { apiRequest, ApiError, isNetworkError } from '@/lib/api'
import { enforceAttachmentQuota } from '@/lib/local-first/attachment-cache'
import { enqueueMutation } from '@/lib/local-first/outbox'
import { localDb } from '@/lib/local-first/database'
import { useAuth } from '@/stores/auth'
import { useModels } from '@/stores/models'
import { DEFAULT_SETTINGS, useSettings } from '@/stores/settings'

const persistedKeys = [
  'theme', 'language', 'sendWithEnter', 'streamResponses', 'showReasoning',
  'chatWidth', 'customInstructions', 'nickname', 'memoryEnabled', 'agentModeEnabled',
  'leaderboardVisible', 'leaderboardColor', 'generation',
  'localChatLimit',
  'localAttachmentCacheMb',
  'trashRetention',
  'automaticChatExpiration',
  'newChatAutoExpire',
  'defaultModelId',
] as const

function settingsSnapshot() {
  const state = useSettings.getState()
  return Object.fromEntries(persistedKeys.map((key) => [key, state[key]]))
}

function modelPreferencesSnapshot() {
  const state = useModels.getState()
  return {
    favoriteModelIds: state.favoriteModelIds,
    providerOrder: state.providerOrder,
  }
}

async function persistModelPreferences(userId: string, body: ReturnType<typeof modelPreferencesSnapshot>): Promise<boolean> {
  const id = `settings-model-preferences:${userId}`
  try {
    await apiRequest('/api/settings', { method: 'PATCH', body })
    await localDb.outbox.delete(id)
    return true
  } catch (error) {
    if (!(isNetworkError(error) || (error instanceof ApiError && error.status >= 500))) throw error
    await enqueueMutation({
      id,
      userId,
      method: 'PATCH',
      path: '/api/settings',
      body,
    })
    return false
  }
}

export function SettingsBridge() {
  const userId = useAuth((state) => state.user?.id)
  const attachmentCacheMb = useSettings((state) => state.localAttachmentCacheMb)
  const hydrated = useRef(false)
  const modelsHydrated = useRef(false)
  const modelsDirty = useRef(false)
  const applyingRemote = useRef(false)
  const { data, refetch } = useQuery({
    queryKey: ['settings', userId],
    queryFn: () => apiRequest<{
      values: Record<string, unknown>
      newAccountFavoriteModelIds?: string[]
    }>('/api/settings'),
    enabled: Boolean(userId),
  })

  useEffect(() => {
    if (!userId) return
    if (useSettings.getState().ownerUserId !== userId) {
      useSettings.setState({ ...DEFAULT_SETTINGS, ownerUserId: userId })
    }
    if (useModels.getState().ownerUserId !== userId) {
      useModels.setState({
        ownerUserId: userId,
        favoriteModelIds: [],
        newAccountFavoriteModelIds: [],
        newAccountFavoritesLoaded: false,
        providerOrder: [],
      })
    }
  }, [userId])

  useEffect(() => {
    if (userId) void enforceAttachmentQuota(userId, attachmentCacheMb)
  }, [userId, attachmentCacheMb])

  useEffect(() => {
    if (!data || !userId) return
    applyingRemote.current = true
    try {
      useSettings.setState({ ...DEFAULT_SETTINGS, ...data.values, ownerUserId: userId })
      const modelPreferences = modelPreferencesSchema.parse(data.values)
      const newAccountFavoriteModelIds = data.newAccountFavoriteModelIds ?? []
      const newAccountFavoritesLoaded = Array.isArray(data.newAccountFavoriteModelIds)
      const local = modelPreferencesSnapshot()
      const matchesLocal = JSON.stringify(modelPreferences) === JSON.stringify(local)
      if (!modelsDirty.current || matchesLocal) {
        useModels.setState({
          ...modelPreferences,
          ownerUserId: userId,
          newAccountFavoriteModelIds,
          newAccountFavoritesLoaded,
        })
        modelsDirty.current = false
      } else {
        useModels.setState({
          newAccountFavoriteModelIds,
          newAccountFavoritesLoaded,
        })
      }
    } finally {
      applyingRemote.current = false
    }
    hydrated.current = true
    modelsHydrated.current = true
  }, [data, userId])

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

  useEffect(() => {
    if (!userId) return
    let timer: number | undefined
    const unsubscribe = useModels.subscribe((state, previous) => {
      if (!modelsHydrated.current || applyingRemote.current || state.ownerUserId !== userId) return
      if (state.favoriteModelIds === previous.favoriteModelIds && state.providerOrder === previous.providerOrder) return
      modelsDirty.current = true
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const body = modelPreferencesSnapshot()
        void persistModelPreferences(userId, body).then((saved) => {
          const current = modelPreferencesSnapshot()
          if (saved && JSON.stringify(current) === JSON.stringify(body)) {
            modelsDirty.current = false
            void refetch()
          }
        })
      }, 500)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      modelsHydrated.current = false
      modelsDirty.current = false
    }
  }, [refetch, userId])

  return null
}
