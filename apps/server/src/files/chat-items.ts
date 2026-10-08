import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { FileNode } from '@pulpo/contracts'
import { chats, fileNodes } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { accessibleChatCondition } from '../chats/temporary.js'
import { resolveFileAccess, type FileExecutor, type FileNodeRow } from './access.js'
import { topChatOrder } from './order.js'

type ChatRow = typeof chats.$inferSelect

/**
 * Chats filed in Files folders are listed as `chat` items. A chat with no folder sits directly
 * in the Chats folder, which is the sidebar's unfiled list.
 */
export function chatToFileNode(chat: Pick<ChatRow, 'id' | 'folderId' | 'title' | 'sortOrder' | 'createdAt' | 'updatedAt'>, chatsFolderId: string | null): FileNode {
  return {
    id: chat.id,
    parentId: chat.folderId ?? chatsFolderId,
    kind: 'chat',
    name: chat.title,
    status: 'ready',
    mimeType: null,
    sizeBytes: 0,
    revision: 0,
    trashedAt: null,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    systemRole: null,
    sortOrder: chat.sortOrder,
  }
}

const liveChat = (userId: string) => and(
  eq(chats.userId, userId),
  isNull(chats.deletedAt),
  eq(chats.temporary, false),
  accessibleChatCondition(),
)

/** The chats inside `folder` (none at the top of My files). */
export async function listFolderChats(executor: FileExecutor, userId: string, folder: FileNodeRow | null): Promise<FileNode[]> {
  if (!folder) return []
  const rows = await executor.select().from(chats).where(and(
    liveChat(userId),
    folder.systemRole === 'chats' ? or(eq(chats.folderId, folder.id), isNull(chats.folderId)) : eq(chats.folderId, folder.id),
  ))
  return rows.map((chat) => chatToFileNode(chat, folder.systemRole === 'chats' ? folder.id : null))
}

/** Which of `ids` are the account's live chats rather than Files items. */
export async function liveChatIds(executor: FileExecutor, userId: string, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await executor.select({ id: chats.id }).from(chats).where(and(liveChat(userId), inArray(chats.id, [...new Set(ids)])))
  return new Set(rows.map((row) => row.id))
}

/**
 * The `chats.folder_id` for filing a chat in `parentId`: a live folder the account owns. The
 * Chats folder and the top of My files both mean the sidebar's unfiled list (null).
 */
export async function chatFolderId(executor: FileExecutor, userId: string, parentId: string | null): Promise<string | null> {
  if (!parentId) return null
  const access = await resolveFileAccess(executor, userId, parentId)
  if (!access || access.node.trashedAt || access.node.status !== 'ready') throw notFound('Folder')
  if (access.node.kind !== 'folder') throw new AppError(400, 'file_parent_not_folder', 'Items can only be placed in folders')
  return access.node.systemRole === 'chats' ? null : access.node.id
}

/** Files chats into folders. Returns them as items, as they now appear in Files. */
export async function moveChatsInTx(executor: FileExecutor, userId: string, items: Array<{ id: string; parentId: string | null }>, chatsFolderId: string | null): Promise<FileNode[]> {
  const moved: FileNode[] = []
  for (const item of items) {
    const folderId = await chatFolderId(executor, userId, item.parentId)
    const [row] = await executor.update(chats).set({ folderId, sortOrder: await topChatOrder(executor, userId, folderId) }).where(and(eq(chats.id, item.id), liveChat(userId))).returning()
    if (!row) throw notFound('Chat')
    moved.push(chatToFileNode(row, chatsFolderId))
  }
  return moved
}

/** The account's Chats folder, if it has been created. */
export async function chatsFolderIdOf(executor: FileExecutor, userId: string): Promise<string | null> {
  const [row] = await executor.select({ id: fileNodes.id }).from(fileNodes)
    .where(and(eq(fileNodes.ownerUserId, userId), eq(fileNodes.systemRole, 'chats'))).limit(1)
  return row?.id ?? null
}
