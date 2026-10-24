import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  billingAccounts,
  billingOrders,
  budgetReservations,
  dailyUsagePeriods,
  users,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseBillingSettings, type UsageTier } from '../settings/application-settings.js'
import { loadBillingEntitlements } from './entitlements.js'
import { utcDayEnd, utcDayStart } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const DAY_MS = 24 * 60 * 60 * 1_000

export const DAILY_SPEND_LIMIT_CODE = 'daily_spend_limit_reached'

export interface UsageTierProgress {
  tier: number
  next: {
    tier: number
    dailyLimitMicros: number
    remainingPaidCents: number
    minDaysSinceFirstPayment: number
    /** When the waiting period ends, or null before the first payment or without one. */
    availableAt: Date | null
  } | null
}

function qualifies(tier: UsageTier, paidCents: number, firstPaidAt: Date | null, now: Date): boolean {
  if (paidCents < tier.minPaidCents) return false
  if (tier.minDaysSinceFirstPayment === 0) return true
  return firstPaidAt !== null && now.getTime() - firstPaidAt.getTime() >= tier.minDaysSinceFirstPayment * DAY_MS
}

/** Tiers follow OpenAI's model: lifetime payments plus days since the first successful payment. */
export function resolveUsageTier(input: {
  tiers: UsageTier[]
  paidCents: number
  firstPaidAt: Date | null
  now: Date
}): UsageTierProgress {
  let tier = 0
  input.tiers.forEach((definition, index) => {
    if (qualifies(definition, input.paidCents, input.firstPaidAt, input.now)) tier = index
  })
  const next = input.tiers[tier + 1]
  return {
    tier,
    next: next ? {
      tier: tier + 1,
      dailyLimitMicros: next.dailyLimitMicros,
      remainingPaidCents: Math.max(0, next.minPaidCents - input.paidCents),
      minDaysSinceFirstPayment: next.minDaysSinceFirstPayment,
      availableAt: next.minDaysSinceFirstPayment > 0 && input.firstPaidAt
        ? new Date(input.firstPaidAt.getTime() + next.minDaysSinceFirstPayment * DAY_MS)
        : null,
    } : null,
  }
}

export interface DailySpend extends UsageTierProgress {
  /** Null when the user is exempt from daily caps. */
  limitMicros: number | null
  limitOverridden: boolean
  spentMicros: number
  pendingMicros: number
  remainingMicros: number | null
  paidCents: number
  firstPaidAt: Date | null
  periodStart: Date
  resetAt: Date
}

/**
 * The caller's daily spend across subscription allowances, credits, and pool funding.
 * Custom limit allowances are left out: like plan usage they are included, not paid.
 * Returns null when billing is disabled, since nobody can pay to move up a tier.
 */
export async function loadDailySpend(tx: Transaction, input: {
  userId: string
  role: string
  /** The plan's weekly allowance; a tier cap never cuts into included usage. */
  weeklyLimitMicros: number
  /** The part of a reservation being resized that already counts in the pending total. */
  currentReservationMicros?: number
  now?: Date
}): Promise<DailySpend | null> {
  if (!getConfig().PULPO_BILLING_ENABLED) return null
  const now = input.now ?? new Date()
  const periodStart = utcDayStart(now)
  const [[setting], [account], [payments], [period], [pending]] = await Promise.all([
    tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'billing')).limit(1),
    tx.select({ dailyLimitOverrideMicros: billingAccounts.dailyLimitOverrideMicros }).from(billingAccounts)
      .where(eq(billingAccounts.userId, input.userId)).limit(1),
    tx.select({
      paidCents: sql<number>`coalesce(sum(greatest(${billingOrders.netAmountCents} - ${billingOrders.refundedAmountCents}, 0)), 0)::bigint`,
      firstPaidAt: sql<Date | null>`min(${billingOrders.paidAt}) filter (where ${billingOrders.netAmountCents} > ${billingOrders.refundedAmountCents})`
        .mapWith(billingOrders.paidAt),
    }).from(billingOrders).where(and(
      eq(billingOrders.userId, input.userId),
      isNotNull(billingOrders.paidAt),
      inArray(billingOrders.status, ['paid', 'refunded']),
    )),
    tx.select({ spentMicros: dailyUsagePeriods.spentMicros }).from(dailyUsagePeriods)
      .where(and(eq(dailyUsagePeriods.userId, input.userId), eq(dailyUsagePeriods.periodStart, periodStart))).limit(1),
    tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros} - ${budgetReservations.customReservedMicros}), 0)::bigint` }).from(budgetReservations)
      .where(and(eq(budgetReservations.userId, input.userId), eq(budgetReservations.status, 'pending'))),
  ])
  const tiers = parseBillingSettings(setting?.value).usageTiers
  const paidCents = Number(payments?.paidCents ?? 0)
  const firstPaidAt = payments?.firstPaidAt ?? null
  const progress = resolveUsageTier({ tiers, paidCents, firstPaidAt, now })
  const override = account?.dailyLimitOverrideMicros ?? null
  const limitMicros = input.role === 'admin'
    ? null
    : override ?? Math.max(tiers[progress.tier]!.dailyLimitMicros, input.weeklyLimitMicros)
  const spentMicros = period?.spentMicros ?? 0
  const pendingMicros = Math.max(0, Number(pending?.total ?? 0) - (input.currentReservationMicros ?? 0))
  return {
    ...progress,
    limitMicros,
    limitOverridden: override !== null,
    spentMicros,
    pendingMicros,
    remainingMicros: limitMicros === null ? null : Math.max(0, limitMicros - spentMicros - pendingMicros),
    paidCents,
    firstPaidAt,
    periodStart,
    resetAt: utcDayEnd(now),
  }
}

export function dailySpendLimitMessage(spend: Pick<DailySpend, 'tier' | 'limitMicros'>): string {
  const limit = ((spend.limitMicros ?? 0) / 1_000_000).toFixed(2)
  return `You've reached your daily usage limit of $${limit} for usage tier ${spend.tier}. It resets at 00:00 UTC.`
}

export async function addDailyUsage(tx: Transaction, userId: string, micros: number, now = new Date()): Promise<void> {
  if (micros <= 0) return
  await tx.insert(dailyUsagePeriods).values({ userId, periodStart: utcDayStart(now), spentMicros: micros }).onConflictDoUpdate({
    target: [dailyUsagePeriods.userId, dailyUsagePeriods.periodStart],
    set: { spentMicros: sql`${dailyUsagePeriods.spentMicros} + ${micros}`, updatedAt: new Date() },
  })
}

/**
 * Metered usage is charged after the provider call, so refuse new work up front
 * once the cap is used up instead of failing after the cost is incurred.
 */
export async function assertDailySpendAvailable(userId: string): Promise<void> {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
    if (!user) return
    const entitlements = await loadBillingEntitlements(tx, userId)
    const spend = await loadDailySpend(tx, { userId, role: user.role, weeklyLimitMicros: entitlements.weeklyLimitMicros })
    if (spend?.remainingMicros === 0) throw new AppError(402, DAILY_SPEND_LIMIT_CODE, dailySpendLimitMessage(spend))
  })
}
