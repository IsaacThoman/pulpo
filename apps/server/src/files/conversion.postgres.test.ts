import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { db, queryClient } from '../database/client.js'
import { fileDocs, fileNodes, users } from '../database/schema.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const closed = vi.hoisted(() => vi.fn())
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: closed }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))
vi.mock('../storage/index.js', () => ({
  getBlobStore: () => ({
    put: async (key: string, body: Uint8Array) => { objects.set(key, Buffer.from(body)) },
    getStream: async (key: string) => Readable.from([objects.get(key) ?? Buffer.alloc(0)]),
    delete: async (key: string) => { objects.delete(key) },
  }),
}))

const { convertBlobToDocInTx, previewMarkdownConversion } = await import('./conversion.js')
const { loadYDoc } = await import('./doc-store.js')
const { mutateFileTree, updateFileNode } = await import('./tree-service.js')

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
  })
  afterAll(async () => { await queryClient.end() })

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
})
