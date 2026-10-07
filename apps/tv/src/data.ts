import { useEffect, useMemo, useState } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import * as Crypto from 'expo-crypto'
import { hydrateEmbeddedResponseSnapshot } from '@pulpo/client-core'
import { mobileApi } from '@/api/client'
import { cacheNamespace } from '@/data/database'
import { chatQuery, chatsQuery, modelsQuery, queryKeys } from '@/data/queries'
import { activateBranch, cancelResponse, regenerateResponse, sendMessage, startChat, trashChat, updateChat } from '@/features/chat/api'
import { createChatProjector, type DisplayMessage } from '@/features/chat/projection'
import {
  acknowledgeOptimisticChatList,
  cacheOptimisticBranch,
  cacheOptimisticTurn,
  pendingOptimisticResponseIds,
  reconcileOptimisticResponses,
  rejectOptimisticTurn,
} from '@/mockup5/src/production/optimisticResponses'
import { activateOptimisticBranch, reconcileOptimisticBranchSelection } from '@/mockup5/src/production/optimisticBranches'
import { subscribeToChat, subscribeToResponse, useRealtimeStore } from '@/providers/realtimeStore'
import { preferencePatchForServer, preferencesFromServer, usePreferencesStore } from '@/store/preferences'
import { useSessionStore } from '@/store/session'
import type { MobileModel, ServerChat } from '@/types'

export function useNamespace(): string | null {
  return useSessionStore((state) => state.status === 'authenticated' && state.user
    ? cacheNamespace(state.instanceUrl, state.user.id)
    : null)
}

export function useChats(namespace: string) {
  const chats = useQuery(chatsQuery(namespace))
  useEffect(() => {
    if (chats.data) acknowledgeOptimisticChatList(namespace, new Set(chats.data.map((chat) => chat.id)))
  }, [chats.data, namespace])
  return chats
}

/** Pinned chats first, then the most recently active ones. */
export function sortChats(chats: ServerChat[]): ServerChat[] {
  return chats
    .filter((chat) => !chat.deletedAt && !chat.temporary)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt))
}

export function useModels(namespace: string) {
  const catalog = useQuery(modelsQuery(namespace))
  const { favoriteModelIds, defaultModelId } = usePreferencesStore(useShallow((state) => ({
    favoriteModelIds: state.favoriteModelIds,
    defaultModelId: state.defaultModelId,
  })))
  return useMemo(() => {
    const models = orderModels(catalog.data?.data ?? [], favoriteModelIds)
    const defaultModel = models.find((model) => model.id === defaultModelId) ?? models[0] ?? null
    return { models, defaultModel, loading: catalog.isPending }
  }, [catalog.data, catalog.isPending, defaultModelId, favoriteModelIds])
}

export function orderModels(models: MobileModel[], favoriteIds: string[]): MobileModel[] {
  const favorites = favoriteIds.flatMap((id) => models.filter((model) => model.id === id))
  return [...favorites, ...models.filter((model) => !favoriteIds.includes(model.id))]
}

/** Keep account-synced preferences (default model, favourites) current with the server. */
export function useServerPreferences(namespace: string) {
  const settings = useQuery({ queryKey: queryKeys.settings(namespace), queryFn: mobileApi.settings })
  useEffect(() => {
    if (usePreferencesStore.getState().synchronizedOwnerNamespace !== namespace) {
      void usePreferencesStore.getState().resetSynchronizedPreferences(namespace)
    }
  }, [namespace])
  useEffect(() => {
    if (settings.data) void usePreferencesStore.getState().applyServerPreferences(preferencesFromServer(settings.data.values))
  }, [settings.data])
}

export async function setDefaultModel(queryClient: QueryClient, namespace: string, modelId: string): Promise<void> {
  await usePreferencesStore.getState().setPreference('defaultModelId', modelId)
  const body = preferencePatchForServer('defaultModelId', modelId)
  if (!body) return
  await mobileApi.updateSettings(body)
  await usePreferencesStore.getState().markSynchronizedPreferenceSynced('defaultModelId', modelId)
  void queryClient.invalidateQueries({ queryKey: queryKeys.settings(namespace) })
}

export function isActive(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress'
}

/** The open chat's transcript, merged with optimistic turns and live stream deltas. */
export function useConversation(namespace: string, chatId: string) {
  const detail = useQuery(chatQuery(namespace, chatId))
  const [projector] = useState(createChatProjector)
  const responseIds = useMemo(() => {
    const ids = new Set((detail.data?.responses ?? []).map((response) => response.id))
    for (const id of pendingOptimisticResponseIds(namespace, chatId)) ids.add(id)
    return [...ids]
  }, [chatId, detail.data?.responses, namespace])
  const snapshots = useRealtimeStore(useShallow((state) => Object.fromEntries(
    responseIds.flatMap((id) => state.snapshots[id] ? [[id, state.snapshots[id]]] : []),
  )))
  const chat = useMemo(() => detail.data
    ? reconcileOptimisticBranchSelection(namespace, reconcileOptimisticResponses(namespace, detail.data, snapshots))
    : undefined, [detail.data, namespace, snapshots])
  const messages: DisplayMessage[] = useMemo(() => chat ? projector(chat, snapshots) : [], [chat, projector, snapshots])

  // Seed the realtime reducer with stored snapshots so socket deltas apply on top.
  useEffect(() => {
    if (!detail.data) return
    useRealtimeStore.getState().receiveSnapshots((detail.data.responses ?? [])
      .filter((response) => response.detailAvailable !== false)
      .map((response) => hydrateEmbeddedResponseSnapshot(response.snapshot, response.output)))
  }, [detail.data])

  const activeIds = (chat?.responses ?? []).filter((response) => isActive(snapshots[response.id]?.status ?? response.status))
    .map((response) => response.id).sort().join('\n')
  useEffect(() => {
    const unsubscribeChat = subscribeToChat(chatId)
    const unsubscribers = activeIds ? activeIds.split('\n').map((id) => subscribeToResponse(
      id, useRealtimeStore.getState().snapshots[id]?.sequence ?? 0,
    )) : []
    return () => { unsubscribeChat(); unsubscribers.forEach((unsubscribe) => unsubscribe()) }
  }, [activeIds, chatId])

  return { chat, messages, loading: detail.isPending && !chat, error: detail.error }
}

function refresh(queryClient: QueryClient, namespace: string, chatId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) })
}

function titleFor(text: string): string {
  return text.trim().split(/\s+/).slice(0, 7).join(' ')
}

/**
 * Send a message, creating the chat when `chatId` is null. The transcript is
 * updated before the request leaves the device; failures roll it back.
 */
export function sendTurn(input: {
  queryClient: QueryClient
  namespace: string
  chatId: string | null
  text: string
  modelId: string
  parentResponseId: string | null
}): { chatId: string; done: Promise<void> } {
  const content = input.text.trim()
  const chatId = input.chatId ?? Crypto.randomUUID()
  const responseId = Crypto.randomUUID()
  const title = titleFor(content)
  cacheOptimisticTurn({
    queryClient: input.queryClient,
    namespace: input.namespace,
    chatId,
    responseId,
    parentResponseId: input.parentResponseId,
    content,
    title,
    modelId: input.modelId,
    temporary: false,
    presetSelections: {},
    agentMode: false,
    attachments: [],
    createdAt: Date.now(),
  })
  if (!input.chatId) {
    const now = new Date().toISOString()
    input.queryClient.setQueryData<ServerChat[]>(queryKeys.chats(input.namespace), (chats = []) => [{
      id: chatId, title, modelId: input.modelId, pinned: false, folderId: null, sortOrder: 0, temporary: false,
      activeResponseId: responseId, activeBranchLeafId: responseId, createdAt: now, updatedAt: now,
    }, ...chats])
  }
  const request = input.chatId
    ? sendMessage({ clientId: responseId, chatId, content, modelId: input.modelId, parentResponseId: input.parentResponseId })
    : startChat({ chatId, responseId, content, modelId: input.modelId, title }).then((result) => result.response)
  const done = request.then(() => refresh(input.queryClient, input.namespace, chatId), (error: unknown) => {
    rejectOptimisticTurn({ queryClient: input.queryClient, namespace: input.namespace, responseId, discardChat: !input.chatId })
    throw error
  })
  return { chatId, done }
}

export async function stopResponse(queryClient: QueryClient, namespace: string, chatId: string, responseId: string) {
  await cancelResponse(responseId)
  refresh(queryClient, namespace, chatId)
}

export async function regenerate(queryClient: QueryClient, namespace: string, chatId: string, responseId: string, modelId: string) {
  const clientId = Crypto.randomUUID()
  cacheOptimisticBranch({
    queryClient, namespace, chatId, sourceResponseId: responseId, responseId: clientId,
    modelId, presetSelections: {}, createdAt: Date.now(),
  })
  try {
    await regenerateResponse(responseId, modelId, {}, clientId, false)
    refresh(queryClient, namespace, chatId)
  } catch (error) {
    rejectOptimisticTurn({ queryClient, namespace, responseId: clientId, discardChat: false })
    throw error
  }
}

export function showVersion(queryClient: QueryClient, namespace: string, chatId: string, responseId: string) {
  return activateOptimisticBranch({ queryClient, namespace, chatId, selectedResponseId: responseId, request: activateBranch })
}

export async function setChatModel(queryClient: QueryClient, namespace: string, chatId: string, modelId: string) {
  queryClient.setQueryData<ServerChat>(queryKeys.chat(namespace, chatId), (chat) => chat ? { ...chat, modelId } : chat)
  await updateChat(chatId, { modelId })
}

export async function togglePin(queryClient: QueryClient, namespace: string, chat: ServerChat) {
  queryClient.setQueryData<ServerChat[]>(queryKeys.chats(namespace), (chats = []) => chats.map((row) => row.id === chat.id ? { ...row, pinned: !chat.pinned } : row))
  try { await updateChat(chat.id, { pinned: !chat.pinned }) } finally {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
  }
}

export async function deleteChat(queryClient: QueryClient, namespace: string, chatId: string) {
  queryClient.setQueryData<ServerChat[]>(queryKeys.chats(namespace), (chats = []) => chats.filter((row) => row.id !== chatId))
  try { await trashChat(chatId) } finally {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) })
  }
}

