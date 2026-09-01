// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import type { ComposerDraft, ComposerDraftChange, ComposerDraftsCleared } from '@pulpo/contracts'
import { localDb } from './database'
import {
  applyWebComposerDraftChange,
  applyWebComposerDraftsCleared,
  loadLocalComposerDraft,
  saveLocalComposerDraft,
  saveLocalComposerTombstone,
} from './composer-drafts'

const userId = 'draft-test-user'

function remote(revision: number, editorId = 'remote-editor', content = 'remote text'): ComposerDraft {
  return {
    scope: 'new',
    content,
    modelId: 'model-1',
    presetSelections: { reasoning: 'high' },
    agentMode: true,
    autoExpire: true,
    editorId,
    attachments: [],
    revision,
    updatedAt: new Date(revision * 1_000).toISOString(),
  }
}

function change(draft: ComposerDraft | null, revision: number, editorId = 'remote-editor'): ComposerDraftChange {
  return {
    scope: 'new',
    draft,
    revision,
    editorId,
    reason: draft ? 'saved' : 'deleted',
  }
}

async function saveLocal(content: string, editorId: string, revision: number, dirty = true) {
  await saveLocalComposerDraft({
    userId,
    scope: 'new',
    content,
    modelId: 'model-1',
    presetSelections: {},
    agentMode: false,
    autoExpire: false,
    uploads: [],
    editorId,
    dirty,
    serverRevision: revision,
  })
}

describe('web composer draft realtime reconciliation', () => {
  beforeEach(async () => {
    await localDb.delete()
    await localDb.open()
  })

  afterEach(async () => {
    await localDb.delete()
  })

  it('migrates a legacy text-only draft without losing its content', async () => {
    localDb.close()
    await localDb.delete()
    const legacy = new Dexie('pulpo-local-v1')
    legacy.version(4).stores({ drafts: '&id, userId, [userId+chatId], updatedAt' })
    await legacy.open()
    await legacy.table('drafts').put({
      id: `${userId}:draft:new`, userId, chatId: 'new', content: 'legacy text', updatedAt: 123,
    })
    legacy.close()

    await localDb.open()
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'legacy text', dirty: true, deleted: false,
    })
  })

  it('immediately replaces a dirty inactive draft with a newer remote revision', async () => {
    await saveLocal('unsynced local text', 'local-editor', 4)

    expect(await applyWebComposerDraftChange(userId, change(remote(5), 5))).toBe(true)
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'remote text',
      presetSelections: { reasoning: 'high' },
      agentMode: true,
      autoExpire: true,
      serverRevision: 5,
      dirty: false,
      deleted: false,
    })
  })

  it('ignores stale events and preserves newer local state', async () => {
    await saveLocal('newer local text', 'local-editor', 8, false)

    expect(await applyWebComposerDraftChange(userId, change(remote(7), 7))).toBe(false)
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'newer local text', serverRevision: 8,
    })
  })

  it('suppresses self echoes without discarding typing that followed the request', async () => {
    await saveLocal('typing continued', 'same-editor', 10)

    await applyWebComposerDraftChange(userId, change(remote(11, 'same-editor', 'older submitted text'), 11, 'same-editor'))
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'typing continued', serverRevision: 11, dirty: true,
    })
  })

  it('stores a clean deletion tombstone so deleted drafts cannot resurrect', async () => {
    await saveLocal('delete me', 'local-editor', 12, false)

    await applyWebComposerDraftChange(userId, change(null, 13))
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: '', attachments: [], serverRevision: 13, dirty: false, deleted: true,
    })
  })

  it('keeps local text and cached files when server draft sync is disabled', async () => {
    const file = new File(['draft attachment'], 'notes.txt', { type: 'text/plain' })
    await saveLocalComposerDraft({
      userId,
      scope: 'new',
      content: 'keep this locally',
      modelId: 'model-1',
      presetSelections: {},
      agentMode: false,
      uploads: [{
        localId: 'local-file', id: 'bb9dfa6c-e580-4a10-ab9d-f60444f88f18', name: file.name,
        size: file.size, mimeType: file.type, previewUrl: null, status: 'ready', file,
        chatId: null, temporary: false, managed: true, attempt: 1,
      }],
      editorId: 'local-editor',
      dirty: false,
      serverRevision: 20,
    })

    const cleared: ComposerDraftsCleared = {
      revision: 21, editorId: 'server:settings', reason: 'sync_disabled',
    }
    await applyWebComposerDraftsCleared(userId, cleared)

    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'keep this locally',
      attachments: [{ localId: 'local-file', serverId: undefined }],
      dirty: false,
      deleted: false,
    })
    expect(await localDb.draftAttachmentBlobs.count()).toBe(1)
  })

  it('removes cached draft blobs when a tombstone replaces the draft', async () => {
    const file = new File(['temporary bytes'], 'temporary.txt', { type: 'text/plain' })
    await saveLocalComposerDraft({
      userId,
      scope: 'new',
      content: '',
      modelId: 'model-1',
      presetSelections: {},
      agentMode: false,
      uploads: [{
        localId: 'pending-file', name: file.name, size: file.size, mimeType: file.type,
        previewUrl: null, status: 'uploading', file, chatId: null, temporary: false,
        managed: true, attempt: 1,
      }],
      editorId: 'local-editor',
      dirty: true,
    })
    expect(await localDb.draftAttachmentBlobs.count()).toBe(1)

    await saveLocalComposerTombstone({
      userId, scope: 'new', editorId: 'local-editor', dirty: true,
    })
    expect(await localDb.draftAttachmentBlobs.count()).toBe(0)
  })
})
