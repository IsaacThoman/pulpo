import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerDraft, ComposerDraftChange } from '@pulpo/contracts'

const mocks = vi.hoisted(() => {
  const rows = new Map<string, unknown>()
  const values = new Map<string, unknown>()
  const files = new Map<string, string>()
  return { rows, values, files }
})

vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/').replaceAll('//', '/')
    }
    create() {}
  },
  File: class {
    uri: string
    constructor(source: string | { uri: string }, name?: string) {
      const root = typeof source === 'string' ? source : source.uri
      this.uri = name ? `${root}/${name}` : root
    }
    get exists() { return mocks.files.has(this.uri) }
    copy(destination: { uri: string }) { mocks.files.set(destination.uri, mocks.files.get(this.uri) ?? '') }
    delete() { mocks.files.delete(this.uri) }
  },
  Paths: { document: 'file:///documents', cache: 'file:///cache' },
}))
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'generated-local-id') }))
vi.mock('./api', () => ({ downloadAttachment: vi.fn() }))
vi.mock('../../api/client', () => ({
  mobileApi: {
    composerDraft: vi.fn(),
    saveComposerDraft: vi.fn(),
    deleteComposerDraft: vi.fn(),
  },
}))
vi.mock('../../data/database', () => ({
  composerDraftScopes: vi.fn(async (namespace: string, dirtyOnly = false) => [...mocks.rows.entries()]
    .filter(([key, value]) => key.startsWith(`${namespace}:`) && (!dirtyOnly || (value as { dirty: boolean }).dirty))
    .map(([key]) => key.slice(namespace.length + 1))),
  detachAllComposerDraftServerReferences: vi.fn(async () => undefined),
  getValue: vi.fn(async (namespace: string, key: string) => mocks.values.get(`${namespace}:${key}`) ?? null),
  loadComposerDraftRecord: vi.fn(async (namespace: string, scope: string) => mocks.rows.get(`${namespace}:${scope}`) ?? null),
  saveComposerDraftRecord: vi.fn(async (namespace: string, scope: string, value: unknown) => {
    mocks.rows.set(`${namespace}:${scope}`, structuredClone(value))
  }),
  saveDraft: vi.fn(async (namespace: string, scope: string, body: string, attachments: unknown[]) => {
    if (!body && attachments.length === 0) mocks.rows.delete(`${namespace}:${scope}`)
  }),
  setValue: vi.fn(async (namespace: string, key: string, value: unknown) => {
    mocks.values.set(`${namespace}:${key}`, value)
  }),
}))

import {
  applyMobileComposerDraftChange,
  deleteMobileComposerDraft,
  deleteMobileRemoteDraft,
  flushDirtyMobileComposerDrafts,
  loadMobileComposerDraft,
  saveMobileComposerDraft,
  saveMobileRemoteDraft,
  type MobileDraftAttachment,
  type MobileComposerDraft,
} from './composerDrafts'
import { mobileApi } from '../../api/client'

const namespace = 'https://example.test|user'

function local(content: string, editorId: string, revision: number): MobileComposerDraft {
  return {
    version: 1,
    content,
    modelId: 'model-1',
    presetSelections: {},
    agentMode: false,
    autoExpire: false,
    attachments: [],
    editorId,
    dirty: true,
    deleted: false,
    serverRevision: revision,
    updatedAt: revision,
  }
}

function remote(revision: number, editorId = 'remote', content = 'remote text'): ComposerDraft {
  return {
    scope: 'new', content, modelId: 'model-1', presetSelections: { style: 'short' },
    agentMode: true, autoExpire: true, attachments: [], editorId, revision,
    updatedAt: new Date(revision * 1_000).toISOString(),
  }
}

function event(draft: ComposerDraft | null, revision: number, editorId = 'remote'): ComposerDraftChange {
  return { scope: 'new', draft, revision, editorId, reason: draft ? 'saved' : 'deleted' }
}

describe('mobile composer draft realtime reconciliation', () => {
  beforeEach(() => {
    mocks.rows.clear()
    mocks.values.clear()
    mocks.files.clear()
    vi.mocked(mobileApi.saveComposerDraft).mockReset()
    vi.mocked(mobileApi.deleteComposerDraft).mockReset()
  })

  it('overwrites dirty SQLite state when a newer remote editor arrives', async () => {
    await saveMobileComposerDraft(namespace, 'new', local('local text', 'ios-local', 2))

    await applyMobileComposerDraftChange(namespace, event(remote(3), 3))
    await expect(loadMobileComposerDraft(namespace, 'new')).resolves.toMatchObject({
      content: 'remote text', presetSelections: { style: 'short' }, agentMode: true,
      serverRevision: 3, dirty: false, deleted: false,
    })
  })

  it('ignores stale revisions and suppresses self echoes', async () => {
    await saveMobileComposerDraft(namespace, 'new', local('continued typing', 'ios-local', 5))

    expect(await applyMobileComposerDraftChange(namespace, event(remote(4), 4))).toBe(false)
    await applyMobileComposerDraftChange(namespace, event(remote(6, 'ios-local', 'submitted text'), 6, 'ios-local'))
    await expect(loadMobileComposerDraft(namespace, 'new')).resolves.toMatchObject({
      content: 'continued typing', serverRevision: 6, dirty: true,
    })
  })

  it('serializes concurrent inbound revisions so the newest snapshot wins', async () => {
    await Promise.all([
      applyMobileComposerDraftChange(namespace, event(remote(21, 'remote-a', 'older'), 21, 'remote-a')),
      applyMobileComposerDraftChange(namespace, event(remote(22, 'remote-a', 'newest'), 22, 'remote-a')),
    ])
    await expect(loadMobileComposerDraft(namespace, 'new')).resolves.toMatchObject({
      content: 'newest', serverRevision: 22,
    })
  })

  it('persists remote deletion tombstones', async () => {
    await saveMobileComposerDraft(namespace, 'new', local('remove me', 'ios-local', 7))

    await applyMobileComposerDraftChange(namespace, event(null, 8))
    await expect(loadMobileComposerDraft(namespace, 'new')).resolves.toMatchObject({
      content: '', attachments: [], serverRevision: 8, dirty: false, deleted: true,
    })
  })

  it('marks an acknowledged projection clean while a local attachment is pending', async () => {
    const sourceUri = 'file:///picked/pending.txt'
    mocks.files.set(sourceUri, 'uploading')
    await saveMobileComposerDraft(namespace, 'new', {
      ...local('saved text', 'ios-local', 0),
      serverRevision: undefined,
      attachments: [{
        id: 'pending-file', localId: 'pending-file', name: 'pending.txt', uri: sourceUri,
        mimeType: 'text/plain', size: 9, kind: 'file', state: 'uploading', ownerId: 'draft:new',
        attempt: 1, managed: true,
      }],
    })
    vi.mocked(mobileApi.saveComposerDraft).mockResolvedValue({ draft: remote(9, 'ios-local', 'saved text') })

    await flushDirtyMobileComposerDrafts(namespace)

    await expect(loadMobileComposerDraft(namespace, 'new')).resolves.toMatchObject({
      content: 'saved text', dirty: false, serverRevision: 9,
      attachments: [{ localId: 'pending-file' }],
    })
  })

  it('copies local attachment files into durable draft storage and removes them with the draft', async () => {
    const sourceUri = 'file:///picked/notes.txt'
    mocks.files.set(sourceUri, 'draft bytes')
    const attachment: MobileDraftAttachment = {
      id: 'local-file', localId: 'local-file', name: 'notes.txt', uri: sourceUri,
      mimeType: 'text/plain', size: 11, kind: 'file', state: 'local', ownerId: 'draft:new',
      attempt: 0, managed: true,
    }
    await saveMobileComposerDraft(namespace, 'new', {
      ...local('', 'ios-local', 0), attachments: [attachment], serverRevision: undefined,
    })

    const stored = await loadMobileComposerDraft(namespace, 'new')
    expect(stored?.attachments[0]?.uri).toContain('/composer-drafts/')
    expect(mocks.files.get(stored!.attachments[0]!.uri)).toBe('draft bytes')

    await deleteMobileComposerDraft(namespace, 'new')
    expect(mocks.files.has(stored!.attachments[0]!.uri)).toBe(false)
    await expect(loadMobileComposerDraft(namespace, 'new')).resolves.toBeNull()
  })

  it('keeps a newer save behind an in-flight deletion for the same scope', async () => {
    let finishDelete!: (value: { revision: number }) => void
    vi.mocked(mobileApi.deleteComposerDraft).mockReturnValue(new Promise((resolve) => { finishDelete = resolve }))
    vi.mocked(mobileApi.saveComposerDraft).mockResolvedValue({ draft: remote(10, 'ios-local', 'new text') })

    const deletion = deleteMobileRemoteDraft('new', 'ios-local')
    const saving = saveMobileRemoteDraft('new', {
      content: 'new text', modelId: 'model-1', presetSelections: {}, agentMode: false,
      autoExpire: false, attachmentIds: [], editorId: 'ios-local',
    })
    await vi.waitFor(() => expect(mobileApi.deleteComposerDraft).toHaveBeenCalledOnce())
    expect(mobileApi.saveComposerDraft).not.toHaveBeenCalled()

    finishDelete({ revision: 9 })
    await expect(deletion).resolves.toBe(9)
    await expect(saving).resolves.toMatchObject({ content: 'new text', revision: 10 })
    expect(vi.mocked(mobileApi.deleteComposerDraft).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(mobileApi.saveComposerDraft).mock.invocationCallOrder[0]!)
  })
})
