import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { DEFAULT_FILE_ACCESS_MODE, FILE_SCOPE_ROOT, fileAccessModeSchema, fileReferenceIds, MAX_CHAT_FILE_SCOPES, type FileAccessMode } from '@pulpo/contracts'
import type { FileExecutor } from '../files/access.js'
import { db } from '../database/client.js'
import { chats, fileNodes, userPreferences } from '../database/schema.js'
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

/** What the agent may change in Files in a new chat: the account's choice, else suggestions. */
export async function defaultFileChangeMode(userId: string): Promise<FileAccessMode> {
  const [row] = await db.select({ values: userPreferences.values }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1)
  return fileAccessModeSchema.safeParse((row?.values as Record<string, unknown> | undefined)?.agentFileChangeMode).data ?? DEFAULT_FILE_ACCESS_MODE
}

/**
 * The chat's scope after a message that links to Files items: the owner's live items it links to
 * are added, so the agent may work with them in this chat. Past the limit, the oldest entries make
 * room. Undefined when nothing changes.
 */
export async function scopeWithMessageReferences(executor: FileExecutor, userId: string, scopeIds: readonly string[], text: string): Promise<string[] | undefined> {
  const linked = fileReferenceIds(text).filter((id) => !scopeIds.includes(id))
  if (!linked.length) return undefined
  const found = new Set((await executor.select({ id: fileNodes.id }).from(fileNodes).where(and(
    inArray(fileNodes.id, linked),
    eq(fileNodes.ownerUserId, userId),
    eq(fileNodes.status, 'ready'),
    isNull(fileNodes.trashedAt),
    ne(fileNodes.kind, 'shortcut'),
  ))).map((row) => row.id))
  const added = linked.filter((id) => found.has(id))
  if (!added.length) return undefined
  const next = [...scopeIds, ...added]
  while (next.length > MAX_CHAT_FILE_SCOPES) {
    const oldest = next.findIndex((id) => id !== FILE_SCOPE_ROOT)
    next.splice(oldest, 1)
  }
  return next
}
