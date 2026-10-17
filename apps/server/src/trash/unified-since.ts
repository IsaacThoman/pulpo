import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'

/**
 * When chats and Files started sharing one trash. Files items trashed before then keep the 30 days
 * Files gave them (see `filePurgeAtFor`). Migration 0102 records it; the server keeps it, so
 * admins cannot change it.
 */
export const UNIFIED_TRASH_SINCE_KEY = 'unifiedTrashSince'

/** The recorded time; until one is recorded, now, so nothing trashed so far loses its 30 days. */
export async function getUnifiedTrashSince(): Promise<Date> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, UNIFIED_TRASH_SINCE_KEY))
  const since = typeof row?.value === 'string' ? new Date(row.value) : null
  return since && !Number.isNaN(since.getTime()) ? since : new Date()
}

/**
 * Records now when the time is missing: the worker can clean up before the API has run migration
 * 0102, and restoring a backup from before it removes the setting. Run before purging.
 */
export async function ensureUnifiedTrashSince(): Promise<void> {
  await db.insert(applicationSettings).values({ key: UNIFIED_TRASH_SINCE_KEY, value: new Date().toISOString() }).onConflictDoNothing()
}
