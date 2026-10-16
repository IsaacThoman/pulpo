import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { FILE_TREE_MAX_DEPTH, type FileNode, type FileSystemRole, type SidebarFolder, type SidebarState, type UpdateSidebarItem } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, fileNodes } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { resolveFileAccess, type FileExecutor } from '../files/access.js'
import { chatFolderId, liveChatIds } from '../files/chat-items.js'
import { toFileNodes } from '../files/shortcuts.js'
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
import { pinnedEndOrder, topChatOrder, topSortOrder } from '../files/order.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Sets a sort order column to each listed id's position in `ids`. */
const listPosition = (ids: readonly string[], column: typeof chats.id | typeof fileNodes.id) =>
  sql`case ${column} ${sql.join(ids.map((id, index) => sql`when ${id}::uuid then ${index}::int`), sql` `)} end`

/** Without Files, the sidebar shows only folders and shortcuts to folders and chats. */
export const shownWithoutFiles = (node: FileNode) =>
  node.kind === 'folder' || (node.kind === 'shortcut' && (node.target?.kind === 'folder' || node.target?.kind === 'chat'))

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

/** Pinned folders, files, and shortcuts, wherever they are in Files. */
async function pinnedItems(userId: string, filesEnabled: boolean): Promise<FileNode[]> {
  const rows = await db.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId), eq(fileNodes.pinned, true), isNull(fileNodes.trashedAt), eq(fileNodes.status, 'ready'),
  ))
  const nodes = await toFileNodes(db, userId, rows)
  return filesEnabled ? nodes : nodes.filter(shownWithoutFiles)
}

/**
 * The pinned Files items, and the folders the sidebar can show (for moving things): the Chats and
 * Archive folders and pinned folders, with the folders inside them.
 */
export async function sidebarState(userId: string, filesEnabled = true): Promise<SidebarState> {
  const { chatsFolderId, archiveFolderId } = await ensureSystemFolders(userId)
  const pinned = await pinnedItems(userId, filesEnabled)
  const pinnedFolderIds = pinned.filter((node) => node.kind === 'folder').map((node) => node.id)
  const folders = await folderTrees(userId, [chatsFolderId, archiveFolderId, ...pinnedFolderIds])
  return { chatsFolderId, archiveFolderId, folders, pinnedItems: pinned }
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
      sortOrder: await topSortOrder(tx, userId, parentId),
    }).returning()
    return toFileNode(created!)
  })
}

/**
 * What the sidebar shows in a folder besides its chats (which clients already have): subfolders,
 * shortcuts, and files, except pinned ones, which it lists under Pinned. Without Files, only
 * folders and shortcuts to folders and chats.
 */
export async function sidebarFolderItems(userId: string, id: string, filesEnabled: boolean): Promise<FileNode[]> {
  await requireFolder(userId, id)
  const children = (await listFolder(userId, id)).children.filter((node) => node.kind !== 'chat' && !node.pinned)
  return filesEnabled ? children : children.filter(shownWithoutFiles)
}

const pinnedNodes = (executor: FileExecutor, userId: string, ids: readonly string[]) => ids.length
  ? executor.select({ id: fileNodes.id, parentId: fileNodes.parentId }).from(fileNodes)
    .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, [...ids]), eq(fileNodes.pinned, true)))
  : Promise.resolve([])

/**
 * Unpins whichever of `ids` are pinned, putting each back at the top of its folder (unfiled chats
 * at the top of the sidebar). `chatIds` are the ones that are chats.
 */
async function unpinInTx(tx: DatabaseTransaction, userId: string, ids: readonly string[], chatIds: ReadonlySet<string> = new Set()): Promise<void> {
  const nodes = new Map((await pinnedNodes(tx, userId, ids.filter((id) => !chatIds.has(id)))).map((node) => [node.id, node]))
  // One at a time, last first, so several unpinned into one folder keep the order given.
  for (const id of [...ids].reverse()) {
    const node = nodes.get(id)
    if (node) {
      await tx.update(fileNodes).set({ pinned: false, sortOrder: await topSortOrder(tx, userId, node.parentId) }).where(eq(fileNodes.id, id))
      continue
    }
    if (!chatIds.has(id)) continue
    const [chat] = await tx.select({ pinned: chats.pinned, folderId: chats.folderId, inFilesRoot: chats.inFilesRoot }).from(chats).where(eq(chats.id, id))
    if (!chat?.pinned) continue
    const sortOrder = chat.inFilesRoot ? await topSortOrder(tx, userId, null) : await topChatOrder(tx, userId, chat.folderId)
    await tx.update(chats).set({ pinned: false, sortOrder }).where(eq(chats.id, id))
  }
}

/** Unpins pinned chats (`chatIds`) and Files items among `ids` before they are put somewhere, even where they are. */
async function unpinBeforePlacing(userId: string, ids: readonly string[], chatIds: ReadonlySet<string> = new Set()): Promise<void> {
  const pinnedChats = chatIds.size
    ? await db.select({ id: chats.id }).from(chats).where(and(inArray(chats.id, [...chatIds]), eq(chats.pinned, true)))
    : []
  if (pinnedChats.length || (await pinnedNodes(db, userId, ids)).length) {
    await mutateFileTree(userId, (tx) => unpinInTx(tx, userId, ids, chatIds), pinnedChats.length ? ['files', 'folders', 'chats'] : undefined)
  }
}

/**
 * Moves chats and Files items into a folder; null is the Chats folder, the top of the sidebar.
 * Pinned ones stay pinned unless `unpin` takes them out of the pinned list.
 */
export async function moveSidebarItems(userId: string, ids: string[], parentId: string | null, { unpin = false } = {}): Promise<FileNode[]> {
  const destination = parentId ?? (await ensureSystemFolders(userId)).chatsFolderId
  if (unpin) await unpinBeforePlacing(userId, ids, await liveChatIds(db, userId, ids))
  return moveFileNodes(userId, ids.map((id) => ({ id, parentId: destination })))
}

/**
 * Sets the order of a folder's items, chats included (null is the Chats folder). Listed items from
 * elsewhere move in first, chats leaving the pinned list. Items not listed keep their place.
 */
export async function orderSidebarItems(userId: string, parentId: string | null, ids: string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new AppError(400, 'validation_error', 'The order cannot list an item twice')
  const folderId = parentId ?? (await ensureSystemFolders(userId)).chatsFolderId
  const chatIds = [...await liveChatIds(db, userId, ids)]
  const nodeIds = ids.filter((id) => !chatIds.includes(id))
  const nodes = nodeIds.length
    ? await db.select({ id: fileNodes.id, parentId: fileNodes.parentId }).from(fileNodes)
      .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, nodeIds), isNull(fileNodes.trashedAt)))
    : []
  if (nodes.length !== nodeIds.length) throw notFound('File')
  // Moving checks for cycles, depth, and name clashes as any other move does.
  const outside = nodes.filter((node) => node.parentId !== folderId)
  if (outside.length) await moveFileNodes(userId, outside.map((node) => ({ id: node.id, parentId: folderId })))
  await mutateFileTree(userId, async (tx) => {
    const chatFolder = await chatFolderId(tx, userId, folderId)
    if (chatIds.length) {
      await tx.update(chats).set({ folderId: chatFolder, inFilesRoot: false, pinned: false, sortOrder: listPosition(ids, chats.id) })
        .where(and(eq(chats.userId, userId), inArray(chats.id, chatIds)))
    }
    if (nodeIds.length) {
      await tx.update(fileNodes).set({ pinned: false, sortOrder: listPosition(ids, fileNodes.id) })
        .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, nodeIds)))
    }
  }, ['files', 'folders', 'chats'])
}

/** The account's live, ready Files items among `ids`; throws unless every one of them is. */
async function requireLiveNodes(executor: FileExecutor, userId: string, ids: readonly string[]) {
  if (!ids.length) return []
  const nodes = await executor.select({ id: fileNodes.id, parentId: fileNodes.parentId, systemRole: fileNodes.systemRole, pinned: fileNodes.pinned })
    .from(fileNodes)
    .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, [...ids]), isNull(fileNodes.trashedAt), eq(fileNodes.status, 'ready')))
  if (nodes.length !== new Set(ids).size) throw notFound('File')
  return nodes
}

const sidebarFolderNotPinnable = () =>
  new AppError(400, 'file_system_folder', 'The Sidebar folder is the sidebar itself and cannot be pinned to it')

/**
 * Pins chats and Files items after those already pinned, in the order given, or unpins them, each
 * back to the top of its folder (unfiled chats to the top of the sidebar). Items stay where they
 * are in Files either way.
 */
export async function pinSidebarItems(userId: string, ids: string[], pinned: boolean): Promise<void> {
  const chatIds = await liveChatIds(db, userId, ids)
  const nodeIds = ids.filter((id) => !chatIds.has(id))
  await mutateFileTree(userId, async (tx) => {
    const nodes = await requireLiveNodes(tx, userId, nodeIds)
    if (!pinned) {
      await unpinInTx(tx, userId, ids, chatIds)
      return
    }
    if (nodes.some((node) => node.systemRole === 'chats')) throw sidebarFolderNotPinnable()
    const alreadyPinned = new Set([
      ...nodes.filter((node) => node.pinned).map((node) => node.id),
      ...chatIds.size ? (await tx.select({ id: chats.id }).from(chats).where(and(inArray(chats.id, [...chatIds]), eq(chats.pinned, true)))).map((row) => row.id) : [],
    ])
    let sortOrder = await pinnedEndOrder(tx, userId)
    for (const id of ids) {
      if (alreadyPinned.has(id)) continue
      if (chatIds.has(id)) await tx.update(chats).set({ pinned: true, sortOrder: sortOrder++ }).where(eq(chats.id, id))
      else await tx.update(fileNodes).set({ pinned: true, sortOrder: sortOrder++ }).where(eq(fileNodes.id, id))
    }
  }, chatIds.size ? ['files', 'folders', 'chats'] : ['files', 'folders'])
}

/**
 * Sets the order of the sidebar's pinned list, chats included. Listed items not yet pinned are
 * pinned where they are; items not listed keep their place.
 */
export async function orderPinnedItems(userId: string, ids: string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new AppError(400, 'validation_error', 'The order cannot list an item twice')
  const chatIds = [...await liveChatIds(db, userId, ids)]
  const nodeIds = ids.filter((id) => !chatIds.includes(id))
  await mutateFileTree(userId, async (tx) => {
    const nodes = await requireLiveNodes(tx, userId, nodeIds)
    if (nodes.some((node) => node.systemRole === 'chats')) throw sidebarFolderNotPinnable()
    if (chatIds.length) {
      await tx.update(chats).set({ pinned: true, sortOrder: listPosition(ids, chats.id) })
        .where(and(eq(chats.userId, userId), inArray(chats.id, chatIds)))
    }
    if (nodeIds.length) {
      await tx.update(fileNodes).set({ pinned: true, sortOrder: listPosition(ids, fileNodes.id) })
        .where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, nodeIds)))
    }
  }, chatIds.length ? ['files', 'folders', 'chats'] : ['files', 'folders'])
}

/** Renames an item (a taken name gets a " (n)" suffix) or changes its color and icon. */
export async function updateSidebarItem(userId: string, id: string, input: UpdateSidebarItem): Promise<FileNode> {
  return updateFileNode(userId, id, { ...input, onConflict: 'rename' })
}

/** Trashes an item (restorable from Files). Chats in a trashed folder return to the unfiled list. */
export async function trashSidebarItem(userId: string, id: string): Promise<void> {
  await trashFileNodes(userId, [id])
}

/** Moves chats and Files items into the Archive folder, unpinning them. */
export async function archiveItems(userId: string, input: { chatIds: string[]; fileIds: string[] }): Promise<{ archiveFolderId: string }> {
  const { archiveFolderId } = await ensureSystemFolders(userId)
  const chatIds = [...await liveChatIds(db, userId, [...input.chatIds, ...input.fileIds])]
  const fileIds = input.fileIds.filter((id) => !chatIds.includes(id))
  if (chatIds.length) {
    await mutateFileTree(userId, async (tx) => {
      await tx.update(chats).set({ folderId: archiveFolderId, inFilesRoot: false, pinned: false, sortOrder: await topSortOrder(tx, userId, archiveFolderId) })
        .where(and(eq(chats.userId, userId), inArray(chats.id, chatIds), isNull(chats.deletedAt), accessibleChatCondition()))
    }, ['files', 'folders', 'chats'])
  }
  if (fileIds.length) {
    await unpinBeforePlacing(userId, fileIds)
    await moveFileNodes(userId, fileIds.map((id) => ({ id, parentId: archiveFolderId })))
  }
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
