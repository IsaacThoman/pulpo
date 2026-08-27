export const BILLING_PLANS = ['baby', 'eight', 'fat'] as const
export type BillingPlan = typeof BILLING_PLANS[number]
export type PaidBillingPlan = Exclude<BillingPlan, 'baby'>

export const PLAN_MONTHLY_PRICE_CENTS: Record<PaidBillingPlan, number> = {
  eight: 800,
  fat: 2_400,
}

export const PLAN_MONTHLY_CREDIT_MICROS: Record<PaidBillingPlan, number> = {
  eight: 2_000_000,
  fat: 16_000_000,
}

export const MIN_TOP_UP_CENTS = 500
export const MAX_TOP_UP_CENTS = 50_000
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000

export function chargeCentsForCredits(creditCents: number): number {
  if (!Number.isSafeInteger(creditCents) || creditCents < MIN_TOP_UP_CENTS || creditCents > MAX_TOP_UP_CENTS) {
    throw new Error(`Credit amount must be between ${MIN_TOP_UP_CENTS} and ${MAX_TOP_UP_CENTS} cents`)
  }
  return Math.ceil((creditCents + 50) / 0.95)
}

export function utcWeekStart(value = new Date()): Date {
  const date = new Date(value)
  const day = date.getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday))
}

export function utcWeekEnd(value = new Date()): Date {
  return new Date(utcWeekStart(value).getTime() + 7 * 24 * 60 * 60 * 1_000)
}

export function fiveHourEnd(periodStart: Date): Date {
  return new Date(periodStart.getTime() + FIVE_HOURS_MS)
}

export function remainingPercentage(limitMicros: number, spentMicros: number): number | null {
  if (limitMicros <= 0) return null
  const remaining = Math.max(0, limitMicros - spentMicros)
  return Math.max(0, Math.min(100, Math.round((remaining / limitMicros) * 100)))
}

export function splitReservationMicros(amountMicros: number, weeklyAvailableMicros: number, fiveHourAvailableMicros: number): {
  weeklyMicros: number
  fiveHourMicros: number
  balanceMicros: number
} {
  const coveredMicros = Math.min(
    Math.max(0, weeklyAvailableMicros),
    Math.max(0, fiveHourAvailableMicros),
    amountMicros,
  )
  return { weeklyMicros: coveredMicros, fiveHourMicros: coveredMicros, balanceMicros: amountMicros - coveredMicros }
}

export function isPaidPlan(value: unknown): value is PaidBillingPlan {
  return value === 'eight' || value === 'fat'
}

export type SubscriptionChange =
  | 'missing'
  | 'noop'
  | 'cancel'
  | 'renew'
  | 'upgrade_fat'
  | 'downgrade_eight'
  | 'unsupported'

export function resolveSubscriptionChange(
  current: { plan: PaidBillingPlan; cancelAtPeriodEnd: boolean } | null,
  target: BillingPlan,
): SubscriptionChange {
  if (!current) return 'missing'
  if (target === current.plan) return current.cancelAtPeriodEnd ? 'renew' : 'noop'
  if (target === 'baby') return current.cancelAtPeriodEnd ? 'noop' : 'cancel'
  if (target === 'fat' && current.plan === 'eight') return 'upgrade_fat'
  if (target === 'eight' && current.plan === 'fat') return 'downgrade_eight'
  return 'unsupported'
}

export function effectivePlan(subscriptions: Array<{
  plan: string
  status: string
  paidThrough: Date | null
}>, now = new Date()): BillingPlan {
  const eligible = subscriptions.filter((subscription) =>
    isPaidPlan(subscription.plan)
    && (subscription.status === 'active' || subscription.status === 'past_due')
    && subscription.paidThrough !== null
    && subscription.paidThrough > now,
  )
  if (eligible.some((subscription) => subscription.plan === 'fat')) return 'fat'
  if (eligible.some((subscription) => subscription.plan === 'eight')) return 'eight'
  return 'baby'
}
