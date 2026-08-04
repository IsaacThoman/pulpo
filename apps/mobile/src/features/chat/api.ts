import { File, Paths } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import * as Sharing from 'expo-sharing'
import { attachmentValidationError } from '@pulpo/client-core'
import type { ResponseSnapshot } from '@pulpo/contracts'
import { apiOrigin, apiRequest, nativeAuthorizationHeaders } from '../../api/client'
import { cacheNamespace, recordCachedAttachment } from '../../data/database'
import type { AttachmentDraft, ServerAttachment, ServerChat, ServerFolder } from '../../types'
import { useRealtimeStore } from '../../providers/RealtimeProvider'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'

export async function createChat(input: { clientId?: string; modelId: string; temporary?: boolean; title?: string }): Promise<ServerChat> {
  const clientId = input.clientId ?? Crypto.randomUUID()
  return apiRequest('/api/chats', {
    method: 'POST',
    idempotencyKey: clientId,
    body: { clientId, modelId: input.modelId, temporary: input.temporary ?? false, title: input.title },
  })
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
  chatId: string
  content: string
  modelId: string
  parentResponseId?: string | null
  presetSelections?: Record<string, string>
  attachmentIds?: string[]
  agentMode?: boolean
}): Promise<ResponseSnapshot> {
  const responseId = Crypto.randomUUID()
  const result = await apiRequest<{ response: ResponseSnapshot }>(`/api/chats/${input.chatId}/responses`, {
    method: 'POST', idempotencyKey: responseId,
    body: {
      clientId: responseId,
      parentResponseId: input.parentResponseId,
      input: input.content,
      modelId: input.modelId,
      presetSelections: input.presetSelections ?? {},
      attachmentIds: input.attachmentIds ?? [],
      agentMode: input.agentMode ?? false,
    },
  })
  useRealtimeStore.getState().receiveSnapshot(result.response)
  return result.response
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
  return apiRequest(`/api/responses/${id}/continue-without-agent`, { method: 'POST' })
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
  const result = await file.upload(reservation.uploadUrl, {
    httpMethod: 'PUT',
    mimeType: draft.mimeType,
    headers: { ...reservation.uploadHeaders, ...nativeAuthorizationHeaders(reservation.uploadUrl) },
  })
  if (result.status < 200 || result.status >= 300) throw new Error(`Upload failed (${result.status})`)
  return apiRequest(`/api/attachments/${reservation.attachment.id}/confirm`, { method: 'POST' })
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'pulpo-file'
}

export async function downloadAttachment(id: string, name: string): Promise<File> {
  const { url } = await apiRequest<{ url: string }>(`/api/attachments/${id}/download`)
  const destination = new File(Paths.cache, safeFilename(`${id}-${name}`))
  const file = await File.downloadFileAsync(url, destination, {
    idempotent: true,
    headers: nativeAuthorizationHeaders(url),
  })
  const { instanceUrl, user } = useSessionStore.getState()
  if (user) {
    const quotaBytes = Math.max(usePreferencesStore.getState().attachmentCacheMb * 1024 * 1024, file.size)
    const evictedUris = await recordCachedAttachment(
      cacheNamespace(instanceUrl, user.id), id, file.uri, file.size, quotaBytes,
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
