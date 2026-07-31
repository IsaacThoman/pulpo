import { create } from 'zustand'
import type { ResponseEvent, ResponseSnapshot } from '@pulpo/contracts'
import type { Chat, Folder, Message } from '@/lib/types'
import { apiRequest, isNetworkError } from '@/lib/api'
import { enqueueMutation } from '@/lib/local-first/outbox'
import { queryClient } from '@/lib/query-client'
import { chatOptionsFor, resolveGeneration, useModelConfig } from '@/stores/modelConfig'
import { useSettings } from '@/stores/settings'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { useAuth } from './auth'

interface ServerResponse {
  id: string
  modelId: string
  status: ResponseSnapshot['status']
  input: unknown[]
  output: unknown[]
  presetSelections: Record<string, string>
  usage: { inputTokens: number; outputTokens: number } | null
  error: { message?: string } | null
  createdAt: string
  completedAt: string | null
  snapshot: ResponseSnapshot
}

export interface ServerChat {
  id: string
  title: string
  modelId: string
  pinned: boolean
  folderId: string | null
  createdAt: string
  updatedAt: string
  responses?: ServerResponse[]
}

export interface ServerFolder {
  id: string
  name: string
}

interface ChatState {
  chats: Chat[]
  folders: Folder[]
  activeChatId: string | null
  streamingId: string | null
  responseSequences: Record<string, number>
  replaceSummaries: (chats: ServerChat[]) => void
  replaceFolders: (folders: ServerFolder[]) => void
  setDetailedChat: (chat: ServerChat) => void
  applyResponseEvent: (event: ResponseEvent) => void
  applyResponseSnapshot: (snapshot: ResponseSnapshot) => void
  newChat: (modelId?: string) => string
  setActive: (id: string | null) => void
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  moveToFolder: (id: string, folderId: string | null) => void
  shareChat: (id: string) => Promise<string>
  addFolder: (name: string) => void
  toggleFolder: (id: string) => void
  deleteFolder: (id: string) => void
  sendMessage: (chatId: string | null, content: string, modelId: string, attachmentIds?: string[], temporary?: boolean) => string
  regenerate: (chatId: string, messageId: string) => void
  editUserMessage: (chatId: string, messageId: string, content: string) => void
  stopStreaming: () => void
  rateMessage: (chatId: string, messageId: string, rating: 'up' | 'down' | null) => void
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    const typed = part as { text?: string; content?: string; refusal?: string }
    return typed.text ?? typed.content ?? typed.refusal ?? ''
  }).join('')
}

function outputText(output: unknown[]): string {
  return output.map((item) => {
    const typed = item as { type?: string; content?: unknown }
    return typed.type === 'message' ? textFromContent(typed.content) : ''
  }).join('\n')
}

function reasoningText(output: unknown[]): string | undefined {
  const parts = output.flatMap((item) => {
    const typed = item as { type?: string; summary?: unknown[] }
    return typed.type === 'reasoning' ? typed.summary ?? [] : []
  })
  const text = textFromContent(parts)
  return text || undefined
}

function inputText(input: unknown[]): string {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as { role?: string; content?: unknown }
    if (item.role === 'user') return textFromContent(item.content)
  }
  return ''
}

function messagesFromResponses(responses: ServerResponse[]): Message[] {
  return responses.flatMap((response) => {
    const timestamp = Date.parse(response.createdAt)
    const done = !['queued', 'in_progress'].includes(response.status)
    return [
      {
        id: `${response.id}:input`, role: 'user' as const, content: inputText(response.input),
        timestamp, done: true,
      },
      {
        id: response.id, role: 'assistant' as const, content: outputText(response.output),
        modelId: response.modelId, timestamp: timestamp + 1, done,
        reasoning: reasoningText(response.output), presetSelections: response.presetSelections,
        tokensIn: response.usage?.inputTokens, tokensOut: response.usage?.outputTokens,
        error: response.error?.message,
      },
    ]
  })
}

function toChat(row: ServerChat, current?: Chat): Chat {
  const serverMessages = row.responses ? messagesFromResponses(row.responses) : current?.messages ?? []
  const messages = serverMessages.map((message) => {
    const local = current?.messages.find((candidate) => candidate.id === message.id)
    if (!local || message.content || message.done) return message
    return { ...message, content: local.content, reasoning: local.reasoning }
  })
  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    messages,
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt),
    pinned: row.pinned,
    folderId: row.folderId,
    tags: current?.tags ?? [],
  }
}

function currentUserId(): string | null { return useAuth.getState().user?.id ?? null }
function chatsKey(): readonly unknown[] { return ['chats', currentUserId()] }
function chatKey(id: string): readonly unknown[] { return ['chat', currentUserId(), id] }

async function optimisticRequest(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown,
): Promise<unknown> {
  const userId = currentUserId()
  if (!userId) return
  const idempotencyKey = crypto.randomUUID()
  try {
    return await apiRequest(path, { method, body, idempotencyKey })
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueueMutation({ userId, method, path, body, idempotencyKey })
      return
    }
    throw error
  }
}

export const useChat = create<ChatState>()((set, get) => ({
  chats: [],
  folders: [],
  activeChatId: null,
  streamingId: null,
  responseSequences: {},

  replaceSummaries: (rows) => set((state) => ({
    chats: rows.map((row) => toChat(row, state.chats.find((chat) => chat.id === row.id))),
  })),
  replaceFolders: (rows) => set((state) => ({
    folders: rows.map((row) => ({
      ...row,
      expanded: state.folders.find((folder) => folder.id === row.id)?.expanded ?? true,
    })),
  })),
  setDetailedChat: (row) => set((state) => {
    const chat = toChat(row, state.chats.find((item) => item.id === row.id))
    const exists = state.chats.some((item) => item.id === row.id)
    const streaming = chat.messages.find((message) => message.role === 'assistant' && !message.done)?.id ?? null
    return {
      chats: exists ? state.chats.map((item) => item.id === row.id ? chat : item) : [chat, ...state.chats],
      streamingId: streaming,
    }
  }),

  applyResponseEvent: (event) => {
    if ((get().responseSequences[event.responseId] ?? 0) >= event.sequence) return
    const payload = event.payload as { delta?: string; type?: string }
    set((state) => ({
      responseSequences: { ...state.responseSequences, [event.responseId]: event.sequence },
      chats: state.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => message.id !== event.responseId ? message : {
          ...message,
          content: event.type === 'response.output_text.delta' ? message.content + payload.delta : message.content,
          reasoning: event.type.includes('reasoning') ? (message.reasoning ?? '') + payload.delta : message.reasoning,
        }),
      })),
    }))
  },

  applyResponseSnapshot: (snapshot) => {
    if ((get().responseSequences[snapshot.responseId] ?? 0) > snapshot.sequence) return
    set((state) => ({
      responseSequences: { ...state.responseSequences, [snapshot.responseId]: snapshot.sequence },
      streamingId: ['queued', 'in_progress'].includes(snapshot.status) ? snapshot.responseId : state.streamingId === snapshot.responseId ? null : state.streamingId,
      chats: state.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => message.id !== snapshot.responseId ? message : {
          ...message,
          content: snapshot.output.length ? outputText(snapshot.output) : message.content,
          reasoning: snapshot.output.length ? reasoningText(snapshot.output) : message.reasoning,
          done: !['queued', 'in_progress'].includes(snapshot.status),
          tokensIn: snapshot.usage?.inputTokens,
          tokensOut: snapshot.usage?.outputTokens,
          error: (snapshot.error as { message?: string } | null)?.message,
        }),
      })),
    }))
    if (!['queued', 'in_progress'].includes(snapshot.status)) void queryClient.invalidateQueries({ queryKey: chatsKey() })
  },

  newChat: (modelId) => {
    set({ activeChatId: null })
    return modelId ?? useCatalog.getState().models[0]?.id ?? ''
  },
  setActive: (activeChatId) => set({ activeChatId }),

  deleteChat: (id) => {
    set((state) => ({ chats: state.chats.filter((chat) => chat.id !== id) }))
    queryClient.setQueryData(chatsKey(), (rows: ServerChat[] | undefined) => rows?.filter((row) => row.id !== id))
    void optimisticRequest('DELETE', `/api/chats/${id}`).catch(() => void queryClient.invalidateQueries({ queryKey: chatsKey() }))
  },
  renameChat: (id, title) => {
    set((state) => ({ chats: state.chats.map((chat) => chat.id === id ? { ...chat, title } : chat) }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { title })
  },
  togglePin: (id) => {
    const chat = get().chats.find((item) => item.id === id)
    if (!chat) return
    set((state) => ({ chats: state.chats.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item) }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { pinned: !chat.pinned })
  },
  moveToFolder: (id, folderId) => {
    set((state) => ({ chats: state.chats.map((chat) => chat.id === id ? { ...chat, folderId } : chat) }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { folderId })
  },
  shareChat: async (id) => {
    const share = await apiRequest<{ token: string }>('/api/chat-shares', {
      method: 'POST',
      body: { chatId: id, expiresAt: null },
      idempotencyKey: crypto.randomUUID(),
    })
    return `${location.origin}/share/${share.token}`
  },
  addFolder: (name) => {
    const id = crypto.randomUUID()
    set((state) => ({ folders: [...state.folders, { id, name, expanded: true }] }))
    void optimisticRequest('POST', '/api/folders', { clientId: id, name })
  },
  toggleFolder: (id) => set((state) => ({
    folders: state.folders.map((folder) => folder.id === id ? { ...folder, expanded: !folder.expanded } : folder),
  })),
  deleteFolder: (id) => {
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== id),
      chats: state.chats.map((chat) => chat.folderId === id ? { ...chat, folderId: null } : chat),
    }))
    void optimisticRequest('DELETE', `/api/folders/${id}`)
  },

  sendMessage: (chatId, content, modelId, attachmentIds = [], temporary = false) => {
    const userId = currentUserId()
    if (!userId) return chatId ?? ''
    const id = chatId ?? crypto.randomUUID()
    const responseId = crypto.randomUUID()
    const timestamp = Date.now()
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      useSettings.getState().generation[modelId],
      modelId,
    )
    const userMessage: Message = { id: `${responseId}:input`, role: 'user', content, timestamp, done: true }
    const assistantMessage: Message = {
      id: responseId, role: 'assistant', content: '', modelId: generation.effectiveModelId || modelId,
      timestamp: timestamp + 1, done: false, presetSelections: generation.selections,
    }
    set((state) => {
      const existing = state.chats.find((chat) => chat.id === id)
      const title = content.length > 42 ? `${content.slice(0, 42)}…` : content
      const updated: Chat = existing
        ? { ...existing, updatedAt: timestamp, messages: [...existing.messages, userMessage, assistantMessage] }
        : { id, title, modelId, messages: [userMessage, assistantMessage], createdAt: timestamp, updatedAt: timestamp, pinned: false, folderId: null, tags: [] }
      return {
        chats: existing ? state.chats.map((chat) => chat.id === id ? updated : chat) : [updated, ...state.chats],
        activeChatId: id,
        streamingId: responseId,
      }
    })

    void (async () => {
      if (!chatId) await optimisticRequest('POST', '/api/chats', { clientId: id, modelId, title: content.slice(0, 200), temporary })
      const result = await optimisticRequest('POST', `/api/chats/${id}/responses`, {
        input: content,
        modelId: generation.effectiveModelId || modelId,
        presetSelections: generation.selections,
        attachmentIds,
      }) as { response?: ResponseSnapshot } | undefined
      const serverId = result?.response?.responseId
      if (serverId && serverId !== responseId) {
        set((state) => ({
          streamingId: state.streamingId === responseId ? serverId : state.streamingId,
          chats: state.chats.map((chat) => chat.id !== id ? chat : {
            ...chat,
            messages: chat.messages.map((message) => message.id === responseId ? { ...message, id: serverId } : message),
          }),
        }))
      }
      await queryClient.invalidateQueries({ queryKey: chatsKey() })
      await queryClient.invalidateQueries({ queryKey: chatKey(id) })
    })().catch(() => undefined)
    return id
  },

  regenerate: (chatId, messageId) => {
    void optimisticRequest('POST', `/api/messages/${messageId}/regenerate`).then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  editUserMessage: (chatId, messageId, content) => {
    set((state) => ({ chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
      ...chat, messages: chat.messages.map((message) => message.id === messageId ? { ...message, content } : message),
    }) }))
    void optimisticRequest('PATCH', `/api/messages/${messageId}`, { content }).then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  stopStreaming: () => {
    const responseId = get().streamingId
    if (!responseId) return
    set({ streamingId: null })
    void optimisticRequest('POST', `/api/responses/${responseId}/cancel`)
  },
  rateMessage: (chatId, messageId, rating) => {
    set((state) => ({ chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
      ...chat, messages: chat.messages.map((message) => message.id === messageId ? { ...message, rating } : message),
    }) }))
    void optimisticRequest('PUT', `/api/messages/${messageId}/feedback`, { rating })
  },
}))
