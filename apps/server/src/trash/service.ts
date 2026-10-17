import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { FileNode, TrashFolderListing, TrashItem, TrashListing, TrashRetention } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, fileNodes } from '../database/schema.js'
import { filePurgeAtFor, getTrashRetention, getUnifiedTrashSince, markChatsForPurge, purgeAtFor } from '../chats/trash.js'
import { chatToFileNode, chatsFolderIdOf } from '../files/chat-items.js'
import { deleteFileNodes, emptyTrash, listTrash, listTrashedFolder, mutateFileTree, restoreFileNodes } from '../files/tree-service.js'
import { toFileNodes } from '../files/shortcuts.js'
import { queueTrashPurge } from '../jobs.js'
import { notFound } from '../lib/errors.js'
import { shownWithoutFiles } from '../sidebar/service.js'

/**
 * One trash for the account: trashed chats and trashed Files items, under one retention setting.
 * Chats and Files items keep their own storage and purge paths; this only lists and routes ids.
 * `files` is false when the administrator has turned Files off; the trash then covers what the
 * sidebar still shows (folders, and shortcuts to folders and chats).
 */
interface TrashScope { files: boolean }

const chatTrashed = (userId: string) => and(
  eq(chats.userId, userId),
  isNotNull(chats.deletedAt),
  isNull(chats.purgeStartedAt),
  eq(chats.temporary, false),
)

async function trashedFileItems(userId: string, scope: TrashScope): Promise<FileNode[]> {
  const nodes = await listTrash(userId)
  return scope.files ? nodes : nodes.filter(shownWithoutFiles)
}

/** When trashed Files items are purged: by the retention setting, and `unifiedSince` (see `filePurgeAtFor`). */
interface FileDeadlines { retention: TrashRetention; unifiedSince: Date | null }

const withDeadline = (node: FileNode, { retention, unifiedSince }: FileDeadlines): TrashItem => ({
  ...node,
  trashedAt: node.trashedAt!,
  purgeAt: filePurgeAtFor(new Date(node.trashedAt!), retention, unifiedSince)?.toISOString() ?? null,
})

/** Trashed Files items with their purge deadlines, newest first. */
export async function listTrashedFiles(userId: string, scope: TrashScope, retention?: TrashRetention): Promise<TrashItem[]> {
  const [nodes, setting, unifiedSince] = await Promise.all([trashedFileItems(userId, scope), retention ?? getTrashRetention(userId), getUnifiedTrashSince()])
  return nodes.map((node) => withDeadline(node, { retention: setting, unifiedSince }))
}

/** A trashed folder's contents, so the trash can be browsed like any other folder. */
export async function listTrashFolder(userId: string, id: string, scope: TrashScope): Promise<TrashFolderListing> {
  const [listing, retention, unifiedSince] = await Promise.all([listTrashedFolder(userId, id), getTrashRetention(userId), getUnifiedTrashSince()])
  const children = scope.files ? listing.children : listing.children.filter(shownWithoutFiles)
  const deadlines = { retention, unifiedSince }
  return {
    folder: withDeadline(listing.folder!, deadlines),
    ancestors: listing.ancestors,
    children: children.map((node) => withDeadline(node, deadlines)),
    retention,
    files: scope.files,
  }
}

export async function listAccountTrash(userId: string, scope: TrashScope): Promise<TrashListing> {
  const retention = await getTrashRetention(userId)
  const [chatRows, fileItems, chatsFolderId] = await Promise.all([
    db.select().from(chats).where(chatTrashed(userId)).orderBy(desc(chats.deletedAt)),
    listTrashedFiles(userId, scope, retention),
    chatsFolderIdOf(db, userId),
  ])
  const items: TrashItem[] = [
    ...chatRows.map((chat) => ({
      ...chatToFileNode(chat, chatsFolderId),
      trashedAt: chat.deletedAt!.toISOString(),
      purgeAt: purgeAtFor(chat.deletedAt!, retention)?.toISOString() ?? null,
    })),
    ...fileItems,
  ]
  items.sort((a, b) => Date.parse(b.trashedAt) - Date.parse(a.trashedAt))
  return { items, retention, files: scope.files }
}

/**
 * Splits ids into Files items and chats. Without Files, only trashed items the sidebar would show
 * can be acted on; Files checks the rest (that each item is in the trash) itself.
 */
async function partition(userId: string, ids: string[], scope: TrashScope): Promise<{ fileIds: string[]; chatIds: string[] }> {
  const unique = [...new Set(ids)]
  const rows = await db.select().from(fileNodes)
    .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, unique)))
  const nodeIds = new Set(rows.map((row) => row.id))
  const chatIds = unique.filter((id) => !nodeIds.has(id))
  if (!scope.files && rows.length && (await toFileNodes(db, userId, rows)).some((node) => !node.trashedAt || !shownWithoutFiles(node))) {
    throw notFound('Trashed item')
  }
  return { fileIds: [...nodeIds], chatIds }
}

/**
 * Restores items, from the trash or from inside trashed folders. Without a destination they go
 * back where they were (chats to the sidebar); with one, there. Returns the restored items.
 */
export async function restoreTrashItems(userId: string, ids: string[], scope: TrashScope, destination?: { parentId: string | null }): Promise<FileNode[]> {
  const { fileIds, chatIds } = await partition(userId, ids, scope)
  // Files restore already brings back chats among the ids, in the same transaction.
  return restoreFileNodes(userId, [...fileIds, ...chatIds], destination)
}

async function purgeChats(userId: string, chatIds: string[], reason: string): Promise<void> {
  if (!chatIds.length) return
  const marked = await mutateFileTree(userId, () => markChatsForPurge(chatIds, userId), ['chats'])
  if (marked) await queueTrashPurge(userId, reason)
}

/**
 * Permanently deletes trashed items. Files items go right away; chats are marked and purged by
 * the maintenance worker, and leave the trash listing immediately.
 */
export async function deleteTrashItems(userId: string, ids: string[], scope: TrashScope): Promise<void> {
  const { fileIds, chatIds } = await partition(userId, ids, scope)
  if (fileIds.length) await deleteFileNodes(userId, fileIds)
  await purgeChats(userId, chatIds, 'trash-delete')
}

export async function emptyAccountTrash(userId: string, scope: TrashScope): Promise<void> {
  if (scope.files) await emptyTrash(userId)
  else {
    const ids = (await trashedFileItems(userId, scope)).map((node) => node.id)
    if (ids.length) await deleteFileNodes(userId, ids)
  }
  // Like DELETE /api/chats/deleted, this includes temporary chats that are waiting to expire.
  const trashedChats = await db.select({ id: chats.id }).from(chats).where(and(
    eq(chats.userId, userId), isNotNull(chats.deletedAt), isNull(chats.purgeStartedAt),
  ))
  await purgeChats(userId, trashedChats.map((chat) => chat.id), 'trash-empty')
}
