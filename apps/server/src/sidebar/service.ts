import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  FILE_TREE_MAX_DEPTH,
  MAX_SIDEBAR_SHORTCUTS,
  type FileNode,
  type FileNodeKind,
  type FileSystemRole,
  type SidebarFolder,
  type SidebarShortcut,
  type SidebarShortcutTarget,
  type SidebarState,
} from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, fileNodes, sidebarShortcuts } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { resolveFileAccess } from '../files/access.js'
import { liveChatIds } from '../files/chat-items.js'
import { ensureSystemFolders } from '../files/system-folders.js'
import {
  availableName,
  destinationDepth,
  listFolder,
  moveFileNodes,
  mutateFileTree,
  toFileNode,
  trashFileNodes,
  treeTooDeep,
  updateFileNode,
} from '../files/tree-service.js'

/** Live folders under `rootIds` (inclusive), each listed once. */
async function folderTrees(userId: string, rootIds: string[]): Promise<SidebarFolder[]> {
  if (!rootIds.length) return []
  const rows = await db.execute<{ id: string; parent_id: string | null; name: string; system_role: string | null }>(sql`
    with recursive tree(id, depth) as (
      select id, 0 from file_nodes
      where owner_user_id = ${userId} and id in (${sql.join(rootIds.map((id) => sql`${id}::uuid`), sql`, `)})
        and kind = 'folder' and trashed_at is null and status = 'ready'
      union
      select node.id, tree.depth + 1 from file_nodes node
      join tree on node.parent_id = tree.id
      where node.kind = 'folder' and node.trashed_at is null and node.status = 'ready' and tree.depth < ${FILE_TREE_MAX_DEPTH}
    )
    select distinct node.id::text as id, node.parent_id::text as parent_id, node.name, node.system_role
    from file_nodes node join tree on tree.id = node.id
  `)
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    systemRole: (row.system_role as FileSystemRole | null) ?? null,
  }))
}

export async function listShortcuts(userId: string): Promise<SidebarShortcut[]> {
  const rows = await db.select({
    id: sidebarShortcuts.id,
    targetKind: sidebarShortcuts.targetKind,
    fileNodeId: sidebarShortcuts.fileNodeId,
    chatId: sidebarShortcuts.chatId,
    nodeName: fileNodes.name,
    nodeKind: fileNodes.kind,
    nodeRole: fileNodes.systemRole,
    nodeLive: sql<boolean>`${fileNodes.trashedAt} is null and ${fileNodes.status} = 'ready'`,
    chatTitle: chats.title,
    chatLive: sql<boolean>`${chats.deletedAt} is null and not ${chats.temporary}`,
  }).from(sidebarShortcuts)
    .leftJoin(fileNodes, eq(fileNodes.id, sidebarShortcuts.fileNodeId))
    .leftJoin(chats, eq(chats.id, sidebarShortcuts.chatId))
    .where(eq(sidebarShortcuts.userId, userId))
    .orderBy(asc(sidebarShortcuts.sortOrder), asc(sidebarShortcuts.createdAt))
  // Shortcuts to trashed items stay saved and come back if the item is restored.
  return rows.flatMap((row): SidebarShortcut[] => {
    if (row.targetKind === 'chat') {
      return row.chatId && row.chatLive ? [{ id: row.id, targetKind: 'chat', targetId: row.chatId, name: row.chatTitle ?? '', kind: 'chat', systemRole: null }] : []
    }
    return row.fileNodeId && row.nodeLive
      ? [{
          id: row.id,
          targetKind: 'file',
          targetId: row.fileNodeId,
          name: row.nodeName ?? '',
          kind: row.nodeKind as FileNodeKind,
          systemRole: (row.nodeRole as FileSystemRole | null) ?? null,
        }]
      : []
  })
}

/** Everything the sidebar needs besides the chat list: its folders and shortcuts. */
export async function sidebarState(userId: string): Promise<SidebarState> {
  const { chatsFolderId, archiveFolderId } = await ensureSystemFolders(userId)
  const shortcuts = await listShortcuts(userId)
  const roots = [chatsFolderId, archiveFolderId, ...shortcuts.filter((item) => item.kind === 'folder').map((item) => item.targetId)]
  return { chatsFolderId, archiveFolderId, folders: await folderTrees(userId, roots), shortcuts }
}

export async function createShortcut(userId: string, targetKind: SidebarShortcutTarget, targetId: string): Promise<SidebarShortcut[]> {
  if (targetKind === 'chat') {
    if (!(await liveChatIds(db, userId, [targetId])).size) throw notFound('Chat')
  } else {
    const access = await resolveFileAccess(db, userId, targetId)
    if (!access || access.node.trashedAt || access.node.status !== 'ready') throw notFound('File')
  }
  await mutateFileTree(userId, async (tx) => {
    const [stats] = await tx.select({
      count: sql<number>`count(*)::int`,
      last: sql<number>`coalesce(max(${sidebarShortcuts.sortOrder}), -1)::int`,
    }).from(sidebarShortcuts).where(eq(sidebarShortcuts.userId, userId))
    if ((stats?.count ?? 0) >= MAX_SIDEBAR_SHORTCUTS) {
      throw new AppError(400, 'sidebar_shortcut_limit', `The sidebar can hold at most ${MAX_SIDEBAR_SHORTCUTS} shortcuts`)
    }
    await tx.insert(sidebarShortcuts).values({
      id: newId(),
      userId,
      targetKind,
      fileNodeId: targetKind === 'file' ? targetId : null,
      chatId: targetKind === 'chat' ? targetId : null,
      sortOrder: (stats?.last ?? -1) + 1,
    }).onConflictDoNothing()
  }, ['folders'])
  return listShortcuts(userId)
}

export async function deleteShortcut(userId: string, id: string): Promise<void> {
  await mutateFileTree(userId, async (tx) => {
    const deleted = await tx.delete(sidebarShortcuts).where(and(eq(sidebarShortcuts.id, id), eq(sidebarShortcuts.userId, userId))).returning({ id: sidebarShortcuts.id })
    if (!deleted.length) throw notFound('Shortcut')
  }, ['folders'])
}

export async function reorderShortcuts(userId: string, ids: string[]): Promise<SidebarShortcut[]> {
  await mutateFileTree(userId, async (tx) => {
    for (const [sortOrder, id] of ids.entries()) {
      await tx.update(sidebarShortcuts).set({ sortOrder }).where(and(eq(sidebarShortcuts.id, id), eq(sidebarShortcuts.userId, userId)))
    }
  }, ['folders'])
  return listShortcuts(userId)
}

async function requireFolder(userId: string, id: string) {
  const access = await resolveFileAccess(db, userId, id)
  if (!access || access.node.trashedAt || access.node.status !== 'ready' || access.node.kind !== 'folder') throw notFound('Folder')
  return access.node
}

/**
 * Creates a folder for chats, in the Chats folder unless `parentId` says otherwise. A taken name
 * gets a " (n)" suffix. A client-chosen id makes replays (e.g. from an offline queue) idempotent.
 */
export async function createSidebarFolder(userId: string, input: { id?: string; parentId?: string | null; name: string }): Promise<FileNode> {
  const { chatsFolderId } = await ensureSystemFolders(userId)
  const parentId = input.parentId ?? chatsFolderId
  return mutateFileTree(userId, async (tx) => {
    if (input.id) {
      const [existing] = await tx.select().from(fileNodes).where(eq(fileNodes.id, input.id)).limit(1)
      if (existing) {
        if (existing.ownerUserId !== userId) throw new AppError(409, 'folder_id_conflict', 'Folder identifier is already in use')
        return toFileNode(existing)
      }
    }
    if (await destinationDepth(tx, userId, parentId) > FILE_TREE_MAX_DEPTH) throw treeTooDeep()
    const [created] = await tx.insert(fileNodes).values({
      id: input.id ?? newId(),
      ownerUserId: userId,
      parentId,
      kind: 'folder',
      name: await availableName(tx, userId, parentId, input.name),
    }).returning()
    return toFileNode(created!)
  })
}

export async function updateSidebarFolder(userId: string, id: string, input: { name?: string; parentId?: string | null }): Promise<FileNode> {
  await requireFolder(userId, id)
  const parentId = input.parentId === undefined
    ? undefined
    : input.parentId ?? (await ensureSystemFolders(userId)).chatsFolderId
  return updateFileNode(userId, id, { name: input.name, parentId })
}

/** Trashes a folder (restorable from Files). Its chats go back to the unfiled list. */
export async function trashSidebarFolder(userId: string, id: string): Promise<void> {
  await requireFolder(userId, id)
  await trashFileNodes(userId, [id])
}

/** The Files items (not folders or chats) in a folder; nothing when Files is turned off. */
export async function sidebarFolderFiles(userId: string, id: string, filesEnabled: boolean): Promise<FileNode[]> {
  await requireFolder(userId, id)
  if (!filesEnabled) return []
  return (await listFolder(userId, id)).children.filter((node) => node.kind === 'doc' || node.kind === 'blob')
}

/** Moves chats (unpinning them) and Files items into the Archive folder. */
export async function archiveItems(userId: string, input: { chatIds: string[]; fileIds: string[] }): Promise<{ archiveFolderId: string }> {
  const { archiveFolderId } = await ensureSystemFolders(userId)
  const chatIds = [...await liveChatIds(db, userId, [...input.chatIds, ...input.fileIds])]
  const fileIds = input.fileIds.filter((id) => !chatIds.includes(id))
  if (chatIds.length) {
    await mutateFileTree(userId, async (tx) => {
      await tx.update(chats).set({ folderId: archiveFolderId, pinned: false })
        .where(and(eq(chats.userId, userId), inArray(chats.id, chatIds), isNull(chats.deletedAt), accessibleChatCondition()))
    }, ['files', 'folders', 'chats'])
  }
  if (fileIds.length) await moveFileNodes(userId, fileIds.map((id) => ({ id, parentId: archiveFolderId })))
  return { archiveFolderId }
}

/**
 * The flat folder list older clients (and the admin chat view) show: the Chats folder's folders,
 * Archive, and any other folder holding chats, each named by its path.
 */
export async function legacyFolderList(userId: string, options: { create: boolean }) {
  let roots: { chatsFolderId: string; archiveFolderId: string } | null = null
  if (options.create) {
    roots = await ensureSystemFolders(userId)
  } else {
    const rows = await db.select({ id: fileNodes.id, role: fileNodes.systemRole }).from(fileNodes)
      .where(and(eq(fileNodes.ownerUserId, userId), sql`${fileNodes.systemRole} is not null`))
    const chatsFolderId = rows.find((row) => row.role === 'chats')?.id
    const archiveFolderId = rows.find((row) => row.role === 'archive')?.id
    if (chatsFolderId || archiveFolderId) roots = { chatsFolderId: chatsFolderId ?? '', archiveFolderId: archiveFolderId ?? '' }
  }
  const tree = roots ? await folderTrees(userId, [roots.chatsFolderId, roots.archiveFolderId].filter(Boolean)) : []
  const byId = new Map(tree.map((folder) => [folder.id, folder]))
  const pathName = (folder: SidebarFolder): string => {
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined
    if (!parent || parent.systemRole === 'chats') return folder.name
    return `${pathName(parent)} / ${folder.name}`
  }
  const listed = tree.filter((folder) => folder.systemRole !== 'chats')
  const known = new Set(listed.map((folder) => folder.id))
  // Folders elsewhere in Files that hold chats, so those chats are not lost to older clients.
  const elsewhere = await db.selectDistinct({ id: fileNodes.id, name: fileNodes.name }).from(chats)
    .innerJoin(fileNodes, eq(fileNodes.id, chats.folderId))
    .where(and(eq(chats.userId, userId), isNull(chats.deletedAt), isNull(fileNodes.trashedAt)))
  const folders = [
    ...listed.map((folder) => ({ id: folder.id, name: pathName(folder) })),
    ...elsewhere.filter((folder) => !known.has(folder.id)),
  ].sort((left, right) => left.name.localeCompare(right.name))
  return folders
}
