import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { applyNodeToYDoc, listSuggestions, resolveSuggestions, ydocToMarkdown, ydocToNode } from '@pulpo/client-core/doc-schema'
import { Transform } from '@tiptap/pm/transform'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileNodes } from '../../database/schema.js'
import { appendDocUpdate, loadYDoc, readDocMarkdown } from '../doc-store.js'
import { listFileChanges } from './changes.js'
import { FileChangesConflictError, redoFileChanges, undoFileChanges } from './history.js'
import { reviewFileChange, reviewReplyChanges } from './review.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const docUpdates = vi.hoisted(() => [] as string[])
vi.mock('../../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../doc-events.js', () => ({ publishDocsClosed: vi.fn(), publishDocUpdate: vi.fn((docId: string) => { docUpdates.push(docId) }) }))
vi.mock('../../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let files: FilesFixture

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }

/** Pulls a document, rewrites its Markdown, and pushes it back against the pulled version. */
async function edit(remote: string, change: (markdown: string) => string, options: { force?: boolean } = {}) {
  const local = `/workspace/files/${remote}`
  const pulled = (await files.ok('pull', { path: remote, dest: local })).data as { files: Array<{ nodeId: string; version: string }> }
  files.put(local, change(files.workspace.files.get(local)!.toString()))
  const base = options.force ? null : { nodeId: pulled.files[0]!.nodeId, version: pulled.files[0]!.version }
  const result = await files.ok('push', { items: [{ local, remote, base, force: options.force }] })
  return (result.data as PushData).results[0]!
}

/** An edit the owner makes in the editor, as a Yjs update from another replica. */
async function ownerEdit(nodeId: string, markdown: string) {
  const replica = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(replica)
  const { markdownToDocJSON, docSchema } = await import('@pulpo/client-core/doc-schema')
  applyNodeToYDoc(replica, docSchema().nodeFromJSON(markdownToDocJSON(markdown)))
  await appendDocUpdate({ nodeId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(replica, vector), origin: 'client' })
}

describe.skipIf(!enabled)('agent document changes', () => {
  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    docUpdates.length = 0
  })
  afterAll(async () => { await queryClient.end() })

  it('pulls documents ending in a newline, so appended lines start new ones', async () => {
    const projects = await files.folder('Projects')
    const notes = await files.doc('Notes.md', projects, '# Notes\n\n- first note')
    await files.attach({ [projects]: 'write' })
    expect(await edit('Projects/Notes.md', (markdown) => `${markdown}- second note\n`)).toMatchObject({ status: 'updated' })
    expect((await readDocMarkdown(files.userId, notes)).markdown).toBe('# Notes\n\n- first note\n- second note')
  })

  it('edits documents directly in Write mode, live and undoable', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, '# Plan\n\nFirst step')
    await files.attach({ [projects]: 'write' })
    expect(await edit('Projects/Plan.md', (markdown) => markdown)).toMatchObject({ status: 'unchanged' })
    const saved = await edit('Projects/Plan.md', (markdown) => markdown.replace('First', 'Second'))
    expect(saved).toMatchObject({ status: 'updated', nodeId: plan })
    expect((await readDocMarkdown(files.userId, plan)).markdown).toBe('# Plan\n\nSecond step')
    expect(docUpdates).toEqual([plan])
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, plan))
    expect(row).toMatchObject({ mode: 'write', kind: 'update', status: 'applied' })
    expect(ydocToNode(await loadYDoc(plan)).toJSON()).toEqual((row!.after as { doc: unknown }).doc)

    await undoFileChanges(files.userId, files.responseId)
    expect((await readDocMarkdown(files.userId, plan)).markdown).toBe('# Plan\n\nFirst step')
    await redoFileChanges(files.userId, files.responseId)
    expect((await readDocMarkdown(files.userId, plan)).markdown).toBe('# Plan\n\nSecond step')
  })

  it('refuses stale versions unless forced, and undo after the owner edited', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, 'one')
    await files.attach({ [projects]: 'write' })
    const local = '/workspace/files/Projects/Plan.md'
    const pulled = (await files.ok('pull', { path: 'Projects/Plan.md', dest: local })).data as { files: Array<{ version: string }> }
    await ownerEdit(plan, 'one\n\nowner')
    files.put(local, 'one\n\nagent')
    const base = { nodeId: plan, version: pulled.files[0]!.version }
    const [stale] = ((await files.ok('push', { items: [{ local, remote: 'Projects/Plan.md', base }] })).data as PushData).results
    expect(stale).toMatchObject({ status: 'conflict' })
    expect(await edit('Projects/Plan.md', () => 'one\n\nagent', { force: true })).toMatchObject({ status: 'updated' })

    await ownerEdit(plan, 'one\n\nagent\n\nlater')
    const error = await undoFileChanges(files.userId, files.responseId).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(FileChangesConflictError)
    expect((error as FileChangesConflictError).conflicts).toEqual([expect.objectContaining({
      nodeId: plan, reason: 'edited', expected: 'one\n\nagent', current: 'one\n\nagent\n\nlater',
    })])
  })

  it('suggests document edits inline and reviews them', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, '# Plan\n\nFirst step')
    await files.attach({ [projects]: 'suggest' })
    const suggested = await edit('Projects/Plan.md', (markdown) => markdown.replace('First', 'Second'))
    expect(suggested).toMatchObject({ status: 'suggested', message: expect.stringMatching(/Suggested 1 change to/) })
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, plan))
    expect(row).toMatchObject({ mode: 'suggest', kind: 'update', status: 'pending', before: null, after: null })
    // The owner still reads the document as it was; the agent reads it as if accepted.
    expect((await readDocMarkdown(files.userId, plan)).markdown).toBe('# Plan\n\nFirst step')
    expect((await files.ok('cat', { path: 'Projects/Plan.md' })).output).toBe('# Plan\n\nSecond step')
    expect(listSuggestions(ydocToNode(await loadYDoc(plan))).every((hunk) => hunk.changeId === row!.id)).toBe(true)
    // Pushing what it pulled again changes nothing.
    expect(await edit('Projects/Plan.md', (markdown) => markdown)).toMatchObject({ status: 'unchanged' })
    // Another push in the same reply joins the same change.
    await edit('Projects/Plan.md', (markdown) => `${markdown}\n\nThird step`)
    expect(await db.select().from(fileChanges).where(eq(fileChanges.nodeId, plan))).toHaveLength(1)
    expect((await listFileChanges(files.userId, files.responseId)).changes[0]).toMatchObject({ pendingSuggestions: 2, status: 'pending' })

    await reviewFileChange(files.userId, row!.id, 'accept')
    expect(ydocToMarkdown(await loadYDoc(plan))).toBe('# Plan\n\nSecond step\n\nThird step')
    expect(listSuggestions(ydocToNode(await loadYDoc(plan)))).toEqual([])
  })

  it('rejects document suggestions, and settles ones the owner resolved in the editor', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, 'Keep this')
    const notes = await files.doc('Notes.md', projects, 'Draft')
    await files.attach({ [projects]: 'suggest' })
    await edit('Projects/Plan.md', () => 'Keep that')
    await edit('Projects/Notes.md', () => 'Final')
    const rows = await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))
    await reviewFileChange(files.userId, rows.find((row) => row.nodeId === plan)!.id, 'reject')
    expect(ydocToMarkdown(await loadYDoc(plan), 'proposed')).toBe('Keep this')

    // The owner accepts in the editor: a plain Yjs update, no API call.
    const replica = await loadYDoc(notes)
    const vector = Y.encodeStateVector(replica)
    applyNodeToYDoc(replica, resolveSuggestions(new Transform(ydocToNode(replica)), () => true, 'accept').doc)
    await appendDocUpdate({ nodeId: notes, actorUserId: files.userId, update: Y.encodeStateAsUpdate(replica, vector), origin: 'client' })
    const listed = await listFileChanges(files.userId, files.responseId)
    expect(listed.changes.map((change) => [change.nodeId === plan, change.status, change.pendingSuggestions])).toEqual(expect.arrayContaining([
      [true, 'rejected', 0], [false, 'accepted', 0],
    ]))
  })

  it('keeps each reply\'s suggestions to a document apart', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, 'Alpha\n\nBeta')
    await files.attach({ [projects]: 'suggest' })
    await edit('Projects/Plan.md', (markdown) => markdown.replace('Alpha', 'Alpha one'))
    const first = files.responseId
    await files.newReply()
    // The next reply starts from the proposed view, earlier suggestions included.
    await edit('Projects/Plan.md', (markdown) => {
      expect(markdown).toBe('Alpha one\n\nBeta\n')
      return markdown.replace('Beta', 'Beta two')
    })
    await reviewReplyChanges(files.userId, files.responseId, 'accept')
    expect(ydocToMarkdown(await loadYDoc(plan))).toBe('Alpha\n\nBeta two')
    expect(ydocToMarkdown(await loadYDoc(plan), 'proposed')).toBe('Alpha one\n\nBeta two')
    expect((await listFileChanges(files.userId, first)).changes[0]).toMatchObject({ status: 'pending', pendingSuggestions: 1 })
  })

  it('folds a revision of an earlier suggested paragraph into that suggestion', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, 'Alpha')
    await files.attach({ [projects]: 'suggest' })
    await edit('Projects/Plan.md', (markdown) => `${markdown}\n\nNew idea`)
    const first = files.responseId
    await files.newReply()
    expect(await edit('Projects/Plan.md', (markdown) => markdown.replace('New idea', 'Newer idea'))).toMatchObject({
      status: 'suggested', message: expect.stringMatching(/^Revised your suggested changes/),
    })
    expect(await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))).toEqual([])
    expect(ydocToMarkdown(await loadYDoc(plan), 'proposed')).toBe('Alpha\n\nNewer idea')
    expect((await listFileChanges(files.userId, first)).changes[0]).toMatchObject({ status: 'pending', pendingSuggestions: 1 })
  })

  it('keeps a document the reply created once the owner edited it', async () => {
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/files/Projects/New.md', 'draft')
    const created = ((await files.ok('push', { items: [{ local: '/workspace/files/Projects/New.md', remote: 'Projects/New.md', base: null }] })).data as PushData).results[0]!
    // The reply's own later edit is part of its creation.
    expect(await edit('Projects/New.md', () => 'final')).toMatchObject({ status: 'updated' })
    await ownerEdit(created.nodeId!, 'final\n\nowner')
    const error = await undoFileChanges(files.userId, files.responseId).catch((caught: unknown) => caught)
    expect((error as FileChangesConflictError).conflicts).toEqual([expect.objectContaining({
      nodeId: created.nodeId, kind: 'create', reason: 'edited', expected: 'final', current: 'final\n\nowner',
    })])
    await ownerEdit(created.nodeId!, 'final')
    await undoFileChanges(files.userId, files.responseId)
    expect((await db.select().from(fileNodes).where(eq(fileNodes.id, created.nodeId!)))[0]!.trashedAt).not.toBeNull()
  })

  it('edits documents the agent added directly', async () => {
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/files/Projects/New.md', 'draft')
    const created = ((await files.ok('push', { items: [{ local: '/workspace/files/Projects/New.md', remote: 'Projects/New.md', base: null }] })).data as PushData).results[0]!
    expect(created).toMatchObject({ status: 'suggested' })
    expect(await edit('Projects/New.md', () => 'final')).toMatchObject({ status: 'suggested' })
    expect((await readDocMarkdown(files.userId, created.nodeId!)).markdown).toBe('final')
    expect(listSuggestions(ydocToNode(await loadYDoc(created.nodeId!)))).toEqual([])
    expect((await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))).map((row) => row.kind)).toEqual(['create'])
  })
})
