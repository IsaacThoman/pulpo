import { z } from 'zod'

export const composerDraftIdSchema = z.union([z.literal('new'), z.uuid()])
export const composerAttachmentSchema = z.object({
  id: z.uuid(), name: z.string().max(1024), mimeType: z.string().max(255), size: z.number().int().nonnegative(),
})
export const composerStateSchema = z.object({
  content: z.string().max(1_000_000),
  attachments: z.array(composerAttachmentSchema).max(100),
  model: z.object({ id: z.string().max(256), presets: z.record(z.string().max(256), z.string().max(256)) }).nullable(),
  agentMode: z.boolean(), temporary: z.boolean(), autoExpire: z.boolean(),
})
export const composerSnapshotSchema = z.object({
  draftId: composerDraftIdSchema,
  revision: z.number().int().nonnegative(),
  clearedRevision: z.number().int().nonnegative(),
  state: composerStateSchema,
  mutationId: z.string().nullable(),
})
export const composerWriteSchema = z.object({
  draftId: composerDraftIdSchema,
  baseRevision: z.number().int().nonnegative(),
  mutationId: z.string().min(1).max(128),
  patch: composerStateSchema.partial(),
  clear: z.boolean().optional(),
})
export type ComposerState = z.infer<typeof composerStateSchema>
export type ComposerSnapshot = z.infer<typeof composerSnapshotSchema>
export type ComposerWrite = z.infer<typeof composerWriteSchema>
export type ComposerAck = { ok: true; snapshot: ComposerSnapshot; conflict?: boolean } | { ok: false; error: string }
export function emptyComposerState(): ComposerState {
  return { content: '', attachments: [], model: null, agentMode: true, temporary: false, autoExpire: false }
}
