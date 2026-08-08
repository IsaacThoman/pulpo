import { mergeResponseSnapshots, type ResponseSnapshot } from '@pulpo/contracts'
import { hydrateEmbeddedResponseSnapshot } from '@pulpo/client-core'
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
  rollbackResponseId: string | null
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

interface CacheOptimisticBranchInput {
  queryClient: QueryClient
  namespace: string
  chatId: string
  sourceResponseId: string
  responseId: string
  modelId: string
  presetSelections: Record<string, string>
  editedInput?: string
  editedOutput?: string
  editedAttachments?: OptimisticAttachment[]
  editedAgentMode?: boolean
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
  const base = hydrateEmbeddedResponseSnapshot(response.snapshot, response.output)
  const snapshot = mergeResponseSnapshots(base, live)
  if (snapshot === base && 'output' in response.snapshot) return response
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

function replaceInputUserContent(input: unknown[], content: string, attachments: OptimisticAttachment[]): unknown[] {
  const lastUserIndex = input.reduce((last, entry, index) => (
    (entry as { role?: string }).role === 'user' ? index : last
  ), -1)
  let replaced = false
  const updated = input.map((item, index) => {
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
  })
  return replaced ? updated : [...updated, { role: 'user', content: [
    { type: 'input_text', text: content },
    ...attachments.map((attachment) => ({ type: 'input_file', attachment_id: attachment.id })),
  ] }]
}

function userBranchKey(response: ServerResponse): string {
  return response.userMessageId ?? `legacy:${JSON.stringify(response.input)}`
}

/** Recompute branch controls whenever an optimistic response changes the tree. */
export function withBranchMetadata(responses: ServerResponse[]): ServerResponse[] {
  const sorted = [...responses].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  ))
  return sorted.map((active) => {
    const siblings = sorted.filter((response) => response.parentResponseId === active.parentResponseId)
    const groups = new Map<string, ServerResponse[]>()
    for (const sibling of siblings) {
      const key = userBranchKey(sibling)
      groups.set(key, [...(groups.get(key) ?? []), sibling])
    }
    const activeKey = userBranchKey(active)
    const userIds = [...groups.entries()].map(([key, group]) => (
      key === activeKey ? active.id : group.at(-1)!.id
    ))
    const assistantIds = groups.get(activeKey)?.map((response) => response.id) ?? [active.id]
    return {
      ...active,
      branches: {
        user: { ids: userIds, index: userIds.indexOf(active.id) },
        assistant: { ids: assistantIds, index: assistantIds.indexOf(active.id) },
      },
    }
  })
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
    rollbackResponseId: input.parentResponseId,
    attachments: attachmentRows,
    chatListed: false,
    terminalDetailSeen: false,
  })

  const existing = input.queryClient.getQueryData<ServerChat>(chatKey(input.namespace, input.chatId))
  const existingResponses = existing?.responses ?? []
  const responses = existingResponses.some((item) => item.id === response.id)
    ? existingResponses
    : withBranchMetadata([...existingResponses, response])
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

/** Add a regenerated or edited branch before its request leaves the device. */
export function cacheOptimisticBranch(input: CacheOptimisticBranchInput): ServerResponse | undefined {
  const existing = input.queryClient.getQueryData<ServerChat>(chatKey(input.namespace, input.chatId))
  const source = existing?.responses?.find((response) => response.id === input.sourceResponseId)
  if (!existing?.responses || !source) return undefined
  const createdAt = new Date(input.createdAt).toISOString()
  const isAssistantEdit = input.editedOutput !== undefined
  const attachmentRows: ServerAttachment[] = (input.editedAttachments ?? []).map((attachment) => ({
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  }))
  const output = isAssistantEdit ? [{
    id: `msg_${input.responseId}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: input.editedOutput, annotations: [] }],
  }] : []
  const snapshot: ResponseSnapshot = {
    responseId: input.responseId,
    status: isAssistantEdit ? 'completed' : 'queued',
    sequence: 0,
    output,
    usage: null,
    error: null,
    updatedAt: createdAt,
  }
  const response: ServerResponse = {
    ...source,
    id: input.responseId,
    previousResponseId: source.parentResponseId,
    userMessageId: input.editedInput === undefined ? source.userMessageId : `${input.responseId}:input`,
    modelId: input.modelId,
    displayModelId: input.modelId,
    status: snapshot.status,
    input: input.editedInput === undefined
      ? source.input
      : replaceInputUserContent(source.input, input.editedInput, input.editedAttachments ?? []),
    output,
    presetSelections: input.presetSelections,
    usage: null,
    error: null,
    createdAt,
    completedAt: isAssistantEdit ? createdAt : null,
    snapshot,
    branches: {
      user: { ids: [input.responseId], index: 0 },
      assistant: { ids: [input.responseId], index: 0 },
    },
    agentMode: input.editedAgentMode ?? source.agentMode,
  }
  pendingResponses.set(pendingKey(input.namespace, input.responseId), {
    namespace: input.namespace,
    chatId: input.chatId,
    response,
    rollbackResponseId: source.id,
    attachments: attachmentRows,
    chatListed: false,
    terminalDetailSeen: false,
  })
  input.queryClient.setQueryData<ServerChat>(chatKey(input.namespace, input.chatId), {
    ...existing,
    modelId: input.modelId,
    updatedAt: createdAt,
    activeResponseId: response.id,
    activeBranchLeafId: response.id,
    responses: withBranchMetadata([...existing.responses, response]),
    attachments: [
      ...(existing.attachments ?? []).filter((attachment) => !attachmentRows.some((item) => item.id === attachment.id)),
      ...attachmentRows,
    ],
  })
  useRealtimeStore.getState().receiveSnapshot(snapshot)
  return response
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
    responses: withBranchMetadata(responses),
    attachments,
  }
}

export function pendingOptimisticChatIds(namespace: string): ReadonlySet<string> {
  return new Set([...pendingResponses.values()]
    .filter((item) => item.namespace === namespace)
    .map((item) => item.chatId))
}

export function pendingOptimisticResponseIds(namespace: string, chatId: string): string[] {
  return [...pendingResponses.values()]
    .filter((item) => item.namespace === namespace && item.chatId === chatId)
    .map((item) => item.response.id)
}

export function discardOptimisticChat(namespace: string, chatId: string): void {
  for (const [key, pending] of pendingResponses) {
    if (pending.namespace !== namespace || pending.chatId !== chatId) continue
    pendingResponses.delete(key)
    useRealtimeStore.getState().removeSnapshot(pending.response.id)
  }
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
      activeResponseId: pending.rollbackResponseId,
      activeBranchLeafId: pending.rollbackResponseId,
      responses: withBranchMetadata(responses),
    }
  })
}

function deletionIds(responses: ServerResponse[], selected: ServerResponse, includeUserVariant: boolean): Set<string> {
  const deleting = new Set(includeUserVariant
    ? responses.filter((response) => response.parentResponseId === selected.parentResponseId
      && userBranchKey(response) === userBranchKey(selected)).map((response) => response.id)
    : [selected.id])
  let changed = true
  while (changed) {
    changed = false
    for (const response of responses) {
      if (response.parentResponseId && deleting.has(response.parentResponseId) && !deleting.has(response.id)) {
        deleting.add(response.id)
        changed = true
      }
    }
  }
  return deleting
}

/** Apply a deletion after server success without blocking on a transcript refetch. */
export function applyConfirmedMessageDeletion(input: {
  queryClient: QueryClient
  namespace: string
  chatId: string
  messageId: string
}): void {
  const responseId = input.messageId.endsWith(':input') ? input.messageId.slice(0, -6) : input.messageId
  const includeUserVariant = input.messageId.endsWith(':input')
  const chat = input.queryClient.getQueryData<ServerChat>(chatKey(input.namespace, input.chatId))
  const selected = chat?.responses?.find((response) => response.id === responseId)
  if (!chat?.responses || !selected) return
  const deleting = deletionIds(chat.responses, selected, includeUserVariant)
  const responses = chat.responses.filter((response) => !deleting.has(response.id))
  const currentLeaf = chat.activeBranchLeafId ?? chat.activeResponseId
  const leafId = currentLeaf && !deleting.has(currentLeaf) ? currentLeaf : responses.at(-1)?.id ?? null
  for (const id of deleting) {
    pendingResponses.delete(pendingKey(input.namespace, id))
    useRealtimeStore.getState().removeSnapshot(id)
  }
  input.queryClient.setQueryData<ServerChat>(chatKey(input.namespace, input.chatId), {
    ...chat,
    activeResponseId: leafId,
    activeBranchLeafId: leafId,
    responses: withBranchMetadata(responses),
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
