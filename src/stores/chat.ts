import { create } from 'zustand'
import { mergeResponseSnapshots, type ResponseEvent, type ResponseSnapshot } from '@pulpo/contracts'
import type { Attachment, Chat, Folder, Message } from '@/lib/types'
import { apiRequest, isNetworkError } from '@/lib/api'
import { enqueueMutation } from '@/lib/local-first/outbox'
import { queryClient } from '@/lib/query-client'
import { chatOptionsFor, resolveGeneration, useModelConfig } from '@/stores/modelConfig'
import { useSettings } from '@/stores/settings'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { lineageFromLeaf, newestDescendantId } from '@/lib/chat-tree'
import { mergePendingLocalMessages } from '@/lib/merge-pending-local-messages'
import { applyEventToSnapshot } from '@/lib/local-first/response-snapshot'
import { useAuth } from './auth'

interface ServerResponse {
  id: string
  parentResponseId: string | null
  userMessageId: string | null
  modelId: string
  displayModelId?: string
  status: ResponseSnapshot['status']
  input: unknown[]
  output: unknown[]
  presetSelections: Record<string, string>
  usage: { inputTokens: number; outputTokens: number } | null
  error: { message?: string } | null
  createdAt: string
  completedAt: string | null
  snapshot: ResponseSnapshot
  branches: {
    user: { ids: string[]; index: number }
    assistant: { ids: string[]; index: number }
  }
}

export interface ServerAttachment {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

export interface ServerChat {
  id: string
  title: string
  modelId: string
  pinned: boolean
  folderId: string | null
  createdAt: string
  updatedAt: string
  activeResponseId: string | null
  activeBranchLeafId: string | null
  attachments?: ServerAttachment[]
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
  streamingIds: string[]
  responseSequences: Record<string, number>
  replaceSummaries: (chats: ServerChat[]) => void
  replaceFolders: (folders: ServerFolder[]) => void
  setDetailedChat: (chat: ServerChat) => void
  applyResponseEvent: (event: ResponseEvent) => boolean
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
  sendMessage: (chatId: string | null, content: string, modelId: string, attachments?: Attachment[], temporary?: boolean) => string
  regenerate: (chatId: string, messageId: string, modelId: string) => void
  editUserMessage: (chatId: string, messageId: string, content: string, modelId: string) => void
  editAssistantMessage: (chatId: string, messageId: string, content: string) => void
  deleteUserMessage: (chatId: string, messageId: string) => void
  activateBranch: (chatId: string, responseId: string) => void
  stopStreaming: (responseId: string) => void
}

function addStreamingId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id]
}

function removeStreamingId(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id)
}

function replaceStreamingId(ids: string[], from: string, to: string): string[] {
  if (from === to || !ids.includes(from)) return ids
  return addStreamingId(removeStreamingId(ids, from), to)
}

function reconcileStreamingIds(chats: Chat[], previous: string[]): string[] {
  const unfinished = new Set<string>()
  const known = new Set<string>()
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.role !== 'assistant') continue
      known.add(message.id)
      if (!message.done) unfinished.add(message.id)
    }
  }
  const next = [
    ...unfinished,
    ...previous.filter((id) => !known.has(id) && !unfinished.has(id)),
  ]
  if (next.length === previous.length && next.every((id, index) => id === previous[index])) return previous
  return next
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

function attachmentIdsFromInput(input: unknown[]): string[] {
  return input.flatMap((item) => {
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      const typed = part as { type?: string; attachment_id?: string }
      return typed.type === 'input_file' && typed.attachment_id ? [typed.attachment_id] : []
    })
  })
}

function messagesFromResponses(responses: ServerResponse[], attachmentRows: ServerAttachment[]): Message[] {
  const attachments = new Map(attachmentRows.map((attachment) => [attachment.id, attachment]))
  return responses.flatMap((response) => {
    const timestamp = Date.parse(response.createdAt)
    const done = !['queued', 'in_progress'].includes(response.status)
    const messageAttachments = attachmentIdsFromInput(response.input).flatMap((id): Attachment[] => {
      const attachment = attachments.get(id)
      return attachment ? [{
        id: attachment.id,
        name: attachment.originalName,
        type: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
        size: attachment.sizeBytes,
      }] : []
    })
    return [
      {
        id: `${response.id}:input`, role: 'user' as const, content: inputText(response.input),
        timestamp, done: true, branch: response.branches.user, attachments: messageAttachments,
      },
      {
        id: response.id, role: 'assistant' as const, content: outputText(response.output),
        modelId: response.displayModelId ?? response.modelId, timestamp: timestamp + 1, done,
        reasoning: reasoningText(response.output), presetSelections: response.presetSelections,
        tokensIn: response.usage?.inputTokens, tokensOut: response.usage?.outputTokens,
        latencyMs: response.completedAt
          ? Math.max(0, Date.parse(response.completedAt) - timestamp)
          : undefined,
        error: response.error?.message,
        outputItems: response.output,
        branch: response.branches.assistant,
      },
    ]
  })
}

function toChat(
  row: ServerChat,
  current?: Chat,
  responseSequences: Record<string, number> = {},
  streamingIds: readonly string[] = [],
): Chat {
  const selectedResponses = row.responses
    ? lineageFromLeaf(row.responses, row.activeBranchLeafId ?? row.activeResponseId ?? row.responses.at(-1)?.id ?? null)
    : undefined
  const selectedById = new Map(selectedResponses?.map((response) => [response.id, response]) ?? [])
  const serverMessages = selectedResponses ? messagesFromResponses(selectedResponses, row.attachments ?? []) : current?.messages ?? []
  const messages = mergePendingLocalMessages(
    serverMessages.map((message) => {
      const local = current?.messages.find((candidate) => candidate.id === message.id)
      const response = selectedById.get(message.id)
      if (local && response && !message.done && (responseSequences[response.id] ?? 0) > response.snapshot.sequence) {
        return { ...message, content: local.content, reasoning: local.reasoning, outputItems: local.outputItems }
      }
      if (!local || message.content || message.done) return message
      return { ...message, content: local.content, reasoning: local.reasoning }
    }),
    selectedResponses ? current?.messages : undefined,
    streamingIds,
  )
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

function cacheOptimisticTurn(input: {
  chatId: string
  responseId: string
  content: string
  modelId: string
  displayModelId: string
  title: string
  temporary: boolean
  attachments: Attachment[]
  presetSelections: Record<string, string>
  createdAt: number
}): void {
  const createdAt = new Date(input.createdAt).toISOString()
  const existing = queryClient.getQueryData<ServerChat>(chatKey(input.chatId))
  const parentResponseId = existing?.activeBranchLeafId ?? existing?.activeResponseId ?? null
  const response: ServerResponse = {
    id: input.responseId,
    parentResponseId,
    userMessageId: crypto.randomUUID(),
    modelId: input.modelId,
    displayModelId: input.displayModelId,
    status: 'queued',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: input.content },
      ...input.attachments.map((attachment) => ({ type: 'input_file', attachment_id: attachment.id })),
    ] }],
    output: [],
    presetSelections: input.presetSelections,
    usage: null,
    error: null,
    createdAt,
    completedAt: null,
    snapshot: {
      responseId: input.responseId,
      status: 'queued',
      sequence: 0,
      output: [],
      usage: null,
      error: null,
      updatedAt: createdAt,
    },
    branches: { user: { ids: [input.responseId], index: 0 }, assistant: { ids: [input.responseId], index: 0 } },
  }
  const detail: ServerChat = existing
    ? {
        ...existing,
        updatedAt: createdAt,
        activeResponseId: input.responseId,
        activeBranchLeafId: input.responseId,
        attachments: [
          ...(existing.attachments ?? []).filter((attachment) => !input.attachments.some((item) => item.id === attachment.id)),
          ...input.attachments.map((attachment) => ({
            id: attachment.id,
            originalName: attachment.name,
            mimeType: attachment.type === 'image' ? 'image/*' : 'application/octet-stream',
            sizeBytes: attachment.size,
          })),
        ],
        responses: [...(existing.responses ?? []), response],
      }
    : {
        id: input.chatId,
        title: input.title,
        modelId: input.modelId,
        pinned: false,
        folderId: null,
        createdAt,
        updatedAt: createdAt,
        activeResponseId: input.responseId,
        activeBranchLeafId: input.responseId,
        attachments: input.attachments.map((attachment) => ({
          id: attachment.id,
          originalName: attachment.name,
          mimeType: attachment.type === 'image' ? 'image/*' : 'application/octet-stream',
          sizeBytes: attachment.size,
        })),
        responses: [response],
      }
  queryClient.setQueryData(chatKey(input.chatId), detail)
  queryClient.setQueryData<ServerChat[]>(chatsKey(), (rows = []) => {
    const summary = { ...detail, responses: undefined }
    return [summary, ...rows.filter((row) => row.id !== input.chatId)]
  })
}

const pendingResponseEvents = new Map<string, {
  chatId: string
  events: ResponseEvent[]
  timer: number
}>()
const accumulatedResponseSnapshots = new Map<string, ResponseSnapshot>()

function rememberResponseSnapshot(snapshot: ResponseSnapshot): ResponseSnapshot {
  const current = accumulatedResponseSnapshots.get(snapshot.responseId)
  const merged = current ? mergeResponseSnapshots(current, snapshot) : snapshot
  accumulatedResponseSnapshots.set(snapshot.responseId, merged)
  return merged
}

function flushResponseEvents(responseId: string): void {
  const pending = pendingResponseEvents.get(responseId)
  if (!pending) return
  pendingResponseEvents.delete(responseId)
  queryClient.setQueryData<ServerChat>(chatKey(pending.chatId), (chat) => {
    if (!chat?.responses) return chat
    return {
      ...chat,
      responses: chat.responses.map((response) => {
        if (response.id !== responseId) return response
        const base = accumulatedResponseSnapshots.get(responseId) ?? response.snapshot
        const snapshot = rememberResponseSnapshot(pending.events.reduce(applyEventToSnapshot, base))
        return {
          ...response,
          status: snapshot.status,
          output: snapshot.output,
          usage: snapshot.usage,
          error: snapshot.error as ServerResponse['error'],
          snapshot,
        }
      }),
    }
  })
}

function persistResponseEvent(chatId: string, event: ResponseEvent): void {
  const pending = pendingResponseEvents.get(event.responseId)
  if (pending) {
    pending.events.push(event)
    return
  }
  const timer = window.setTimeout(() => flushResponseEvents(event.responseId), 1_000)
  pendingResponseEvents.set(event.responseId, { chatId, events: [event], timer })
}

function persistResponseSnapshot(chatId: string, snapshot: ResponseSnapshot): void {
  const pending = pendingResponseEvents.get(snapshot.responseId)
  if (pending) {
    window.clearTimeout(pending.timer)
    flushResponseEvents(snapshot.responseId)
  }
  queryClient.setQueryData<ServerChat>(chatKey(chatId), (chat) => {
    if (!chat?.responses) return chat
    return {
      ...chat,
      responses: chat.responses.map((response) => {
        if (response.id !== snapshot.responseId) return response
        const merged = rememberResponseSnapshot(mergeResponseSnapshots(response.snapshot, snapshot))
        const done = !['queued', 'in_progress'].includes(merged.status)
        return {
          ...response,
          status: merged.status,
          output: merged.output,
          usage: merged.usage,
          error: merged.error as ServerResponse['error'],
          completedAt: done ? (response.completedAt ?? merged.updatedAt) : response.completedAt,
          snapshot: merged,
        }
      }),
    }
  })
}

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
  streamingIds: [],
  responseSequences: {},

  replaceSummaries: (rows) => set((state) => ({
    chats: rows.map((row) => toChat(row, state.chats.find((chat) => chat.id === row.id), state.responseSequences, state.streamingIds)),
  })),
  replaceFolders: (rows) => set((state) => ({
    folders: rows.map((row) => ({
      ...row,
      expanded: state.folders.find((folder) => folder.id === row.id)?.expanded ?? true,
    })),
  })),
  setDetailedChat: (row) => set((state) => {
    const responseSequences = { ...state.responseSequences }
    for (const response of row.responses ?? []) {
      rememberResponseSnapshot(response.snapshot)
      responseSequences[response.id] = Math.max(
        responseSequences[response.id] ?? 0,
        response.snapshot.sequence,
      )
    }
    const chat = toChat(row, state.chats.find((item) => item.id === row.id), responseSequences, state.streamingIds)
    const exists = state.chats.some((item) => item.id === row.id)
    const chats = exists ? state.chats.map((item) => item.id === row.id ? chat : item) : [chat, ...state.chats]
    return {
      chats,
      streamingIds: reconcileStreamingIds(chats, state.streamingIds),
      responseSequences,
    }
  }),

  applyResponseEvent: (event) => {
    if ((get().responseSequences[event.responseId] ?? 0) >= event.sequence) return true
    const affectedChat = get().chats.find((chat) => chat.messages.some((message) => message.id === event.responseId))
    if (!affectedChat) return false
    const payload = event.payload as { delta?: string; type?: string }
    const textDelta = typeof payload.delta === 'string' ? payload.delta : ''
    const reasoningDelta = event.type === 'response.reasoning_summary_text.delta' ? textDelta : ''
    set((state) => ({
      responseSequences: { ...state.responseSequences, [event.responseId]: event.sequence },
      chats: state.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => message.id !== event.responseId ? message : {
          ...message,
          content: event.type === 'response.output_text.delta' ? message.content + textDelta : message.content,
          reasoning: reasoningDelta ? (message.reasoning ?? '') + reasoningDelta : message.reasoning,
        }),
      })),
    }))
    persistResponseEvent(affectedChat.id, event)
    return true
  },

  applyResponseSnapshot: (snapshot) => {
    if ((get().responseSequences[snapshot.responseId] ?? 0) > snapshot.sequence) return
    const affectedChatId = get().chats.find((chat) =>
      chat.messages.some((message) => message.id === snapshot.responseId)
    )?.id
    if (affectedChatId) persistResponseSnapshot(affectedChatId, snapshot)
    set((state) => {
      const inFlight = ['queued', 'in_progress'].includes(snapshot.status)
      return {
        responseSequences: { ...state.responseSequences, [snapshot.responseId]: snapshot.sequence },
        streamingIds: inFlight
          ? addStreamingId(state.streamingIds, snapshot.responseId)
          : removeStreamingId(state.streamingIds, snapshot.responseId),
        chats: state.chats.map((chat) => ({
          ...chat,
          messages: chat.messages.map((message) => {
            if (message.id !== snapshot.responseId) return message
            return {
              ...message,
              content: snapshot.output.length ? outputText(snapshot.output) : message.content,
              reasoning: snapshot.output.length ? reasoningText(snapshot.output) : message.reasoning,
              done: !inFlight,
              tokensIn: snapshot.usage?.inputTokens,
              tokensOut: snapshot.usage?.outputTokens,
              latencyMs: !inFlight
                ? Math.max(0, Date.parse(snapshot.updatedAt) - message.timestamp)
                : message.latencyMs,
              error: (snapshot.error as { message?: string } | null)?.message,
              outputItems: snapshot.output,
            }
          }),
        })),
      }
    })
    if (!['queued', 'in_progress'].includes(snapshot.status)) {
      void queryClient.invalidateQueries({ queryKey: chatsKey() })
      if (affectedChatId) void queryClient.invalidateQueries({ queryKey: chatKey(affectedChatId) })
    }
  },

  newChat: (modelId) => {
    set({ activeChatId: null })
    return modelId ?? useCatalog.getState().models[0]?.id ?? ''
  },
  setActive: (activeChatId) => set({ activeChatId }),

  deleteChat: (id) => {
    set((state) => {
      const removed = state.chats.find((chat) => chat.id === id)
      const removedIds = new Set(
        removed?.messages.filter((message) => message.role === 'assistant').map((message) => message.id) ?? [],
      )
      return {
        chats: state.chats.filter((chat) => chat.id !== id),
        streamingIds: state.streamingIds.filter((responseId) => !removedIds.has(responseId)),
      }
    })
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

  sendMessage: (chatId, content, modelId, attachments = [], temporary = false) => {
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
    const userMessage: Message = {
      id: `${responseId}:input`,
      role: 'user',
      content,
      timestamp,
      done: true,
      attachments: attachments.length ? attachments : undefined,
    }
    const assistantMessage: Message = {
      id: responseId, role: 'assistant', content: '', modelId,
      timestamp: timestamp + 1, done: false, presetSelections: generation.selections,
    }
    set((state) => {
      const existing = state.chats.find((chat) => chat.id === id)
      const titleSource = content || (attachments[0]?.name ?? 'Image')
      const title = titleSource.length > 42 ? `${titleSource.slice(0, 42)}…` : titleSource
      const updated: Chat = existing
        ? { ...existing, updatedAt: timestamp, messages: [...existing.messages, userMessage, assistantMessage] }
        : { id, title, modelId, messages: [userMessage, assistantMessage], createdAt: timestamp, updatedAt: timestamp, pinned: false, folderId: null, tags: [] }
      return {
        chats: existing ? state.chats.map((chat) => chat.id === id ? updated : chat) : [updated, ...state.chats],
        activeChatId: id,
        streamingIds: addStreamingId(state.streamingIds, responseId),
      }
    })
    cacheOptimisticTurn({
      chatId: id,
      responseId,
      content,
      modelId: generation.effectiveModelId || modelId,
      displayModelId: modelId,
      title: (content || attachments[0]?.name || 'Image').slice(0, 200),
      temporary,
      attachments,
      presetSelections: generation.selections,
      createdAt: timestamp,
    })

    void (async () => {
      if (!chatId) {
        await optimisticRequest('POST', '/api/chats', {
          clientId: id,
          modelId,
          title: (content || attachments[0]?.name || 'Image').slice(0, 200),
          temporary,
        })
      }
      const result = await optimisticRequest('POST', `/api/chats/${id}/responses`, {
        clientId: responseId,
        input: content,
        modelId,
        presetSelections: generation.selections,
        attachmentIds: attachments.map((attachment) => attachment.id),
      }) as { response?: ResponseSnapshot } | undefined
      const serverId = result?.response?.responseId
      if (serverId && serverId !== responseId) {
        const clientUserId = `${responseId}:input`
        const serverUserId = `${serverId}:input`
        set((state) => {
          const responseSequences = { ...state.responseSequences }
          if (responseSequences[responseId] != null) {
            responseSequences[serverId] = Math.max(responseSequences[serverId] ?? 0, responseSequences[responseId] ?? 0)
            delete responseSequences[responseId]
          }
          return {
            streamingIds: replaceStreamingId(state.streamingIds, responseId, serverId),
            responseSequences,
            chats: state.chats.map((chat) => chat.id !== id ? chat : {
              ...chat,
              messages: chat.messages.map((message) => {
                if (message.id === responseId) return { ...message, id: serverId }
                if (message.id === clientUserId) return { ...message, id: serverUserId }
                return message
              }),
            }),
          }
        })
        queryClient.setQueryData<ServerChat>(chatKey(id), (chat) => {
          if (!chat?.responses) return chat
          return {
            ...chat,
            activeResponseId: chat.activeResponseId === responseId ? serverId : chat.activeResponseId,
            activeBranchLeafId: chat.activeBranchLeafId === responseId ? serverId : chat.activeBranchLeafId,
            responses: chat.responses.map((response) => response.id !== responseId ? response : {
              ...response,
              id: serverId,
              snapshot: { ...response.snapshot, responseId: serverId },
            }),
          }
        })
      }
      await queryClient.invalidateQueries({ queryKey: chatsKey() })
      await queryClient.invalidateQueries({ queryKey: chatKey(id) })
    })().catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Unable to generate a response'
      const failedAt = new Date().toISOString()
      set((state) => ({
        streamingIds: removeStreamingId(state.streamingIds, responseId),
        chats: state.chats.map((chat) => chat.id !== id ? chat : {
          ...chat,
          messages: chat.messages.map((message) => message.id !== responseId ? message : {
            ...message,
            done: true,
            error: errorMessage,
          }),
        }),
      }))
      queryClient.setQueryData<ServerChat>(chatKey(id), (chat) => {
        if (!chat?.responses) return chat
        return {
          ...chat,
          responses: chat.responses.map((response) => response.id !== responseId ? response : {
            ...response,
            status: 'failed',
            error: { message: errorMessage },
            completedAt: failedAt,
            snapshot: {
              ...response.snapshot,
              status: 'failed',
              error: { message: errorMessage },
              updatedAt: failedAt,
            },
          }),
        }
      })
    })
    return id
  },

  regenerate: (chatId, messageId, modelId) => {
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      useSettings.getState().generation[modelId],
      modelId,
    )
    void optimisticRequest('POST', `/api/messages/${messageId}/regenerate`, {
      modelId,
      presetSelections: generation.selections,
    }).then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  editUserMessage: (chatId, messageId, content, modelId) => {
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      useSettings.getState().generation[modelId],
      modelId,
    )
    void optimisticRequest('PATCH', `/api/messages/${messageId}`, {
      content,
      modelId,
      presetSelections: generation.selections,
    }).then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  editAssistantMessage: (chatId, messageId, content) => {
    void optimisticRequest('PATCH', `/api/messages/${messageId}`, { content }).then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  deleteUserMessage: (chatId, messageId) => {
    void optimisticRequest('DELETE', `/api/messages/${messageId}`).then(async () => {
      await queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
      await queryClient.invalidateQueries({ queryKey: chatsKey() })
    })
  },
  activateBranch: (chatId, responseId) => {
    const cached = queryClient.getQueryData<ServerChat>(chatKey(chatId))
    if (cached?.responses?.some((response) => response.id === responseId)) {
      const activeBranchLeafId = newestDescendantId(cached.responses, responseId)
      const updated = { ...cached, activeResponseId: activeBranchLeafId, activeBranchLeafId }
      queryClient.setQueryData(chatKey(chatId), updated)
      get().setDetailedChat(updated)
    }
    void optimisticRequest('POST', `/api/messages/${responseId}/activate`).then((result) => {
      const activeBranchLeafId = (result as { activeBranchLeafId?: string } | undefined)?.activeBranchLeafId
      if (!activeBranchLeafId) return
      const current = queryClient.getQueryData<ServerChat>(chatKey(chatId))
      if (!current) return
      const updated = { ...current, activeResponseId: activeBranchLeafId, activeBranchLeafId }
      queryClient.setQueryData(chatKey(chatId), updated)
      get().setDetailedChat(updated)
    })
  },
  stopStreaming: (responseId) => {
    if (!responseId) return
    set((state) => ({
      streamingIds: removeStreamingId(state.streamingIds, responseId),
      chats: state.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => message.id !== responseId ? message : {
          ...message,
          done: true,
        }),
      })),
    }))
    void optimisticRequest('POST', `/api/responses/${responseId}/cancel`)
  },
}))
