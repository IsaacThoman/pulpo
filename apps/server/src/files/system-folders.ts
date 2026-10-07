import { and, eq, isNull, sql } from 'drizzle-orm'
import { nextAvailableName, type FileSystemRole } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileNodes, sidebarShortcuts } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import type { FileExecutor } from './access.js'
import { liveSiblingNames, mutateFileTree } from './tree-service.js'

export interface SystemFolderIds {
  chatsFolderId: string
  archiveFolderId: string
}

const SYSTEM_FOLDER_NAMES: Record<FileSystemRole, string> = { chats: 'Chats', archive: 'Archive' }

async function existingSystemFolders(executor: FileExecutor, userId: string): Promise<Partial<Record<FileSystemRole, string>>> {
  const rows = await executor.select({ id: fileNodes.id, role: fileNodes.systemRole }).from(fileNodes)
    .where(and(eq(fileNodes.ownerUserId, userId), sql`${fileNodes.systemRole} is not null`))
  return Object.fromEntries(rows.map((row) => [row.role, row.id]))
}

/**
 * Every account has a Chats folder (the sidebar's folders live in it) and an Archive folder at the
 * top of My files. They are created the first time they are needed; a live top-level folder that
 * already has the name is adopted instead of getting a "(2)" twin. A new Archive also gets a
 * sidebar shortcut, so archived chats stay reachable from the sidebar.
 */
export async function ensureSystemFolders(userId: string): Promise<SystemFolderIds> {
  const existing = await existingSystemFolders(db, userId)
  if (existing.chats && existing.archive) return { chatsFolderId: existing.chats, archiveFolderId: existing.archive }
  return mutateFileTree(userId, async (tx) => {
    const current = await existingSystemFolders(tx, userId)
    for (const role of ['chats', 'archive'] as const) {
      if (current[role]) continue
      const name = SYSTEM_FOLDER_NAMES[role]
      const [adopted] = await tx.update(fileNodes).set({ systemRole: role, updatedAt: new Date() }).where(and(
        eq(fileNodes.ownerUserId, userId),
        isNull(fileNodes.parentId),
        isNull(fileNodes.trashedAt),
        isNull(fileNodes.systemRole),
        eq(fileNodes.kind, 'folder'),
        eq(fileNodes.status, 'ready'),
        sql`lower(${fileNodes.name}) = ${name.toLowerCase()}`,
      )).returning({ id: fileNodes.id })
      if (adopted) {
        current[role] = adopted.id
      } else {
        const id = newId()
        await tx.insert(fileNodes).values({
          id, ownerUserId: userId, parentId: null, kind: 'folder', systemRole: role,
          name: nextAvailableName(name, await liveSiblingNames(tx, userId, null)),
        })
        current[role] = id
      }
      if (role === 'archive') {
        const [last] = await tx.select({ order: sql<number>`coalesce(max(${sidebarShortcuts.sortOrder}), -1)::int` })
          .from(sidebarShortcuts).where(eq(sidebarShortcuts.userId, userId))
        await tx.insert(sidebarShortcuts).values({
          id: newId(), userId, targetKind: 'file', fileNodeId: current[role], sortOrder: (last?.order ?? -1) + 1,
        }).onConflictDoNothing()
      }
    }
    return { chatsFolderId: current.chats!, archiveFolderId: current.archive! }
  }, ['files', 'folders'])
}
