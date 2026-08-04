import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { idSchema } from '@pulpo/contracts'
import { cacheNamespace, cachedChats, getValue, reconcileCachedChatScope } from '../../../data/database'
import { chatQuery, chatsQuery, deletedChatsQuery, foldersQuery, queryKeys } from '../../../data/queries'
import { isNetworkError, mobileApi } from '../../../api/client'
import { queueOfflineMutation } from '../../../data/mutations'
import { projectChat, type DisplayMessage } from '../../../features/chat/projection'
import { createFolder, deleteFolder, permanentlyDeleteChat, restoreChat, trashChat, updateChat, updateFolder } from '../../../features/chat/api'
import { useRealtimeStore, subscribeToChat, subscribeToResponse } from '../../../providers/realtimeStore'
import { usePreferencesStore } from '../../../store/preferences'
import { useSessionStore } from '../../../store/session'
import type { MobileModel, ServerChat, ServerFolder } from '../../../types'
import type { ActivityStep, PrototypeAttachment, PrototypeChat, PrototypeMessage, PrototypeModel } from '../domain'
import { usePrototypeStore } from '../store/prototypeStore'
import { configureProductionActions } from './productionActions'
import { reuseProjectedMessages } from './messageReuse'

function modelAsset(model: MobileModel): PrototypeModel['asset'] {
  const value = `${model.provider.name} ${model.name}`.toLowerCase()
  if (value.includes('anthropic') || value.includes('claude')) return 'claude'
  if (value.includes('google') || value.includes('gemini')) return 'gemini'
  if (value.includes('deepseek')) return 'deepseek'
  return 'openai'
}

function mapModel(model: MobileModel, favorites: string[]): PrototypeModel {
  const asset = modelAsset(model)
  return {
    id: model.id,
    name: model.name,
    provider: model.provider.name,
    lab: model.lab?.name ?? model.provider.name,
    description: model.description,
    contextWindow: model.tags.find((tag) => /context/i.test(tag)) ?? `${Math.round(model.maxOutputTokens / 1000)}K max output`,
    pricing: 'Managed by this Pulpo instance',
    tags: model.tags,
    enabled: true,
    agentEnabled: model.agentEnabled,
    favorite: favorites.includes(model.id),
    tint: asset === 'claude' ? '#E8794A' : asset === 'gemini' ? '#6EA8FF' : asset === 'deepseek' ? '#5B8CFF' : '#D9D9D9',
    asset,
    modelLogo: model.logo ?? model.lab?.logo ?? 'pulpo',
    labLogo: model.lab?.logo ?? 'pulpo',
    presets: model.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      icon: preset.id.includes('reason') ? 'brain' : 'slider.horizontal.3',
      selectedId: preset.defaultChoiceId ?? preset.choices[0]?.id ?? '',
      choices: preset.choices.map((option) => ({ id: option.id, label: option.displayName, icon: 'circle' })),
    })),
  }
}

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
    modelId: message.modelId,
    attachments: message.attachments.map(mapAttachment),
    activity,
    status,
    error: message.error,
    outputItems: message.outputItems,
    agentMode: message.agentMode,
    meta: message.usage ? `${message.usage.inputTokens.toLocaleString()}→${message.usage.outputTokens.toLocaleString()} tok` : undefined,
    branches: message.branch.ids.length > 1 ? message.branch.ids.map((id) => ({ id, text: message.text, modelId: message.modelId, createdAt: Date.parse(message.createdAt) })) : undefined,
    activeBranch: message.branch.index,
  }
}

function mapChat(chat: ServerChat, messages: PrototypeMessage[] = []): PrototypeChat {
  return {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    createdAt: Date.parse(chat.createdAt),
    updatedAt: Date.parse(chat.updatedAt),
    pinned: chat.pinned,
    folderId: chat.folderId,
    temporary: chat.temporary,
    messages,
    deletedAt: chat.deletedAt ? Date.parse(chat.deletedAt) : null,
    purgeAt: chat.purgeAt ? Date.parse(chat.purgeAt) : null,
  }
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
    return await input.request()
  } catch (error) {
    if (!isNetworkError(error)) throw error
    await queueOfflineMutation(input)
    return undefined
  }
}

export function ProductionBridge({ activeChatId }: { activeChatId: string | null }) {
  const status = useSessionStore((state) => state.status)
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const userId = useSessionStore((state) => state.user?.id)
  const preferences = usePreferencesStore()
  const snapshots = useRealtimeStore((state) => state.snapshots)
  const namespace = useMemo(() => userId ? cacheNamespace(instanceUrl, userId) : 'anonymous', [instanceUrl, userId])
  const enabled = status === 'authenticated' && Boolean(userId)
  const activeChatIsServerAddressable = Boolean(activeChatId && idSchema.safeParse(activeChatId).success)
  const serverHydrated = useRef(false)
  const chats = useQuery({ ...chatsQuery(namespace, preferences.localChatLimit), enabled })
  const deleted = useQuery({ ...deletedChatsQuery(namespace, preferences.localChatLimit), enabled })
  const folders = useQuery({ ...foldersQuery(namespace), enabled })
  const models = useQuery({ queryKey: queryKeys.models(namespace), queryFn: mobileApi.models, enabled })
  const detail = useQuery({
    ...chatQuery(namespace, activeChatId ?? '', preferences.localChatLimit),
    enabled: enabled && activeChatIsServerAddressable,
  })

  useEffect(() => { serverHydrated.current = false }, [namespace])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void Promise.all([cachedChats(namespace), getValue<ServerFolder[]>(namespace, 'folders')]).then(([localChats, localFolders]) => {
      if (cancelled || serverHydrated.current || (!localChats.length && !localFolders?.length)) return
      usePrototypeStore.setState((state) => {
        const existingMessages = new Map(state.chats.map((chat) => [chat.id, chat.messages]))
        const liveSnapshots = useRealtimeStore.getState().snapshots
        return {
          chats: localChats.length ? localChats.map((chat) => mapChat(
            chat,
            chat.responses ? projectChat(chat, liveSnapshots).map(mapMessage) : existingMessages.get(chat.id),
          )) : state.chats,
          folders: localFolders?.map((folder) => ({
            id: folder.id,
            name: folder.name,
            expanded: state.folders.find((item) => item.id === folder.id)?.expanded ?? true,
          })) ?? state.folders,
        }
      })
    })
    return () => { cancelled = true }
  }, [enabled, namespace])

  useEffect(() => {
    configureProductionActions({
      renameChat: (id, title) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'PATCH', path: `/api/chats/${id}`, body: { title }, request: () => updateChat(id, { title }) }),
      togglePin: (id, pinned) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'PATCH', path: `/api/chats/${id}`, body: { pinned }, request: () => updateChat(id, { pinned }) }),
      moveChat: (id, folderId) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'PATCH', path: `/api/chats/${id}`, body: { folderId }, request: () => updateChat(id, { folderId }) }),
      trashChat: (id) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'DELETE', path: `/api/chats/${id}`, request: () => trashChat(id) }),
      restoreChat: (id) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'POST', path: `/api/chats/${id}/recover`, request: () => restoreChat(id) }),
      permanentlyDeleteChat: (id) => offlineCapableMutation({ namespace, entityKey: `chat:${id}`, method: 'DELETE', path: `/api/chats/${id}/permanent`, request: () => permanentlyDeleteChat(id) }),
      emptyTrash: () => offlineCapableMutation({ namespace, entityKey: 'trash:all', method: 'DELETE', path: '/api/chats/deleted', request: () => mobileApi.emptyTrash() }),
      createFolder: (name, clientId) => offlineCapableMutation({ namespace, entityKey: `folder:${clientId}`, method: 'POST', path: '/api/folders', body: { name, clientId }, request: () => createFolder(name, clientId) }),
      renameFolder: (id, name) => offlineCapableMutation({ namespace, entityKey: `folder:${id}`, method: 'PATCH', path: `/api/folders/${id}`, body: { name }, request: () => updateFolder(id, { name }) }),
      deleteFolder: (id) => offlineCapableMutation({ namespace, entityKey: `folder:${id}`, method: 'DELETE', path: `/api/folders/${id}`, request: () => deleteFolder(id) }),
      setPreference: (key, value) => usePreferencesStore.getState().setPreference(key, value),
    })
  }, [namespace])

  useEffect(() => {
    if (!enabled || !activeChatId || !activeChatIsServerAddressable) return
    const unsubscribeChat = subscribeToChat(activeChatId)
    const unsubscribers = (detail.data?.responses ?? [])
      .filter((response) => response.status === 'queued' || response.status === 'in_progress')
      .map((response) => subscribeToResponse(
        response.id,
        useRealtimeStore.getState().snapshots[response.id]?.sequence ?? response.snapshot.sequence,
      ))
    return () => { unsubscribeChat(); unsubscribers.forEach((unsubscribe) => unsubscribe()) }
  }, [activeChatId, activeChatIsServerAddressable, detail.data?.responses, enabled])

  useEffect(() => {
    usePrototypeStore.setState((state) => ({
      preferences: {
        ...state.preferences,
        theme: preferences.theme,
        textSize: preferences.textSize,
        streamResponses: preferences.streamResponses,
        showReasoning: preferences.showReasoning,
        haptics: preferences.haptics,
        sendWithEnter: preferences.sendWithEnter,
        attachmentCacheMb: preferences.attachmentCacheMb,
        localChatLimit: preferences.localChatLimit,
      },
      defaultModelId: preferences.defaultModelId ?? models.data?.data[0]?.id ?? state.defaultModelId,
      models: models.data ? models.data.data.map((model) => mapModel(model, preferences.favoriteModelIds)) : state.models,
    }))
  }, [models.data, preferences])

  useEffect(() => {
    if (!chats.data && !deleted.data && !folders.data) return
    serverHydrated.current = true
    usePrototypeStore.setState((state) => {
      const oldMessages = new Map(state.chats.map((chat) => [chat.id, chat.messages]))
      const serverChats = [...(chats.data ?? []), ...(deleted.data ?? [])]
      return {
        chats: serverChats.map((chat) => mapChat(chat, oldMessages.get(chat.id))),
        folders: folders.data?.map((folder) => ({ id: folder.id, name: folder.name, expanded: state.folders.find((item) => item.id === folder.id)?.expanded ?? true })) ?? state.folders,
      }
    })
  }, [chats.data, deleted.data, folders.data])

  useEffect(() => {
    if (!chats.data || !deleted.data) return
    void reconcileCachedChatScope(
      namespace,
      [...chats.data, ...deleted.data],
      'all',
      preferences.localChatLimit,
    )
  }, [chats.data, deleted.data, namespace, preferences.localChatLimit])

  useEffect(() => {
    if (!detail.data) return
    for (const response of detail.data.responses ?? []) useRealtimeStore.getState().receiveSnapshot(response.snapshot)
  }, [detail.data])

  useEffect(() => {
    if (!detail.data) return
    const projected = projectChat(detail.data, snapshots).map(mapMessage)
    usePrototypeStore.setState((state) => ({
      chats: state.chats.map((chat) => chat.id === detail.data.id
        ? mapChat(detail.data, reuseProjectedMessages(chat.messages, projected))
        : chat),
    }))
  }, [detail.data, snapshots])

  return null
}
