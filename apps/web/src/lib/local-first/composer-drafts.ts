import { localAccountKey, localDb, type DraftRow } from './database'

export const NEW_CHAT_DRAFT_ID = 'new'

export interface PersistedDraftAttachment {
  localId: string
  serverId?: string
  name: string
  size: number
  mimeType: string
  status: 'uploading' | 'ready' | 'error'
  error?: string
  file?: Blob
}

export interface PersistedComposerDraft {
  content: string
  attachments: PersistedDraftAttachment[]
}

export interface RuntimeComposerDraft extends PersistedComposerDraft {
  attachmentIds: string[]
}

const runtimeDrafts = new Map<string, RuntimeComposerDraft>()

function draftScope(userId: string, chatId: string): string {
  return `${localAccountKey(userId)}\u0000${chatId}`
}

function rowId(userId: string, chatId: string): string {
  return `draft:${draftScope(userId, chatId)}`
}

export function runtimeComposerDraft(userId: string, chatId: string): RuntimeComposerDraft | null {
  return runtimeDrafts.get(draftScope(userId, chatId)) ?? null
}

export function rememberRuntimeComposerDraft(
  userId: string,
  chatId: string,
  draft: RuntimeComposerDraft,
): void {
  const key = draftScope(userId, chatId)
  if (!draft.content && draft.attachments.length === 0) runtimeDrafts.delete(key)
  else runtimeDrafts.set(key, draft)
}

export function clearRuntimeComposerDrafts(userId: string, chatIds?: Iterable<string>): void {
  const accountPrefix = `${localAccountKey(userId)}\u0000`
  const selected = chatIds ? new Set(chatIds) : null
  for (const key of runtimeDrafts.keys()) {
    if (!key.startsWith(accountPrefix)) continue
    if (!selected || selected.has(key.slice(accountPrefix.length))) runtimeDrafts.delete(key)
  }
}

export async function loadComposerDraft(userId: string, chatId: string): Promise<PersistedComposerDraft | null> {
  if (chatId.startsWith('temporary:')) return null
  const accountKey = localAccountKey(userId)
  const row = await localDb.drafts.where('[userId+chatId]').equals([accountKey, chatId]).first()
  if (!row) return null
  return {
    content: row.content,
    attachments: Array.isArray(row.attachments)
      ? row.attachments as PersistedDraftAttachment[]
      : [],
  }
}

const draftWrites = new Map<string, Promise<void>>()
function serializeDraftWrite(userId: string, chatId: string, write: () => Promise<void>): Promise<void> {
  const key = draftScope(userId, chatId)
  const operation = (draftWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(write)
  draftWrites.set(key, operation)
  void operation.finally(() => { if (draftWrites.get(key) === operation) draftWrites.delete(key) }).catch(() => undefined)
  return operation
}

export function saveComposerDraft(userId: string, chatId: string, draft: PersistedComposerDraft): Promise<void> {
  return serializeDraftWrite(userId, chatId, () => writeComposerDraft(userId, chatId, draft))
}

async function writeComposerDraft(
  userId: string,
  chatId: string,
  draft: PersistedComposerDraft,
): Promise<void> {
  // IndexedDB is shared by browser tabs; temporary drafts stay in this tab's runtime cache.
  if (chatId.startsWith('temporary:')) return
  const accountKey = localAccountKey(userId)
  if (!draft.content && draft.attachments.length === 0) {
    await localDb.drafts.where('[userId+chatId]').equals([accountKey, chatId]).delete()
    return
  }
  const row: DraftRow = {
    id: rowId(userId, chatId),
    userId: accountKey,
    chatId,
    content: draft.content,
    attachments: draft.attachments,
    updatedAt: Date.now(),
  }
  await localDb.drafts.put(row)
}

export async function deleteComposerDraft(userId: string, chatId: string): Promise<void> {
  runtimeDrafts.delete(draftScope(userId, chatId))
  await serializeDraftWrite(userId, chatId, async () => {
    await localDb.drafts.where('[userId+chatId]').equals([localAccountKey(userId), chatId]).delete()
  })
}

export async function updateComposerDraftAttachment(
  userId: string,
  chatId: string,
  attachment: PersistedDraftAttachment,
): Promise<void> {
  const runtime = runtimeComposerDraft(userId, chatId)
  if (runtime) {
    const attachments = runtime.attachments.map((item) => item.localId === attachment.localId ? attachment : item)
    const updated = { ...runtime, attachments }
    rememberRuntimeComposerDraft(userId, chatId, updated)
    await saveComposerDraft(userId, chatId, updated)
    return
  }
  const persisted = await loadComposerDraft(userId, chatId)
  if (!persisted?.attachments.some((item) => item.localId === attachment.localId)) return
  await saveComposerDraft(userId, chatId, {
    ...persisted,
    attachments: persisted.attachments.map((item) => item.localId === attachment.localId ? attachment : item),
  })
}
