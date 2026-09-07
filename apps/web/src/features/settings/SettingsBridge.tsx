import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { modelPreferencesSchema } from '@pulpo/contracts'
import { dataProfileGeneration, LatestValueQueue } from '@pulpo/client-core'
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
  'composerSyncEnabled', 'theme', 'language', 'sendWithEnter', 'doubleShiftSearch', 'streamResponses', 'showPromptSuggestions', 'showReasoning', 'showResponseCost',
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

async function persistSettings(accountKey: string, body: Record<string, unknown>, generation: number, kind = 'preferences'): Promise<boolean> {
  const id = `settings-${kind}:${accountKey}`
  // Checkpoint before any request so switching/offline retries retain the original scope.
  await enqueueMutation({ id, userId: accountKey, method: 'PATCH', path: '/api/settings', body })
  if (generation !== dataProfileGeneration()) return false
  try {
    await apiRequest('/api/settings', { method: 'PATCH', body })
    await localDb.outbox.delete(id)
    return true
  } catch (error) {
    if (error instanceof ApiError && error.code === 'profile_changed') return false
    if (!(isNetworkError(error) || (error instanceof ApiError && error.status >= 500))) throw error
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
    queryFn: async () => {
      const generation = dataProfileGeneration()
      const accountKey = localAccountKey(userId!)
      const remote = await apiRequest<SettingsDocument>('/api/settings')
      const pending = await localDb.outbox.where('userId').equals(accountKey).toArray()
      if (generation !== dataProfileGeneration()) throw new ApiError(409, 'profile_changed', 'Profile changed')
      for (const mutation of pending) if (mutation.path === '/api/settings' && mutation.body) Object.assign(remote.values, mutation.body)
      return remote
    },
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
    const generation = dataProfileGeneration()
    const accountKey = localAccountKey(userId)
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
        void settingsMutations.enqueue(accountKey, body, (latest) => persistSettings(accountKey, latest, generation)).then(async (saved) => {
          if (!saved || generation !== dataProfileGeneration()) return
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
      if (pendingKeys.size) void persistSettings(accountKey, settingsSnapshot(pendingKeys), generation).catch(() => undefined)
      hydrated.current = false
      pendingKeys.clear()
    }
  }, [applyRemoteSettings, refetch, userId])

  useEffect(() => {
    if (!userId) return
    const generation = dataProfileGeneration()
    const accountKey = localAccountKey(userId)
    let timer: number | undefined
    const unsubscribe = useModels.subscribe((state, previous) => {
      if (!modelsHydrated.current || applyingRemote.current || state.ownerUserId !== userId) return
      if (state.favoriteModelIds === previous.favoriteModelIds && state.providerOrder === previous.providerOrder) return
      modelsDirty.current = true
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const body = modelPreferencesSnapshot()
        void modelPreferenceMutations.enqueue(accountKey, body, (latest) => persistSettings(accountKey, latest, generation, 'model-preferences')).then((saved) => {
          const current = modelPreferencesSnapshot()
          if (saved && generation === dataProfileGeneration() && JSON.stringify(current) === JSON.stringify(body)) {
            modelsDirty.current = false
            void refetch()
          }
        })
      }, 500)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      if (modelsDirty.current) void persistSettings(accountKey, modelPreferencesSnapshot(), generation, 'model-preferences').catch(() => undefined)
      modelsHydrated.current = false
      modelsDirty.current = false
    }
  }, [refetch, userId])

  return null
}
