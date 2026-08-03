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
import { clearLocalChats } from '@/lib/local-first/chat-cache'
import { coalesceResponseEvents } from '@/features/chat/response-sync'
import { withBranchMetadata } from '@/lib/message-branches'
import { reconcileStreamingResponseIds, reindexDetailedChatResponses } from '@/lib/response-tracking'
import { BranchSelectionIntents } from '@/lib/branch-selection-intents'
import { reorderList } from '@/lib/model-order'
import { useAuth } from './auth'

const FOLDER_EXPANDED_KEY = 'pulpo-folder-expanded'

function loadFolderExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLDER_EXPANDED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    )
  } catch {
    return {}
  }
}

function saveFolderExpanded(map: Record<string, boolean>) {
  try {
    localStorage.setItem(FOLDER_EXPANDED_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private mode
  }
}

function applySortOrders(ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]))
}

export interface ServerResponse {
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
  agentMode?: boolean
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
  sortOrder?: number
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
  pinned: boolean
  sortOrder?: number
}

interface ChatState {
  chats: Chat[]
  folders: Folder[]
  activeChatId: string | null
  streamingIds: string[]
  responseSequences: Record<string, number>
  responseChatIds: Record<string, string>
  replaceSummaries: (chats: ServerChat[]) => void
  replaceFolders: (folders: ServerFolder[]) => void
  setDetailedChat: (chat: ServerChat) => void
  applyResponseEvents: (events: ResponseEvent[]) => boolean
  applyResponseSnapshot: (snapshot: ResponseSnapshot, options?: { invalidate?: boolean }) => void
  newChat: (modelId?: string) => string
  setActive: (id: string | null) => void
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  moveToFolder: (id: string, folderId: string | null) => void
  reorderPinnedChats: (fromId: string, toId: string, edge: 'before' | 'after') => void
  reorderFolderChats: (folderId: string, fromId: string, toId: string, edge: 'before' | 'after') => void
  shareChat: (id: string) => Promise<string>
  addFolder: (name: string) => void
  toggleFolder: (id: string) => void
  renameFolder: (id: string, name: string) => void
  toggleFolderPin: (id: string) => void
  reorderFolders: (fromId: string, toId: string, edge: 'before' | 'after') => void
  deleteFolder: (id: string) => void
  sendMessage: (chatId: string | null, content: string, modelId: string, attachments?: Attachment[], temporary?: boolean) => string
  regenerate: (chatId: string, messageId: string, modelId: string) => void
  editUserMessage: (chatId: string, messageId: string, content: string, modelId: string) => void
  editAssistantMessage: (chatId: string, messageId: string, content: string) => void
  deleteUserMessage: (chatId: string, messageId: string) => void
  activateBranch: (chatId: string, responseId: string) => void
  stopStreaming: (responseId: string) => void
  continueWithoutAgent: (responseId: string) => Promise<void>
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

function responseChatIndex(chats: Chat[], previous: Record<string, string> = {}): Record<string, string> {
  const chatIds = new Set(chats.map((chat) => chat.id))
  const index: Record<string, string> = Object.fromEntries(
    Object.entries(previous).filter(([, chatId]) => chatIds.has(chatId)),
  )
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.role === 'assistant') index[message.id] = chat.id
    }
  }
  return index
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
  }).filter(Boolean).join('')
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

function attachmentsFromOutput(output: unknown[], metadata: Map<string, ServerAttachment>): Attachment[] {
  return output.flatMap((item): Attachment[] => {
    const value = item as { type?: string; attachment_id?: string; name?: string; mime_type?: string; size_bytes?: number }
    if (value.type !== 'pulpo_attachment' || !value.attachment_id) return []
    const stored = metadata.get(value.attachment_id)
    const mimeType = stored?.mimeType ?? value.mime_type ?? 'application/octet-stream'
    return [{
      id: value.attachment_id,
      name: stored?.originalName ?? value.name ?? 'attachment',
      type: mimeType.startsWith('image/') ? 'image' : 'file',
      size: stored?.sizeBytes ?? value.size_bytes ?? 0,
    }]
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
        agentMode: response.agentMode,
        outputItems: response.output,
        attachments: attachmentsFromOutput(response.output, attachments),
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
  durableResponseIds: ReadonlySet<string> = new Set(),
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
    new Set([
      ...durableResponseIds,
      ...(row.responses?.map((response) => response.id) ?? []),
    ]),
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
    sortOrder: row.sortOrder ?? current?.sortOrder ?? 0,
    tags: current?.tags ?? [],
  }
}

function currentUserId(): string | null { return useAuth.getState().user?.id ?? null }
function chatsKey(): readonly unknown[] { return ['chats', currentUserId()] }
function chatKey(id: string): readonly unknown[] { return ['chat', currentUserId(), id] }

const pendingOptimisticResponses = new Map<string, { chatId: string; response: ServerResponse }>()
const branchSelectionIntents = new BranchSelectionIntents()

function mergePendingOptimisticResponses(row: ServerChat): ServerChat {
  if (!row.responses) return row
  const responses = [...row.responses]
  const serverIds = new Set(responses.map((response) => response.id))
  let changed = false
  for (const [responseId, pending] of pendingOptimisticResponses) {
    if (pending.chatId !== row.id) continue
    if (serverIds.has(responseId)) {
      const serverResponse = responses.find((response) => response.id === responseId)
      const pendingTerminal = !['queued', 'in_progress'].includes(pending.response.status)
      const serverTerminal = serverResponse && !['queued', 'in_progress'].includes(serverResponse.status)
      if (pendingTerminal && serverTerminal) pendingOptimisticResponses.delete(responseId)
      continue
    }
    responses.push(pending.response)
    changed = true
  }
  const desiredLeaf = branchSelectionIntents.current(row.id)?.leafId
  const activeLeaf = desiredLeaf && responses.some((response) => response.id === desiredLeaf)
    ? desiredLeaf
    : row.activeBranchLeafId
  if (activeLeaf !== row.activeBranchLeafId || activeLeaf !== row.activeResponseId) changed = true
  if (!changed) return row
  return {
    ...row,
    activeResponseId: activeLeaf,
    activeBranchLeafId: activeLeaf,
    responses: withBranchMetadata(responses),
  }
}

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
  parentResponseId: string | null
}): number {
  const createdAt = new Date(input.createdAt).toISOString()
  const existing = queryClient.getQueryData<ServerChat>(chatKey(input.chatId))
  const response: ServerResponse = {
    id: input.responseId,
    parentResponseId: input.parentResponseId,
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
  pendingOptimisticResponses.set(response.id, { chatId: input.chatId, response })
  const selectionIntent = branchSelectionIntents.select(input.chatId, response.id)
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
        responses: withBranchMetadata([...(existing.responses ?? []), response]),
      }
    : {
        id: input.chatId,
        title: input.title,
        modelId: input.modelId,
        pinned: false,
        folderId: null,
        sortOrder: 0,
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
  return selectionIntent.version
}

function replaceInputText(input: unknown[], content: string): unknown[] {
  const lastUserIndex = input.reduce(
    (last, entry, index) => (entry as { role?: string }).role === 'user' ? index : last,
    -1,
  )
  let replaced = false
  return input.map((item, index) => {
    const typed = item as { role?: string; content?: unknown }
    if (typed.role !== 'user' || index !== lastUserIndex) return item
    replaced = true
    if (!Array.isArray(typed.content)) return { ...typed, content }
    let found = false
    const parts = typed.content.map((part) => {
      const value = part as { type?: string }
      if (value.type !== 'input_text') return part
      found = true
      return { ...value, text: content }
    })
    return { ...typed, content: found ? parts : [{ type: 'input_text', text: content }, ...parts] }
  }).concat(replaced ? [] : [{ role: 'user', content }])
}

function cacheOptimisticBranch(input: {
  chatId: string
  sourceResponseId: string
  responseId: string
  modelId: string
  displayModelId: string
  presetSelections: Record<string, string>
  editedInput?: string
}): { chat: ServerChat; selectionVersion: number } | undefined {
  const existing = queryClient.getQueryData<ServerChat>(chatKey(input.chatId))
  const source = existing?.responses?.find((response) => response.id === input.sourceResponseId)
  if (!existing?.responses || !source) return undefined
  const createdAt = new Date().toISOString()
  const response: ServerResponse = {
    ...source,
    id: input.responseId,
    modelId: input.modelId,
    displayModelId: input.displayModelId,
    status: 'queued',
    input: input.editedInput === undefined ? source.input : replaceInputText(source.input, input.editedInput),
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
    userMessageId: input.editedInput === undefined ? source.userMessageId : crypto.randomUUID(),
  }
  pendingOptimisticResponses.set(response.id, { chatId: input.chatId, response })
  const selectionIntent = branchSelectionIntents.select(input.chatId, response.id)
  const updated: ServerChat = {
    ...existing,
    updatedAt: createdAt,
    activeResponseId: response.id,
    activeBranchLeafId: response.id,
    responses: withBranchMetadata([...existing.responses, response]),
  }
  queryClient.setQueryData(chatKey(input.chatId), updated)
  return { chat: updated, selectionVersion: selectionIntent.version }
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
        const snapshot = rememberResponseSnapshot(coalesceResponseEvents(pending.events).reduce(applyEventToSnapshot, base))
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
  const optimistic = pendingOptimisticResponses.get(event.responseId)
  if (optimistic) {
    const snapshot = applyEventToSnapshot(optimistic.response.snapshot, event)
    pendingOptimisticResponses.set(event.responseId, {
      ...optimistic,
      response: {
        ...optimistic.response,
        status: snapshot.status,
        output: snapshot.output,
        snapshot,
      },
    })
  }
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
  const optimistic = pendingOptimisticResponses.get(snapshot.responseId)
  if (optimistic) {
    const merged = mergeResponseSnapshots(optimistic.response.snapshot, snapshot)
    const done = !['queued', 'in_progress'].includes(merged.status)
    pendingOptimisticResponses.set(snapshot.responseId, {
      ...optimistic,
      response: {
        ...optimistic.response,
        status: merged.status,
        output: merged.output,
        usage: merged.usage,
        error: merged.error as ServerResponse['error'],
        completedAt: done ? (optimistic.response.completedAt ?? merged.updatedAt) : optimistic.response.completedAt,
        snapshot: merged,
      },
    })
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

const chatMutationTails = new Map<string, Promise<unknown>>()

function enqueueChatMutation<T>(chatId: string, operation: () => Promise<T>): Promise<T> {
  const previous = chatMutationTails.get(chatId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  chatMutationTails.set(chatId, result)
  void result.finally(() => {
    if (chatMutationTails.get(chatId) === result) chatMutationTails.delete(chatId)
  }).catch(() => undefined)
  return result
}

function failOptimisticResponse(
  chatId: string,
  responseId: string,
  fallbackResponseId: string,
  selectionVersion: number,
  message: string,
): ServerChat | undefined {
  const current = queryClient.getQueryData<ServerChat>(chatKey(chatId))
  if (!current?.responses?.some((response) => response.id === responseId)) return current
  const failedAt = new Date().toISOString()
  const restoreFallback = branchSelectionIntents.isCurrent(chatId, selectionVersion)
    && current.activeBranchLeafId === responseId
  const updated: ServerChat = {
    ...current,
    activeResponseId: restoreFallback ? fallbackResponseId : current.activeResponseId,
    activeBranchLeafId: restoreFallback ? fallbackResponseId : current.activeBranchLeafId,
    responses: withBranchMetadata(current.responses.map((response) => response.id !== responseId ? response : {
      ...response,
      status: 'failed',
      error: { message },
      completedAt: failedAt,
      snapshot: { ...response.snapshot, status: 'failed', error: { message }, updatedAt: failedAt },
    })),
  }
  const failedResponse = updated.responses?.find((response) => response.id === responseId)
  if (failedResponse) pendingOptimisticResponses.set(responseId, { chatId, response: failedResponse })
  if (restoreFallback) branchSelectionIntents.select(chatId, fallbackResponseId)
  queryClient.setQueryData(chatKey(chatId), updated)
  return updated
}

export const useChat = create<ChatState>()((set, get) => ({
  chats: [],
  folders: [],
  activeChatId: null,
  streamingIds: [],
  responseSequences: {},
  responseChatIds: {},

  replaceSummaries: (rows) => set((state) => {
    const chats = rows.map((row) => toChat(row, state.chats.find((chat) => chat.id === row.id), state.responseSequences, state.streamingIds))
    return { chats, responseChatIds: responseChatIndex(chats, state.responseChatIds) }
  }),
  replaceFolders: (rows) => set((state) => {
    const persisted = loadFolderExpanded()
    return {
      folders: rows.map((row) => {
        const existing = state.folders.find((folder) => folder.id === row.id)
        const expanded = existing?.expanded ?? persisted[row.id] ?? true
        return {
          id: row.id,
          name: row.name,
          pinned: row.pinned,
          sortOrder: row.sortOrder ?? existing?.sortOrder ?? 0,
          expanded,
        }
      }),
    }
  }),
  setDetailedChat: (incoming) => {
    const row = mergePendingOptimisticResponses(incoming)
    if (row !== incoming) queryClient.setQueryData(chatKey(row.id), row)
    set((state) => {
      const responseSequences = { ...state.responseSequences }
      for (const response of row.responses ?? []) {
        rememberResponseSnapshot(response.snapshot)
        responseSequences[response.id] = Math.max(
          responseSequences[response.id] ?? 0,
          response.snapshot.sequence,
        )
      }
      const durableResponseIds = new Set(
        Object.entries(state.responseChatIds)
          .filter(([, chatId]) => chatId === row.id)
          .map(([responseId]) => responseId),
      )
      const chat = toChat(
        row,
        state.chats.find((item) => item.id === row.id),
        responseSequences,
        state.streamingIds,
        durableResponseIds,
      )
      const exists = state.chats.some((item) => item.id === row.id)
      const chats = exists ? state.chats.map((item) => item.id === row.id ? chat : item) : [chat, ...state.chats]
      return {
        chats,
        streamingIds: reconcileStreamingResponseIds(chats, state.streamingIds, row),
        responseSequences,
        responseChatIds: reindexDetailedChatResponses(state.responseChatIds, chat, row),
      }
    })
  },

  applyResponseEvents: (events) => {
    const responseId = events[0]?.responseId
    if (!responseId) return false
    const currentSequence = get().responseSequences[responseId] ?? 0
    const freshEvents = events.filter((event) => event.responseId === responseId && event.sequence > currentSequence)
    if (freshEvents.length === 0) return false
    const affectedChatId = get().responseChatIds[responseId]
    const affectedChat = get().chats.find((chat) => chat.id === affectedChatId)
    if (!affectedChat) return false
    let nextSequence = currentSequence
    for (const event of freshEvents) nextSequence = Math.max(nextSequence, event.sequence)
    set((state) => ({
      responseSequences: { ...state.responseSequences, [responseId]: nextSequence },
      chats: state.chats.map((chat) => chat.id !== affectedChat.id ? chat : {
            ...chat,
            messages: chat.messages.map((message) => {
              if (message.id !== responseId) return message
              const base: ResponseSnapshot = {
                responseId,
                status: message.done ? 'completed' : 'in_progress',
                sequence: currentSequence,
                output: message.outputItems ?? [],
                usage: null,
                error: null,
                updatedAt: new Date(message.timestamp).toISOString(),
              }
              const projected = freshEvents.reduce(applyEventToSnapshot, base)
              return {
                ...message,
                content: outputText(projected.output),
                reasoning: reasoningText(projected.output),
                outputItems: projected.output,
              }
            }),
          }),
    }))
    for (const event of freshEvents) persistResponseEvent(affectedChat.id, event)
    return true
  },

  applyResponseSnapshot: (snapshot, options) => {
    const currentSnapshot = accumulatedResponseSnapshots.get(snapshot.responseId)
    const acceptedSnapshot = currentSnapshot ? mergeResponseSnapshots(currentSnapshot, snapshot) : snapshot
    if (currentSnapshot && acceptedSnapshot === currentSnapshot) return
    accumulatedResponseSnapshots.set(snapshot.responseId, acceptedSnapshot)
    snapshot = acceptedSnapshot
    const affectedChatId = get().responseChatIds[snapshot.responseId]
    const terminal = !['queued', 'in_progress'].includes(snapshot.status)
    if (affectedChatId) persistResponseSnapshot(affectedChatId, snapshot)
    set((state) => {
      const inFlight = ['queued', 'in_progress'].includes(snapshot.status)
      return {
        responseSequences: { ...state.responseSequences, [snapshot.responseId]: snapshot.sequence },
        streamingIds: inFlight
          ? addStreamingId(state.streamingIds, snapshot.responseId)
          : removeStreamingId(state.streamingIds, snapshot.responseId),
        chats: state.chats.map((chat) => chat.id !== affectedChatId ? chat : ({
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
              attachments: attachmentsFromOutput(snapshot.output, new Map()),
            }
          }),
        })),
      }
    })
    if (terminal && affectedChatId) {
      const detail = queryClient.getQueryData<ServerChat>(chatKey(affectedChatId))
      if (detail) get().setDetailedChat(detail)
    }
    if (terminal && options?.invalidate !== false) {
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
    const userId = currentUserId()
    set((state) => {
      const removed = state.chats.find((chat) => chat.id === id)
      const removedIds = new Set(
        removed?.messages.filter((message) => message.role === 'assistant').map((message) => message.id) ?? [],
      )
      return {
        chats: state.chats.filter((chat) => chat.id !== id),
        streamingIds: state.streamingIds.filter((responseId) => !removedIds.has(responseId)),
        responseChatIds: Object.fromEntries(Object.entries(state.responseChatIds).filter(([, chatId]) => chatId !== id)),
      }
    })
    queryClient.setQueryData(chatsKey(), (rows: ServerChat[] | undefined) => rows?.filter((row) => row.id !== id))
    if (userId && useSettings.getState().trashRetention === 'instant') {
      void clearLocalChats(userId, [id]).catch(() => undefined)
    }
    void optimisticRequest('DELETE', `/api/chats/${id}`).catch(() => void queryClient.invalidateQueries({ queryKey: chatsKey() }))
  },
  renameChat: (id, title) => {
    set((state) => ({ chats: state.chats.map((chat) => chat.id === id ? { ...chat, title } : chat) }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { title })
  },
  togglePin: (id) => {
    const chat = get().chats.find((item) => item.id === id)
    if (!chat) return
    const nextPinned = !chat.pinned
    const maxPinnedOrder = get().chats
      .filter((item) => item.pinned && item.id !== id)
      .reduce((max, item) => Math.max(max, item.sortOrder), -1)
    const sortOrder = nextPinned ? maxPinnedOrder + 1 : chat.sortOrder
    set((state) => ({
      chats: state.chats.map((item) => item.id === id ? { ...item, pinned: nextPinned, sortOrder } : item),
    }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { pinned: nextPinned, sortOrder })
  },
  moveToFolder: (id, folderId) => {
    const maxOrder = folderId
      ? get().chats
        .filter((chat) => chat.folderId === folderId && !chat.pinned && chat.id !== id)
        .reduce((max, chat) => Math.max(max, chat.sortOrder), -1)
      : -1
    const sortOrder = folderId ? maxOrder + 1 : 0
    set((state) => ({
      chats: state.chats.map((chat) => chat.id === id ? { ...chat, folderId, sortOrder } : chat),
    }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { folderId, sortOrder })
  },
  reorderPinnedChats: (fromId, toId, edge) => {
    const pinnedIds = get().chats
      .filter((chat) => chat.pinned)
      .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
      .map((chat) => chat.id)
    const nextIds = reorderList(pinnedIds, fromId, toId, edge)
    if (nextIds === pinnedIds || nextIds.join() === pinnedIds.join()) return
    const orders = applySortOrders(nextIds)
    set((state) => ({
      chats: state.chats.map((chat) => {
        const sortOrder = orders.get(chat.id)
        return sortOrder === undefined ? chat : { ...chat, sortOrder }
      }),
    }))
    void optimisticRequest('PUT', '/api/chats/order', { chatIds: nextIds })
  },
  reorderFolderChats: (folderId, fromId, toId, edge) => {
    const folderChatIds = get().chats
      .filter((chat) => !chat.pinned && chat.folderId === folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
      .map((chat) => chat.id)
    const nextIds = reorderList(folderChatIds, fromId, toId, edge)
    if (nextIds === folderChatIds || nextIds.join() === folderChatIds.join()) return
    const orders = applySortOrders(nextIds)
    set((state) => ({
      chats: state.chats.map((chat) => {
        const sortOrder = orders.get(chat.id)
        return sortOrder === undefined ? chat : { ...chat, sortOrder }
      }),
    }))
    void optimisticRequest('PUT', '/api/chats/order', { chatIds: nextIds })
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
    const sortOrder = get().folders.reduce((max, folder) => Math.max(max, folder.sortOrder), -1) + 1
    set((state) => ({
      folders: [...state.folders, { id, name, pinned: false, expanded: true, sortOrder }],
    }))
    const expanded = loadFolderExpanded()
    expanded[id] = true
    saveFolderExpanded(expanded)
    void optimisticRequest('POST', '/api/folders', { clientId: id, name })
  },
  toggleFolder: (id) => set((state) => {
    const folders = state.folders.map((folder) => (
      folder.id === id ? { ...folder, expanded: !folder.expanded } : folder
    ))
    const expanded = loadFolderExpanded()
    for (const folder of folders) expanded[folder.id] = folder.expanded
    saveFolderExpanded(expanded)
    return { folders }
  }),
  renameFolder: (id, name) => {
    set((state) => ({ folders: state.folders.map((folder) => folder.id === id ? { ...folder, name } : folder) }))
    void optimisticRequest('PATCH', `/api/folders/${id}`, { name })
  },
  toggleFolderPin: (id) => {
    const folder = get().folders.find((item) => item.id === id)
    if (!folder) return
    set((state) => ({ folders: state.folders.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item) }))
    void optimisticRequest('PATCH', `/api/folders/${id}`, { pinned: !folder.pinned })
  },
  reorderFolders: (fromId, toId, edge) => {
    const orderedIds = [...get().folders]
      .sort((a, b) => a.sortOrder - b.sortOrder || Number(b.pinned) - Number(a.pinned))
      .map((folder) => folder.id)
    const nextIds = reorderList(orderedIds, fromId, toId, edge)
    if (nextIds === orderedIds || nextIds.join() === orderedIds.join()) return
    const orders = applySortOrders(nextIds)
    set((state) => ({
      folders: state.folders.map((folder) => {
        const sortOrder = orders.get(folder.id)
        return sortOrder === undefined ? folder : { ...folder, sortOrder }
      }),
    }))
    void optimisticRequest('PUT', '/api/folders/order', { folderIds: nextIds })
  },
  deleteFolder: (id) => {
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== id),
      chats: state.chats.map((chat) => chat.folderId === id ? { ...chat, folderId: null } : chat),
    }))
    const expanded = loadFolderExpanded()
    delete expanded[id]
    saveFolderExpanded(expanded)
    void optimisticRequest('DELETE', `/api/folders/${id}`)
  },

  sendMessage: (chatId, content, modelId, attachments = [], temporary = false) => {
    const userId = currentUserId()
    if (!userId) return chatId ?? ''
    const id = chatId ?? crypto.randomUUID()
    const responseId = crypto.randomUUID()
    const timestamp = Date.now()
    const cachedChat = queryClient.getQueryData<ServerChat>(chatKey(id))
    const parentResponseId = cachedChat?.activeBranchLeafId ?? cachedChat?.activeResponseId ?? null
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
      agentMode: useSettings.getState().agentModeEnabled && getCatalogModel(modelId).agentEnabled && useCatalog.getState().agentAvailable,
    }
    set((state) => {
      const existing = state.chats.find((chat) => chat.id === id)
      const titleSource = content || (attachments[0]?.name ?? 'Image')
      const title = titleSource.length > 42 ? `${titleSource.slice(0, 42)}…` : titleSource
      const updated: Chat = existing
        ? { ...existing, updatedAt: timestamp, messages: [...existing.messages, userMessage, assistantMessage] }
        : { id, title, modelId, messages: [userMessage, assistantMessage], createdAt: timestamp, updatedAt: timestamp, pinned: false, folderId: null, sortOrder: 0, tags: [] }
      return {
        chats: existing ? state.chats.map((chat) => chat.id === id ? updated : chat) : [updated, ...state.chats],
        activeChatId: id,
        streamingIds: addStreamingId(state.streamingIds, responseId),
        responseChatIds: { ...state.responseChatIds, [responseId]: id },
      }
    })
    const selectionVersion = cacheOptimisticTurn({
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
      parentResponseId,
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
      const result = await enqueueChatMutation(id, () => optimisticRequest('POST', `/api/chats/${id}/responses`, {
        clientId: responseId,
        parentResponseId,
        input: content,
        modelId,
        presetSelections: generation.selections,
        attachmentIds: attachments.map((attachment) => attachment.id),
        agentMode: useSettings.getState().agentModeEnabled && getCatalogModel(modelId).agentEnabled && useCatalog.getState().agentAvailable,
      })) as { response?: ResponseSnapshot } | undefined
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
            responseChatIds: Object.fromEntries(Object.entries(state.responseChatIds).map(([id, chatId]) => [
              id === responseId ? serverId : id,
              chatId,
            ])),
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
      if (result !== undefined) branchSelectionIntents.clear(id, selectionVersion)
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
    const responseId = crypto.randomUUID()
    const optimistic = cacheOptimisticBranch({
      chatId,
      sourceResponseId: messageId,
      responseId,
      modelId: generation.effectiveModelId || modelId,
      displayModelId: modelId,
      presetSelections: generation.selections,
    })
    const selectionVersion = optimistic?.selectionVersion
      ?? branchSelectionIntents.select(chatId, responseId).version
    if (optimistic) get().setDetailedChat(optimistic.chat)
    void enqueueChatMutation(chatId, () => optimisticRequest('POST', `/api/messages/${messageId}/regenerate`, {
      clientId: responseId,
      modelId,
      presetSelections: generation.selections,
    })).then((result) => {
      if (result === undefined) return
      branchSelectionIntents.clear(chatId, selectionVersion)
      void queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to regenerate the response'
      const failed = failOptimisticResponse(chatId, responseId, messageId, selectionVersion, message)
      if (failed) get().setDetailedChat(failed)
    })
  },
  editUserMessage: (chatId, messageId, content, modelId) => {
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      useSettings.getState().generation[modelId],
      modelId,
    )
    const sourceResponseId = messageId.endsWith(':input') ? messageId.slice(0, -6) : messageId
    const responseId = crypto.randomUUID()
    const optimistic = cacheOptimisticBranch({
      chatId,
      sourceResponseId,
      responseId,
      modelId: generation.effectiveModelId || modelId,
      displayModelId: modelId,
      presetSelections: generation.selections,
      editedInput: content,
    })
    const selectionVersion = optimistic?.selectionVersion
      ?? branchSelectionIntents.select(chatId, responseId).version
    if (optimistic) get().setDetailedChat(optimistic.chat)
    void enqueueChatMutation(chatId, () => optimisticRequest('PATCH', `/api/messages/${messageId}`, {
      clientId: responseId,
      content,
      modelId,
      presetSelections: generation.selections,
    })).then((result) => {
      if (result === undefined) return
      branchSelectionIntents.clear(chatId, selectionVersion)
      void queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to save and resend the message'
      const failed = failOptimisticResponse(chatId, responseId, sourceResponseId, selectionVersion, message)
      if (failed) get().setDetailedChat(failed)
    })
  },
  editAssistantMessage: (chatId, messageId, content) => {
    void enqueueChatMutation(chatId, () => optimisticRequest('PATCH', `/api/messages/${messageId}`, { content }))
      .then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  deleteUserMessage: (chatId, messageId) => {
    void enqueueChatMutation(chatId, () => optimisticRequest('DELETE', `/api/messages/${messageId}`)).then(async () => {
      await queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
      await queryClient.invalidateQueries({ queryKey: chatsKey() })
    })
  },
  activateBranch: (chatId, responseId) => {
    const cached = queryClient.getQueryData<ServerChat>(chatKey(chatId))
    const intendedLeafId = cached?.responses?.some((response) => response.id === responseId)
      ? newestDescendantId(cached.responses, responseId)
      : responseId
    const selectionIntent = branchSelectionIntents.select(chatId, intendedLeafId)
    if (cached?.responses?.some((response) => response.id === responseId)) {
      const updated = { ...cached, activeResponseId: intendedLeafId, activeBranchLeafId: intendedLeafId }
      queryClient.setQueryData(chatKey(chatId), updated)
      get().setDetailedChat(updated)
    }
    void enqueueChatMutation(chatId, () => optimisticRequest('POST', `/api/messages/${responseId}/activate`)).then((result) => {
      const activeBranchLeafId = (result as { activeBranchLeafId?: string } | undefined)?.activeBranchLeafId
      if (!activeBranchLeafId) return
      if (!branchSelectionIntents.isCurrent(chatId, selectionIntent.version)) return
      const current = queryClient.getQueryData<ServerChat>(chatKey(chatId))
      if (!current) return
      branchSelectionIntents.clear(chatId, selectionIntent.version)
      const updated = { ...current, activeResponseId: activeBranchLeafId, activeBranchLeafId }
      queryClient.setQueryData(chatKey(chatId), updated)
      get().setDetailedChat(updated)
    }).catch(() => {
      branchSelectionIntents.clear(chatId, selectionIntent.version)
      void queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    })
  },
  stopStreaming: (responseId) => {
    if (!responseId) return
    set((state) => {
      const affectedChatId = state.responseChatIds[responseId]
      return {
        streamingIds: removeStreamingId(state.streamingIds, responseId),
        chats: state.chats.map((chat) => chat.id !== affectedChatId ? chat : ({
          ...chat,
          messages: chat.messages.map((message) => message.id !== responseId ? message : {
            ...message,
            done: true,
          }),
        })),
      }
    })
    void optimisticRequest('POST', `/api/responses/${responseId}/cancel`)
  },
  continueWithoutAgent: async (responseId) => {
    if (!responseId) return
    await optimisticRequest('POST', `/api/responses/${responseId}/continue-without-agent`)
  },
}))
