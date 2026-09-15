import { z } from 'zod'
import { chargeCentsForCredits, MAX_TOP_UP_CENTS, MIN_TOP_UP_CENTS } from './plans.js'

export const AUTO_TOP_UP_DEFAULTS = { enabled: false, thresholdCents: 500, creditCents: 2500, monthlyLimitCents: 10000 }
export const ACTIVE_TOP_UP_STATUSES = ['creating', 'ready', 'paying']
export const autoTopUpInputSchema = z.object({
  enabled: z.boolean(),
  thresholdCents: z.number().int().positive().max(MAX_TOP_UP_CENTS),
  creditCents: z.number().int().min(MIN_TOP_UP_CENTS).max(MAX_TOP_UP_CENTS),
  monthlyLimitCents: z.number().int().positive().max(2_147_483_647),
  revision: z.number().int().nonnegative(),
  consent: z.boolean().default(false),
  resume: z.boolean().default(false),
}).refine(v => v.thresholdCents <= v.creditCents, { message: 'Threshold must not exceed the top-up amount', path: ['thresholdCents'] })
  .refine(v => !Number.isInteger(v.creditCents) || v.creditCents < MIN_TOP_UP_CENTS || v.creditCents > MAX_TOP_UP_CENTS || v.monthlyLimitCents >= chargeCentsForCredits(v.creditCents), { message: 'Monthly limit must cover a top-up including fees', path: ['monthlyLimitCents'] })

export function utcMonth(now = new Date()) {
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }
}
export function topUpFits(limit: number, charged: number, pending: number, amount: number) {
  return amount >= 0 && charged + pending + amount <= limit
}
export function belowTopUpThreshold(balanceMicros: number, pendingMicros: number, thresholdCents: number) {
  return Math.max(0, balanceMicros - pendingMicros) < thresholdCents * 10_000
}
