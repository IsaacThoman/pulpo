import { z } from 'zod'
import { fileNodeSchema } from './files.js'

/**
 * How long trashed items stay recoverable. One setting covers chats and Files items; Files items
 * are kept at least `MIN_FILE_TRASH_RETENTION_MS`, so "No retention" only applies to chats.
 */
export const TRASH_RETENTION_VALUES = ['instant', '24h', '7d', '30d', '90d', 'indefinite'] as const
export const trashRetentionSchema = z.enum(TRASH_RETENTION_VALUES)
export type TrashRetention = z.infer<typeof trashRetentionSchema>
export const DEFAULT_TRASH_RETENTION: TrashRetention = '30d'

export const MIN_FILE_TRASH_RETENTION_MS = 24 * 60 * 60 * 1_000

/**
 * One entry in the account's trash: a Files item, or a chat (`kind: 'chat'`). Trashed folders are
 * listed once and restore or delete with their contents. `purgeAt` is null while the retention
 * setting keeps items indefinitely.
 */
export const trashItemSchema = fileNodeSchema.extend({
  trashedAt: z.string(),
  purgeAt: z.string().nullable(),
})
export type TrashItem = z.infer<typeof trashItemSchema>

export const trashListingSchema = z.object({
  /** Newest first. */
  items: z.array(trashItemSchema),
  retention: trashRetentionSchema,
  /** Whether Files items are included (Files can be turned off by the administrator). */
  files: z.boolean(),
})
export type TrashListing = z.infer<typeof trashListingSchema>
