import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { modelPreferencesSchema } from '@pulpo/contracts'
import { LatestValueQueue } from '@pulpo/client-core'
import { apiRequest, ApiError, isNetworkError } from '@/lib/api'
import { enforceAttachmentQuota } from '@/lib/local-first/attachment-cache'
import { enqueueMutation } from '@/lib/local-first/outbox'
import { localAccountKey, localDb } from '@/lib/local-first/database'
import { useAuth } from '@/stores/auth'
import { useModels } from '@/stores/models'
import { DEFAULT_SETTINGS, normalizeLanguage, useSettings, type SettingsState } from '@/stores/settings'
import { isDesktopRuntime } from '@/lib/runtime'
import { normalizeAnimationSpeed } from '@/lib/animation-speed'

const persistedKeys = [
  'composerSyncEnabled', 'theme', 'language', 'sendWithEnter', 'doubleShiftSearch', 'streamResponses', 'showReasoning', 'showResponseCost',
  'chatWidth', 'animationSpeed', 'customInstructions', 'instructionPresetSelections', 'nickname', 'memoryEnabled', 'agentModes',
  'leaderboardVisible', 'leaderboardColor', 'generation',
  'localChatLimit',
  'localAttachmentCacheMb',
  'trashRetention',
  'automaticChatExpiration',
  'newChatAutoExpire',
  'defaultModelId',
  'sidebarPins',
] as const
type PersistedKey = typeof persistedKeys[number]
type SettingsDocument = {
  values: Record<string, unknown>
  newAccountFavoriteModelIds?: string[]
}

const settingsMutations = new LatestValueQueue<string, Record<string, unknown>, boolean>()
const modelPreferenceMutations = new LatestValueQueue<string, ReturnType<typeof modelPreferencesSnapshot>, boolean>()

function settingsSnapshot(keys: Iterable<PersistedKey>) {
  const state = useSettings.getState()
  return Object.fromEntries([...keys].map((key) => [key, state[key]]))
}

function sameSetting(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function persistSettings(userId: string, body: Record<string, unknown>): Promise<boolean> {
  const id = `settings-preferences:${localAccountKey(userId)}`
  try {
    await apiRequest('/api/settings', { method: 'PATCH', body })
    await localDb.outbox.delete(id)
    return true
  } catch (error) {
    if (!(isNetworkError(error) || (error instanceof ApiError && error.status >= 500))) throw error
    await enqueueMutation({ id, userId, method: 'PATCH', path: '/api/settings', body })
    return false
  }
}

function modelPreferencesSnapshot() {
  const state = useModels.getState()
  return {
    favoriteModelIds: state.favoriteModelIds,
    providerOrder: state.providerOrder,
  }
}

async function persistModelPreferences(userId: string, body: ReturnType<typeof modelPreferencesSnapshot>): Promise<boolean> {
  const id = `settings-model-preferences:${localAccountKey(userId)}`
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
  const instanceReady = useAuth((state) => state.instanceReady)
  const networkReady = !isDesktopRuntime() || instanceReady
  const attachmentCacheMb = useSettings((state) => state.localAttachmentCacheMb)
  const hydrated = useRef(false)
  const modelsHydrated = useRef(false)
  const modelsDirty = useRef(false)
  const dirtyKeys = useRef(new Set<PersistedKey>())
  const applyingRemote = useRef(false)
  const { data, refetch } = useQuery({
    queryKey: ['settings', userId],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => apiRequest<SettingsDocument>('/api/settings'),
    enabled: Boolean(networkReady && userId),
  })

  useEffect(() => {
    if (!userId) return
    if (useSettings.getState().ownerUserId !== userId) {
      useSettings.setState({ ...DEFAULT_SETTINGS, ownerUserId: userId })
      dirtyKeys.current.clear()
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

  const applyRemoteSettings = useCallback((remote: SettingsDocument) => {
    if (!userId) return
    applyingRemote.current = true
    try {
      const local = useSettings.getState()
      const next: Partial<SettingsState> = {
        ...DEFAULT_SETTINGS,
        ...remote.values,
        language: normalizeLanguage(remote.values.language),
        animationSpeed: normalizeAnimationSpeed(remote.values.animationSpeed),
        ownerUserId: userId,
      }
      for (const key of dirtyKeys.current) {
        if (sameSetting(remote.values[key], local[key])) dirtyKeys.current.delete(key)
        else next[key] = local[key] as never
      }
      useSettings.setState(next)
      const modelPreferences = modelPreferencesSchema.parse(remote.values)
      const newAccountFavoriteModelIds = remote.newAccountFavoriteModelIds ?? []
      const newAccountFavoritesLoaded = Array.isArray(remote.newAccountFavoriteModelIds)
      const localModels = modelPreferencesSnapshot()
      const matchesLocal = JSON.stringify(modelPreferences) === JSON.stringify(localModels)
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
  }, [userId])

  useEffect(() => {
    if (data) applyRemoteSettings(data)
  }, [applyRemoteSettings, data])

  useEffect(() => {
    if (!userId) return
    let timer: number | undefined
    const pendingKeys = dirtyKeys.current
    const unsubscribe = useSettings.subscribe((state, previous) => {
      if (!hydrated.current || applyingRemote.current) return
      for (const key of persistedKeys) {
        if (!sameSetting(state[key], previous[key])) pendingKeys.add(key)
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const body = settingsSnapshot(pendingKeys)
        void settingsMutations.enqueue(userId, body, (latest) => persistSettings(userId, latest)).then(async (saved) => {
          if (!saved) return
          const current = useSettings.getState()
          for (const key of [...pendingKeys]) {
            if (sameSetting(current[key], body[key])) pendingKeys.delete(key)
          }
          const refreshed = await refetch()
          if (refreshed.data) applyRemoteSettings(refreshed.data)
        })
      }, 500)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      hydrated.current = false
      pendingKeys.clear()
    }
  }, [applyRemoteSettings, refetch, userId])

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
        void modelPreferenceMutations.enqueue(userId, body, (latest) => persistModelPreferences(userId, latest)).then((saved) => {
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
