import { z } from 'zod'

export const SIGNUP_PROMO_CLAIM_DAYS = 7
export const SIGNUP_PROMO_CLAIM_MS = SIGNUP_PROMO_CLAIM_DAYS * 24 * 60 * 60 * 1_000
export const SIGNUP_PROMO_MAX_CENTS = 1_000_000
export const SIGNUP_PROMO_MESSAGE_MAX = 300

const amountSchema = z.number().int().min(1).max(SIGNUP_PROMO_MAX_CENTS)

export const signupPromoConfigSchema = z.object({
  enabled: z.boolean(),
  amountCents: amountSchema,
  dailyCapCents: amountSchema,
  message: z.string().trim().max(SIGNUP_PROMO_MESSAGE_MAX),
}).refine((config) => config.dailyCapCents >= config.amountCents, {
  path: ['dailyCapCents'],
  message: 'The daily cap must cover at least one claim',
})

export type SignupPromoConfig = z.infer<typeof signupPromoConfigSchema>
export type SignupPromoOffer = Pick<SignupPromoConfig, 'amountCents' | 'message'>
export interface SignupPromoAvailability { userId: string; offer: SignupPromoOffer | null }
export interface SignupPromoAdminSettings extends SignupPromoConfig { claimedTodayCents: number }

export const signupPromoClaimSchema = z.object({
  userId: z.uuid(),
  amountCents: amountSchema,
})

export interface SignupPromoReceipt { amountCents: number }
