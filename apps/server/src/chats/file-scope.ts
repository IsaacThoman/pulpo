import { and, eq, inArray, isNull } from 'drizzle-orm'
import { FILE_SCOPE_ROOT } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileNodes } from '../database/schema.js'
import { AppError } from '../lib/errors.js'

/**
 * Rejects a chat Files scope unless every entry is the root or a live folder the user owns.
 * Scopes are checked when they are set; folders trashed later simply stop resolving.
 */
export async function assertFileScope(userId: string, scopeIds: readonly string[]): Promise<void> {
  const folderIds = scopeIds.filter((id) => id !== FILE_SCOPE_ROOT)
  if (folderIds.length === 0) return
  const found = await db.select({ id: fileNodes.id }).from(fileNodes).where(and(
    inArray(fileNodes.id, folderIds),
    eq(fileNodes.ownerUserId, userId),
    eq(fileNodes.kind, 'folder'),
    isNull(fileNodes.trashedAt),
  ))
  if (found.length !== folderIds.length) {
    throw new AppError(400, 'invalid_file_scope', 'Choose folders from your files')
  }
}
