import { z } from 'zod'

export const DEFAULT_BALANCE_MICROS = 5_000_000

export const authSettingsSchema = z.object({
  signupEnabled: z.boolean().default(true),
  defaultBalanceMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(DEFAULT_BALANCE_MICROS),
  pendingDetails: z.boolean().default(true),
  adminEmail: z.union([z.literal(''), z.email()]).default(''),
  pendingMessage: z.string().max(2_000).default('Your account is pending approval. An admin will review it shortly.'),
})

export type AuthSettings = z.infer<typeof authSettingsSchema>

export function parseAuthSettings(value: unknown): AuthSettings {
  const parsed = authSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : authSettingsSchema.parse({})
}
