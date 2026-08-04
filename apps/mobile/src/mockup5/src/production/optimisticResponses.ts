import { mergeResponseSnapshots, type ResponseSnapshot } from '@pulpo/contracts'
import type { QueryClient } from '@tanstack/react-query'
import { useRealtimeStore } from '../../../providers/realtimeStore'
import type { ServerAttachment, ServerChat, ServerResponse } from '../../../types'

interface OptimisticAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
}

interface PendingOptimisticResponse {
  namespace: string
  chatId: string
  response: ServerResponse
  attachments: ServerAttachment[]
  chatListed: boolean
  terminalDetailSeen: boolean
}

interface CacheOptimisticTurnInput {
  queryClient: QueryClient
  namespace: string
  chatId: string
  responseId: string
  parentResponseId: string | null
  content: string
  title: string
  modelId: string
  temporary: boolean
  presetSelections: Record<string, string>
  agentMode: boolean
  attachments: OptimisticAttachment[]
  createdAt: number
}

const pendingResponses = new Map<string, PendingOptimisticResponse>()

const chatKey = (namespace: string, chatId: string) => ['chat', namespace, chatId] as const
const chatsKey = (namespace: string) => ['chats', namespace] as const

function pendingKey(namespace: string, responseId: string): string {
  return `${namespace}:${responseId}`
}

function responseFromSnapshot(response: ServerResponse, live: ResponseSnapshot | undefined): ServerResponse {
  if (!live) return response
  const snapshot = mergeResponseSnapshots(response.snapshot, live)
  if (snapshot === response.snapshot) return response
  const terminal = snapshot.status !== 'queued' && snapshot.status !== 'in_progress'
  return {
    ...response,
    status: snapshot.status,
    output: snapshot.output,
    usage: snapshot.usage,
    error: snapshot.error as ServerResponse['error'],
    completedAt: terminal ? response.completedAt ?? snapshot.updatedAt : response.completedAt,
    snapshot,
  }
}

/**
 * Seed the detail cache and realtime reducer before the request leaves the
 * device. Socket deltas can then paint immediately instead of waiting for a
 * transcript round trip to manufacture the response row.
 */
export function cacheOptimisticTurn(input: CacheOptimisticTurnInput): void {
  const createdAt = new Date(input.createdAt).toISOString()
  const attachmentRows: ServerAttachment[] = input.attachments.map((attachment) => ({
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  }))
  const snapshot: ResponseSnapshot = {
    responseId: input.responseId,
    status: 'queued',
    sequence: 0,
    output: [],
    usage: null,
    error: null,
    updatedAt: createdAt,
  }
  const response: ServerResponse = {
    id: input.responseId,
    parentResponseId: input.parentResponseId,
    previousResponseId: input.parentResponseId,
    userMessageId: `${input.responseId}:input`,
    modelId: input.modelId,
    displayModelId: input.modelId,
    status: 'queued',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: input.content },
        ...attachmentRows.map((attachment) => ({ type: 'input_file', attachment_id: attachment.id })),
      ],
    }],
    output: [],
    presetSelections: input.presetSelections,
    agentMode: input.agentMode,
    usage: null,
    error: null,
    createdAt,
    completedAt: null,
    snapshot,
    branches: {
      user: { ids: [input.responseId], index: 0 },
      assistant: { ids: [input.responseId], index: 0 },
    },
  }
  pendingResponses.set(pendingKey(input.namespace, input.responseId), {
    namespace: input.namespace,
    chatId: input.chatId,
    response,
    attachments: attachmentRows,
    chatListed: false,
    terminalDetailSeen: false,
  })

  const existing = input.queryClient.getQueryData<ServerChat>(chatKey(input.namespace, input.chatId))
  const existingResponses = existing?.responses ?? []
  const responses = existingResponses.some((item) => item.id === response.id)
    ? existingResponses
    : [...existingResponses, response]
  const existingAttachments = existing?.attachments ?? []
  const attachmentIds = new Set(attachmentRows.map((attachment) => attachment.id))
  const detail: ServerChat = existing ? {
    ...existing,
    modelId: input.modelId,
    updatedAt: createdAt,
    activeResponseId: response.id,
    activeBranchLeafId: response.id,
    responses,
    attachments: [
      ...existingAttachments.filter((attachment) => !attachmentIds.has(attachment.id)),
      ...attachmentRows,
    ],
  } : {
    id: input.chatId,
    title: input.title,
    modelId: input.modelId,
    pinned: false,
    folderId: null,
    sortOrder: 0,
    temporary: input.temporary,
    activeResponseId: response.id,
    activeBranchLeafId: response.id,
    createdAt,
    updatedAt: createdAt,
    responses: [response],
    attachments: attachmentRows,
  }
  input.queryClient.setQueryData(chatKey(input.namespace, input.chatId), detail)
  useRealtimeStore.getState().receiveSnapshot(snapshot)
}

/**
 * Merge an optimistic turn into a stale transcript until the server contains
 * the same terminal response. This prevents send/completion refetches from
 * momentarily blanking the visible conversation.
 */
export function reconcileOptimisticResponses(
  namespace: string,
  chat: ServerChat,
  snapshots: Record<string, ResponseSnapshot>,
): ServerChat {
  const pending = [...pendingResponses.values()]
    .filter((item) => item.namespace === namespace && item.chatId === chat.id)
    .sort((left, right) => left.response.createdAt.localeCompare(right.response.createdAt))
  if (!pending.length) return chat

  const responses = [...(chat.responses ?? [])]
  const serverById = new Map(responses.map((response) => [response.id, response]))
  const attachments = [...(chat.attachments ?? [])]
  const attachmentIds = new Set(attachments.map((attachment) => attachment.id))
  let optimisticLeaf: string | null = null
  let changed = false

  for (const item of pending) {
    const optimistic = responseFromSnapshot(item.response, snapshots[item.response.id])
    const server = serverById.get(item.response.id)
    // Chat persistence is not guaranteed to expose the response row, active
    // leaf, and attachment metadata in the same client read. Keep the latest
    // accepted turn selected and its attachments resolvable until both the
    // terminal transcript and chat list have caught up.
    optimisticLeaf = item.response.id
    for (const attachment of item.attachments) {
      if (attachmentIds.has(attachment.id)) continue
      attachmentIds.add(attachment.id)
      attachments.push(attachment)
      changed = true
    }
    if (server) {
      const optimisticTerminal = optimistic.status !== 'queued' && optimistic.status !== 'in_progress'
      const serverTerminal = server.status !== 'queued' && server.status !== 'in_progress'
      if (optimisticTerminal && serverTerminal) {
        item.terminalDetailSeen = true
        if (item.chatListed) pendingResponses.delete(pendingKey(namespace, item.response.id))
      }
      continue
    }
    responses.push(optimistic)
    changed = true
  }

  if (optimisticLeaf && (
    chat.activeResponseId !== optimisticLeaf
    || chat.activeBranchLeafId !== optimisticLeaf
  )) changed = true
  if (!changed) return chat
  return {
    ...chat,
    activeResponseId: optimisticLeaf ?? chat.activeResponseId,
    activeBranchLeafId: optimisticLeaf ?? chat.activeBranchLeafId,
    responses,
    attachments,
  }
}

export function pendingOptimisticChatIds(namespace: string): ReadonlySet<string> {
  return new Set([...pendingResponses.values()]
    .filter((item) => item.namespace === namespace)
    .map((item) => item.chatId))
}

/** Mark chat-list persistence separately from transcript persistence. */
export function acknowledgeOptimisticChatList(namespace: string, chatIds: ReadonlySet<string>): void {
  for (const [key, pending] of pendingResponses) {
    if (pending.namespace !== namespace || !chatIds.has(pending.chatId)) continue
    pending.chatListed = true
    if (pending.terminalDetailSeen) pendingResponses.delete(key)
  }
}

export function rejectOptimisticTurn(input: {
  queryClient: QueryClient
  namespace: string
  responseId: string
  discardChat: boolean
}): void {
  const key = pendingKey(input.namespace, input.responseId)
  const pending = pendingResponses.get(key)
  if (!pending) return
  pendingResponses.delete(key)
  useRealtimeStore.getState().removeSnapshot(input.responseId)
  if (input.discardChat) {
    input.queryClient.removeQueries({ queryKey: chatKey(input.namespace, pending.chatId), exact: true })
    input.queryClient.setQueryData<ServerChat[]>(chatsKey(input.namespace), (rows = []) => rows.filter((row) => row.id !== pending.chatId))
    return
  }
  input.queryClient.setQueryData<ServerChat>(chatKey(input.namespace, pending.chatId), (chat) => {
    if (!chat?.responses) return chat
    const responses = chat.responses.filter((response) => response.id !== input.responseId)
    return {
      ...chat,
      activeResponseId: pending.response.parentResponseId,
      activeBranchLeafId: pending.response.parentResponseId,
      responses,
    }
  })
}

export function clearPendingOptimisticResponses(namespace?: string): void {
  if (!namespace) {
    pendingResponses.clear()
    return
  }
  for (const [key, pending] of pendingResponses) {
    if (pending.namespace === namespace) pendingResponses.delete(key)
  }
}
