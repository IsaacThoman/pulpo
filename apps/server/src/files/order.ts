import { sql } from 'drizzle-orm'
import type { FileExecutor } from './access.js'

/*
 * Chats and Files items in a folder share one manual order: `sort_order` ascending, newest first
 * on ties. Chats with no folder sit in the account's Chats folder. New and moved items go to the
 * top, above everything already there.
 */

/** Chats listed in `parentId`: those filed there, plus the unfiled ones when it is the Chats folder. */
const chatsIn = (userId: string, parentId: string) => sql`
  c.user_id = ${userId} and not c.pinned and not c.temporary and c.deleted_at is null
  and (c.folder_id = ${parentId}::uuid or (c.folder_id is null and not c.in_files_root and exists (
    select 1 from file_nodes f where f.id = ${parentId}::uuid and f.owner_user_id = ${userId} and f.system_role = 'chats'
  )))`

/** Chats at the top of My files. */
const rootChats = (userId: string) => sql`
  c.user_id = ${userId} and c.in_files_root and not c.pinned and not c.temporary and c.deleted_at is null`

/** The order that puts an item at the top of `parentId` (null is the top of My files). */
export async function topSortOrder(executor: FileExecutor, userId: string, parentId: string | null): Promise<number> {
  const rows = await executor.execute<{ top: number }>(sql`
    select (coalesce(least(
      (select min(sort_order) from file_nodes
        where owner_user_id = ${userId} and parent_id is not distinct from ${parentId}::uuid and trashed_at is null),
      (select min(c.sort_order) from chats c where ${parentId ? chatsIn(userId, parentId) : rootChats(userId)})
    ), 1) - 1)::int as top
  `)
  return Number(rows[0]?.top ?? 0)
}

/** The order that puts a chat at the top of folder `folderId`, or of the unfiled chats (null). */
export async function topChatOrder(executor: FileExecutor, userId: string, folderId: string | null): Promise<number> {
  if (folderId) return topSortOrder(executor, userId, folderId)
  const rows = await executor.execute<{ id: string }>(sql`
    select id::text as id from file_nodes where owner_user_id = ${userId} and system_role = 'chats' limit 1
  `)
  if (rows[0]) return topSortOrder(executor, userId, rows[0].id)
  // Before the Chats folder exists, only chats are there.
  const fallback = await executor.execute<{ top: number }>(sql`
    select (coalesce(min(c.sort_order), 1) - 1)::int as top from chats c
    where c.user_id = ${userId} and c.folder_id is null and not c.in_files_root and not c.pinned and not c.temporary and c.deleted_at is null
  `)
  return Number(fallback[0]?.top ?? 0)
}
