import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { db, queryClient } from '../database/client.js'
import { fileDocs, fileNodes, users } from '../database/schema.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const closed = vi.hoisted(() => vi.fn())
const putGate = vi.hoisted(() => ({ wait: null as (() => Promise<void>) | null }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: closed }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))
vi.mock('../storage/index.js', () => ({
  getBlobStore: () => ({
    put: async (key: string, body: Uint8Array) => { objects.set(key, Buffer.from(body)); await putGate.wait?.() },
    getStream: async (key: string) => Readable.from([objects.get(key) ?? Buffer.alloc(0)]),
    delete: async (key: string) => { objects.delete(key) },
  }),
}))

const { convertBlobToDocInTx, previewMarkdownConversion } = await import('./conversion.js')
const { appendDocUpdate, compactDoc, loadYDoc } = await import('./doc-store.js')
const { convertMisnamedDocs, moveNodeInTx, mutateFileTree, updateFileNode } = await import('./tree-service.js')
const { createDoc } = await import('./doc-store.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

async function uploadedFile(name: string, content: string | Buffer) {
  const id = randomUUID()
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const objectKey = `users/${userId}/files/${id}`
  objects.set(objectKey, bytes)
  const [node] = await db.insert(fileNodes).values({
    id, ownerUserId: userId, kind: 'blob', name, mimeType: 'text/markdown', sizeBytes: bytes.byteLength, objectKey,
  }).returning()
  return node!
}

async function convert(nodeId: string) {
  return mutateFileTree(userId, async (tx) => {
    const [node] = await tx.select().from(fileNodes).where(eq(fileNodes.id, nodeId))
    return convertBlobToDocInTx(tx, node!)
  })
}

describe.skipIf(!enabled)('Markdown file conversion', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Conversion test', email: `${userId}@example.test`, username: `c${userId.replaceAll('-', '')}`, role: 'user' })
    closed.mockClear()
    putGate.wait = null
  })
  afterAll(async () => { await queryClient.end() })

  it('finishes conversion and compaction when their database locks overlap', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'Concurrent.md', markdown: 'Before' })
    const replica = await loadYDoc(node.id)
    const vector = Y.encodeStateVector(replica)
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText('Latest edit')])
    replica.getXmlFragment('default').push([paragraph])
    await appendDocUpdate({ nodeId: node.id, actorUserId: userId, update: Y.encodeStateAsUpdate(replica, vector), origin: 'client' })
    let markEntered!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { markEntered = resolve })
    const released = new Promise<void>((resolve) => { release = resolve })
    putGate.wait = async () => { markEntered(); await released }
    let renamePid = 0
    const rename = mutateFileTree(userId, async (tx) => {
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
      renamePid = backend!.pid
      const [current] = await tx.select().from(fileNodes).where(eq(fileNodes.id, node.id))
      return moveNodeInTx(tx, userId, current!, { parentId: null, name: 'Concurrent.txt', onConflict: 'fail' })
    })
    await entered
    const compaction = compactDoc(node.id)
    // A separate observer does not use either of the two transaction pool connections.
    const observer = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      await vi.waitFor(async () => {
        const [row] = await observer<{ waiting: boolean }[]>`select exists (
          select 1 from pg_stat_activity where ${renamePid} = any(pg_blocking_pids(pid))
        ) as waiting`
        expect(row!.waiting).toBe(true)
      })
      release()
      const result = await Promise.all([rename, compaction])
      expect(result[0].row.kind).toBe('blob')
      expect(objects.get(result[0].row.objectKey!)?.toString()).toBe('Before\n\nLatest edit')
    } finally {
      release()
      await Promise.allSettled([rename, compaction])
      putGate.wait = null
      await observer.end()
    }
  })

  it('reports no change when only line endings and trailing spaces differ', async () => {
    const node = await uploadedFile('notes.md', '# Notes  \r\n\r\n- one\r\n- two\r\n')
    expect((await previewMarkdownConversion(node)).changed).toBe(false)
  })

  it('reports the reformatted Markdown when conversion would change the file', async () => {
    const node = await uploadedFile('readme.md', '# Title\n\n<div align="center">Logo</div>\n\n* star bullet\n')
    const preview = await previewMarkdownConversion(node)
    expect(preview.changed).toBe(true)
    expect(preview.original).toContain('<div')
    expect(preview.converted).toContain('- star bullet')
  })

  it('refuses files that are not Markdown or not text', async () => {
    await expect(previewMarkdownConversion(await uploadedFile('data.csv', 'a,b'))).rejects.toMatchObject({ code: 'file_not_markdown' })
    await expect(previewMarkdownConversion(await uploadedFile('bad.md', Buffer.from([0xff, 0xfe, 0x00])))).rejects.toMatchObject({ code: 'file_not_text' })
  })

  it('turns an uploaded Markdown file into an editable document with the same content', async () => {
    const node = await uploadedFile('plan.md', '# Plan\n\nShip **it**.')
    const { row, objectKey } = await convert(node.id)
    expect(row).toMatchObject({ kind: 'doc', objectKey: null, name: 'plan.md' })
    expect(objectKey).toBe(node.objectKey)
    expect(ydocToMarkdown(await loadYDoc(node.id))).toBe('# Plan\n\nShip **it**.')
  })

  it('turns a document renamed away from .md into a plain file holding its Markdown', async () => {
    const node = await uploadedFile('todo.md', '- [ ] write tests')
    await convert(node.id)
    const renamed = await updateFileNode(userId, node.id, { name: 'todo.txt' })
    expect(renamed).toMatchObject({ kind: 'blob', name: 'todo.txt', mimeType: 'text/plain' })
    const [row] = await db.select().from(fileNodes).where(eq(fileNodes.id, node.id))
    expect(objects.get(row!.objectKey!)?.toString()).toBe('- [ ] write tests')
    expect(await db.select().from(fileDocs).where(eq(fileDocs.nodeId, node.id))).toEqual([])
    expect(closed).toHaveBeenCalledWith([node.id], 'converted')
    // Renaming back to .md keeps it a file until someone chooses to edit it.
    expect(await updateFileNode(userId, node.id, { name: 'todo.md' })).toMatchObject({ kind: 'blob' })
  })

  it('keeps an editable document editable across Markdown renames', async () => {
    const node = await uploadedFile('a.md', 'text')
    await convert(node.id)
    expect(await updateFileNode(userId, node.id, { name: 'b.markdown' })).toMatchObject({ kind: 'doc' })
    expect(closed).not.toHaveBeenCalled()
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(await loadYDoc(node.id)))
    expect(ydocToMarkdown(doc)).toBe('text')
  })

  it('only creates editable documents with Markdown names', async () => {
    await expect(createDoc(userId, { parentId: null, name: 'notes.txt' })).rejects.toMatchObject({ code: 'file_not_markdown' })
    expect(await createDoc(userId, { parentId: null, name: 'notes.md' })).toMatchObject({ kind: 'doc' })
  })

  it('repairs documents whose names are not Markdown into plain files', async () => {
    const legacy = await createDoc(userId, { parentId: null, name: 'legacy.md', markdown: '# Old' })
    const untitled = await createDoc(userId, { parentId: null, name: 'untitled.md' })
    const kept = await createDoc(userId, { parentId: null, name: 'kept.MD', markdown: 'stays' })
    await db.update(fileNodes).set({ name: 'legacy.txt' }).where(eq(fileNodes.id, legacy.id))
    await db.update(fileNodes).set({ name: 'Untitled document' }).where(eq(fileNodes.id, untitled.id))
    await convertMisnamedDocs()
    const rows = new Map((await db.select().from(fileNodes).where(eq(fileNodes.ownerUserId, userId))).map((row) => [row.id, row]))
    expect(rows.get(legacy.id)).toMatchObject({ kind: 'blob', mimeType: 'text/plain' })
    expect(objects.get(rows.get(legacy.id)!.objectKey!)?.toString()).toBe('# Old')
    expect(rows.get(untitled.id)).toMatchObject({ kind: 'blob', sizeBytes: 0 })
    expect(rows.get(kept.id)).toMatchObject({ kind: 'doc' })
    expect(closed).toHaveBeenCalledWith([legacy.id], 'converted')
  })
})
