import { and, eq, isNull } from 'drizzle-orm'
import type { FileFolderLayout, UpdateFileFolderLayout } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileFolderLayouts, fileNodes } from '../database/schema.js'
import { notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { resolveFileAccess, type FileExecutor } from './access.js'
import { mutateFileTree } from './tree-service.js'

async function assertFolder(executor: FileExecutor, userId: string, folderId: string | null): Promise<void> {
  if (!folderId) return
  const access = await resolveFileAccess(executor, userId, folderId)
  if (!access || access.node.kind !== 'folder' || access.node.trashedAt) throw notFound('Folder')
}

function layoutWhere(userId: string, folderId: string | null) {
  return and(eq(fileFolderLayouts.ownerUserId, userId), folderId ? eq(fileFolderLayouts.folderId, folderId) : isNull(fileFolderLayouts.folderId))
}

/** A folder's grid arrangement; folders never arranged snap to the grid with no positions. */
export async function getFolderLayout(userId: string, folderId: string | null): Promise<FileFolderLayout> {
  await assertFolder(db, userId, folderId)
  const [row] = await db.select().from(fileFolderLayouts).where(layoutWhere(userId, folderId)).limit(1)
  return { folderId, snapToGrid: row?.snapToGrid ?? true, positions: row?.positions ?? {} }
}

/**
 * Merges position changes (null forgets one) and the snap setting into a folder's layout. Places
 * of items that have since left the folder are dropped, so the layout stays the folder's size.
 */
export async function updateFolderLayout(userId: string, input: ReturnType<typeof normalizeInput>): Promise<FileFolderLayout> {
  return mutateFileTree(userId, async (tx) => {
    await assertFolder(tx, userId, input.folderId)
    const [row] = await tx.select().from(fileFolderLayouts).where(layoutWhere(userId, input.folderId)).limit(1)
    const children = await tx.select({ id: fileNodes.id }).from(fileNodes).where(and(
      eq(fileNodes.ownerUserId, userId),
      input.folderId ? eq(fileNodes.parentId, input.folderId) : isNull(fileNodes.parentId),
      isNull(fileNodes.trashedAt),
    ))
    const live = new Set(children.map((child) => child.id))
    const positions: Record<string, { x: number; y: number }> = {}
    for (const [id, position] of Object.entries({ ...row?.positions, ...input.positions })) {
      if (position && live.has(id)) positions[id] = { x: position.x, y: position.y }
    }
    const snapToGrid = input.snapToGrid ?? row?.snapToGrid ?? true
    if (row) {
      await tx.update(fileFolderLayouts).set({ positions, snapToGrid, updatedAt: new Date() }).where(eq(fileFolderLayouts.id, row.id))
    } else {
      // The account's Files lock serializes writers, so two sessions cannot both insert.
      await tx.insert(fileFolderLayouts).values({ id: newId(), ownerUserId: userId, folderId: input.folderId, positions, snapToGrid })
    }
    return { folderId: input.folderId, snapToGrid, positions }
  })
}

export function normalizeInput(input: UpdateFileFolderLayout) {
  return { folderId: input.folderId, snapToGrid: input.snapToGrid, positions: input.positions ?? {} }
}
