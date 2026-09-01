import type { ComposerDraft, ComposerDraftChange, ComposerDraftInput, ComposerDraftsCleared } from '@pulpo/contracts'
import { Directory, File, Paths } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { mobileApi } from '../../api/client'
import {
  composerDraftScopes,
  detachAllComposerDraftServerReferences,
  loadComposerDraftRecord,
  saveComposerDraftRecord,
  saveDraft,
} from '../../data/database'
import { downloadAttachment } from './api'

export interface MobileDraftAttachment {
  id: string
  localId: string
  serverId?: string
  name: string
  uri: string
  mimeType: string
  size?: number
  kind: 'image' | 'file'
  state: 'local' | 'uploading' | 'ready' | 'failed'
  error?: string
  ownerId: string
  attempt: number
  managed: boolean
}

export interface MobileComposerDraft {
  version: 1
  content: string
  modelId: string
  presetSelections: Record<string, string>
  agentMode: boolean
  autoExpire?: boolean
  attachments: MobileDraftAttachment[]
  editorId: string
  dirty: boolean
  deleted: boolean
  serverRevision?: number
  serverUpdatedAt?: string
  updatedAt: number
}

export async function loadMobileComposerDraft(namespace: string, scope: string): Promise<MobileComposerDraft | null> {
  const stored = await loadComposerDraftRecord<MobileDraftAttachment>(namespace, scope)
  if (!stored) return null
  if (stored.modelId !== null || stored.editorId !== null) {
    return {
      version: 1,
      content: stored.body,
      modelId: stored.modelId ?? '',
      presetSelections: stored.presetSelections,
      agentMode: stored.agentMode,
      autoExpire: stored.autoExpire,
      attachments: stored.attachments,
      editorId: stored.editorId ?? '',
      dirty: stored.dirty,
      deleted: stored.deleted,
      serverRevision: stored.serverRevision ?? undefined,
      serverUpdatedAt: stored.serverUpdatedAt ?? undefined,
      updatedAt: stored.updatedAt,
    }
  }
  try {
    // Development builds briefly stored the v1 snapshot as JSON in body.
    const parsed = JSON.parse(stored.body) as MobileComposerDraft
    return parsed?.version === 1 ? { ...parsed, deleted: parsed.deleted ?? false } : null
  } catch {
    if (!stored.body) return null
    return {
      version: 1,
      content: stored.body,
      modelId: '',
      presetSelections: {},
      agentMode: false,
      attachments: stored.attachments,
      editorId: '',
      dirty: true,
      deleted: false,
      updatedAt: Date.now(),
    }
  }
}

export async function saveMobileComposerDraft(namespace: string, scope: string, draft: MobileComposerDraft): Promise<void> {
  const directory = new Directory(
    Paths.document,
    'composer-drafts',
    namespace.replace(/[^a-zA-Z0-9.-]/g, '_'),
    scope.replace(/[^a-zA-Z0-9.-]/g, '_'),
  )
  directory.create({ idempotent: true, intermediates: true })
  const attachments = await Promise.all(draft.attachments.map(async (attachment) => {
    if (!attachment.uri) return attachment
    const source = new File(attachment.uri)
    if (!source.exists || source.uri.includes('/composer-drafts/')) return attachment
    const extension = attachment.name.includes('.') ? `.${attachment.name.split('.').at(-1)}` : ''
    const destination = new File(directory, `${attachment.localId.replace(/[^a-zA-Z0-9.-]/g, '_')}${extension}`)
    await source.copy(destination, { overwrite: true })
    return { ...attachment, uri: destination.uri }
  }))
  await saveComposerDraftRecord(namespace, scope, {
    body: draft.content,
    attachments,
    modelId: draft.modelId,
    presetSelections: draft.presetSelections,
    agentMode: draft.agentMode,
    autoExpire: draft.autoExpire,
    editorId: draft.editorId,
    serverRevision: draft.serverRevision ?? null,
    serverUpdatedAt: draft.serverUpdatedAt ?? null,
    dirty: draft.dirty,
    deleted: false,
    updatedAt: draft.updatedAt,
  })
}

export async function deleteMobileComposerDraft(namespace: string, scope: string): Promise<void> {
  const current = await loadMobileComposerDraft(namespace, scope)
  for (const attachment of current?.attachments ?? []) {
    if (!attachment.uri.includes('/composer-drafts/')) continue
    try {
      const file = new File(attachment.uri)
      if (file.exists) file.delete()
    } catch { /* already removed */ }
  }
  await saveDraft(namespace, scope, '', [])
}

export async function saveMobileComposerTombstone(input: {
  namespace: string
  scope: string
  editorId: string
  dirty: boolean
  serverRevision?: number
}): Promise<void> {
  await deleteMobileComposerDraft(input.namespace, input.scope)
  await saveComposerDraftRecord(input.namespace, input.scope, {
    body: '',
    attachments: [],
    modelId: '',
    presetSelections: {},
    agentMode: false,
    autoExpire: undefined,
    editorId: input.editorId,
    serverRevision: input.serverRevision ?? null,
    serverUpdatedAt: null,
    dirty: input.dirty,
    deleted: true,
    updatedAt: Date.now(),
  })
}

export async function prepareMobileTemporaryAttachments(
  attachments: MobileDraftAttachment[],
): Promise<MobileDraftAttachment[]> {
  const directory = new Directory(Paths.cache, 'composer-temporary')
  directory.create({ idempotent: true, intermediates: true })
  const prepared: MobileDraftAttachment[] = []
  for (const attachment of attachments) {
    if (!attachment.uri) continue
    let uri = attachment.uri
    if (uri.includes('/composer-drafts/')) {
      const source = new File(uri)
      if (!source.exists) continue
      const destination = new File(
        directory,
        `${Date.now()}-${Math.random().toString(36).slice(2)}-${attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
      )
      await source.copy(destination, { overwrite: true })
      uri = destination.uri
    }
    prepared.push({
      ...attachment,
      id: attachment.localId,
      serverId: undefined,
      uri,
      state: 'local' as const,
      attempt: 0,
    })
  }
  return prepared
}

export async function fetchMobileRemoteDraft(scope: string): Promise<{ draft: ComposerDraft | null; revision: number }> {
  return mobileApi.composerDraft(scope)
}

export async function saveMobileRemoteDraft(scope: string, input: ComposerDraftInput): Promise<ComposerDraft> {
  return mobileApi.saveComposerDraft(scope, input).then((result) => result.draft)
}

export function deleteMobileRemoteDraft(scope: string, editorId: string): Promise<number> {
  return mobileApi.deleteComposerDraft(scope, editorId).then((result) => result.revision)
}

type MobileDraftEvent =
  | { type: 'changed'; event: ComposerDraftChange }
  | { type: 'cleared'; event: ComposerDraftsCleared }

const mobileDraftListeners = new Set<(event: MobileDraftEvent) => void>()

export function subscribeMobileComposerDrafts(listener: (event: MobileDraftEvent) => void): () => void {
  mobileDraftListeners.add(listener)
  return () => { mobileDraftListeners.delete(listener) }
}

function emitMobileDraftEvent(event: MobileDraftEvent): void {
  for (const listener of mobileDraftListeners) listener(event)
}

function attachmentFromRemote(scope: string, attachment: ComposerDraft['attachments'][number], existing?: MobileDraftAttachment): MobileDraftAttachment {
  const localId = existing?.localId ?? `synced:${attachment.id}:${Crypto.randomUUID()}`
  return {
    id: attachment.id,
    localId,
    serverId: attachment.id,
    name: attachment.name,
    uri: existing?.uri ?? '',
    mimeType: attachment.mimeType,
    size: attachment.sizeBytes,
    kind: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
    state: 'ready',
    ownerId: existing?.ownerId ?? `draft:${scope}`,
    attempt: 0,
    managed: true,
  }
}

function mobileLocalMatchesRemote(local: MobileComposerDraft, remote: ComposerDraft): boolean {
  if (local.deleted || local.content !== remote.content || local.modelId !== remote.modelId) return false
  if (local.agentMode !== remote.agentMode || local.autoExpire !== remote.autoExpire) return false
  if (JSON.stringify(local.presetSelections) !== JSON.stringify(remote.presetSelections)) return false
  if (local.attachments.some((attachment) => !attachment.serverId)) return false
  return local.attachments.map((attachment) => attachment.serverId).join('\0')
    === remote.attachments.map((attachment) => attachment.id).join('\0')
}

async function persistRemoteMobileDraft(namespace: string, remote: ComposerDraft): Promise<void> {
  const existing = await loadMobileComposerDraft(namespace, remote.scope)
  const existingByServerId = new Map((existing?.attachments ?? []).flatMap((attachment) =>
    attachment.serverId ? [[attachment.serverId, attachment] as const] : []))
  const local: MobileComposerDraft = {
    version: 1,
    content: remote.content,
    modelId: remote.modelId,
    presetSelections: remote.presetSelections,
    agentMode: remote.agentMode,
    autoExpire: remote.autoExpire,
    attachments: remote.attachments.map((attachment) =>
      attachmentFromRemote(remote.scope, attachment, existingByServerId.get(attachment.id))),
    editorId: remote.editorId,
    dirty: false,
    deleted: false,
    serverRevision: remote.revision,
    serverUpdatedAt: remote.updatedAt,
    updatedAt: Date.parse(remote.updatedAt),
  }
  await saveMobileComposerDraft(namespace, remote.scope, local)
  void Promise.all(local.attachments.map(async (attachment) => {
    if (attachment.uri) return attachment
    try {
      const file = await downloadAttachment(attachment.serverId!, attachment.name)
      return { ...attachment, uri: file.uri }
    } catch {
      return attachment
    }
  })).then(async (attachments) => {
    const current = await loadMobileComposerDraft(namespace, remote.scope)
    if (!current || current.serverRevision !== remote.revision || current.deleted) return
    await saveMobileComposerDraft(namespace, remote.scope, { ...current, attachments })
  })
}

export async function applyMobileComposerDraftChange(namespace: string, event: ComposerDraftChange): Promise<boolean> {
  const existing = await loadMobileComposerDraft(namespace, event.scope)
  if ((existing?.serverRevision ?? 0) >= event.revision) return false
  const selfEvent = existing?.editorId === event.editorId
  if (selfEvent && existing) {
    if (event.draft && mobileLocalMatchesRemote(existing, event.draft)) {
      await saveMobileComposerDraft(namespace, event.scope, {
        ...existing,
        dirty: false,
        serverRevision: event.revision,
        serverUpdatedAt: event.draft.updatedAt,
        updatedAt: existing.updatedAt,
      })
    } else if (!event.draft && existing.deleted) {
      await saveMobileComposerTombstone({
        namespace,
        scope: event.scope,
        editorId: existing.editorId,
        dirty: false,
        serverRevision: event.revision,
      })
    } else {
      await saveMobileComposerDraft(namespace, event.scope, { ...existing, serverRevision: event.revision })
    }
  } else if (event.draft) {
    await persistRemoteMobileDraft(namespace, event.draft)
  } else {
    await saveMobileComposerTombstone({
      namespace,
      scope: event.scope,
      editorId: event.editorId,
      dirty: false,
      serverRevision: event.revision,
    })
  }
  emitMobileDraftEvent({ type: 'changed', event })
  return true
}

export async function applyMobileComposerDraftsCleared(namespace: string, event: ComposerDraftsCleared): Promise<void> {
  await detachAllComposerDraftServerReferences(namespace)
  emitMobileDraftEvent({ type: 'cleared', event })
}

export async function reconcileMobileComposerDraftSnapshot(
  namespace: string,
  scope: string,
  snapshot: { draft: ComposerDraft | null; revision: number },
  editorId: string,
): Promise<void> {
  const existing = await loadMobileComposerDraft(namespace, scope)
  if (existing?.dirty) return
  if (snapshot.draft) {
    if ((existing?.serverRevision ?? 0) < snapshot.draft.revision) await persistRemoteMobileDraft(namespace, snapshot.draft)
  } else if ((existing?.serverRevision ?? 0) < snapshot.revision) {
    await saveMobileComposerTombstone({ namespace, scope, editorId, dirty: false, serverRevision: snapshot.revision })
  }
}

export async function flushDirtyMobileComposerDrafts(namespace: string): Promise<void> {
  for (const scope of await composerDraftScopes(namespace, true)) {
    const local = await loadMobileComposerDraft(namespace, scope)
    if (!local?.dirty) continue
    try {
      if (local.deleted) {
        const revision = await deleteMobileRemoteDraft(scope, local.editorId)
        const current = await loadMobileComposerDraft(namespace, scope)
        if (current?.dirty && current.updatedAt === local.updatedAt) {
          await saveMobileComposerTombstone({ namespace, scope, editorId: local.editorId, dirty: false, serverRevision: revision })
        }
        continue
      }
      const readyIds = local.attachments.flatMap((attachment) => attachment.serverId ? [attachment.serverId] : [])
      if (!local.content && readyIds.length === 0) continue
      const remote = await saveMobileRemoteDraft(scope, {
        content: local.content,
        modelId: local.modelId,
        presetSelections: local.presetSelections,
        agentMode: local.agentMode,
        ...(scope === 'new' ? { autoExpire: local.autoExpire } : {}),
        attachmentIds: readyIds,
        editorId: local.editorId,
      })
      const current = await loadMobileComposerDraft(namespace, scope)
      if (!current?.dirty || current.updatedAt !== local.updatedAt) continue
      await saveMobileComposerDraft(namespace, scope, {
        ...current,
        dirty: current.attachments.some((attachment) => !attachment.serverId),
        serverRevision: remote.revision,
        serverUpdatedAt: remote.updatedAt,
      })
    } catch {
      // Keep the durable dirty record for the next reconnect.
    }
  }
}

export async function enableMobileComposerDraftSync(namespace: string): Promise<void> {
  for (const scope of await composerDraftScopes(namespace)) {
    const local = await loadMobileComposerDraft(namespace, scope)
    if (!local || local.deleted || (!local.content && local.attachments.length === 0)) continue
    await saveMobileComposerDraft(namespace, scope, { ...local, dirty: true })
  }
  await flushDirtyMobileComposerDrafts(namespace)
}
