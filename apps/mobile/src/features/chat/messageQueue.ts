import type { CreateQueuedMessageInput, UpdateQueuedMessageInput } from '@pulpo/contracts'
import type { QueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { apiRequest, isNetworkError } from '../../api/client'
import { cacheOpenedChat, pendingOutbox } from '../../data/database'
import { queueOfflineMutation } from '../../data/mutations'
import { queryKeys } from '../../data/queries'
import { enqueueCacheWrite, flushCacheWrites } from '../../data/writeBehind'
import type { MobileQueuedMessage, ServerChat } from '../../types'

import { reorderQueue, submittingQueueIds } from './messageQueuePolicy'
export { shouldQueueMessage } from './messageQueuePolicy'

export function setChatQueue(client: QueryClient, namespace: string, chatId: string, update: (queue: MobileQueuedMessage[]) => MobileQueuedMessage[]): void {
  client.setQueryData<ServerChat>(queryKeys.chat(namespace, chatId), (chat) => {
    if (!chat) return chat
    const next = { ...chat, queuedMessages: update(chat.queuedMessages ?? []) }
    if (!next.temporary) enqueueCacheWrite(namespace, () => cacheOpenedChat(namespace, next))
    return next
  })
}

export async function enqueueMessage(client: QueryClient, namespace: string, chatId: string, input: CreateQueuedMessageInput,
  attachments: MobileQueuedMessage['attachments'], temporary: boolean): Promise<void> {
  const id = Crypto.randomUUID()
  input = { ...input, clientId: id }
  const now = new Date().toISOString()
  const key = queryKeys.chat(namespace, chatId)
  await client.cancelQueries({ queryKey: key })
  const queue = client.getQueryData<ServerChat>(key)?.queuedMessages ?? []
  const optimistic: MobileQueuedMessage = {
    id, pendingSubmissionId: id, chatId, content: input.input, modelId: input.modelId,
    presetSelections: input.presetSelections, agentMode: input.agentMode, attachments,
    position: Math.max(-1, ...queue.map((item) => item.position)) + 1,
    status: 'pending', error: null, createdAt: now, updatedAt: now,
  }
  submittingQueueIds.add(id)
  setChatQueue(client, namespace, chatId, (items) => [...items, optimistic])
  const path = `/api/chats/${chatId}/queued-messages`
  try {
    // Keep later submissions behind durable offline operations, including chat creation.
    const waiting = temporary ? [] : await pendingOutbox(namespace)
    if (waiting.length) {
      await flushCacheWrites(namespace)
      await queueOfflineMutation({ namespace, entityKey: `queued-message:${id}`, method: 'POST', path, body: input, idempotencyKey: id })
      return
    }
    const result = await apiRequest<{ queuedMessage: MobileQueuedMessage | null }>(path, {
      method: 'POST', body: input, idempotencyKey: id,
    })
    setChatQueue(client, namespace, chatId, (items) => {
      const rest = items.filter((item) => item.id !== id && item.id !== result.queuedMessage?.id)
      return result.queuedMessage ? [...rest, result.queuedMessage].sort((a, b) => a.position - b.position) : rest
    })
  } catch (error) {
    if (!temporary && isNetworkError(error)) {
      await flushCacheWrites(namespace)
      await queueOfflineMutation({ namespace, entityKey: `queued-message:${id}`, method: 'POST', path, body: input, idempotencyKey: id })
    } else {
      setChatQueue(client, namespace, chatId, (items) => items.filter((item) => item.id !== id))
      throw error
    }
  } finally {
    submittingQueueIds.delete(id)
    void client.invalidateQueries({ queryKey: key })
  }
}

export async function mutateQueuedMessage(client: QueryClient, namespace: string, chatId: string, id: string,
  action: UpdateQueuedMessageInput | { action: 'delete' } | { action: 'reorder'; targetMessageId: string; edge: 'before' | 'after' },
  attachments?: MobileQueuedMessage['attachments']): Promise<void> {
  const key = queryKeys.chat(namespace, chatId)
  await client.cancelQueries({ queryKey: key })
  const previous = client.getQueryData<ServerChat>(key)?.queuedMessages ?? []
  const current = previous.find((item) => item.id === id)
  if (!current || current.status === 'dispatching') throw new Error('This message is already being sent. Refresh the queue and try again.')
  if (current.localFailure) {
    if (action.action === 'save_edit') {
      const chat = client.getQueryData<ServerChat>(key)
      await enqueueMessage(client, namespace, chatId, action, attachments ?? current.attachments, chat?.temporary ?? false)
    }
    setChatQueue(client, namespace, chatId, (items) => action.action === 'delete' || action.action === 'save_edit'
      ? items.filter((item) => item.id !== id)
      : items.map((item) => item.id !== id ? item : { ...item, status: action.action === 'begin_edit' ? 'editing' : 'failed' }))
    return
  }
  if (current.pendingSubmissionId) throw new Error('Wait for this message to sync before changing it.')
  setChatQueue(client, namespace, chatId, (items) => action.action === 'delete' ? items.filter((item) => item.id !== id)
    : action.action === 'reorder' ? reorderQueue(items, id, action.targetMessageId, action.edge)
      : items.map((item) => item.id !== id ? item : {
        ...item, status: action.action === 'begin_edit' ? 'editing' : 'pending', error: null,
        ...(action.action === 'save_edit' ? { content: action.input, modelId: action.modelId, presetSelections: action.presetSelections,
          agentMode: action.agentMode, attachments: attachments ?? item.attachments } : {}),
      }))
  try {
    const result = await apiRequest<{ queuedMessage?: MobileQueuedMessage | null; queuedMessages?: MobileQueuedMessage[] }>(
      `/api/chats/${chatId}/queued-messages/${id}${action.action === 'reorder' ? '/reorder' : ''}`, {
        method: action.action === 'delete' ? 'DELETE' : 'PATCH',
        body: action.action === 'delete' ? undefined : action.action === 'reorder'
          ? { targetMessageId: action.targetMessageId, edge: action.edge } : action,
      })
    if (action.action !== 'delete') setChatQueue(client, namespace, chatId, (items) => result.queuedMessages ?? items.flatMap((item) =>
      item.id === id ? result.queuedMessage ? [result.queuedMessage] : [] : [item]))
  } catch (error) {
    setChatQueue(client, namespace, chatId, (items) => {
      if (action.action === 'reorder') {
        const byId = new Map(items.map((item) => [item.id, item]))
        const previousIds = new Set(previous.map((item) => item.id))
        return [...previous.flatMap((item) => byId.has(item.id) ? [byId.get(item.id)!] : []),
          ...items.filter((item) => !previousIds.has(item.id))].map((item, position) => ({ ...item, position }))
      }
      const restored = items.map((item) => item.id === id && item.status !== 'dispatching' ? current : item)
      return action.action === 'delete' && !restored.some((item) => item.id === id)
        ? [...restored, current].sort((a, b) => a.position - b.position) : restored
    })
    throw error
  } finally {
    void client.invalidateQueries({ queryKey: key })
  }
}
