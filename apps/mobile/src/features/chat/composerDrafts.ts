import type { ComposerDraft, ComposerDraftInput } from '@pulpo/contracts'
import { Directory, File, Paths } from 'expo-file-system'
import { mobileApi } from '../../api/client'
import { loadComposerDraftRecord, saveComposerDraftRecord, saveDraft } from '../../data/database'

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
      serverRevision: stored.serverRevision ?? undefined,
      serverUpdatedAt: stored.serverUpdatedAt ?? undefined,
      updatedAt: stored.updatedAt,
    }
  }
  try {
    // Development builds briefly stored the v1 snapshot as JSON in body.
    const parsed = JSON.parse(stored.body) as MobileComposerDraft
    return parsed?.version === 1 ? parsed : null
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

export async function fetchMobileRemoteDraft(scope: string): Promise<ComposerDraft | null> {
  return mobileApi.composerDraft(scope).then((result) => result.draft)
}

export async function saveMobileRemoteDraft(scope: string, input: ComposerDraftInput): Promise<ComposerDraft> {
  return mobileApi.saveComposerDraft(scope, input).then((result) => result.draft)
}

export function deleteMobileRemoteDraft(scope: string): Promise<void> {
  return mobileApi.deleteComposerDraft(scope)
}
