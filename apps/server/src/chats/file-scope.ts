import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { FILE_SCOPE_ROOT, type FileAccessMode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, fileNodes } from '../database/schema.js'
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

/** Keeps the access modes of entries still in the scope; entries without one use the default. */
export function scopedFileAccess(scopeIds: readonly string[], access: Readonly<Record<string, string>>): Record<string, FileAccessMode> {
  const ids = new Set(scopeIds)
  return Object.fromEntries(Object.entries(access).filter((entry): entry is [string, FileAccessMode] => (
    ids.has(entry[0]) && (entry[1] === 'read' || entry[1] === 'suggest' || entry[1] === 'write')
  )))
}

/**
 * A chat's access modes after a scope change, as an UPDATE value: the stored modes merged with
 * `patch`, kept only for entries in the new scope (`scopeIds`, or the stored one). Reading the
 * stored modes in the UPDATE itself means two close changes cannot drop each other's modes.
 */
export function mergedFileAccessSql(scopeIds: readonly string[] | undefined, patch: Readonly<Record<string, FileAccessMode>>): SQL {
  const ids = scopeIds ? sql`${JSON.stringify(scopeIds)}::jsonb` : sql`${chats.fileScopeIds}`
  return sql`(
    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    from jsonb_each(${chats.fileScopeAccess} || ${JSON.stringify(patch)}::jsonb) as entry
    where entry.key in (select jsonb_array_elements_text(${ids}))
  )`
}
