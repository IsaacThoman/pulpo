import { z } from 'zod'
import { composerAttachmentSchema } from './composer.js'

export const shelfContentSchema = z.object({
  content: z.string().max(1_000_000),
  attachmentIds: z.array(z.uuid()).max(100),
})
export const shelvedDraftSchema = z.object({
  id: z.uuid(), content: z.string(), attachments: z.array(composerAttachmentSchema),
  position: z.number().int(), revision: z.number().int().nonnegative(),
  createdAt: z.string(), updatedAt: z.string(),
})
const savedDraft = shelfContentSchema.extend({ id: z.uuid() })
export const shelfMutationSchema = z.object({
  operationId: z.uuid(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('save'), draft: savedDraft }),
    z.object({ type: z.literal('restore'), id: z.uuid(), replacement: savedDraft.optional() }),
    z.object({ type: z.literal('delete'), id: z.uuid() }),
    z.object({ type: z.literal('reorder'), id: z.uuid(), targetId: z.uuid(), edge: z.enum(['before', 'after']) }),
  ]),
})
export type ShelvedDraft = z.infer<typeof shelvedDraftSchema>
export type ShelfMutation = z.infer<typeof shelfMutationSchema>
export interface ShelfSnapshot { revision: number; drafts: ShelvedDraft[] }
