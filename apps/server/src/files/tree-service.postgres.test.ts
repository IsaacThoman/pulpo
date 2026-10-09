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
  moveFileNodes,
  restoreFileNode,
  restoreFileNodes,
  trashFileNode,
  trashFileNodes,
  updateFileNode,
} from './tree-service.js'
import { copyFileNodes } from './copy-service.js'
import { saveAttachmentToFiles } from './save-attachment.js'

const publish = vi.hoisted(() => vi.fn())
const deletedKeys = vi.hoisted(() => [] as string[])
const copiedKeys = vi.hoisted(() => [] as Array<[string, string]>)
vi.mock('../responses/events.js', () => ({ publishStateChange: publish }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../storage/index.js', () => ({
  getBlobStore: () => ({
    delete: async (key: string) => { deletedKeys.push(key) },
    copy: async (source: string, target: string) => { copiedKeys.push([source, target]) },
  }),
}))

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
    copiedKeys.length = 0
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
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ userId, scopes: ['files', 'folders'] }))
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

  it('moves a selection atomically, keeping both items on name clashes', async () => {
    const target = await createFolder(userId, { parentId: null, name: 'Target' })
    await insertBlob(target.id, 'report.pdf')
    const a = await insertBlob(null, 'report.pdf')
    const b = await createFolder(userId, { parentId: null, name: 'Notes' })
    const moved = await moveFileNodes(userId, [{ id: a, parentId: target.id }, { id: b.id, parentId: target.id }])
    expect(moved.map((node) => node.name)).toEqual(['report (2).pdf', 'Notes'])
    // Undo moves back with the original name.
    const undone = await moveFileNodes(userId, [{ id: a, parentId: null, name: 'report.pdf' }])
    expect(undone[0]).toMatchObject({ parentId: null, name: 'report.pdf' })
  })

  it('rolls back the whole batch when one move is invalid', async () => {
    const parent = await createFolder(userId, { parentId: null, name: 'Parent' })
    const child = await createFolder(userId, { parentId: parent.id, name: 'Child' })
    const loose = await insertBlob(null, 'loose.txt')
    await expect(moveFileNodes(userId, [{ id: loose, parentId: child.id }, { id: parent.id, parentId: child.id }]))
      .rejects.toMatchObject({ code: 'file_move_cycle' })
    const [row] = await db.select({ parentId: fileNodes.parentId }).from(fileNodes).where(eq(fileNodes.id, loose))
    expect(row?.parentId).toBeNull()
  })

  it('treats a folder selected with its contents as one item for trash and restore', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const inner = await insertBlob(folder.id, 'inner.txt')
    const other = await insertBlob(null, 'other.txt')
    const roots = await trashFileNodes(userId, [inner, folder.id, other])
    expect(roots.sort()).toEqual([folder.id, other].sort())
    expect((await listTrash(userId)).map((node) => node.id).sort()).toEqual(roots.sort())
    await restoreFileNodes(userId, roots)
    expect((await listFolder(userId, folder.id)).children.map((node) => node.id)).toEqual([inner])
  })

  it('copies folders, documents, and files, reserving storage for the whole selection', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const file = await insertBlob(folder.id, 'photo.png', 30)
    const [copy] = await copyFileNodes(userId, [folder.id], null)
    expect(copy).toMatchObject({ kind: 'folder', name: 'Folder (2)', parentId: null })
    const children = (await listFolder(userId, copy!.id)).children
    expect(children).toMatchObject([{ name: 'photo.png', sizeBytes: 30, status: 'ready' }])
    expect(copiedKeys).toEqual([[`users/${userId}/files/${file}`, `users/${userId}/files/${children[0]!.id}`]])
    expect(await storageUsedBytes(db, userId)).toBe(60)
    await db.update(users).set({ storageLimitBytes: 80 }).where(eq(users.id, userId))
    await expect(copyFileNodes(userId, [folder.id], null)).rejects.toMatchObject({ code: 'storage_quota_exceeded' })
  })

  it('refuses to copy a folder into itself', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const child = await createFolder(userId, { parentId: folder.id, name: 'Child' })
    await expect(copyFileNodes(userId, [folder.id], child.id)).rejects.toMatchObject({ code: 'file_move_cycle' })
  })

  it('saves a chat attachment into Files as a copy, keeping both names and counting its storage', async () => {
    const [attachment] = await db.insert(attachments).values({
      id: randomUUID(), userId, originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 30, objectKey: `users/${userId}/attachments/a`, status: 'ready',
    }).returning()
    const folder = await createFolder(userId, { parentId: null, name: 'Work' })
    await insertBlob(folder.id, 'report.pdf')
    const { node: saved, replacedId } = await saveAttachmentToFiles(userId, attachment!, { parentId: folder.id })
    expect(replacedId).toBeNull()
    expect(saved).toMatchObject({ kind: 'blob', name: 'report (2).pdf', parentId: folder.id, status: 'ready', mimeType: 'application/pdf', sizeBytes: 30 })
    expect(copiedKeys).toEqual([[`users/${userId}/attachments/a`, `users/${userId}/files/${saved.id}`]])
    expect(await storageUsedBytes(db, userId)).toBe(70)
    await db.update(users).set({ storageLimitBytes: 80 }).where(eq(users.id, userId))
    await expect(saveAttachmentToFiles(userId, attachment!, { parentId: null })).rejects.toMatchObject({ code: 'storage_quota_exceeded' })
  })

  it('saves an attachment under a chosen name, or over a file of that name, which moves to the trash', async () => {
    const [attachment] = await db.insert(attachments).values({
      id: randomUUID(), userId, originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 5, objectKey: `users/${userId}/attachments/b`, status: 'ready',
    }).returning()
    const existing = await insertBlob(null, 'Q3.pdf')
    const { node: renamed } = await saveAttachmentToFiles(userId, attachment!, { parentId: null, name: 'Notes.pdf' })
    expect(renamed.name).toBe('Notes.pdf')

    const { node, replacedId } = await saveAttachmentToFiles(userId, attachment!, { parentId: null, name: 'q3.pdf', replaceId: existing })
    expect(replacedId).toBe(existing)
    expect(node).toMatchObject({ name: 'q3.pdf', parentId: null, status: 'ready' })
    expect((await listTrash(userId)).map((item) => item.id)).toEqual([existing])

    // The file to overwrite must still hold that name where the user saw it.
    await expect(saveAttachmentToFiles(userId, attachment!, { parentId: null, name: 'Other.pdf', replaceId: node.id }))
      .rejects.toMatchObject({ code: 'file_replace_conflict' })
  })
})
