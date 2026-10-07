import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { FILE_SCOPE_ROOT } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { fileNodes } from '../database/schema.js'
import { AppError } from '../lib/errors.js'

/**
 * Rejects a chat Files scope unless every entry is the root or a live file or folder the user
 * owns. Scopes are checked when they are set; items trashed later simply stop resolving.
 */
export async function assertFileScope(userId: string, scopeIds: readonly string[]): Promise<void> {
  const nodeIds = scopeIds.filter((id) => id !== FILE_SCOPE_ROOT)
  if (nodeIds.length === 0) return
  const found = await db.select({ id: fileNodes.id }).from(fileNodes).where(and(
    inArray(fileNodes.id, nodeIds),
    eq(fileNodes.ownerUserId, userId),
    eq(fileNodes.status, 'ready'),
    isNull(fileNodes.trashedAt),
    // A shortcut is not content; scope the item it opens instead.
    ne(fileNodes.kind, 'shortcut'),
  ))
  if (found.length !== nodeIds.length) {
    throw new AppError(400, 'invalid_file_scope', 'Choose items from your files')
  }
}
