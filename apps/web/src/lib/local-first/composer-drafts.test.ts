// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { ComposerDraft, ComposerDraftChange, ComposerDraftsCleared } from '@pulpo/contracts'
import { localDb } from './database'

const apiMocks = vi.hoisted(() => ({ apiRequest: vi.fn(), fetchApiBlob: vi.fn() }))

vi.mock('@/lib/api', () => ({
  apiRequest: apiMocks.apiRequest,
  fetchApiBlob: apiMocks.fetchApiBlob,
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number) {
      super('API error')
      this.status = status
    }
  },
}))

import {
  applyWebComposerDraftChange,
  applyWebComposerDraftsCleared,
  clearRuntimeComposerDrafts,
  deleteRemoteComposerDraft,
  flushDirtyWebComposerDrafts,
  loadLocalComposerDraft,
  saveLocalComposerDraft,
  saveLocalComposerTombstone,
  saveRemoteComposerDraft,
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
    apiMocks.apiRequest.mockReset()
    apiMocks.fetchApiBlob.mockReset()
    clearRuntimeComposerDrafts(userId)
    await localDb.delete()
    await localDb.open()
  })

  afterEach(async () => {
    clearRuntimeComposerDrafts(userId)
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

  it('notifies this tab when another tab already persisted the same socket event', async () => {
    await saveLocal('shared indexeddb text', 'remote-editor', 9, false)
    const listener = vi.fn()
    window.addEventListener('pulpo:composer-draft-changed', listener)

    expect(await applyWebComposerDraftChange(userId, change(remote(9, 'remote-editor', 'shared indexeddb text'), 9))).toBe(true)

    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('pulpo:composer-draft-changed', listener)
  })

  it('exposes a just-saved snapshot before its IndexedDB write completes', async () => {
    const get = vi.spyOn(localDb.drafts, 'get')
    const saved = saveLocal('switch-safe text', 'local-editor', 4)

    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'switch-safe text', editorId: 'local-editor', dirty: true,
    })
    await saved
    expect(get).toHaveBeenCalled()
  })

  it('serializes concurrent inbound revisions so the newest snapshot wins', async () => {
    await Promise.all([
      applyWebComposerDraftChange(userId, change(remote(21, 'remote-a', 'older'), 21, 'remote-a')),
      applyWebComposerDraftChange(userId, change(remote(22, 'remote-a', 'newest'), 22, 'remote-a')),
    ])
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'newest', serverRevision: 22,
    })
  })

  it('suppresses self echoes without discarding typing that followed the request', async () => {
    await saveLocal('typing continued', 'same-editor', 10)

    await applyWebComposerDraftChange(userId, change(remote(11, 'same-editor', 'older submitted text'), 11, 'same-editor'))
    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'typing continued', serverRevision: 11, dirty: true,
    })
  })

  it('marks an acknowledged projection clean while a local attachment is pending', async () => {
    const file = new File(['uploading'], 'pending.txt', { type: 'text/plain' })
    await saveLocalComposerDraft({
      userId,
      scope: 'new',
      content: 'saved text',
      modelId: 'model-1',
      presetSelections: {},
      agentMode: false,
      autoExpire: false,
      uploads: [{
        localId: 'pending-file', name: file.name, size: file.size, mimeType: file.type,
        previewUrl: null, status: 'uploading', file, chatId: null, temporary: false,
        managed: true, attempt: 1,
      }],
      editorId: 'same-editor',
      dirty: true,
    })
    apiMocks.apiRequest.mockResolvedValue({ draft: remote(12, 'same-editor', 'saved text') })

    await flushDirtyWebComposerDrafts(userId)

    await expect(loadLocalComposerDraft(userId, 'new')).resolves.toMatchObject({
      content: 'saved text', dirty: false, serverRevision: 12,
      attachments: [{ localId: 'pending-file' }],
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

  it('keeps a newer save behind an in-flight deletion for the same scope', async () => {
    let finishDelete!: (value: { revision: number }) => void
    apiMocks.apiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') return new Promise((resolve) => { finishDelete = resolve })
      return Promise.resolve({ draft: remote(10, 'web-local', 'new text') })
    })

    const deletion = deleteRemoteComposerDraft('new', 'web-local')
    const saving = saveRemoteComposerDraft('new', {
      content: 'new text', modelId: 'model-1', presetSelections: {}, agentMode: false,
      autoExpire: false, attachmentIds: [], editorId: 'web-local',
    })
    await vi.waitFor(() => expect(apiMocks.apiRequest).toHaveBeenCalledTimes(1))

    finishDelete({ revision: 9 })
    await expect(deletion).resolves.toBe(9)
    await expect(saving).resolves.toMatchObject({ content: 'new text', revision: 10 })
    expect(apiMocks.apiRequest.mock.calls.map(([, options]) => options?.method)).toEqual(['DELETE', 'PUT'])
  })
})
