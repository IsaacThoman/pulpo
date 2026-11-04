import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { liveAssetHash } from '@pulpo/client-core/office'
import { textCodec } from '@pulpo/client-core/office/text'
import { storageUsedBytes } from '../attachments/storage-quota.js'
import { db, queryClient } from '../database/client.js'
import { fileDocAssets, fileDocs, fileNodes, users } from '../database/schema.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const closed = vi.hoisted(() => vi.fn())
vi.mock('../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./agent/test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: closed, publishDocUpdate: vi.fn() }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const { convertBlobToDocInTx } = await import('./conversion.js')
const { appendDocUpdate, compactDoc, createDoc, loadYDoc, readDocMarkdown } = await import('./doc-store.js')
const { copyFileNodes } = await import('./copy-service.js')
const { DocAssetStore, exportStoredDoc } = await import('./live-docs.js')
const { convertMisnamedDocs, deleteFileNode, mutateFileTree, trashFileNode, updateFileNode } = await import('./tree-service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

const crlf = Buffer.from('﻿def main():\r\n    print("hi")\r\n')

async function uploaded(name: string, bytes: Buffer, mimeType = 'text/plain') {
  const id = randomUUID()
  const objectKey = `users/${userId}/files/${id}`
  objects.set(objectKey, bytes)
  const [node] = await db.insert(fileNodes).values({
    id, ownerUserId: userId, kind: 'blob', name, mimeType, sizeBytes: bytes.byteLength, objectKey,
    checksum: createHash('sha256').update(bytes).digest('base64url'),
  }).returning()
  return node!
}

async function convert(nodeId: string) {
  return mutateFileTree(userId, async (tx) => {
    const [node] = await tx.select().from(fileNodes).where(eq(fileNodes.id, nodeId))
    return convertBlobToDocInTx(tx, node!)
  })
}

async function row(id: string) {
  const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
  return node
}

/** Edits a document as a client would: an update against its current state. */
async function clientEdit(nodeId: string, edit: (text: Y.Text) => void) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  edit(doc.getText('text'))
  await appendDocUpdate({ nodeId, ownerUserId: userId, actorUserId: userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

/** Gives a document an asset, as a codec storing an image would. */
async function addAsset(nodeId: string, bytes: Buffer) {
  return mutateFileTree(userId, async (tx) => {
    const store = new DocAssetStore(tx, nodeId)
    const ref = await store.put(bytes, 'image/png')
    await store.flush(tx, userId, nodeId)
    return ref
  })
}

describe.skipIf(!enabled)('live documents in Files', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Live test', email: `${userId}@example.test`, username: `l${userId.replaceAll('-', '')}`, role: 'user', storageLimitBytes: 10_000_000 })
    closed.mockClear()
  })
  afterAll(async () => { await queryClient.end() })

  it('creates empty text documents in the format their name gives them', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'main.py' })
    expect(node).toMatchObject({ kind: 'doc', format: 'text', mimeType: 'text/x-python' })
    const [doc] = await db.select().from(fileDocs).where(eq(fileDocs.nodeId, node.id))
    expect(doc).toMatchObject({ schemaVersion: 1, markdown: '' })
    expect(Buffer.from(await exportStoredDoc((await row(node.id))!)).toString()).toBe('')
    // A new document without a name is Markdown, as always.
    expect(await createDoc(userId, { parentId: null })).toMatchObject({ format: 'markdown', name: 'Untitled.md' })
    await expect(createDoc(userId, { parentId: null, name: 'main.py', markdown: '# no' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('converts an uploaded code file losslessly and exports it byte for byte', async () => {
    const blob = await uploaded('main.py', crlf)
    const { row: doc, objectKey } = await convert(blob.id)
    expect(doc).toMatchObject({ kind: 'doc', format: 'text', objectKey: null, checksum: null, mimeType: 'text/x-python' })
    expect(objectKey).toBe(blob.objectKey)
    expect(Buffer.from(await exportStoredDoc(doc)).equals(crlf)).toBe(true)
    expect(await readDocMarkdown(userId, doc.id)).toMatchObject({ markdown: 'def main():\n    print("hi")\n', format: 'text' })
    // Edits come back in the file's own encoding and line breaks.
    await clientEdit(doc.id, (text) => text.insert(text.length, 'main()\n'))
    expect(Buffer.from(await exportStoredDoc(doc)).equals(Buffer.concat([crlf, Buffer.from('main()\r\n')]))).toBe(true)
    await compactDoc(doc.id)
    const [compacted] = await db.select().from(fileDocs).where(eq(fileDocs.nodeId, doc.id))
    expect(compacted!.markdown).toBe('def main():\n    print("hi")\nmain()\n')
  })

  it('refuses to convert binary, oversized, and unknown files', async () => {
    const binary = await uploaded('data.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]))
    await expect(convert(binary.id)).rejects.toMatchObject({ statusCode: 422, code: 'file_not_editable' })
    const huge = await uploaded('huge.log', Buffer.alloc(10))
    await db.update(fileNodes).set({ sizeBytes: 5_000_000 }).where(eq(fileNodes.id, huge.id))
    await expect(convert(huge.id)).rejects.toMatchObject({ statusCode: 413 })
    const image = await uploaded('photo.png', Buffer.from([1, 2, 3]), 'image/png')
    await expect(convert(image.id)).rejects.toMatchObject({ code: 'file_not_live' })
    expect(await row(binary.id)).toMatchObject({ kind: 'blob' })
  })

  it('keeps a document when renamed within its format and converts it when renamed out of it', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'script.py' })
    await clientEdit(node.id, (text) => text.insert(0, 'console.log(1)\n'))
    const renamed = await updateFileNode(userId, node.id, { name: 'script.ts' })
    expect(renamed).toMatchObject({ kind: 'doc', format: 'text', mimeType: 'text/typescript' })
    expect(closed).not.toHaveBeenCalled()
    // A text file named as Markdown becomes an ordinary file; Markdown would reformat it.
    const markdown = await updateFileNode(userId, node.id, { name: 'script.md' })
    expect(markdown).toMatchObject({ kind: 'blob', format: null })
    expect(closed).toHaveBeenCalledWith([node.id], 'converted')
    expect(objects.get((await row(node.id))!.objectKey!)!.toString()).toBe('console.log(1)\n')
    // Markdown documents renamed to a text name become files holding their Markdown, as before.
    const plan = await createDoc(userId, { parentId: null, name: 'Plan.md', markdown: '# Plan' })
    expect(await updateFileNode(userId, plan.id, { name: 'Plan.txt' })).toMatchObject({ kind: 'blob', mimeType: 'text/plain' })
    expect(objects.get((await row(plan.id))!.objectKey!)!.toString()).toBe('# Plan')
  })

  it('repairs documents whose names left their format', async () => {
    const text = await createDoc(userId, { parentId: null, name: 'notes.txt' })
    const dockerfile = await createDoc(userId, { parentId: null, name: 'Dockerfile' })
    await db.update(fileNodes).set({ name: 'notes.bin' }).where(eq(fileNodes.id, text.id))
    await convertMisnamedDocs()
    expect(await row(text.id)).toMatchObject({ kind: 'blob', format: null })
    expect(await row(dockerfile.id)).toMatchObject({ kind: 'doc', format: 'text' })
  })

  it('copies documents with their format and assets, and charges the assets to storage', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'page.html' })
    await clientEdit(node.id, (text) => text.insert(0, '<p>hi</p>\n'))
    const image = Buffer.from('fake png bytes')
    const before = await storageUsedBytes(db, userId)
    const ref = await addAsset(node.id, image)
    expect(ref).toMatchObject({ hash: await liveAssetHash(image), sizeBytes: image.byteLength })
    expect(await storageUsedBytes(db, userId)).toBe(before + image.byteLength)
    const [copy] = await copyFileNodes(userId, [node.id], null)
    expect(copy).toMatchObject({ kind: 'doc', format: 'text', name: 'page (2).html' })
    expect(Buffer.from(await exportStoredDoc((await row(copy!.id))!)).toString()).toBe('<p>hi</p>\n')
    const [copiedAsset] = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, copy!.id))
    expect(copiedAsset).toMatchObject({ hash: ref.hash, mimeType: 'image/png', ownerUserId: userId })
    expect(objects.get(copiedAsset!.objectKey)?.equals(image)).toBe(true)
    const store = new DocAssetStore(db, copy!.id)
    expect(Buffer.from(await store.get(ref.hash)).equals(image)).toBe(true)
  })

  it('deletes assets with their document, and keeps them through the trash', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'a.txt' })
    await addAsset(node.id, Buffer.from('asset'))
    const [asset] = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))
    await trashFileNode(userId, node.id)
    expect(objects.has(asset!.objectKey)).toBe(true)
    await deleteFileNode(userId, node.id)
    expect(objects.has(asset!.objectKey)).toBe(false)
    expect(await db.select().from(fileDocAssets).where(and(eq(fileDocAssets.nodeId, node.id)))).toHaveLength(0)
    expect(closed).toHaveBeenCalledWith([node.id], 'deleted')
  })

  it('drops assets when a document becomes an ordinary file', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'a.txt' })
    await addAsset(node.id, Buffer.from('asset'))
    const [asset] = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))
    await updateFileNode(userId, node.id, { name: 'a.bin' })
    expect(objects.has(asset!.objectKey)).toBe(false)
  })

  it('refuses to store an asset past the storage allowance', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'a.txt' })
    await db.update(users).set({ storageLimitBytes: 100 }).where(eq(users.id, userId))
    await expect(mutateFileTree(userId, async (tx) => {
      const store = new DocAssetStore(tx, node.id)
      await store.put(Buffer.alloc(500), 'image/png')
      await store.flush(tx, userId, node.id)
    }, ['files'], { reserveBytes: 500 })).rejects.toMatchObject({ code: 'storage_quota_exceeded' })
    expect(await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))).toHaveLength(0)
  })

  it('exports text documents through the shared codec, matching what clients export', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'notes.txt' })
    await clientEdit(node.id, (text) => text.insert(0, 'line one\nline two\n'))
    const doc = await loadYDoc(node.id)
    const local = await textCodec.exportFile(doc, { name: 'notes.txt', assets: new DocAssetStore(db, node.id) })
    expect(Buffer.from(await exportStoredDoc((await row(node.id))!)).equals(Buffer.from(local))).toBe(true)
  })
})
