import { create } from 'zustand'
import {
  mergeResponseSnapshots,
  type CreateQueuedMessageInput,
  type EmbeddedResponseSnapshot,
  type ResponseEvent,
  type ResponseSnapshot,
  type UpdateQueuedMessageInput,
} from '@pulpo/contracts'
import {
  hydrateEmbeddedResponseSnapshot,
  mergeCachedResponseDetails,
  responseLineageDetailsAvailable,
} from '@pulpo/client-core'
import type { Attachment, Chat, Folder, Message, QueuedMessage } from '@/lib/types'
import { apiRequest, ApiError, isNetworkError } from '@/lib/api'
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
import { mergeSummaryResponseTracking, reconcileStreamingResponseIds, reindexDetailedChatResponses } from '@/lib/response-tracking'
import { BranchSelectionIntents } from '@/lib/branch-selection-intents'
import { reorderList } from '@/lib/model-order'
import { useAuth } from './auth'
import { adminChatAccessActive, adminChatAccountKey } from '@/features/admin-chat/access'

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
  costMicros?: number | null
  error: { message?: string } | null
  createdAt: string
  completedAt: string | null
  agentMode?: boolean
  snapshot: ResponseSnapshot | EmbeddedResponseSnapshot
  branches: {
    user: { ids: string[]; index: number }
    assistant: { ids: string[]; index: number }
  }
  detailAvailable?: boolean
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
  temporary?: boolean
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
  activeResponseId: string | null
  activeBranchLeafId: string | null
  inFlightResponseIds?: string[]
  attachments?: ServerAttachment[]
  responses?: ServerResponse[]
  queuedMessages?: QueuedMessage[]
}

interface BranchActivationResult {
  activeBranchLeafId: string
  responses?: ServerResponse[]
}

interface PendingMessageInput {
  chatId: string | null
  responseId?: string
  content: string
  modelId: string
  attachments: Attachment[]
  temporary: boolean
  autoExpire: boolean
  createdAt?: number
}

interface PendingQueuedMessageInput extends Omit<PendingMessageInput, 'chatId'> {
  chatId: string
  responseId: string
  presetSelections: Record<string, string>
  agentMode: boolean
}

interface StagedSendOptions {
  targetChatId: string
  responseId: string
  presetSelections: Record<string, string>
  agentMode: boolean
}

export function mergeServerChatDetails(cached: ServerChat | undefined, incoming: ServerChat): ServerChat {
  if (!cached) return incoming
  return {
    ...incoming,
    responses: mergeCachedResponseDetails(cached.responses, incoming.responses),
  }
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
  activeTemporaryChatId: string | null
  adminAccessRequiredChatId: string | null
  composerModelId: string | null
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
  setAdminAccessRequiredChat: (id: string | null) => void
  setComposerModel: (id: string) => void
  persistTemporaryChat: (id: string) => Promise<ServerChat>
  abandonTemporaryChat: (id?: string) => void
  markTemporaryExpired: (id: string) => void
  setChatAutoExpiration: (id: string, enabled: boolean) => void
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  moveToFolder: (
    id: string,
    folderId: string | null,
    position?: { targetId: string; edge: 'before' | 'after' },
  ) => void
  reorderPinnedChats: (fromId: string, toId: string, edge: 'before' | 'after') => void
  reorderFolderChats: (folderId: string, fromId: string, toId: string, edge: 'before' | 'after') => void
  shareChat: (id: string) => Promise<string>
  addFolder: (name: string) => void
  toggleFolder: (id: string) => void
  renameFolder: (id: string, name: string) => void
  toggleFolderPin: (id: string) => void
  reorderFolders: (fromId: string, toId: string, edge: 'before' | 'after') => void
  deleteFolder: (id: string) => void
  sendMessage: (chatId: string | null, content: string, modelId: string, attachments?: Attachment[], temporary?: boolean, autoExpire?: boolean, staged?: StagedSendOptions) => string
  stagePendingMessage: (input: PendingMessageInput) => { chatId: string; responseId: string }
  stagePendingQueuedMessage: (input: PendingQueuedMessageInput) => void
  removePendingMessage: (chatId: string, responseId: string) => void
  enqueueMessage: (
    chatId: string,
    input: CreateQueuedMessageInput,
    attachments: Attachment[],
    stagedQueueId?: string,
  ) => Promise<void>
  updateQueuedMessage: (chatId: string, messageId: string, input: UpdateQueuedMessageInput, attachments?: Attachment[]) => Promise<void>
  reorderQueuedMessage: (chatId: string, messageId: string, targetMessageId: string, edge: 'before' | 'after') => Promise<void>
  deleteQueuedMessage: (chatId: string, messageId: string) => Promise<void>
  regenerate: (chatId: string, messageId: string, modelId: string) => void
  editUserMessage: (input: {
    chatId: string
    messageId: string
    content: string
    modelId: string
    attachments: Attachment[]
    agentMode: boolean
  }) => Promise<void>
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

function currentAgentMode(modelId: string): boolean {
  return (useSettings.getState().agentModes[modelId] ?? true)
    && Boolean(getCatalogModel(modelId).agentEnabled)
    && useCatalog.getState().agentAvailable
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
      mimeType,
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
        mimeType: attachment.mimeType,
        type: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
        size: attachment.sizeBytes,
      }] : []
    })
    return [
      {
        id: `${response.id}:input`, role: 'user' as const, content: inputText(response.input),
        timestamp, done: true, branch: response.branches.user, attachments: messageAttachments,
        agentMode: response.agentMode,
      },
      {
        id: response.id, role: 'assistant' as const, content: outputText(response.output),
        modelId: response.displayModelId ?? response.modelId, timestamp: timestamp + 1, done,
        reasoning: reasoningText(response.output), presetSelections: response.presetSelections,
        tokensIn: response.usage?.inputTokens, tokensOut: response.usage?.outputTokens,
        cost: response.costMicros == null ? undefined : response.costMicros / 1_000_000,
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
  const queuedMessages = [...(row.queuedMessages ?? current?.queuedMessages ?? [])]
  const queuedIds = new Set(queuedMessages.map((message) => message.id))
  for (const message of pendingOptimisticQueuedMessages.values()) {
    if (message.chatId === row.id && !queuedIds.has(message.id)) queuedMessages.push(message)
  }
  queuedMessages.sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt))
  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    messages,
    queuedMessages,
    createdAt: Date.parse(row.createdAt),
    updatedAt: Date.parse(row.updatedAt),
    pinned: row.pinned,
    folderId: row.folderId,
    sortOrder: row.sortOrder ?? current?.sortOrder ?? 0,
    tags: current?.tags ?? [],
    temporary: row.temporary ?? current?.temporary ?? false,
    expiresAt: row.expiresAt === undefined
      ? current?.expiresAt ?? null
      : row.expiresAt === null ? null : Date.parse(row.expiresAt),
    expired: current?.expired ?? false,
  }
}

function currentUserId(): string | null { return adminChatAccountKey() ?? useAuth.getState().user?.id ?? null }
function chatsKey(): readonly unknown[] { return ['chats', currentUserId()] }
function chatKey(id: string): readonly unknown[] { return ['chat', currentUserId(), id] }

function automaticExpirationDeadline(now = Date.now()): number | null {
  const preference = useSettings.getState().automaticChatExpiration
  if (preference === '24h') return now + 24 * 60 * 60 * 1_000
  if (preference === '7d') return now + 7 * 24 * 60 * 60 * 1_000
  return null
}

const pendingOptimisticResponses = new Map<string, {
  chatId: string
  response: ServerResponse
  attachments: ServerAttachment[]
}>()
const pendingOptimisticQueuedMessages = new Map<string, QueuedMessage>()
const branchSelectionIntents = new BranchSelectionIntents()

function mergePendingOptimisticResponses(row: ServerChat): ServerChat {
  if (!row.responses) return row
  const responses = [...row.responses]
  const serverIds = new Set(responses.map((response) => response.id))
  const attachmentRows = [...(row.attachments ?? [])]
  const attachmentIds = new Set(attachmentRows.map((attachment) => attachment.id))
  let changed = false
  for (const [responseId, pending] of pendingOptimisticResponses) {
    if (pending.chatId !== row.id) continue
    if (serverIds.has(responseId)) {
      const serverResponse = responses.find((response) => response.id === responseId)
      const pendingTerminal = !['queued', 'in_progress'].includes(pending.response.status)
      const serverTerminal = serverResponse && !['queued', 'in_progress'].includes(serverResponse.status)
      if (pendingTerminal && serverTerminal) pendingOptimisticResponses.delete(responseId)
      for (const attachment of pending.attachments) {
        if (attachmentIds.has(attachment.id)) continue
        attachmentIds.add(attachment.id)
        attachmentRows.push(attachment)
        changed = true
      }
      continue
    }
    responses.push(pending.response)
    for (const attachment of pending.attachments) {
      if (attachmentIds.has(attachment.id)) continue
      attachmentIds.add(attachment.id)
      attachmentRows.push(attachment)
    }
    changed = true
  }
  const desiredLeaf = branchSelectionIntents.current(row.id)?.leafId
  const activeLeaf = desiredLeaf && responses.some((response) => response.id === desiredLeaf && response.detailAvailable !== false)
    ? desiredLeaf
    : row.activeBranchLeafId
  if (activeLeaf !== row.activeBranchLeafId || activeLeaf !== row.activeResponseId) changed = true
  if (!changed) return row
  return {
    ...row,
    activeResponseId: activeLeaf,
    activeBranchLeafId: activeLeaf,
    responses: withBranchMetadata(responses),
    attachments: attachmentRows,
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
  expiresAt: string | null
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
  const attachmentRows = input.attachments.map((attachment) => ({
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size,
  }))
  pendingOptimisticResponses.set(response.id, { chatId: input.chatId, response, attachments: attachmentRows })
  const selectionIntent = branchSelectionIntents.select(input.chatId, response.id)
  const detail: ServerChat = existing
    ? {
        ...existing,
        updatedAt: createdAt,
        activeResponseId: input.responseId,
        activeBranchLeafId: input.responseId,
        temporary: existing.temporary ?? input.temporary,
        expiresAt: (existing.temporary ?? input.temporary)
          ? new Date(input.createdAt + 48 * 60 * 60 * 1_000).toISOString()
          : existing.expiresAt ?? input.expiresAt,
        attachments: [
          ...(existing.attachments ?? []).filter((attachment) => !input.attachments.some((item) => item.id === attachment.id)),
          ...attachmentRows,
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
        temporary: input.temporary,
        expiresAt: input.temporary ? new Date(input.createdAt + 48 * 60 * 60 * 1_000).toISOString() : input.expiresAt,
        createdAt,
        updatedAt: createdAt,
        activeResponseId: input.responseId,
        activeBranchLeafId: input.responseId,
        attachments: attachmentRows,
        responses: [response],
      }
  queryClient.setQueryData(chatKey(input.chatId), detail)
  if (!input.temporary) {
    queryClient.setQueryData<ServerChat[]>(chatsKey(), (rows = []) => {
      const summary = { ...detail, responses: undefined }
      return [summary, ...rows.filter((row) => row.id !== input.chatId)]
    })
  }
  return selectionIntent.version
}

function replaceInputUserContent(input: unknown[], content: string, attachments: Attachment[]): unknown[] {
  const lastUserIndex = input.reduce(
    (last, entry, index) => (entry as { role?: string }).role === 'user' ? index : last,
    -1,
  )
  let replaced = false
  return input.map((item, index) => {
    const typed = item as { role?: string; content?: unknown }
    if (typed.role !== 'user' || index !== lastUserIndex) return item
    replaced = true
    const untouched = Array.isArray(typed.content)
      ? typed.content.filter((part) => !['input_text', 'input_file'].includes((part as { type?: string }).type ?? ''))
      : []
    return { ...typed, content: [
      { type: 'input_text', text: content },
      ...attachments.map((attachment) => ({ type: 'input_file', attachment_id: attachment.id })),
      ...untouched,
    ] }
  }).concat(replaced ? [] : [{ role: 'user', content: [
    { type: 'input_text', text: content },
    ...attachments.map((attachment) => ({ type: 'input_file', attachment_id: attachment.id })),
  ] }])
}

function cacheOptimisticBranch(input: {
  chatId: string
  sourceResponseId: string
  responseId: string
  modelId: string
  displayModelId: string
  presetSelections: Record<string, string>
  editedInput?: string
  editedAttachments?: Attachment[]
  agentMode?: boolean
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
    input: input.editedInput === undefined
      ? source.input
      : replaceInputUserContent(source.input, input.editedInput, input.editedAttachments ?? []),
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
    agentMode: input.agentMode ?? source.agentMode,
  }
  const attachmentRows = (input.editedAttachments ?? []).map((attachment) => ({
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size,
  }))
  pendingOptimisticResponses.set(response.id, { chatId: input.chatId, response, attachments: attachmentRows })
  const selectionIntent = branchSelectionIntents.select(input.chatId, response.id)
  const updated: ServerChat = {
    ...existing,
    updatedAt: createdAt,
    activeResponseId: response.id,
    activeBranchLeafId: response.id,
    responses: withBranchMetadata([...existing.responses, response]),
    attachments: [
      ...(existing.attachments ?? []).filter((attachment) => !attachmentRows.some((item) => item.id === attachment.id)),
      ...attachmentRows,
    ],
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

function hydratedResponseSnapshot(response: ServerResponse): ResponseSnapshot {
  return hydrateEmbeddedResponseSnapshot(response.snapshot, response.output)
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
        const base = accumulatedResponseSnapshots.get(responseId) ?? hydratedResponseSnapshot(response)
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
    const snapshot = applyEventToSnapshot(hydratedResponseSnapshot(optimistic.response), event)
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
    const merged = mergeResponseSnapshots(hydratedResponseSnapshot(optimistic.response), snapshot)
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
        const merged = rememberResponseSnapshot(mergeResponseSnapshots(hydratedResponseSnapshot(response), snapshot))
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
  options: { queueOffline?: boolean } = {},
): Promise<unknown> {
  const userId = currentUserId()
  if (!userId) return
  const idempotencyKey = crypto.randomUUID()
  try {
    return await apiRequest(path, { method, body, idempotencyKey })
  } catch (error) {
    if (!adminChatAccessActive() && isNetworkError(error) && options.queueOffline !== false) {
      await enqueueMutation({ userId, method, path, body, idempotencyKey })
      return
    }
    throw error
  }
}

const chatMutationTails = new Map<string, Promise<unknown>>()
const responseDispatches = new Map<string, Promise<void>>()

export function waitForResponseDispatch(responseId: string): Promise<void> {
  return responseDispatches.get(responseId) ?? Promise.resolve()
}

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
      snapshot: { ...hydratedResponseSnapshot(response), status: 'failed', error: { message }, updatedAt: failedAt },
    })),
  }
  const failedResponse = updated.responses?.find((response) => response.id === responseId)
  if (failedResponse) pendingOptimisticResponses.set(responseId, {
    chatId,
    response: failedResponse,
    attachments: pendingOptimisticResponses.get(responseId)?.attachments ?? [],
  })
  if (restoreFallback) branchSelectionIntents.select(chatId, fallbackResponseId)
  queryClient.setQueryData(chatKey(chatId), updated)
  return updated
}

export const useChat = create<ChatState>()((set, get) => ({
  chats: [],
  folders: [],
  activeChatId: null,
  activeTemporaryChatId: null,
  adminAccessRequiredChatId: null,
  composerModelId: null,
  streamingIds: [],
  responseSequences: {},
  responseChatIds: {},

  replaceSummaries: (rows) => set((state) => {
    const serverChats = rows.map((row) => toChat(row, state.chats.find((chat) => chat.id === row.id), state.responseSequences, state.streamingIds))
    const activeTemporary = state.activeTemporaryChatId
      ? state.chats.find((chat) => chat.id === state.activeTemporaryChatId && chat.temporary)
      : undefined
    const localOnly = state.chats.filter((chat) => (
      (chat.provisional || chat.id === activeTemporary?.id)
      && !serverChats.some((serverChat) => serverChat.id === chat.id)
    ))
    const chats = [...localOnly, ...serverChats]
    const tracking = mergeSummaryResponseTracking(
      rows,
      state.streamingIds,
      responseChatIndex(chats, state.responseChatIds),
    )
    return { chats, ...tracking }
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
    const detailed = mergeServerChatDetails(queryClient.getQueryData<ServerChat>(chatKey(incoming.id)), incoming)
    const row = mergePendingOptimisticResponses(detailed)
    if (row !== incoming) queryClient.setQueryData(chatKey(row.id), row)
    set((state) => {
      const responseSequences = { ...state.responseSequences }
      for (const response of row.responses ?? []) {
        rememberResponseSnapshot(hydratedResponseSnapshot(response))
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
    get().abandonTemporaryChat()
    set({ activeChatId: null })
    return modelId ?? useCatalog.getState().models[0]?.id ?? ''
  },
  setActive: (activeChatId) => set({ activeChatId }),
  setAdminAccessRequiredChat: (adminAccessRequiredChatId) => set({ adminAccessRequiredChatId }),
  setComposerModel: (composerModelId) => set({ composerModelId }),

  persistTemporaryChat: async (id) => {
    try {
      const persisted = await enqueueChatMutation(id, () => apiRequest<ServerChat>(`/api/chats/${id}/persist`, {
        method: 'POST',
      }))
      const normalized: ServerChat = { ...persisted, temporary: false, expiresAt: null }
      set((state) => ({
        activeTemporaryChatId: state.activeTemporaryChatId === id ? null : state.activeTemporaryChatId,
        chats: state.chats.map((chat) => chat.id === id ? {
          ...chat,
          temporary: false,
          expiresAt: null,
          expired: false,
        } : chat),
      }))
      queryClient.setQueryData<ServerChat>(chatKey(id), (chat) => chat ? {
        ...chat,
        ...normalized,
        responses: chat.responses,
        attachments: chat.attachments,
      } : normalized)
      await queryClient.invalidateQueries({ queryKey: chatsKey() })
      return normalized
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'temporary_chat_expired' || error.status === 404)) {
        get().markTemporaryExpired(id)
      }
      throw error
    }
  },

  abandonTemporaryChat: (requestedId) => {
    const id = requestedId ?? get().activeTemporaryChatId
    if (!id) return
    const chat = get().chats.find((item) => item.id === id)
    if (!chat?.temporary) {
      set((state) => ({
        activeTemporaryChatId: state.activeTemporaryChatId === id ? null : state.activeTemporaryChatId,
      }))
      return
    }
    const responseIds = new Set(chat.messages.filter((message) => message.role === 'assistant').map((message) => message.id))
    for (const responseId of responseIds) pendingOptimisticResponses.delete(responseId)
    set((state) => ({
      activeTemporaryChatId: state.activeTemporaryChatId === id ? null : state.activeTemporaryChatId,
      activeChatId: state.activeChatId === id ? null : state.activeChatId,
      chats: state.chats.filter((item) => item.id !== id),
      streamingIds: state.streamingIds.filter((responseId) => !responseIds.has(responseId)),
      responseChatIds: Object.fromEntries(Object.entries(state.responseChatIds).filter(([, chatId]) => chatId !== id)),
    }))
    queryClient.setQueryData<ServerChat[]>(chatsKey(), (rows) => rows?.filter((row) => row.id !== id))
    const userId = currentUserId()
    if (userId) void clearLocalChats(userId, [id]).catch(() => undefined)
    else queryClient.removeQueries({ queryKey: chatKey(id), exact: true })
  },

  markTemporaryExpired: (id) => set((state) => ({
    streamingIds: state.streamingIds.filter((responseId) => state.responseChatIds[responseId] !== id),
    chats: state.chats.map((chat) => chat.id === id && chat.temporary ? { ...chat, expired: true } : chat),
  })),

  setChatAutoExpiration: (id, enabled) => {
    const chat = get().chats.find((item) => item.id === id)
    if (!chat || chat.temporary) return
    const previous = chat.expiresAt
    const expiresAt = enabled ? automaticExpirationDeadline() : null
    if (enabled && expiresAt === null) return
    const expiresAtIso = expiresAt === null ? null : new Date(expiresAt).toISOString()
    set((state) => ({
      chats: state.chats.map((item) => item.id === id ? { ...item, expiresAt } : item),
    }))
    queryClient.setQueryData<ServerChat[]>(chatsKey(), (rows) => rows?.map((row) => (
      row.id === id ? { ...row, expiresAt: expiresAtIso } : row
    )))
    queryClient.setQueryData<ServerChat>(chatKey(id), (row) => row ? { ...row, expiresAt: expiresAtIso } : row)
    void enqueueChatMutation(id, () => optimisticRequest('PATCH', `/api/chats/${id}`, { autoExpire: enabled }))
      .then(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: chatsKey() }),
        queryClient.invalidateQueries({ queryKey: chatKey(id) }),
      ]))
      .catch(() => {
        const previousIso = previous === null ? null : new Date(previous).toISOString()
        set((state) => ({
          chats: state.chats.map((item) => item.id === id ? { ...item, expiresAt: previous } : item),
        }))
        queryClient.setQueryData<ServerChat[]>(chatsKey(), (rows) => rows?.map((row) => (
          row.id === id ? { ...row, expiresAt: previousIso } : row
        )))
        queryClient.setQueryData<ServerChat>(chatKey(id), (row) => row ? { ...row, expiresAt: previousIso } : row)
      })
  },

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
  moveToFolder: (id, folderId, position) => {
    if (!folderId) {
      set((state) => ({
        chats: state.chats.map((chat) => chat.id === id ? { ...chat, folderId: null, sortOrder: 0 } : chat),
      }))
      void optimisticRequest('PATCH', `/api/chats/${id}`, { folderId: null, sortOrder: 0 })
      return
    }

    const destIds = get().chats
      .filter((chat) => !chat.pinned && chat.folderId === folderId && chat.id !== id)
      .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
      .map((chat) => chat.id)

    let nextIds: string[]
    if (position && destIds.includes(position.targetId)) {
      nextIds = reorderList([...destIds, id], id, position.targetId, position.edge)
    } else {
      nextIds = [...destIds, id]
    }

    const orders = applySortOrders(nextIds)
    const sortOrder = orders.get(id) ?? nextIds.length - 1
    set((state) => ({
      chats: state.chats.map((chat) => {
        if (chat.id === id) return { ...chat, folderId, sortOrder }
        const nextOrder = orders.get(chat.id)
        return nextOrder === undefined ? chat : { ...chat, sortOrder: nextOrder }
      }),
    }))
    void optimisticRequest('PATCH', `/api/chats/${id}`, { folderId, sortOrder })
    if (nextIds.length > 1) {
      void optimisticRequest('PUT', '/api/chats/order', { chatIds: nextIds })
    }
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

  stagePendingMessage: (input) => {
    const id = input.chatId ?? crypto.randomUUID()
    const responseId = input.responseId ?? crypto.randomUUID()
    const timestamp = input.createdAt ?? Date.now()
    const newChatExpiresAt = !input.chatId && !input.temporary && input.autoExpire
      ? automaticExpirationDeadline(timestamp)
      : null
    const userMessage: Message = {
      id: `${responseId}:input`,
      role: 'user',
      content: input.content,
      timestamp,
      done: true,
      attachments: input.attachments.length ? input.attachments : undefined,
      deliveryStatus: 'uploading',
      pendingSubmissionId: responseId,
    }
    set((state) => {
      const existing = state.chats.find((chat) => chat.id === id)
      const titleSource = input.content || (input.attachments[0]?.name ?? 'Message')
      const title = titleSource.length > 42 ? `${titleSource.slice(0, 42)}…` : titleSource
      const updated: Chat = existing
        ? {
            ...existing,
            updatedAt: timestamp,
            messages: existing.messages.some((message) => message.id === userMessage.id)
              ? existing.messages.map((message) => message.id === userMessage.id ? userMessage : message)
              : [...existing.messages, userMessage],
          }
        : {
            id,
            title,
            modelId: input.modelId,
            messages: [userMessage],
            createdAt: timestamp,
            updatedAt: timestamp,
            pinned: false,
            folderId: null,
            sortOrder: 0,
            tags: [],
            temporary: input.temporary,
            expiresAt: input.temporary ? timestamp + 48 * 60 * 60 * 1_000 : newChatExpiresAt,
            expired: false,
            provisional: true,
          }
      return {
        chats: existing ? state.chats.map((chat) => chat.id === id ? updated : chat) : [updated, ...state.chats],
        activeChatId: id,
        activeTemporaryChatId: input.temporary || existing?.temporary ? id : state.activeTemporaryChatId,
      }
    })
    return { chatId: id, responseId }
  },

  stagePendingQueuedMessage: (input) => {
    const timestamp = input.createdAt ?? Date.now()
    const now = new Date(timestamp).toISOString()
    const currentQueue = get().chats.find((chat) => chat.id === input.chatId)?.queuedMessages ?? []
    const queuedMessage: QueuedMessage = {
      id: input.responseId,
      chatId: input.chatId,
      content: input.content,
      modelId: input.modelId,
      presetSelections: input.presetSelections,
      agentMode: input.agentMode,
      position: Math.max(-1, ...currentQueue.map((message) => message.position)) + 1,
      status: 'pending',
      error: null,
      attachments: input.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        localUploadId: attachment.localUploadId,
      })),
      createdAt: now,
      updatedAt: now,
      pendingSubmissionId: input.responseId,
    }
    pendingOptimisticQueuedMessages.set(queuedMessage.id, queuedMessage)
    set((state) => ({
      chats: state.chats.map((chat) => chat.id !== input.chatId ? chat : {
        ...chat,
        updatedAt: timestamp,
        queuedMessages: (chat.queuedMessages ?? []).some((message) => message.id === queuedMessage.id)
          ? (chat.queuedMessages ?? []).map((message) => message.id === queuedMessage.id ? queuedMessage : message)
          : [...(chat.queuedMessages ?? []), queuedMessage],
      }),
    }))
  },

  removePendingMessage: (chatId, responseId) => {
    pendingOptimisticQueuedMessages.delete(responseId)
    set((state) => ({
      chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
        ...chat,
        messages: chat.messages.filter((message) => message.id !== `${responseId}:input`),
        queuedMessages: (chat.queuedMessages ?? []).filter((message) => (
          message.id !== responseId && message.pendingSubmissionId !== responseId
        )),
      }),
    }))
  },

  sendMessage: (chatId, content, modelId, attachments = [], temporary = false, autoExpire = false, staged) => {
    const userId = currentUserId()
    if (!userId) return chatId ?? ''
    const id = staged?.targetChatId ?? chatId ?? crypto.randomUUID()
    const responseId = staged?.responseId ?? crypto.randomUUID()
    const timestamp = Date.now()
    const newChatExpiresAt = !chatId && !temporary && autoExpire ? automaticExpirationDeadline(timestamp) : null
    const cachedChat = queryClient.getQueryData<ServerChat>(chatKey(id))
    const currentChat = get().chats.find((chat) => chat.id === id)
    if (currentChat?.temporary && currentChat.expired) return id
    const parentResponseId = cachedChat?.activeBranchLeafId ?? cachedChat?.activeResponseId ?? null
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      staged?.presetSelections ?? useSettings.getState().generation[modelId],
      modelId,
    )
    const agentMode = staged?.agentMode ?? currentAgentMode(modelId)
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
      agentMode,
    }
    set((state) => {
      const existing = state.chats.find((chat) => chat.id === id)
      const titleSource = content || (attachments[0]?.name ?? 'Image')
      const title = titleSource.length > 42 ? `${titleSource.slice(0, 42)}…` : titleSource
      const updated: Chat = existing
        ? {
          ...existing,
          updatedAt: timestamp,
          expiresAt: existing.temporary ? timestamp + 48 * 60 * 60 * 1_000 : existing.expiresAt,
          messages: staged && existing.messages.some((message) => message.id === userMessage.id)
            ? existing.messages.flatMap((message) => message.id === userMessage.id ? [userMessage, assistantMessage] : [message])
            : [...existing.messages, userMessage, assistantMessage],
        }
        : {
          id,
          title,
          modelId,
          messages: [userMessage, assistantMessage],
          createdAt: timestamp,
          updatedAt: timestamp,
          pinned: false,
          folderId: null,
          sortOrder: 0,
          tags: [],
          temporary,
          expiresAt: temporary ? timestamp + 48 * 60 * 60 * 1_000 : newChatExpiresAt,
          expired: false,
          // Keep a new chat in the local summary list until /api/chats/start
          // completes. A concurrent summaries refresh can otherwise discard it
          // before the server has persisted the chat.
          provisional: true,
        }
      return {
        chats: existing ? state.chats.map((chat) => chat.id === id ? updated : chat) : [updated, ...state.chats],
        activeChatId: id,
        activeTemporaryChatId: temporary || existing?.temporary ? id : state.activeTemporaryChatId,
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
      expiresAt: newChatExpiresAt === null ? null : new Date(newChatExpiresAt).toISOString(),
      attachments,
      presetSelections: generation.selections,
      createdAt: timestamp,
      parentResponseId,
    })

    const dispatch = (async () => {
      const responseBody = {
        clientId: responseId,
        parentResponseId,
        input: content,
        modelId,
        presetSelections: generation.selections,
        attachmentIds: attachments.map((attachment) => attachment.id),
        agentMode,
      }
      const path = chatId ? `/api/chats/${id}/responses` : '/api/chats/start'
      const body = chatId ? responseBody : {
        chat: {
          clientId: id,
          modelId,
          title: (content || attachments[0]?.name || 'Image').slice(0, 200),
          temporary,
          autoExpire,
        },
        response: responseBody,
      }
      const result = await enqueueChatMutation(id, () => optimisticRequest('POST', path, body, {
        queueOffline: !(temporary || currentChat?.temporary),
      })) as { response?: ResponseSnapshot } | undefined
      set((state) => ({
        chats: state.chats.map((chat) => chat.id === id ? { ...chat, provisional: false } : chat),
      }))
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
    })()
    const trackedDispatch = dispatch.then(() => undefined)
    responseDispatches.set(responseId, trackedDispatch)
    void trackedDispatch.catch(() => undefined).finally(() => {
      if (responseDispatches.get(responseId) === trackedDispatch) responseDispatches.delete(responseId)
    })
    void dispatch.catch((error: unknown) => {
      const expired = error instanceof ApiError
        && (error.code === 'temporary_chat_expired' || (error.status === 404 && get().chats.some((chat) => chat.id === id && chat.temporary)))
      const errorMessage = expired
        ? 'This temporary chat has expired and cannot be recovered.'
        : error instanceof Error ? error.message : 'Unable to generate a response'
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
      if (expired) get().markTemporaryExpired(id)
    })
    return id
  },

  enqueueMessage: async (chatId, input, messageAttachments, stagedQueueId) => {
    const now = new Date().toISOString()
    const currentQueue = get().chats.find((chat) => chat.id === chatId)?.queuedMessages ?? []
    const staged = stagedQueueId
      ? currentQueue.find((message) => message.id === stagedQueueId || message.pendingSubmissionId === stagedQueueId)
      : undefined
    const optimistic: QueuedMessage = {
      id: staged?.id ?? crypto.randomUUID(),
      chatId,
      content: input.input,
      modelId: input.modelId,
      presetSelections: input.presetSelections,
      agentMode: input.agentMode,
      position: staged?.position ?? Math.max(-1, ...currentQueue.map((message) => message.position)) + 1,
      status: 'pending',
      error: null,
      attachments: messageAttachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
      })),
      createdAt: staged?.createdAt ?? now,
      updatedAt: now,
    }
    pendingOptimisticQueuedMessages.set(optimistic.id, optimistic)
    set((state) => ({
      chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
        ...chat,
        queuedMessages: (chat.queuedMessages ?? []).some((message) => message.id === optimistic.id)
          ? (chat.queuedMessages ?? []).map((message) => message.id === optimistic.id ? optimistic : message)
          : [...(chat.queuedMessages ?? []), optimistic],
      }),
    }))
    try {
      const result = await apiRequest<{ queuedMessage: QueuedMessage | null }>(`/api/chats/${chatId}/queued-messages`, {
        method: 'POST', body: input,
      })
      pendingOptimisticQueuedMessages.delete(optimistic.id)
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
          ...chat,
          queuedMessages: (chat.queuedMessages ?? []).flatMap((message) => {
            if (message.id !== optimistic.id) return [message]
            return result.queuedMessage ? [result.queuedMessage] : []
          }),
        }),
      }))
      await queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
      await queryClient.invalidateQueries({ queryKey: chatsKey() })
    } catch (error) {
      pendingOptimisticQueuedMessages.delete(optimistic.id)
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
          ...chat,
          queuedMessages: (chat.queuedMessages ?? []).filter((message) => message.id !== optimistic.id),
        }),
      }))
      throw error
    }
  },

  updateQueuedMessage: async (chatId, messageId, input, messageAttachments = []) => {
    const previous = get().chats.find((chat) => chat.id === chatId)?.queuedMessages ?? []
    const updatedAt = new Date().toISOString()
    set((state) => ({
      chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
        ...chat,
        queuedMessages: (chat.queuedMessages ?? []).map((message) => {
          if (message.id !== messageId) return message
          if (input.action === 'begin_edit') return { ...message, status: 'editing' as const, error: null, updatedAt }
          if (input.action === 'cancel_edit') return { ...message, status: 'pending' as const, error: null, updatedAt }
          return {
            ...message,
            content: input.input,
            modelId: input.modelId,
            presetSelections: input.presetSelections,
            agentMode: input.agentMode,
            attachments: messageAttachments.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.size,
            })),
            status: 'pending' as const,
            error: null,
            updatedAt,
          }
        }),
      }),
    }))
    try {
      const result = await apiRequest<{ queuedMessage: QueuedMessage | null }>(`/api/chats/${chatId}/queued-messages/${messageId}`, {
        method: 'PATCH', body: input,
      })
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
          ...chat,
          queuedMessages: (chat.queuedMessages ?? []).flatMap((message) => {
            if (message.id !== messageId) return [message]
            return result.queuedMessage ? [result.queuedMessage] : []
          }),
        }),
      }))
      await queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    } catch (error) {
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : { ...chat, queuedMessages: previous }),
      }))
      throw error
    }
  },

  reorderQueuedMessage: async (chatId, messageId, targetMessageId, edge) => {
    const previous = get().chats.find((chat) => chat.id === chatId)?.queuedMessages ?? []
    const currentIds = previous.map((message) => message.id)
    const reorderedIds = reorderList(currentIds, messageId, targetMessageId, edge)
    if (reorderedIds === currentIds) return
    const byId = new Map(previous.map((message) => [message.id, message]))
    const optimistic = reorderedIds.flatMap((id, position) => {
      const message = byId.get(id)
      return message ? [{ ...message, position }] : []
    })
    set((state) => ({
      chats: state.chats.map((chat) => chat.id !== chatId ? chat : { ...chat, queuedMessages: optimistic }),
    }))
    try {
      const result = await apiRequest<{ queuedMessages: QueuedMessage[] }>(
        `/api/chats/${chatId}/queued-messages/${messageId}/reorder`,
        { method: 'PATCH', body: { targetMessageId, edge } },
      )
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
          ...chat,
          queuedMessages: result.queuedMessages,
        }),
      }))
      await queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    } catch (error) {
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : { ...chat, queuedMessages: previous }),
      }))
      throw error
    }
  },

  deleteQueuedMessage: async (chatId, messageId) => {
    const previous = get().chats.find((chat) => chat.id === chatId)?.queuedMessages ?? []
    set((state) => ({
      chats: state.chats.map((chat) => chat.id !== chatId ? chat : {
        ...chat,
        queuedMessages: (chat.queuedMessages ?? []).filter((message) => message.id !== messageId),
      }),
    }))
    try {
      await apiRequest(`/api/chats/${chatId}/queued-messages/${messageId}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    } catch (error) {
      set((state) => ({
        chats: state.chats.map((chat) => chat.id !== chatId ? chat : { ...chat, queuedMessages: previous }),
      }))
      throw error
    }
  },

  regenerate: (chatId, messageId, modelId) => {
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      useSettings.getState().generation[modelId],
      modelId,
    )
    const agentMode = currentAgentMode(modelId)
    const responseId = crypto.randomUUID()
    const optimistic = cacheOptimisticBranch({
      chatId,
      sourceResponseId: messageId,
      responseId,
      modelId: generation.effectiveModelId || modelId,
      displayModelId: modelId,
      presetSelections: generation.selections,
      agentMode,
    })
    const selectionVersion = optimistic?.selectionVersion
      ?? branchSelectionIntents.select(chatId, responseId).version
    if (optimistic) get().setDetailedChat(optimistic.chat)
    void enqueueChatMutation(chatId, () => optimisticRequest('POST', `/api/messages/${messageId}/regenerate`, {
      clientId: responseId,
      modelId,
      presetSelections: generation.selections,
      agentMode,
    }, { queueOffline: !get().chats.some((chat) => chat.id === chatId && chat.temporary) })).then((result) => {
      if (result === undefined) return
      branchSelectionIntents.clear(chatId, selectionVersion)
      void queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    }).catch((error: unknown) => {
      const expired = error instanceof ApiError
        && (error.code === 'temporary_chat_expired' || (error.status === 404 && get().chats.some((chat) => chat.id === chatId && chat.temporary)))
      const message = expired
        ? 'This temporary chat has expired and cannot be recovered.'
        : error instanceof Error ? error.message : 'Unable to regenerate the response'
      const failed = failOptimisticResponse(chatId, responseId, messageId, selectionVersion, message)
      if (failed) get().setDetailedChat(failed)
      if (expired) get().markTemporaryExpired(chatId)
    })
  },
  editUserMessage: async ({ chatId, messageId, content, modelId, attachments: editedAttachments, agentMode }) => {
    const generation = resolveGeneration(
      chatOptionsFor(getCatalogModel(modelId), useModelConfig.getState().overrides),
      useSettings.getState().generation[modelId],
      modelId,
    )
    const sourceResponseId = messageId.endsWith(':input') ? messageId.slice(0, -6) : messageId
    const cached = queryClient.getQueryData<ServerChat>(chatKey(chatId))
    const previousActiveLeafId = cached?.activeBranchLeafId ?? cached?.activeResponseId ?? sourceResponseId
    const responseId = crypto.randomUUID()
    const optimistic = cacheOptimisticBranch({
      chatId,
      sourceResponseId,
      responseId,
      modelId: generation.effectiveModelId || modelId,
      displayModelId: modelId,
      presetSelections: generation.selections,
      editedInput: content,
      editedAttachments,
      agentMode,
    })
    const selectionVersion = optimistic?.selectionVersion
      ?? branchSelectionIntents.select(chatId, responseId).version
    if (optimistic) get().setDetailedChat(optimistic.chat)
    try {
      const result = await enqueueChatMutation(chatId, () => optimisticRequest('PATCH', `/api/messages/${messageId}`, {
      clientId: responseId,
      content,
      modelId,
      presetSelections: generation.selections,
      attachmentIds: editedAttachments.map((attachment) => attachment.id),
      agentMode,
    }, { queueOffline: !get().chats.some((chat) => chat.id === chatId && chat.temporary) }))
      if (result === undefined) return
      branchSelectionIntents.clear(chatId, selectionVersion)
      void queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
    } catch (error: unknown) {
      const expired = error instanceof ApiError
        && (error.code === 'temporary_chat_expired' || (error.status === 404 && get().chats.some((chat) => chat.id === chatId && chat.temporary)))
      const message = expired
        ? 'This temporary chat has expired and cannot be recovered.'
        : error instanceof Error ? error.message : 'Unable to save and resend the message'
      const failed = failOptimisticResponse(chatId, responseId, previousActiveLeafId, selectionVersion, message)
      if (failed) get().setDetailedChat(failed)
      if (expired) get().markTemporaryExpired(chatId)
      throw error
    }
  },
  editAssistantMessage: (chatId, messageId, content) => {
    void enqueueChatMutation(chatId, () => optimisticRequest('PATCH', `/api/messages/${messageId}`, { content }, {
      queueOffline: !get().chats.some((chat) => chat.id === chatId && chat.temporary),
    }))
      .then(() => queryClient.invalidateQueries({ queryKey: chatKey(chatId) }))
  },
  deleteUserMessage: (chatId, messageId) => {
    void enqueueChatMutation(chatId, () => optimisticRequest('DELETE', `/api/messages/${messageId}`, undefined, {
      queueOffline: !get().chats.some((chat) => chat.id === chatId && chat.temporary),
    })).then(async () => {
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
    const intendedLeafAvailable = cached?.responses
      ? responseLineageDetailsAvailable(cached.responses, intendedLeafId)
      : false
    if (cached && intendedLeafAvailable) {
      const updated = { ...cached, activeResponseId: intendedLeafId, activeBranchLeafId: intendedLeafId }
      queryClient.setQueryData(chatKey(chatId), updated)
      get().setDetailedChat(updated)
    }
    void enqueueChatMutation(chatId, () => optimisticRequest('POST', `/api/messages/${responseId}/activate`, undefined, {
      queueOffline: !get().chats.some((chat) => chat.id === chatId && chat.temporary),
    })).then((rawResult) => {
      const result = rawResult as BranchActivationResult | undefined
      const activeBranchLeafId = result?.activeBranchLeafId
      if (!activeBranchLeafId) return
      const current = queryClient.getQueryData<ServerChat>(chatKey(chatId))
      if (!current) return
      const enriched = {
        ...current,
        responses: mergeCachedResponseDetails(current.responses, result.responses),
      }
      queryClient.setQueryData(chatKey(chatId), enriched)
      if (!branchSelectionIntents.isCurrent(chatId, selectionIntent.version)) return
      branchSelectionIntents.clear(chatId, selectionIntent.version)
      if (!enriched.responses
        || !responseLineageDetailsAvailable(enriched.responses, activeBranchLeafId)) {
        void queryClient.invalidateQueries({ queryKey: chatKey(chatId) })
        return
      }
      const updated = { ...enriched, activeResponseId: activeBranchLeafId, activeBranchLeafId }
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
