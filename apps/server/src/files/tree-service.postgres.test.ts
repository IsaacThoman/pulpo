import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { attachments, fileNodes, users } from '../database/schema.js'
import { storageUsedBytes, withReservedStorage } from '../attachments/storage-quota.js'
import {
  cleanupFiles,
  createFolder,
  deleteFileNode,
  emptyTrash,
  FILE_TRASH_RETENTION_MS,
  listFolder,
  listTrash,
  restoreFileNode,
  trashFileNode,
  updateFileNode,
} from './tree-service.js'

const publish = vi.hoisted(() => vi.fn())
const deletedKeys = vi.hoisted(() => [] as string[])
vi.mock('../responses/events.js', () => ({ publishStateChange: publish }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ delete: async (key: string) => { deletedKeys.push(key) } }) }))

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

async function insertBlob(parentId: string | null, name: string, sizeBytes = 10) {
  const id = randomUUID()
  await db.insert(fileNodes).values({ id, ownerUserId: userId, parentId, kind: 'blob', name, sizeBytes, objectKey: `users/${userId}/files/${id}` })
  return id
}

describe.skipIf(!enabled)('Files tree PostgreSQL behavior', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Files test', email: `${userId}@example.test`, username: `f${userId.replaceAll('-', '')}`, role: 'user', storageLimitBytes: 100 })
    publish.mockClear()
    deletedKeys.length = 0
  })
  afterAll(async () => { await queryClient.end() })

  it('lists folders first, hides pending uploads, and returns breadcrumbs', async () => {
    const docs = await createFolder(userId, { parentId: null, name: 'Docs' })
    const nested = await createFolder(userId, { parentId: docs.id, name: 'Nested' })
    await insertBlob(nested.id, 'a.txt')
    await db.insert(fileNodes).values({ id: randomUUID(), ownerUserId: userId, parentId: nested.id, kind: 'blob', name: 'b.txt', status: 'pending', objectKey: `users/${userId}/files/pending` })
    await createFolder(userId, { parentId: nested.id, name: 'Zed' })
    const listing = await listFolder(userId, nested.id)
    expect(listing.ancestors.map((node) => node.name)).toEqual(['Docs'])
    expect(listing.children.map((node) => node.name)).toEqual(['Zed', 'a.txt'])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ userId, scopes: ['files'] }))
  })

  it('rejects case-insensitive sibling conflicts and moves into descendants', async () => {
    const parent = await createFolder(userId, { parentId: null, name: 'Parent' })
    const child = await createFolder(userId, { parentId: parent.id, name: 'Child' })
    await expect(createFolder(userId, { parentId: null, name: 'parent' })).rejects.toMatchObject({ code: 'file_name_conflict' })
    await expect(updateFileNode(userId, parent.id, { parentId: child.id })).rejects.toMatchObject({ code: 'file_move_cycle' })
    await expect(updateFileNode(userId, parent.id, { parentId: parent.id })).rejects.toMatchObject({ code: 'file_move_cycle' })
    const moved = await updateFileNode(userId, child.id, { parentId: null, name: 'Sibling', expectedRevision: 0 })
    expect(moved).toMatchObject({ parentId: null, name: 'Sibling', revision: 1 })
    await expect(updateFileNode(userId, child.id, { name: 'Stale', expectedRevision: 0 })).rejects.toMatchObject({ code: 'file_revision_conflict' })
  })

  it('serializes concurrent moves so two folders cannot become each other\'s parent', async () => {
    const a = await createFolder(userId, { parentId: null, name: 'A' })
    const b = await createFolder(userId, { parentId: null, name: 'B' })
    const results = await Promise.allSettled([
      updateFileNode(userId, a.id, { parentId: b.id }),
      updateFileNode(userId, b.id, { parentId: a.id }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('trashes a subtree, restores it as a batch, and renames on conflict', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const file = await insertBlob(folder.id, 'inner.txt')
    await trashFileNode(userId, folder.id)
    expect((await listFolder(userId, null)).children).toEqual([])
    expect((await listTrash(userId)).map((node) => node.id)).toEqual([folder.id])
    await createFolder(userId, { parentId: null, name: 'folder' })
    const restored = await restoreFileNode(userId, folder.id)
    expect(restored.name).toBe('Folder (2)')
    const [inner] = await db.select().from(fileNodes).where(eq(fileNodes.id, file))
    expect(inner?.trashedAt).toBeNull()
  })

  it('restores an item to the top level when its folder is still trashed', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const file = await insertBlob(folder.id, 'inner.txt')
    await trashFileNode(userId, file)
    await trashFileNode(userId, folder.id)
    expect((await listTrash(userId)).map((node) => node.id).sort()).toEqual([folder.id, file].sort())
    const restored = await restoreFileNode(userId, file)
    expect(restored.parentId).toBeNull()
  })

  it('purges only trashed items, deleting stored objects for the whole subtree', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const file = await insertBlob(folder.id, 'inner.txt')
    await expect(deleteFileNode(userId, folder.id)).rejects.toMatchObject({ code: 'file_not_trashed' })
    await trashFileNode(userId, folder.id)
    await emptyTrash(userId)
    expect(deletedKeys).toEqual([`users/${userId}/files/${file}`])
    expect(await db.select().from(fileNodes).where(eq(fileNodes.ownerUserId, userId))).toEqual([])
  })

  it('charges attachments and Files blobs, including trashed ones, against one quota', async () => {
    await db.insert(attachments).values({ id: randomUUID(), userId, originalName: 'a', mimeType: 'text/plain', sizeBytes: 40, objectKey: randomUUID(), status: 'ready' })
    const file = await insertBlob(null, 'b.txt', 50)
    await trashFileNode(userId, file)
    expect(await storageUsedBytes(db, userId)).toBe(90)
    await expect(withReservedStorage(userId, 11, async () => undefined)).rejects.toMatchObject({ code: 'storage_quota_exceeded' })
    await withReservedStorage(userId, 10, async () => undefined)
  })

  it('cleans up abandoned uploads and expired trash', async () => {
    const pending = randomUUID()
    const old = new Date(Date.now() - FILE_TRASH_RETENTION_MS - 60_000)
    await db.insert(fileNodes).values({ id: pending, ownerUserId: userId, kind: 'blob', name: 'p', status: 'pending', objectKey: `k/${pending}`, createdAt: old })
    const trashed = await insertBlob(null, 't')
    await db.update(fileNodes).set({ trashedAt: old, trashRootId: trashed }).where(eq(fileNodes.id, trashed))
    const kept = await insertBlob(null, 'kept')
    await cleanupFiles()
    const remaining = await db.select({ id: fileNodes.id }).from(fileNodes).where(eq(fileNodes.ownerUserId, userId))
    expect(remaining.map((row) => row.id)).toEqual([kept])
  })
})
