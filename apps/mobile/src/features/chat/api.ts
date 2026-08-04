import { File, Paths } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import * as Sharing from 'expo-sharing'
import { attachmentValidationError } from '@pulpo/client-core'
import type { ResponseSnapshot } from '@pulpo/contracts'
import { apiOrigin, apiRequest, apiUrl, isNetworkError, nativeAuthorizationHeaders } from '../../api/client'
import { cacheNamespace, cachedAttachmentUri, recordCachedAttachment } from '../../data/database'
import { queueOfflineMutation } from '../../data/mutations'
import type { AttachmentDraft, ServerAttachment, ServerChat, ServerFolder } from '../../types'
import { useRealtimeStore } from '../../providers/realtimeStore'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'

export async function createChat(input: { clientId?: string; modelId: string; temporary?: boolean; title?: string }): Promise<ServerChat> {
  const clientId = input.clientId ?? Crypto.randomUUID()
  const body = { clientId, modelId: input.modelId, temporary: input.temporary ?? false, title: input.title }
  try {
    return await apiRequest('/api/chats', { method: 'POST', idempotencyKey: clientId, body })
  } catch (error) {
    const { instanceUrl, user } = useSessionStore.getState()
    if (!user || !isNetworkError(error)) throw error
    await queueOfflineMutation({
      namespace: cacheNamespace(instanceUrl, user.id), entityKey: `chat:${clientId}`,
      method: 'POST', path: '/api/chats', body, idempotencyKey: clientId,
    })
    const now = new Date().toISOString()
    return {
      id: clientId, title: input.title ?? 'New chat', modelId: input.modelId, pinned: false,
      folderId: null, sortOrder: 0, temporary: input.temporary ?? false, activeResponseId: null,
      activeBranchLeafId: null, createdAt: now, updatedAt: now, responses: [], attachments: [],
    }
  }
}

export async function updateChat(id: string, patch: Partial<Pick<ServerChat, 'title' | 'pinned' | 'folderId' | 'modelId' | 'sortOrder'>>): Promise<ServerChat> {
  return apiRequest(`/api/chats/${id}`, { method: 'PATCH', body: patch })
}

export async function trashChat(id: string): Promise<void> {
  await apiRequest(`/api/chats/${id}`, { method: 'DELETE' })
}

export async function restoreChat(id: string): Promise<ServerChat> {
  return apiRequest(`/api/chats/${id}/recover`, { method: 'POST' })
}

export async function permanentlyDeleteChat(id: string): Promise<void> {
  await apiRequest(`/api/chats/${id}/permanent`, { method: 'DELETE' })
}

export async function duplicateChat(id: string): Promise<ServerChat> {
  return apiRequest(`/api/chats/${id}/duplicate`, { method: 'POST', idempotencyKey: Crypto.randomUUID() })
}

export async function createFolder(name: string, clientId = Crypto.randomUUID()): Promise<ServerFolder> {
  return apiRequest('/api/folders', { method: 'POST', body: { clientId, name } })
}

export async function updateFolder(id: string, patch: Partial<Pick<ServerFolder, 'name' | 'pinned' | 'sortOrder'>>): Promise<ServerFolder> {
  return apiRequest(`/api/folders/${id}`, { method: 'PATCH', body: patch })
}

export async function deleteFolder(id: string): Promise<void> {
  await apiRequest(`/api/folders/${id}`, { method: 'DELETE' })
}

export async function sendMessage(input: {
  clientId?: string
  chatId: string
  content: string
  modelId: string
  parentResponseId?: string | null
  presetSelections?: Record<string, string>
  attachmentIds?: string[]
  agentMode?: boolean
}): Promise<ResponseSnapshot> {
  const responseId = input.clientId ?? Crypto.randomUUID()
  const path = `/api/chats/${input.chatId}/responses`
  const queued: ResponseSnapshot = {
    responseId, status: 'queued', sequence: 0, output: [], usage: null, error: null,
    updatedAt: new Date().toISOString(),
  }
  // Establish the replay base before the request. Response events are also
  // delivered through the account room and can otherwise arrive before the
  // 202 acknowledgement, leaving mobile unable to apply the first deltas.
  useRealtimeStore.getState().receiveSnapshot(queued)
  const body = {
    clientId: responseId,
    parentResponseId: input.parentResponseId,
    input: input.content,
    modelId: input.modelId,
    presetSelections: input.presetSelections ?? {},
    attachmentIds: input.attachmentIds ?? [],
    agentMode: input.agentMode ?? false,
  }
  try {
    const result = await apiRequest<{ response: ResponseSnapshot }>(path, {
      method: 'POST', idempotencyKey: responseId, body,
    })
    useRealtimeStore.getState().receiveSnapshot(result.response)
    return useRealtimeStore.getState().snapshots[responseId] ?? result.response
  } catch (error) {
    const { instanceUrl, user } = useSessionStore.getState()
    if (!user || !isNetworkError(error)) {
      useRealtimeStore.getState().removeSnapshot(responseId)
      throw error
    }
    await queueOfflineMutation({
      namespace: cacheNamespace(instanceUrl, user.id), entityKey: `response:${responseId}`,
      method: 'POST', path, body, idempotencyKey: responseId,
    })
    return useRealtimeStore.getState().snapshots[responseId] ?? queued
  }
}

export async function cancelResponse(id: string): Promise<ResponseSnapshot> {
  const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${id}/cancel`, { method: 'POST' })
  useRealtimeStore.getState().receiveSnapshot(snapshot)
  return snapshot
}

export async function regenerateResponse(id: string, modelId?: string, presetSelections?: Record<string, string>): Promise<ResponseSnapshot> {
  const responseId = Crypto.randomUUID()
  const result = await apiRequest<{ response: ResponseSnapshot }>(`/api/messages/${id}/regenerate`, {
    method: 'POST', idempotencyKey: responseId,
    body: { clientId: responseId, modelId, presetSelections },
  })
  useRealtimeStore.getState().receiveSnapshot(result.response)
  return result.response
}

export async function editMessage(id: string, content: string, modelId?: string, presetSelections?: Record<string, string>): Promise<ResponseSnapshot> {
  const responseId = Crypto.randomUUID()
  const result = await apiRequest<{ response: ResponseSnapshot }>(`/api/messages/${id}`, {
    method: 'PATCH', idempotencyKey: responseId,
    body: { clientId: responseId, content, modelId, presetSelections },
  })
  useRealtimeStore.getState().receiveSnapshot(result.response)
  return result.response
}

export async function activateBranch(id: string): Promise<{ activeBranchLeafId: string }> {
  return apiRequest(`/api/messages/${id}/activate`, { method: 'POST' })
}

export async function deleteMessageCascade(id: string): Promise<void> {
  await apiRequest(`/api/messages/${id}`, { method: 'DELETE' })
}

export async function continueWithoutAgent(id: string): Promise<ResponseSnapshot> {
  const snapshot = await apiRequest<ResponseSnapshot>(`/api/responses/${id}/continue-without-agent`, { method: 'POST' })
  useRealtimeStore.getState().receiveSnapshot(snapshot)
  return snapshot
}

export async function shareChat(id: string): Promise<string> {
  const result = await apiRequest<{ token: string }>('/api/chat-shares', {
    method: 'POST', idempotencyKey: Crypto.randomUUID(), body: { chatId: id, expiresAt: null },
  })
  return `${apiOrigin()}/share/${result.token}`
}

export async function uploadAttachment(draft: AttachmentDraft, chatId: string | null): Promise<ServerAttachment> {
  const validation = attachmentValidationError({ name: draft.name, mimeType: draft.mimeType, sizeBytes: draft.sizeBytes })
  if (validation) throw new Error(validation)
  const reservation = await apiRequest<{
    attachment: ServerAttachment
    uploadUrl: string
    uploadHeaders: Record<string, string>
  }>('/api/attachments', {
    method: 'POST',
    body: { chatId, originalName: draft.name, mimeType: draft.mimeType, sizeBytes: draft.sizeBytes },
  })
  const file = new File(draft.uri)
  const uploadUrl = apiUrl(reservation.uploadUrl)
  const result = await file.upload(uploadUrl, {
    httpMethod: 'PUT',
    mimeType: draft.mimeType,
    headers: { ...reservation.uploadHeaders, ...nativeAuthorizationHeaders(uploadUrl) },
  })
  if (result.status < 200 || result.status >= 300) throw new Error(`Upload failed (${result.status})`)
  return apiRequest(`/api/attachments/${reservation.attachment.id}/confirm`, { method: 'POST' })
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'pulpo-file'
}

const activeAttachmentDownloads = new Map<string, Promise<File>>()

export function downloadAttachment(id: string, name: string): Promise<File> {
  const key = `${apiOrigin()}:${id}`
  const existing = activeAttachmentDownloads.get(key)
  if (existing) return existing
  const pending = downloadAttachmentOnce(id, name)
  activeAttachmentDownloads.set(key, pending)
  void pending.then(
    () => activeAttachmentDownloads.delete(key),
    () => activeAttachmentDownloads.delete(key),
  )
  return pending
}

async function downloadAttachmentOnce(id: string, name: string): Promise<File> {
  const { instanceUrl, user } = useSessionStore.getState()
  const namespace = user ? cacheNamespace(instanceUrl, user.id) : null
  if (namespace) {
    const localUri = await cachedAttachmentUri(namespace, id)
    if (localUri) {
      const cached = new File(localUri)
      if (cached.exists) return cached
    }
  }
  const { url: rawUrl } = await apiRequest<{ url: string }>(`/api/attachments/${id}/download`)
  const url = apiUrl(rawUrl)
  const destination = new File(Paths.cache, safeFilename(`${id}-${name}`))
  const file = await File.downloadFileAsync(url, destination, {
    idempotent: true,
    headers: nativeAuthorizationHeaders(url),
  })
  if (namespace) {
    const quotaBytes = Math.max(usePreferencesStore.getState().attachmentCacheMb * 1024 * 1024, file.size)
    const evictedUris = await recordCachedAttachment(
      namespace, id, file.uri, file.size, quotaBytes,
    )
    for (const uri of evictedUris) {
      try {
        const cached = new File(uri)
        if (cached.exists) cached.delete()
      } catch {
        // The database is authoritative; an already-removed cache file is harmless.
      }
    }
  }
  return file
}

export async function shareAttachment(id: string, name: string, mimeType?: string): Promise<void> {
  const file = await downloadAttachment(id, name)
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device')
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name })
}
