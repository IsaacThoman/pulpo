import { queryOptions } from '@tanstack/react-query'
import { mobileApi } from '../api/client'
import {
  cacheChats,
  cacheOpenedChat,
  cachedChats,
  getValue,
  markCachedChatOpened,
  setValue,
  trimCachedChats,
} from './database'
import type { MobileModel, ServerChat, ServerDeletedChat, ServerFolder } from '../types'
import { enqueueCacheWrite } from './writeBehind'
import { persistableChats } from './cache'

export interface ModelCatalog {
  agentAvailable: boolean
  data: MobileModel[]
}

export const queryKeys = {
  chats: (namespace: string) => ['chats', namespace] as const,
  deletedChats: (namespace: string) => ['deleted-chats', namespace] as const,
  chat: (namespace: string, id: string) => ['chat', namespace, id] as const,
  folders: (namespace: string) => ['folders', namespace] as const,
  models: (namespace: string) => ['models', namespace] as const,
  settings: (namespace: string) => ['settings', namespace] as const,
}

export function chatsQuery(namespace: string, localChatLimit = 50) {
  return queryOptions({
    queryKey: queryKeys.chats(namespace),
    queryFn: async () => {
      try {
        const { data } = await mobileApi.chats()
        const visible = persistableChats(data)
        enqueueCacheWrite(namespace, async () => {
          await cacheChats(namespace, visible)
          await trimCachedChats(namespace, localChatLimit)
        })
        return visible
      } catch (error) {
        const cached = persistableChats(await cachedChats(namespace)).filter((chat) => !chat.deletedAt)
        if (cached.length) return cached
        throw error
      }
    },
  })
}

function normalizeDeletedChat(chat: ServerDeletedChat, existing?: ServerChat): ServerChat {
  const timestamp = chat.deletedAt || new Date().toISOString()
  return {
    ...existing,
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    pinned: false,
    folderId: null,
    sortOrder: existing?.sortOrder ?? 0,
    temporary: false,
    activeResponseId: existing?.activeResponseId ?? null,
    activeBranchLeafId: existing?.activeBranchLeafId ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: existing?.updatedAt ?? timestamp,
    deletedAt: chat.deletedAt,
    purgeAt: chat.purgeAt,
  }
}

export function deletedChatsQuery(namespace: string, localChatLimit = 50) {
  return queryOptions({
    queryKey: queryKeys.deletedChats(namespace),
    queryFn: async () => {
      try {
        const { data } = await mobileApi.deletedChats()
        const normalized = data.map((chat) => normalizeDeletedChat(chat))
        enqueueCacheWrite(namespace, async () => {
          await cacheChats(namespace, normalized)
          await trimCachedChats(namespace, localChatLimit)
        })
        return normalized
      } catch (error) {
        const cached = (await cachedChats(namespace)).filter((chat) => Boolean(chat.deletedAt))
        if (cached.length) return cached
        throw error
      }
    },
  })
}

export function chatQuery(namespace: string, id: string, localChatLimit = 50) {
  return queryOptions({
    queryKey: queryKeys.chat(namespace, id),
    queryFn: async () => {
      try {
        const chat = await mobileApi.chat(id)
        if (!chat.temporary) enqueueCacheWrite(namespace, () => cacheOpenedChat(namespace, chat, localChatLimit))
        return chat
      } catch (error) {
        const chat = persistableChats(await cachedChats(namespace)).find((candidate) => candidate.id === id)
        if (chat?.responses) {
          enqueueCacheWrite(namespace, () => markCachedChatOpened(namespace, id, localChatLimit))
          return chat
        }
        throw error
      }
    },
  })
}

export function foldersQuery(namespace: string) {
  return queryOptions({
    queryKey: queryKeys.folders(namespace),
    queryFn: async () => {
      try {
        const { data } = await mobileApi.folders()
        enqueueCacheWrite(namespace, () => setValue(namespace, 'folders', data))
        return data
      } catch (error) {
        const cached = await getValue<ServerFolder[]>(namespace, 'folders')
        if (cached) return cached
        throw error
      }
    },
  })
}

export function modelsQuery(namespace: string) {
  return queryOptions({
    queryKey: queryKeys.models(namespace),
    queryFn: async () => {
      try {
        const catalog = await mobileApi.models()
        enqueueCacheWrite(namespace, () => setValue(namespace, 'model-catalog', catalog))
        return catalog
      } catch (error) {
        const cached = await getValue<ModelCatalog>(namespace, 'model-catalog')
        if (cached) return cached
        throw error
      }
    },
  })
}

export function mergeChatSummary(chats: ServerChat[], updated: ServerChat): ServerChat[] {
  const existing = chats.findIndex((chat) => chat.id === updated.id)
  if (existing < 0) return [updated, ...chats]
  const copy = chats.slice()
  copy[existing] = { ...copy[existing], ...updated }
  return copy
}
