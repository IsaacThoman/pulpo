import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { db, queryClient } from '../database/client.js'
import { fileDocs, fileDocUpdates, fileNodes, users } from '../database/schema.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const { appendDocUpdate, compactDoc, createDoc, loadDocUpdate, readDocMarkdown } = await import('./doc-store.js')
const { emptyTrash, trashFileNode } = await import('./tree-service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

function typeInto(doc: Y.Doc, text: string): Uint8Array {
  const before = Y.encodeStateVector(doc)
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.insert(0, [new Y.XmlText(text)])
  doc.getXmlFragment('default').push([paragraph])
  return Y.encodeStateAsUpdate(doc, before)
}

async function loaded(nodeId: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, await loadDocUpdate(nodeId))
  return doc
}

describe.skipIf(!enabled)('collaborative document storage', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Docs test', email: `${userId}@example.test`, username: `d${userId.replaceAll('-', '')}`, role: 'user' })
  })
  afterAll(async () => { await queryClient.end() })

  it('creates a document from Markdown and exposes it through the tree and export', async () => {
    const node = await createDoc(userId, { parentId: null, markdown: '# Hello\n\nWorld' })
    expect(node).toMatchObject({ kind: 'doc', name: 'Untitled document' })
    expect(ydocToMarkdown(await loaded(node.id))).toBe('# Hello\n\nWorld')
    expect((await readDocMarkdown(userId, node.id)).markdown).toBe('# Hello\n\nWorld')
  })

  it('loads the snapshot plus every logged update, before and after compaction', async () => {
    const node = await createDoc(userId, { parentId: null })
    const client = await loaded(node.id)
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: typeInto(client, 'one'), origin: 'client' })
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: typeInto(client, 'two'), origin: 'client' })
    expect(ydocToMarkdown(await loaded(node.id))).toBe('one\n\ntwo')
    expect((await readDocMarkdown(userId, node.id)).markdown).toBe('one\n\ntwo')
    await compactDoc(node.id)
    const [doc] = await db.select().from(fileDocs).where(eq(fileDocs.nodeId, node.id))
    expect(doc).toMatchObject({ pendingUpdates: 0, markdown: 'one\n\ntwo' })
    expect(await db.select().from(fileDocUpdates).where(eq(fileDocUpdates.nodeId, node.id))).toEqual([])
    expect(ydocToMarkdown(await loaded(node.id))).toBe('one\n\ntwo')
  })

  it('never loses an update that commits while compaction runs', async () => {
    const node = await createDoc(userId, { parentId: null })
    const client = await loaded(node.id)
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: typeInto(client, 'before'), origin: 'client' })
    const late = typeInto(client, 'during')
    await Promise.all([
      compactDoc(node.id),
      appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: late, origin: 'client' }),
    ])
    expect(ydocToMarkdown(await loaded(node.id))).toBe('before\n\nduring')
    await compactDoc(node.id)
    expect(ydocToMarkdown(await loaded(node.id))).toBe('before\n\nduring')
    const [doc] = await db.select({ pendingUpdates: fileDocs.pendingUpdates }).from(fileDocs).where(eq(fileDocs.nodeId, node.id))
    expect(doc?.pendingUpdates).toBe(0)
  })

  it('shrinks state when deleted content is compacted', async () => {
    const node = await createDoc(userId, { parentId: null })
    const client = await loaded(node.id)
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: typeInto(client, 'x'.repeat(20_000)), origin: 'client' })
    await compactDoc(node.id)
    const [large] = await db.select({ bytes: fileDocs.stateBytes }).from(fileDocs).where(eq(fileDocs.nodeId, node.id))
    const before = Y.encodeStateVector(client)
    client.getXmlFragment('default').delete(0, 1)
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: Y.encodeStateAsUpdate(client, before), origin: 'client' })
    await compactDoc(node.id)
    const [small] = await db.select({ bytes: fileDocs.stateBytes }).from(fileDocs).where(eq(fileDocs.nodeId, node.id))
    expect(small!.bytes).toBeLessThan(large!.bytes / 10)
    const [row] = await db.select({ sizeBytes: fileNodes.sizeBytes }).from(fileNodes).where(eq(fileNodes.id, node.id))
    expect(row?.sizeBytes).toBe(small!.bytes)
  })

  it('rejects malformed updates and cascades state when a document is purged', async () => {
    const node = await createDoc(userId, { parentId: null })
    await expect(appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: new Uint8Array([255, 255, 255]), origin: 'client' }))
      .rejects.toMatchObject({ code: 'invalid_update' })
    const client = await loaded(node.id)
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: typeInto(client, 'bye'), origin: 'client' })
    await trashFileNode(userId, node.id)
    await emptyTrash(userId)
    expect(await db.select().from(fileDocs).where(eq(fileDocs.nodeId, node.id))).toEqual([])
    expect(await db.select().from(fileDocUpdates).where(eq(fileDocUpdates.nodeId, node.id))).toEqual([])
  })
})
