import type { ComposerDraft, ComposerDraftChange, ComposerDraftInput, ComposerDraftsCleared } from '@pulpo/contracts'
import { apiRequest, ApiError } from '@/lib/api'
import { fetchApiBlob } from '@/lib/api'
import { localAccountKey, localDb, type DraftRow } from './database'
import type { UploadRecord } from '@/stores/upload-outbox'

export type LocalComposerDraft = Omit<DraftRow, 'id' | 'userId' | 'chatId'>

export interface RemoteComposerDraftSnapshot {
  draft: ComposerDraft | null
  revision: number
}

export const WEB_COMPOSER_DRAFT_CHANGED_EVENT = 'pulpo:composer-draft-changed'
export const WEB_COMPOSER_DRAFTS_CLEARED_EVENT = 'pulpo:composer-drafts-cleared'

function rowId(userId: string, scope: string): string {
  return `${localAccountKey(userId)}:draft:${scope}`
}

function blobId(userId: string, localId: string): string {
  return `${localAccountKey(userId)}:draft-blob:${localId}`
}

function enableMarkerKey(userId: string): string {
  return `${localAccountKey(userId)}:draft-sync-enable-pending`
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
    deleted: row.deleted ?? false,
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
      deleted: false,
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

export async function saveLocalComposerTombstone(input: {
  userId: string
  scope: string
  editorId: string
  dirty: boolean
  serverRevision?: number
}): Promise<void> {
  const id = rowId(input.userId, input.scope)
  const row = await localDb.drafts.get(id)
  await localDb.transaction('rw', localDb.drafts, localDb.draftAttachmentBlobs, async () => {
    await localDb.draftAttachmentBlobs.bulkDelete((row?.attachments ?? []).map((attachment) => blobId(input.userId, attachment.localId)))
    await localDb.drafts.put({
      id,
      userId: localAccountKey(input.userId),
      chatId: input.scope,
      content: '',
      modelId: '',
      presetSelections: {},
      agentMode: false,
      attachments: [],
      editorId: input.editorId,
      serverRevision: input.serverRevision,
      dirty: input.dirty,
      deleted: true,
      updatedAt: Date.now(),
    })
  })
}

export async function fetchRemoteComposerDraft(scope: string): Promise<RemoteComposerDraftSnapshot> {
  return apiRequest<RemoteComposerDraftSnapshot>(`/api/composer-drafts/${scope}`)
}

export async function saveRemoteComposerDraft(scope: string, input: ComposerDraftInput): Promise<ComposerDraft> {
  return apiRequest<{ draft: ComposerDraft }>(`/api/composer-drafts/${scope}`, { method: 'PUT', body: input })
    .then((result) => result.draft)
}

export async function deleteRemoteComposerDraft(scope: string, editorId: string): Promise<number> {
  const result = await apiRequest<{ revision: number }>(`/api/composer-drafts/${scope}`, {
    method: 'DELETE',
    body: { editorId },
  })
  return result.revision
}

function remoteUploads(draft: ComposerDraft, existing?: DraftRow): UploadRecord[] {
  const localIds = new Map((existing?.attachments ?? []).flatMap((attachment) =>
    attachment.serverId ? [[attachment.serverId, attachment.localId] as const] : []))
  return draft.attachments.map((attachment) => ({
    localId: localIds.get(attachment.id) ?? crypto.randomUUID(),
    id: attachment.id,
    name: attachment.name,
    size: attachment.sizeBytes,
    mimeType: attachment.mimeType,
    previewUrl: null,
    status: 'ready' as const,
    chatId: draft.scope === 'new' ? null : draft.scope,
    temporary: false,
    managed: false,
    attempt: 0,
  }))
}

function localMatchesRemote(row: DraftRow, draft: ComposerDraft): boolean {
  if (row.deleted || row.content !== draft.content || row.modelId !== draft.modelId) return false
  if (row.agentMode !== draft.agentMode || row.autoExpire !== draft.autoExpire) return false
  if (JSON.stringify(row.presetSelections) !== JSON.stringify(draft.presetSelections)) return false
  if (row.attachments.some((attachment) => !attachment.serverId)) return false
  return row.attachments.map((attachment) => attachment.serverId).join('\0')
    === draft.attachments.map((attachment) => attachment.id).join('\0')
}

async function persistRemoteDraft(userId: string, draft: ComposerDraft): Promise<void> {
  const existing = await localDb.drafts.get(rowId(userId, draft.scope))
  const uploads = remoteUploads(draft, existing)
  await saveLocalComposerDraft({
    userId,
    scope: draft.scope,
    content: draft.content,
    modelId: draft.modelId,
    presetSelections: draft.presetSelections,
    agentMode: draft.agentMode,
    autoExpire: draft.autoExpire,
    uploads,
    editorId: draft.editorId,
    dirty: false,
    serverRevision: draft.revision,
    serverUpdatedAt: draft.updatedAt,
  })
  void Promise.all(draft.attachments.map((attachment, index) =>
    cacheRemoteDraftFile(userId, uploads[index]!.localId, attachment).catch(() => undefined)))
}

function dispatchDraftEvent(name: string, detail: unknown): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }))
}

export async function applyWebComposerDraftChange(userId: string, event: ComposerDraftChange): Promise<boolean> {
  const existing = await localDb.drafts.get(rowId(userId, event.scope))
  if ((existing?.serverRevision ?? 0) >= event.revision) return false
  const selfEvent = existing?.editorId === event.editorId
  if (selfEvent && existing) {
    if (event.draft && localMatchesRemote(existing, event.draft)) {
      await localDb.drafts.update(existing.id, {
        serverRevision: event.revision,
        serverUpdatedAt: event.draft.updatedAt,
        dirty: false,
      })
    } else if (!event.draft && existing.deleted) {
      await localDb.drafts.update(existing.id, { serverRevision: event.revision, dirty: false })
    } else {
      await localDb.drafts.update(existing.id, { serverRevision: event.revision })
    }
  } else if (event.draft) {
    await persistRemoteDraft(userId, event.draft)
  } else {
    await saveLocalComposerTombstone({
      userId,
      scope: event.scope,
      editorId: event.editorId,
      dirty: false,
      serverRevision: event.revision,
    })
  }
  dispatchDraftEvent(WEB_COMPOSER_DRAFT_CHANGED_EVENT, event)
  return true
}

export async function applyWebComposerDraftsCleared(userId: string, event: ComposerDraftsCleared): Promise<void> {
  await detachAllSyncedDraftAttachments(userId)
  dispatchDraftEvent(WEB_COMPOSER_DRAFTS_CLEARED_EVENT, event)
}

export async function reconcileWebComposerDraftSnapshot(
  userId: string,
  scope: string,
  snapshot: RemoteComposerDraftSnapshot,
  editorId: string,
): Promise<void> {
  const existing = await localDb.drafts.get(rowId(userId, scope))
  if (existing?.dirty) return
  if (snapshot.draft) {
    if ((existing?.serverRevision ?? 0) < snapshot.draft.revision) await persistRemoteDraft(userId, snapshot.draft)
    return
  }
  if ((existing?.serverRevision ?? 0) >= snapshot.revision) return
  await saveLocalComposerTombstone({ userId, scope, editorId, dirty: false, serverRevision: snapshot.revision })
}

export async function flushDirtyWebComposerDrafts(userId: string): Promise<void> {
  const accountKey = localAccountKey(userId)
  const dirty = await localDb.drafts.where('userId').equals(accountKey).filter((draft) => draft.dirty).toArray()
  for (const draft of dirty.sort((left, right) => left.updatedAt - right.updatedAt)) {
    try {
      if (draft.deleted) {
        const revision = await deleteRemoteComposerDraft(draft.chatId, draft.editorId)
        const current = await localDb.drafts.get(draft.id)
        if (current?.dirty && current.updatedAt === draft.updatedAt) {
          await localDb.drafts.update(draft.id, { dirty: false, serverRevision: revision })
        }
        continue
      }
      const readyIds = draft.attachments.flatMap((attachment) => attachment.serverId ? [attachment.serverId] : [])
      if (!draft.content && readyIds.length === 0) continue
      const remote = await saveRemoteComposerDraft(draft.chatId, {
        content: draft.content,
        modelId: draft.modelId,
        presetSelections: draft.presetSelections,
        agentMode: draft.agentMode,
        ...(draft.chatId === 'new' ? { autoExpire: draft.autoExpire } : {}),
        attachmentIds: readyIds,
        editorId: draft.editorId,
      })
      const current = await localDb.drafts.get(draft.id)
      if (!current?.dirty || current.updatedAt !== draft.updatedAt) continue
      await localDb.drafts.update(draft.id, {
        dirty: current.attachments.some((attachment) => !attachment.serverId),
        serverRevision: remote.revision,
        serverUpdatedAt: remote.updatedAt,
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await saveLocalComposerTombstone({
          userId,
          scope: draft.chatId,
          editorId: draft.editorId,
          dirty: false,
          serverRevision: draft.serverRevision,
        })
      }
      // The durable dirty snapshot is retried on the next reconnect/focus.
    }
  }
}

export async function enableWebComposerDraftSync(userId: string): Promise<void> {
  const accountKey = localAccountKey(userId)
  await localDb.drafts.where('userId').equals(accountKey).filter((draft) =>
    !draft.deleted && (draft.content.length > 0 || draft.attachments.length > 0)).modify({ dirty: true })
  await flushDirtyWebComposerDrafts(userId)
  await localDb.kv.delete(enableMarkerKey(userId))
}

export async function markWebComposerDraftSyncEnablePending(userId: string): Promise<void> {
  await localDb.kv.put({ key: enableMarkerKey(userId), value: true, updatedAt: Date.now() })
}

export async function resumeWebComposerDraftSyncEnable(userId: string): Promise<void> {
  if (!(await localDb.kv.get(enableMarkerKey(userId)))) return
  await enableWebComposerDraftSync(userId)
}
