import type { ComposerDraft, ComposerDraftInput } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { fetchApiBlob } from '@/lib/api'
import { localAccountKey, localDb, type DraftRow } from './database'
import type { UploadRecord } from '@/stores/upload-outbox'

export type LocalComposerDraft = Omit<DraftRow, 'id' | 'userId' | 'chatId'>

function rowId(userId: string, scope: string): string {
  return `${localAccountKey(userId)}:draft:${scope}`
}

function blobId(userId: string, localId: string): string {
  return `${localAccountKey(userId)}:draft-blob:${localId}`
}

export async function loadLocalComposerDraft(userId: string, scope: string): Promise<LocalComposerDraft | null> {
  const row = await localDb.drafts.get(rowId(userId, scope))
  if (!row) return null
  return {
    content: row.content ?? '',
    modelId: row.modelId ?? '',
    presetSelections: row.presetSelections ?? {},
    agentMode: row.agentMode ?? false,
    autoExpire: row.autoExpire,
    attachments: row.attachments ?? [],
    editorId: row.editorId ?? '',
    serverRevision: row.serverRevision,
    serverUpdatedAt: row.serverUpdatedAt,
    dirty: row.dirty ?? true,
    updatedAt: row.updatedAt,
  }
}

export async function loadDraftFile(userId: string, localId: string): Promise<File | null> {
  const row = await localDb.draftAttachmentBlobs.get(blobId(userId, localId))
  if (!row) return null
  return new File([row.blob], row.name, { type: row.mimeType })
}

export async function cacheRemoteDraftFile(userId: string, localId: string, attachment: {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
}): Promise<void> {
  const { url } = await apiRequest<{ url: string }>(`/api/attachments/${attachment.id}/download`)
  const blob = await fetchApiBlob(url)
  await localDb.draftAttachmentBlobs.put({
    id: blobId(userId, localId),
    userId: localAccountKey(userId),
    localId,
    blob,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    updatedAt: Date.now(),
  })
}

export async function detachSyncedDraftAttachments(userId: string, scope: string): Promise<LocalComposerDraft | null> {
  const id = rowId(userId, scope)
  const row = await localDb.drafts.get(id)
  if (!row) return null
  const attachments = [] as DraftRow['attachments']
  for (const attachment of row.attachments ?? []) {
    if (!attachment.serverId || await localDb.draftAttachmentBlobs.get(blobId(userId, attachment.localId))) {
      attachments.push({ ...attachment, serverId: undefined })
    }
  }
  await localDb.drafts.update(id, { attachments, dirty: false, serverRevision: undefined, serverUpdatedAt: undefined })
  return loadLocalComposerDraft(userId, scope)
}

export async function detachAllSyncedDraftAttachments(userId: string): Promise<void> {
  const accountKey = localAccountKey(userId)
  const rows = await localDb.drafts.where('userId').equals(accountKey).toArray()
  for (const row of rows) await detachSyncedDraftAttachments(userId, row.chatId)
}

export async function saveLocalComposerDraft(input: {
  userId: string
  scope: string
  content: string
  modelId: string
  presetSelections: Record<string, string>
  agentMode: boolean
  autoExpire?: boolean
  uploads: UploadRecord[]
  editorId: string
  dirty: boolean
  serverRevision?: number
  serverUpdatedAt?: string
}): Promise<void> {
  const accountKey = localAccountKey(input.userId)
  const existing = await localDb.drafts.get(rowId(input.userId, input.scope))
  const attachments = input.uploads.map((upload) => ({
    localId: upload.localId,
    ...(upload.id ? { serverId: upload.id } : {}),
    name: upload.name,
    mimeType: upload.mimeType,
    sizeBytes: upload.size,
  }))
  const retained = new Set(attachments.map((attachment) => blobId(input.userId, attachment.localId)))
  await localDb.transaction('rw', localDb.drafts, localDb.draftAttachmentBlobs, async () => {
    for (const upload of input.uploads) {
      if (!upload.file) continue
      await localDb.draftAttachmentBlobs.put({
        id: blobId(input.userId, upload.localId),
        userId: accountKey,
        localId: upload.localId,
        blob: upload.file,
        name: upload.name,
        mimeType: upload.mimeType,
        sizeBytes: upload.size,
        updatedAt: Date.now(),
      })
    }
    for (const attachment of existing?.attachments ?? []) {
      const id = blobId(input.userId, attachment.localId)
      if (!retained.has(id)) await localDb.draftAttachmentBlobs.delete(id)
    }
    await localDb.drafts.put({
      id: rowId(input.userId, input.scope),
      userId: accountKey,
      chatId: input.scope,
      content: input.content,
      modelId: input.modelId,
      presetSelections: input.presetSelections,
      agentMode: input.agentMode,
      autoExpire: input.autoExpire,
      attachments,
      editorId: input.editorId,
      serverRevision: input.serverRevision,
      serverUpdatedAt: input.serverUpdatedAt,
      dirty: input.dirty,
      updatedAt: Date.now(),
    })
  })
}

export async function deleteLocalComposerDraft(userId: string, scope: string): Promise<void> {
  const id = rowId(userId, scope)
  const row = await localDb.drafts.get(id)
  await localDb.transaction('rw', localDb.drafts, localDb.draftAttachmentBlobs, async () => {
    await localDb.drafts.delete(id)
    await localDb.draftAttachmentBlobs.bulkDelete((row?.attachments ?? []).map((attachment) => blobId(userId, attachment.localId)))
  })
}

export async function fetchRemoteComposerDraft(scope: string): Promise<ComposerDraft | null> {
  return apiRequest<{ draft: ComposerDraft | null }>(`/api/composer-drafts/${scope}`).then((result) => result.draft)
}

export async function saveRemoteComposerDraft(scope: string, input: ComposerDraftInput): Promise<ComposerDraft> {
  return apiRequest<{ draft: ComposerDraft }>(`/api/composer-drafts/${scope}`, { method: 'PUT', body: input })
    .then((result) => result.draft)
}

export async function deleteRemoteComposerDraft(scope: string): Promise<void> {
  await apiRequest(`/api/composer-drafts/${scope}`, { method: 'DELETE' })
}
