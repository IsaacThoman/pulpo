import { queryOptions } from '@tanstack/react-query'
import { mobileApi } from '../api/client'
import { cacheChats, cachedChats, getValue, setValue } from './database'
import type { ServerChat, ServerFolder } from '../types'

export const queryKeys = {
  chats: (namespace: string) => ['chats', namespace] as const,
  deletedChats: (namespace: string) => ['deleted-chats', namespace] as const,
  chat: (namespace: string, id: string) => ['chat', namespace, id] as const,
  folders: (namespace: string) => ['folders', namespace] as const,
  models: (namespace: string) => ['models', namespace] as const,
}

export function chatsQuery(namespace: string) {
  return queryOptions({
    queryKey: queryKeys.chats(namespace),
    queryFn: async () => {
      try {
        const { data } = await mobileApi.chats()
        await cacheChats(namespace, data)
        return data
      } catch (error) {
        const cached = await cachedChats(namespace)
        if (cached.length) return cached
        throw error
      }
    },
  })
}

export function chatQuery(namespace: string, id: string) {
  return queryOptions({
    queryKey: queryKeys.chat(namespace, id),
    queryFn: async () => {
      try {
        const chat = await mobileApi.chat(id)
        await cacheChats(namespace, [chat])
        return chat
      } catch (error) {
        const chat = (await cachedChats(namespace)).find((candidate) => candidate.id === id)
        if (chat?.responses) return chat
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
        await setValue(namespace, 'folders', data)
        return data
      } catch (error) {
        const cached = await getValue<ServerFolder[]>(namespace, 'folders')
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
