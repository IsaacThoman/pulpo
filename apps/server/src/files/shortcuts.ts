import { and, eq, inArray } from 'drizzle-orm'
import { FILE_NAME_MAX_LENGTH, type FileNode, type FileSystemRole } from '@pulpo/contracts'
import { chats, fileNodes } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { resolveFileAccess, type FileExecutor, type FileNodeRow } from './access.js'
import { liveChatIds } from './chat-items.js'
import { ensureSystemFolders } from './system-folders.js'
import { assertDestination, availableName, mutateFileTree, toFileNode } from './tree-service.js'
import { topSortOrder } from './order.js'

type Target = NonNullable<FileNode['target']>

/** What each shortcut among `rows` opens, by shortcut id. Targets the account no longer has are missing. */
export async function shortcutTargets(executor: FileExecutor, userId: string, rows: readonly FileNodeRow[]): Promise<Map<string, Target>> {
  const shortcuts = rows.filter((row) => row.kind === 'shortcut')
  const result = new Map<string, Target>()
  if (!shortcuts.length) return result
  const nodeIds = shortcuts.map((row) => row.targetNodeId).filter((id): id is string => Boolean(id))
  const chatIds = shortcuts.map((row) => row.targetChatId).filter((id): id is string => Boolean(id))
  const nodes = nodeIds.length
    ? await executor.select().from(fileNodes).where(and(eq(fileNodes.ownerUserId, userId), inArray(fileNodes.id, nodeIds)))
    : []
  const chatRows = chatIds.length
    ? await executor.select({ id: chats.id, title: chats.title, deletedAt: chats.deletedAt }).from(chats)
      .where(and(eq(chats.userId, userId), inArray(chats.id, chatIds)))
    : []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const chatById = new Map(chatRows.map((chat) => [chat.id, chat]))
  for (const row of shortcuts) {
    if (row.targetChatId) {
      const chat = chatById.get(row.targetChatId)
      if (chat) result.set(row.id, { kind: 'chat', id: chat.id, name: chat.title, mimeType: null, systemRole: null, available: !chat.deletedAt })
      continue
    }
    const node = row.targetNodeId ? nodeById.get(row.targetNodeId) : undefined
    if (node && node.kind !== 'shortcut') {
      result.set(row.id, {
        kind: node.kind as Target['kind'],
        id: node.id,
        name: node.name,
        mimeType: node.mimeType,
        systemRole: (node.systemRole as FileSystemRole | null) ?? null,
        available: !node.trashedAt && node.status === 'ready',
      })
    }
  }
  return result
}

/** `toFileNode` for a listing, with shortcut targets resolved. */
export async function toFileNodes(executor: FileExecutor, userId: string, rows: readonly FileNodeRow[]): Promise<FileNode[]> {
  const targets = await shortcutTargets(executor, userId, rows)
  return rows.map((row) => ({ ...toFileNode(row), ...(row.kind === 'shortcut' ? { target: targets.get(row.id) ?? null } : {}) }))
}

/** A Files name from any title: characters Files rejects become "-", and long titles are cut. */
function shortcutName(name: string): string {
  const cleaned = [...name]
    .map((character) => character === '/' || character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f ? '-' : character)
    .slice(0, FILE_NAME_MAX_LENGTH)
    .join('')
    .trim()
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'Shortcut'
}

/**
 * Creates a shortcut to a Files item or a chat in `parentId` (null is the top of My files), or in
 * the Chats folder (the top of the sidebar) when it is omitted. It takes the target's name unless given one, keeping both
 * names on a clash the way moves do.
 */
export async function createShortcut(userId: string, input: {
  targetKind: 'file' | 'chat'
  targetId: string
  parentId?: string | null
  name?: string
}): Promise<FileNode> {
  const parentId = input.parentId === undefined ? (await ensureSystemFolders(userId)).chatsFolderId : input.parentId
  return mutateFileTree(userId, async (tx) => {
    let targetName: string
    if (input.targetKind === 'chat') {
      if (!(await liveChatIds(tx, userId, [input.targetId])).size) throw notFound('Chat')
      const [chat] = await tx.select({ title: chats.title }).from(chats).where(eq(chats.id, input.targetId))
      targetName = chat!.title
    } else {
      const access = await resolveFileAccess(tx, userId, input.targetId)
      if (!access || access.node.trashedAt || access.node.status !== 'ready') throw notFound('File')
      if (access.node.kind === 'shortcut') throw new AppError(400, 'file_shortcut_to_shortcut', 'Create a shortcut to the item this shortcut opens instead')
      targetName = access.node.name
    }
    await assertDestination(tx, userId, parentId)
    const [created] = await tx.insert(fileNodes).values({
      id: newId(),
      ownerUserId: userId,
      parentId,
      kind: 'shortcut',
      name: await availableName(tx, userId, parentId, shortcutName(input.name ?? targetName)),
      targetNodeId: input.targetKind === 'file' ? input.targetId : null,
      targetChatId: input.targetKind === 'chat' ? input.targetId : null,
      sortOrder: await topSortOrder(tx, userId, parentId),
    }).returning()
    return (await toFileNodes(tx, userId, [created!]))[0]!
  })
}
