import { useEffect, useMemo, useRef } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { idSchema } from '@pulpo/contracts'
import { hydrateEmbeddedResponseSnapshot, LatestValueQueue } from '@pulpo/client-core'
import { useShallow } from 'zustand/react/shallow'
import { cacheNamespace, cachedChats, completeOutboxEntity, getValue, pruneCachedChatScope } from '../../../data/database'
import { enqueueCacheWrite } from '../../../data/writeBehind'
import { chatQuery, chatsQuery, deletedChatsQuery, foldersQuery, modelsQuery, queryKeys, type ModelCatalog } from '../../../data/queries'
import { ApiError, isNetworkError, mobileApi } from '../../../api/client'
import { queueOfflineMutation } from '../../../data/mutations'
import { projectChat, type DisplayMessage } from '../../../features/chat/projection'
import { createFolder, deleteFolder, permanentlyDeleteChat, restoreChat, trashChat, updateChat, updateFolder } from '../../../features/chat/api'
import { useRealtimeStore, subscribeToChat, subscribeToResponse } from '../../../providers/realtimeStore'
import { preferencePatchForServer, preferencesFromServer, usePreferencesStore } from '../../../store/preferences'
import { useSessionStore } from '../../../store/session'
import type { ServerChat, ServerFolder } from '../../../types'
import type { ActivityStep, PrototypeAttachment, PrototypeChat, PrototypeMessage } from '../domain'
import { mapModel } from '../modelIdentity'
import { warmModelCatalogIcons } from './AiIconAssets'
import { usePrototypeStore } from '../store/prototypeStore'
import { configureProductionActions } from './productionActions'
import { reuseProjectedMessages } from './messageReuse'
import {
  acknowledgeOptimisticChatList,
  clearPendingOptimisticResponses,
  pendingOptimisticChatIds,
  pendingOptimisticResponseIds,
  reconcileOptimisticResponses,
} from './optimisticResponses'
import {
  clearOptimisticBranchSelections,
  reconcileOptimisticBranchSelection,
} from './optimisticBranches'

function mapAttachment(attachment: DisplayMessage['attachments'][number]): PrototypeAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
    status: 'ready',
  }
}

function mapMessage(message: DisplayMessage): PrototypeMessage {
  const activity: ActivityStep[] = [
    ...(message.reasoning ? [{
      id: `${message.id}:reasoning`, kind: 'reasoning' as const, title: 'Reasoned about the request',
      detail: message.reasoning, durationMs: 0, status: message.status === 'completed' ? 'complete' as const : 'active' as const,
    }] : []),
    ...message.activity.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      durationMs: item.durationMs ?? 0,
      status: item.status === 'failed' ? 'failed' as const : item.status === 'completed' || item.status === 'complete' ? 'complete' as const : 'active' as const,
    })),
  ]
  const status: PrototypeMessage['status'] = message.status === 'completed' ? 'complete'
    : message.status === 'failed' ? 'failed'
      : message.status === 'cancelled' || message.status === 'incomplete' ? 'stopped'
        : message.status === 'queued' ? 'queued' : 'streaming'
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: Date.parse(message.createdAt),
    latencyMs: message.latencyMs,
    modelId: message.modelId,
    attachments: message.attachments.map(mapAttachment),
    activity,
    status,
    error: message.error,
    outputItems: message.outputItems,
    agentMode: message.agentMode,
    meta: message.usage ? `${message.usage.inputTokens.toLocaleString()}→${message.usage.outputTokens.toLocaleString()} tok` : undefined,
    branches: message.branch.variants.length > 1 ? message.branch.variants.map((branch) => ({
      ...branch,
      createdAt: Date.parse(branch.createdAt),
    })) : undefined,
    activeBranch: message.branch.index,
  }
}

function mapChat(chat: ServerChat, messages: PrototypeMessage[] = [], detailLoaded = false): PrototypeChat {
  return {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    createdAt: Date.parse(chat.createdAt),
    updatedAt: Date.parse(chat.updatedAt),
    pinned: chat.pinned,
    folderId: chat.folderId,
    temporary: chat.temporary,
    expiresAt: chat.expiresAt ? Date.parse(chat.expiresAt) : null,
    expired: false,
    detailLoaded: detailLoaded || chat.responses !== undefined,
    messages,
    deletedAt: chat.deletedAt ? Date.parse(chat.deletedAt) : null,
    purgeAt: chat.purgeAt ? Date.parse(chat.purgeAt) : null,
  }
}

let scopeHydrationToken = 0

function clearProductionScopeState(): void {
  clearPendingOptimisticResponses()
  clearOptimisticBranchSelections()
  usePrototypeStore.setState({
    productionNamespace: null,
    productionScopeReady: false,
    modelPickerScopeReady: false,
    modelCatalogReady: false,
    chats: [],
    folders: [],
    models: [],
    defaultModelId: '',
    agentAvailable: false,
  })
}

// oxlint-disable-next-line react/only-export-components -- production scope lifecycle API
export function clearProductionScope(): void {
  scopeHydrationToken += 1
  clearProductionScopeState()
}

/** Clear the previous production scope, then hydrate only namespaced SQLite data. */
// oxlint-disable-next-line react/only-export-components -- production scope lifecycle API
export async function hydrateProductionScope(namespace: string): Promise<void> {
  const token = ++scopeHydrationToken
  clearProductionScopeState()
  usePrototypeStore.setState({ productionNamespace: namespace })

  const preferenceHydration = (async () => {
    const store = usePreferencesStore.getState()
    if (store.synchronizedOwnerNamespace !== namespace) {
      await store.resetSynchronizedPreferences(namespace)
    }
    return usePreferencesStore.getState()
  })().catch(() => usePreferencesStore.getState())
  const pickerHydration = Promise.all([
    getValue<ModelCatalog>(namespace, 'model-catalog').catch(() => null),
    preferenceHydration,
  ]).then(([catalog, preferences]) => {
    if (token !== scopeHydrationToken) return
    usePrototypeStore.setState((state) => {
      if (state.productionNamespace !== namespace) return state
      return {
        modelPickerScopeReady: true,
        modelCatalogReady: catalog !== null,
        models: (catalog?.data ?? []).map((model) => mapModel(model, preferences.favoriteModelIds)),
        defaultModelId: preferences.defaultModelId ?? catalog?.data[0]?.id ?? '',
        agentAvailable: catalog?.agentAvailable ?? false,
        preferences: {
          ...state.preferences,
          theme: preferences.theme,
          textSize: preferences.textSize,
          streamResponses: preferences.streamResponses,
          showReasoning: preferences.showReasoning,
          memoryEnabled: preferences.memoryEnabled,
          haptics: preferences.haptics,
          sendWithEnter: preferences.sendWithEnter,
          attachmentCacheMb: preferences.attachmentCacheMb,
          localChatLimit: preferences.localChatLimit,
          trashRetention: preferences.trashRetention,
          automaticChatExpiration: preferences.automaticChatExpiration,
          newChatAutoExpire: preferences.newChatAutoExpire,
        },
      }
    })
    if (catalog) void warmModelCatalogIcons(catalog.data)
  })

  const chatHydration = Promise.all([
    cachedChats(namespace).catch(() => []),
    getValue<ServerFolder[]>(namespace, 'folders').catch(() => null),
  ]).then(([localChats, localFolders]) => {
    if (token !== scopeHydrationToken) return
    const liveSnapshots = useRealtimeStore.getState().snapshots
    usePrototypeStore.setState((state) => state.productionNamespace === namespace ? {
      productionScopeReady: true,
      chats: localChats.filter((chat) => !chat.temporary).map((chat) => mapChat(
        chat,
        chat.responses ? projectChat(chat, liveSnapshots).map(mapMessage) : [],
        Boolean(chat.responses),
      )),
      folders: (localFolders ?? []).map((folder) => ({ id: folder.id, name: folder.name, expanded: true })),
    } : state)
  })

  await Promise.all([pickerHydration, chatHydration])
}

/** Fetch one uncached transcript for a context-menu preview without selecting the chat. */
// oxlint-disable-next-line react/only-export-components -- production preview hydration API
export async function hydrateProductionChatPreview(
  queryClient: QueryClient,
  namespace: string,
  chatId: string,
  localChatLimit: number,
): Promise<void> {
  const current = usePrototypeStore.getState()
  if (current.productionNamespace !== namespace) return
  if (current.chats.find((chat) => chat.id === chatId)?.detailLoaded) return

  const detail = await queryClient.fetchQuery(chatQuery(namespace, chatId, localChatLimit))
  for (const response of detail.responses ?? []) {
    if (response.detailAvailable === false) continue
    useRealtimeStore.getState().receiveSnapshot(hydrateEmbeddedResponseSnapshot(response.snapshot, response.output))
  }
  const projected = projectChat(detail, useRealtimeStore.getState().snapshots).map(mapMessage)
  usePrototypeStore.setState((state) => ({
    chats: state.productionNamespace === namespace
      ? state.chats.map((chat) => chat.id === chatId
        ? mapChat(detail, reuseProjectedMessages(chat.messages, projected), true)
        : chat)
      : state.chats,
  }))
}

async function offlineCapableMutation<T>(input: {
  namespace: string
  entityKey: string
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  request: () => Promise<T>
}): Promise<T | undefined> {
  try {
    if (input.entityKey.startsWith('setting:')) {
      // A newer whole-value setting mutation supersedes any older queued value.
      await completeOutboxEntity(input.namespace, input.entityKey)
    }
    return await input.request()
  } catch (error) {
    if (!isNetworkError(error)) throw error
    await queueOfflineMutation(input)
    return undefined
  }
}

type SettingsMutationResult = Awaited<ReturnType<typeof mobileApi.updateSettings>> | undefined
const settingMutations = new LatestValueQueue<string, Record<string, unknown>, SettingsMutationResult>()

function persistLatestSetting(
  namespace: string,
  serverKey: string,
  body: Record<string, unknown>,
): Promise<SettingsMutationResult> {
  const entityKey = `setting:${serverKey}`
  return settingMutations.enqueue(`${namespace}:${serverKey}`, body, (latestBody) => offlineCapableMutation({
    namespace,
    entityKey,
    method: 'PATCH',
    path: '/api/settings',
    body: latestBody,
    request: () => mobileApi.updateSettings(latestBody),
  }))
}

export function ProductionBridge({ activeChatId }: { activeChatId: string | null }) {
  const status = useSessionStore((state) => state.status)
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const userId = useSessionStore((state) => state.user?.id)
  // Keep composer-only changes (notably per-model preset selections) from
  // rebuilding the model catalogue and every native model control.
  const preferences = usePreferencesStore(useShallow((state) => ({
    theme: state.theme,
    textSize: state.textSize,
    streamResponses: state.streamResponses,
    showReasoning: state.showReasoning,
    memoryEnabled: state.memoryEnabled,
    haptics: state.haptics,
    sendWithEnter: state.sendWithEnter,
    attachmentCacheMb: state.attachmentCacheMb,
    localChatLimit: state.localChatLimit,
    trashRetention: state.trashRetention,
    automaticChatExpiration: state.automaticChatExpiration,
    newChatAutoExpire: state.newChatAutoExpire,
    favoriteModelIds: state.favoriteModelIds,
    providerOrder: state.providerOrder,
    defaultModelId: state.defaultModelId,
  })))
  const namespace = useMemo(() => userId ? cacheNamespace(instanceUrl, userId) : 'anonymous', [instanceUrl, userId])
  const productionNamespace = usePrototypeStore((state) => state.productionNamespace)
  const productionScopeReady = usePrototypeStore((state) => state.productionScopeReady)
  const modelPickerScopeReady = usePrototypeStore((state) => state.modelPickerScopeReady)
  const scopeOwned = status === 'authenticated'
    && Boolean(userId)
    && productionNamespace === namespace
  const enabled = scopeOwned
    && productionScopeReady
  const pickerEnabled = scopeOwned && modelPickerScopeReady
  const activeChatIsServerAddressable = Boolean(activeChatId && idSchema.safeParse(activeChatId).success)
  const serverHydrated = useRef(false)
  const chats = useQuery({ ...chatsQuery(namespace, preferences.localChatLimit), enabled })
  const deleted = useQuery({ ...deletedChatsQuery(namespace, preferences.localChatLimit), enabled })
  const folders = useQuery({ ...foldersQuery(namespace), enabled })
  const models = useQuery({ ...modelsQuery(namespace), enabled: pickerEnabled })
  const settings = useQuery({ queryKey: queryKeys.settings(namespace), queryFn: mobileApi.settings, enabled: pickerEnabled })
  const detail = useQuery({
    ...chatQuery(namespace, activeChatId ?? '', preferences.localChatLimit),
    enabled: enabled && activeChatIsServerAddressable,
  })
  const detailResponseIds = useMemo(() => {
    const ids = new Set((detail.data?.responses ?? []).map((response) => response.id))
    if (activeChatId) {
      for (const responseId of pendingOptimisticResponseIds(namespace, activeChatId)) ids.add(responseId)
    }
    return [...ids]
  }, [activeChatId, detail.data?.responses, namespace])
  const snapshots = useRealtimeStore(useShallow((state) => Object.fromEntries(
    detailResponseIds.flatMap((responseId) => state.snapshots[responseId]
      ? [[responseId, state.snapshots[responseId]]]
      : []),
  )))
  const reconciledDetail = useMemo(
    () => detail.data
      ? reconcileOptimisticBranchSelection(
        namespace,
        reconcileOptimisticResponses(namespace, detail.data, snapshots),
      )
      : undefined,
    [detail.data, namespace, snapshots],
  )
  const activeResponseSubscriptionIds = useMemo(() => (reconciledDetail?.responses ?? [])
    .filter((response) => response.status === 'queued' || response.status === 'in_progress')
    .map((response) => response.id)
    .sort()
    .join('\n'), [reconciledDetail?.responses])

  useEffect(() => { serverHydrated.current = false }, [namespace])

  useEffect(() => {
    if (!userId || usePreferencesStore.getState().synchronizedOwnerNamespace === namespace) return
    void usePreferencesStore.getState().resetSynchronizedPreferences(namespace)
  }, [namespace, userId])

  useEffect(() => {
    configureProductionActions({
      renameChat: (id, title) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'PATCH', path: `/api/chats/${id}`, body: { title }, request: () => updateChat(id, { title }) }),
      togglePin: (id, pinned) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'PATCH', path: `/api/chats/${id}`, body: { pinned }, request: () => updateChat(id, { pinned }) }),
      moveChat: (id, folderId) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'PATCH', path: `/api/chats/${id}`, body: { folderId }, request: () => updateChat(id, { folderId }) }),
      setChatAutoExpiration: (id, enabled) => offlineCapableMutation({ namespace, entityKey: `chat:${id}:expiration`, method: 'PATCH', path: `/api/chats/${id}`, body: { autoExpire: enabled }, request: () => updateChat(id, { autoExpire: enabled }) }),
      trashChat: (id) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'DELETE', path: `/api/chats/${id}`, request: () => trashChat(id) }),
      trashAllChats: () => offlineCapableMutation({ namespace, entityKey: 'chats:all', method: 'DELETE', path: '/api/chats', request: () => mobileApi.trashAllChats() }),
      restoreChat: (id) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'POST', path: `/api/chats/${id}/recover`, request: () => restoreChat(id) }),
      permanentlyDeleteChat: (id) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'DELETE', path: `/api/chats/${id}/permanent`, request: () => permanentlyDeleteChat(id) }),
      emptyTrash: () => offlineCapableMutation({ namespace, entityKey: 'trash:all', method: 'DELETE', path: '/api/chats/deleted', request: () => mobileApi.emptyTrash() }),
      createFolder: (name, clientId) => offlineCapableMutation({ namespace, entityKey: `folder:${clientId}`, method: 'POST', path: '/api/folders', body: { name, clientId }, request: () => createFolder(name, clientId) }),
      renameFolder: (id, name) => offlineCapableMutation({ namespace, entityKey: `folder:${id}`, method: 'PATCH', path: `/api/folders/${id}`, body: { name }, request: () => updateFolder(id, { name }) }),
      deleteFolder: (id) => offlineCapableMutation({ namespace, entityKey: `folder:${id}`, method: 'DELETE', path: `/api/folders/${id}`, request: () => deleteFolder(id) }),
      setPreference: async (key, value) => {
        const persisted = usePreferencesStore.getState().setPreference(key, value)
        const body = preferencePatchForServer(key, value)
        if (!body) return persisted
        const serverKey = Object.keys(body)[0] ?? String(key)
        const saved = await persistLatestSetting(namespace, serverKey, body)
        await persisted
        if (saved) {
          await usePreferencesStore.getState().markSynchronizedPreferenceSynced(key, value)
          const latest = await mobileApi.settings()
          await usePreferencesStore.getState().applyServerPreferences(preferencesFromServer(latest.values))
        }
      },
      toggleFavoriteModel: async (modelId: string, favorite: boolean) => {
        const current = usePreferencesStore.getState().favoriteModelIds
        const next = favorite
          ? [...current.filter((id) => id !== modelId), modelId]
          : current.filter((id) => id !== modelId)
        const persisted = usePreferencesStore.getState().setPreference('favoriteModelIds', next)
        const saved = await persistLatestSetting(namespace, 'favoriteModelIds', { favoriteModelIds: next })
        await persisted
        if (saved) {
          await usePreferencesStore.getState().markSynchronizedPreferenceSynced('favoriteModelIds', next)
          const latest = await mobileApi.settings()
          await usePreferencesStore.getState().applyServerPreferences(preferencesFromServer(latest.values))
        }
      },
    })
  }, [namespace])

  useEffect(() => {
    if (!settings.data) return
    if (usePrototypeStore.getState().productionNamespace !== namespace) return
    const patch = preferencesFromServer(settings.data.values)
    void usePreferencesStore.getState().applyServerPreferences(patch)
  }, [namespace, settings.data])

  useEffect(() => {
    if (models.data) void warmModelCatalogIcons(models.data.data)
  }, [models.data])

  useEffect(() => {
    if (!enabled || !activeChatId || !activeChatIsServerAddressable) return
    const unsubscribeChat = subscribeToChat(activeChatId)
    const unsubscribers = activeResponseSubscriptionIds
      ? activeResponseSubscriptionIds.split('\n').map((responseId) => subscribeToResponse(
        responseId,
        useRealtimeStore.getState().snapshots[responseId]?.sequence ?? 0,
      ))
      : []
    return () => { unsubscribeChat(); unsubscribers.forEach((unsubscribe) => unsubscribe()) }
  }, [activeChatId, activeChatIsServerAddressable, activeResponseSubscriptionIds, enabled])

  useEffect(() => {
    usePrototypeStore.setState((state) => {
      if (state.productionNamespace !== namespace) return state
      return {
        preferences: {
          ...state.preferences,
          theme: preferences.theme,
          textSize: preferences.textSize,
          streamResponses: preferences.streamResponses,
          showReasoning: preferences.showReasoning,
          memoryEnabled: preferences.memoryEnabled,
          haptics: preferences.haptics,
          sendWithEnter: preferences.sendWithEnter,
          attachmentCacheMb: preferences.attachmentCacheMb,
          localChatLimit: preferences.localChatLimit,
          trashRetention: preferences.trashRetention,
          automaticChatExpiration: preferences.automaticChatExpiration,
          newChatAutoExpire: preferences.newChatAutoExpire,
        },
        defaultModelId: preferences.defaultModelId ?? models.data?.data[0]?.id ?? state.defaultModelId,
        models: models.data ? models.data.data.map((model) => mapModel(model, preferences.favoriteModelIds)) : state.models,
        modelCatalogReady: Boolean(models.data) || models.isError || state.modelCatalogReady,
        agentAvailable: models.data?.agentAvailable ?? state.agentAvailable,
      }
    })
  }, [models.data, models.isError, namespace, preferences])

  useEffect(() => {
    if (!chats.data && !deleted.data && !folders.data) return
    serverHydrated.current = true
    usePrototypeStore.setState((state) => {
      if (state.productionNamespace !== namespace) return state
      const oldChats = new Map(state.chats.map((chat) => [chat.id, chat]))
      const serverChats = [...(chats.data ?? []), ...(deleted.data ?? [])]
      const serverChatIds = new Set(serverChats.map((chat) => chat.id))
      acknowledgeOptimisticChatList(namespace, serverChatIds)
      const pendingChatIds = pendingOptimisticChatIds(namespace)
      const pendingLocalChats = state.chats.filter((chat) => pendingChatIds.has(chat.id) && !serverChatIds.has(chat.id))
      return {
        chats: [
          ...pendingLocalChats,
          ...serverChats.map((chat) => mapChat(
            chat,
            oldChats.get(chat.id)?.messages,
            oldChats.get(chat.id)?.detailLoaded,
          )),
        ],
        folders: folders.data?.map((folder) => ({ id: folder.id, name: folder.name, expanded: state.folders.find((item) => item.id === folder.id)?.expanded ?? true })) ?? state.folders,
      }
    })
  }, [chats.data, deleted.data, folders.data, namespace])

  useEffect(() => {
    if (!chats.data || !deleted.data) return
    enqueueCacheWrite(namespace, () => pruneCachedChatScope(
      namespace, [...chats.data, ...deleted.data], 'all', preferences.localChatLimit,
    ))
  }, [chats.data, deleted.data, namespace, preferences.localChatLimit])

  useEffect(() => {
    if (!detail.data) return
    for (const response of detail.data.responses ?? []) {
      if (response.detailAvailable === false) continue
      useRealtimeStore.getState().receiveSnapshot(hydrateEmbeddedResponseSnapshot(response.snapshot, response.output))
    }
  }, [detail.data])

  useEffect(() => {
    if (!activeChatId || !(detail.error instanceof ApiError)) return
    if (detail.error.code !== 'temporary_chat_expired' && detail.error.status !== 404) return
    usePrototypeStore.setState((state) => ({
      chats: state.chats.map((chat) => chat.id === activeChatId && chat.temporary
        ? { ...chat, expired: true }
        : chat),
    }))
  }, [activeChatId, detail.error])

  useEffect(() => {
    if (!reconciledDetail) return
    const projected = projectChat(reconciledDetail, snapshots).map(mapMessage)
    usePrototypeStore.setState((state) => ({
      chats: state.productionNamespace === namespace ? state.chats.map((chat) => chat.id === reconciledDetail.id
        ? mapChat(reconciledDetail, reuseProjectedMessages(chat.messages, projected), true)
        : chat) : state.chats,
    }))
  }, [namespace, reconciledDetail, snapshots])

  return null
}
