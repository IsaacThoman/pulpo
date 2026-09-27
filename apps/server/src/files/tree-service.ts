import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { FILE_TREE_MAX_DEPTH, type FileListing, type FileNode, type FileNodeKind } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileNodes } from '../database/schema.js'
import { bumpAccountRevisions, publishScopedStateChanges, type AccountRevisionChange } from '../friends/sync.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { resolveFileAccess, type FileExecutor, type FileNodeRow } from './access.js'
import { nextAvailableName } from './names.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const FILE_TRASH_RETENTION_MS = 30 * 86_400_000
export const PENDING_FILE_UPLOAD_TTL_MS = 86_400_000

export function toFileNode(row: FileNodeRow): FileNode {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind as FileNodeKind,
    name: row.name,
    status: row.status as FileNode['status'],
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    revision: row.revision,
    trashedAt: row.trashedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const nameConflict = (name: string) =>
  new AppError(409, 'file_name_conflict', `An item named "${name}" already exists here`)

export async function lockFileTree(tx: DatabaseTransaction, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-files:${userId}`}))`)
}

/** Runs a tree mutation under the account's Files lock, then tells the account's other sessions to refetch. */
export async function mutateFileTree<T>(userId: string, mutation: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  let changes: AccountRevisionChange[] = []
  const result = await db.transaction(async (tx) => {
    await lockFileTree(tx, userId)
    const value = await mutation(tx)
    changes = await bumpAccountRevisions(tx, [userId])
    return value
  })
  await publishScopedStateChanges(changes, ['files'])
  return result
}

/** Ids from `startId` up to the root, nearest first. The start node is included. */
async function chainIds(executor: FileExecutor, userId: string, startId: string): Promise<string[]> {
  const rows = await executor.execute<{ id: string }>(sql`
    with recursive chain(id, parent_id, depth) as (
      select id, parent_id, 0 from file_nodes where id = ${startId} and owner_user_id = ${userId}
      union all
      select node.id, node.parent_id, chain.depth + 1 from file_nodes node
      join chain on node.id = chain.parent_id
      where chain.depth < ${FILE_TREE_MAX_DEPTH * 2}
    )
    select id::text as id from chain order by depth
  `)
  return rows.map((row) => row.id)
}

/** Every node below `rootId` (inclusive), live or trashed, with its distance from the root. */
async function subtree(executor: FileExecutor, userId: string, rootId: string): Promise<Array<{ id: string; depth: number }>> {
  const rows = await executor.execute<{ id: string; depth: number }>(sql`
    with recursive subtree(id, depth) as (
      select id, 0 from file_nodes where id = ${rootId} and owner_user_id = ${userId}
      union all
      select node.id, subtree.depth + 1 from file_nodes node
      join subtree on node.parent_id = subtree.id
      where subtree.depth < ${FILE_TREE_MAX_DEPTH * 2}
    )
    select id::text as id, depth from subtree
  `)
  return rows.map((row) => ({ id: row.id, depth: Number(row.depth) }))
}

async function ancestorsOf(executor: FileExecutor, userId: string, node: FileNodeRow): Promise<FileNodeRow[]> {
  if (!node.parentId) return []
  const ids = await chainIds(executor, userId, node.parentId)
  const rows = await executor.select().from(fileNodes).where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, ids)))
  const byId = new Map(rows.map((row) => [row.id, row]))
  return [...ids].reverse().map((id) => byId.get(id)).filter((row): row is FileNodeRow => Boolean(row))
}

async function liveNode(executor: FileExecutor, userId: string, id: string): Promise<FileNodeRow> {
  const access = await resolveFileAccess(executor, userId, id)
  if (!access || access.node.trashedAt) throw notFound('File')
  return access.node
}

/** Validates a destination folder and returns the depth its children would have (root children are depth 1). */
async function destinationDepth(executor: FileExecutor, userId: string, parentId: string | null): Promise<number> {
  if (!parentId) return 1
  const parent = await liveNode(executor, userId, parentId).catch(() => { throw notFound('Folder') })
  if (parent.kind !== 'folder') throw new AppError(400, 'file_parent_not_folder', 'Items can only be placed in folders')
  return (await chainIds(executor, userId, parentId)).length + 1
}

async function liveSiblingNames(executor: FileExecutor, userId: string, parentId: string | null, excludeId?: string): Promise<Set<string>> {
  const rows = await executor.select({ name: fileNodes.name }).from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
    isNull(fileNodes.trashedAt),
    excludeId ? ne(fileNodes.id, excludeId) : undefined,
  ))
  return new Set(rows.map((row) => row.name.toLowerCase()))
}

export async function assertNameAvailable(executor: FileExecutor, userId: string, parentId: string | null, name: string, excludeId?: string): Promise<void> {
  if ((await liveSiblingNames(executor, userId, parentId, excludeId)).has(name.toLowerCase())) throw nameConflict(name)
}

export async function availableName(executor: FileExecutor, userId: string, parentId: string | null, desired: string): Promise<string> {
  return nextAvailableName(desired, await liveSiblingNames(executor, userId, parentId))
}

export async function listFolder(userId: string, parentId: string | null): Promise<FileListing> {
  const folder = parentId ? await liveNode(db, userId, parentId) : null
  if (folder && folder.kind !== 'folder') throw notFound('Folder')
  const [ancestors, children] = await Promise.all([
    folder ? ancestorsOf(db, userId, folder) : Promise.resolve([]),
    // Pending uploads stay private to the uploading session until confirmed.
    db.select().from(fileNodes).where(and(
      eq(fileNodes.ownerUserId, userId),
      parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
      isNull(fileNodes.trashedAt),
      eq(fileNodes.status, 'ready'),
    )).orderBy(desc(sql`${fileNodes.kind} = 'folder'`), asc(sql`lower(${fileNodes.name})`)),
  ])
  return { folder: folder && toFileNode(folder), ancestors: ancestors.map(toFileNode), children: children.map(toFileNode) }
}

export async function getFileNode(userId: string, id: string): Promise<{ node: FileNode; ancestors: FileNode[] }> {
  const access = await resolveFileAccess(db, userId, id)
  if (!access) throw notFound('File')
  return { node: toFileNode(access.node), ancestors: (await ancestorsOf(db, userId, access.node)).map(toFileNode) }
}

export async function createFolder(userId: string, input: { parentId: string | null; name: string }): Promise<FileNode> {
  return mutateFileTree(userId, async (tx) => {
    if (await destinationDepth(tx, userId, input.parentId) > FILE_TREE_MAX_DEPTH) {
      throw new AppError(400, 'file_tree_too_deep', `Folders can be nested at most ${FILE_TREE_MAX_DEPTH} levels deep`)
    }
    await assertNameAvailable(tx, userId, input.parentId, input.name)
    const [created] = await tx.insert(fileNodes).values({
      id: newId(), ownerUserId: userId, parentId: input.parentId, kind: 'folder', name: input.name,
    }).returning()
    return toFileNode(created!)
  })
}

export async function updateFileNode(userId: string, id: string, input: {
  name?: string
  parentId?: string | null
  expectedRevision?: number
}): Promise<FileNode> {
  return mutateFileTree(userId, async (tx) => {
    const node = await liveNode(tx, userId, id)
    if (node.status !== 'ready') throw notFound('File')
    if (input.expectedRevision !== undefined && input.expectedRevision !== node.revision) {
      throw new AppError(409, 'file_revision_conflict', 'This item changed on another device. Refresh and try again.')
    }
    const parentId = input.parentId === undefined ? node.parentId : input.parentId
    const name = input.name ?? node.name
    if (parentId !== node.parentId) {
      if (parentId && (await chainIds(tx, userId, parentId)).includes(node.id)) {
        throw new AppError(400, 'file_move_cycle', 'A folder cannot be moved into itself')
      }
      const height = Math.max(...(await subtree(tx, userId, node.id)).map((row) => row.depth))
      if (await destinationDepth(tx, userId, parentId) + height > FILE_TREE_MAX_DEPTH) {
        throw new AppError(400, 'file_tree_too_deep', `Folders can be nested at most ${FILE_TREE_MAX_DEPTH} levels deep`)
      }
    }
    if (parentId === node.parentId && name === node.name) return toFileNode(node)
    await assertNameAvailable(tx, userId, parentId, name, node.id)
    const [updated] = await tx.update(fileNodes).set({
      name, parentId, revision: sql`${fileNodes.revision} + 1`, updatedAt: new Date(),
    }).where(eq(fileNodes.id, node.id)).returning()
    return toFileNode(updated!)
  })
}

export async function trashFileNode(userId: string, id: string): Promise<void> {
  await mutateFileTree(userId, async (tx) => {
    const node = await liveNode(tx, userId, id)
    if (node.status !== 'ready') throw notFound('File')
    const ids = (await subtree(tx, userId, node.id)).map((row) => row.id)
    // Descendants trashed earlier keep their own trash root so they can still be restored separately.
    await tx.update(fileNodes).set({ trashedAt: new Date(), trashRootId: node.id, updatedAt: new Date() })
      .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, ids), isNull(fileNodes.trashedAt)))
  })
}

export async function restoreFileNode(userId: string, id: string): Promise<FileNode> {
  return mutateFileTree(userId, async (tx) => {
    const access = await resolveFileAccess(tx, userId, id)
    if (!access || !access.node.trashedAt || access.node.trashRootId !== access.node.id) throw notFound('Trashed item')
    const node = access.node
    // If the original folder is still in the trash, the item comes back at the top level.
    const parent = node.parentId ? (await resolveFileAccess(tx, userId, node.parentId))?.node : null
    const parentId = parent && !parent.trashedAt ? parent.id : null
    const name = await availableName(tx, userId, parentId, node.name)
    // Rename while still trashed; the live-name index only applies once the batch is restored.
    await tx.update(fileNodes).set({ parentId, name, revision: sql`${fileNodes.revision} + 1` }).where(eq(fileNodes.id, node.id))
    await tx.update(fileNodes).set({ trashedAt: null, trashRootId: null, updatedAt: new Date() })
      .where(and(eq(fileNodes.ownerUserId, userId), eq(fileNodes.trashRootId, node.id)))
    const [restored] = await tx.select().from(fileNodes).where(eq(fileNodes.id, node.id))
    return toFileNode(restored!)
  })
}

export async function listTrash(userId: string): Promise<FileNode[]> {
  const rows = await db.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    isNotNull(fileNodes.trashedAt),
    eq(fileNodes.trashRootId, fileNodes.id),
  )).orderBy(desc(fileNodes.trashedAt))
  return rows.map(toFileNode)
}

/** Deletes stored objects before rows so a failed purge can be retried without orphaning blobs. */
async function purgeNodes(tx: DatabaseTransaction, userId: string, rootIds: string[]): Promise<void> {
  if (!rootIds.length) return
  const ids = new Set<string>()
  for (const rootId of rootIds) for (const row of await subtree(tx, userId, rootId)) ids.add(row.id)
  const blobs = await tx.select({ key: fileNodes.objectKey }).from(fileNodes)
    .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, [...ids]), isNotNull(fileNodes.objectKey)))
  for (const blob of blobs) if (blob.key) await getBlobStore().delete(blob.key)
  // Children cascade from their parents.
  await tx.delete(fileNodes).where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, rootIds)))
}

/** Permanently deletes a trashed item, or cancels an upload that was never confirmed. */
export async function deleteFileNode(userId: string, id: string): Promise<void> {
  await mutateFileTree(userId, async (tx) => {
    const access = await resolveFileAccess(tx, userId, id)
    if (!access) throw notFound('File')
    if (!access.node.trashedAt && access.node.status !== 'pending') {
      throw new AppError(409, 'file_not_trashed', 'Move this item to the trash before deleting it permanently')
    }
    await purgeNodes(tx, userId, [id])
  })
}

export async function emptyTrash(userId: string): Promise<void> {
  await mutateFileTree(userId, async (tx) => {
    const roots = await tx.select({ id: fileNodes.id }).from(fileNodes).where(and(
      eq(fileNodes.ownerUserId, userId),
      isNotNull(fileNodes.trashedAt),
      eq(fileNodes.trashRootId, fileNodes.id),
    ))
    await purgeNodes(tx, userId, roots.map((row) => row.id))
  })
}

/** Maintenance: drop uploads that were never confirmed and trash past its retention window. */
export async function cleanupFiles(now = new Date()): Promise<void> {
  const abandoned = await db.select({ id: fileNodes.id, userId: fileNodes.ownerUserId }).from(fileNodes).where(and(
    eq(fileNodes.status, 'pending'),
    lt(fileNodes.createdAt, new Date(now.getTime() - PENDING_FILE_UPLOAD_TTL_MS)),
  )).limit(500)
  const expired = await db.select({ id: fileNodes.id, userId: fileNodes.ownerUserId }).from(fileNodes).where(and(
    eq(fileNodes.trashRootId, fileNodes.id),
    lt(fileNodes.trashedAt, new Date(now.getTime() - FILE_TRASH_RETENTION_MS)),
  )).limit(500)
  const byUser = new Map<string, string[]>()
  for (const row of [...abandoned, ...expired]) byUser.set(row.userId, [...byUser.get(row.userId) ?? [], row.id])
  for (const [userId, ids] of byUser) {
    // One account's storage failure must not block cleanup for the others.
    await mutateFileTree(userId, (tx) => purgeNodes(tx, userId, ids)).catch(() => undefined)
  }
}
