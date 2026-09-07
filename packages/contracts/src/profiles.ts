import { z } from 'zod'

export const dataProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
})
export const dataProfileSchema = dataProfileInputSchema.extend({
  id: z.uuid(),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type DataProfile = z.infer<typeof dataProfileSchema>
export interface ProfileList { profiles: DataProfile[]; defaultProfileId: string }
