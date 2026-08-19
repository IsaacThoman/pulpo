import { and, eq, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  billingAccounts,
  billingSubscriptions,
  budgetReservations,
  weeklyUsagePeriods,
} from '../database/schema.js'
import { parseBillingSettings } from '../settings/application-settings.js'
import { effectivePlan, remainingPercentage, utcWeekEnd, utcWeekStart, type BillingPlan } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface BillingEntitlements {
  plan: BillingPlan
  weeklyLimitMicros: number
  weeklySpentMicros: number
  weeklyPendingMicros: number
  weeklyRemainingMicros: number
  weeklyRemainingPercentage: number | null
  weeklyPeriodStart: Date
  weeklyResetAt: Date
  weeklyLimitOverridden: boolean
  balancePendingMicros: number
  onHold: boolean
}

export async function loadBillingEntitlements(
  tx: Transaction,
  userId: string,
  now = new Date(),
): Promise<BillingEntitlements> {
  const periodStart = utcWeekStart(now)
  if (!getConfig().PULPO_BILLING_ENABLED) {
    const [pending] = await tx.select({
      balance: sql<number>`coalesce(sum(${budgetReservations.balanceReservedMicros}), 0)::bigint`,
    }).from(budgetReservations).where(and(eq(budgetReservations.userId, userId), eq(budgetReservations.status, 'pending')))
    return {
      plan: 'baby',
      weeklyLimitMicros: 0,
      weeklySpentMicros: 0,
      weeklyPendingMicros: 0,
      weeklyRemainingMicros: 0,
      weeklyRemainingPercentage: null,
      weeklyPeriodStart: periodStart,
      weeklyResetAt: utcWeekEnd(now),
      weeklyLimitOverridden: false,
      balancePendingMicros: Number(pending?.balance ?? 0),
      onHold: false,
    }
  }

  const [[account], subscriptions, [setting], [period], [pending]] = await Promise.all([
    tx.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1),
    tx.select({ plan: billingSubscriptions.plan, status: billingSubscriptions.status, paidThrough: billingSubscriptions.paidThrough })
      .from(billingSubscriptions).where(eq(billingSubscriptions.userId, userId)),
    tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'billing')).limit(1),
    tx.select({ spentMicros: weeklyUsagePeriods.spentMicros }).from(weeklyUsagePeriods)
      .where(and(eq(weeklyUsagePeriods.userId, userId), eq(weeklyUsagePeriods.periodStart, periodStart))).limit(1),
    tx.select({
      weekly: sql<number>`coalesce(sum(case when ${budgetReservations.weeklyPeriodStart} = ${periodStart} then ${budgetReservations.weeklyReservedMicros} else 0 end), 0)::bigint`,
      balance: sql<number>`coalesce(sum(${budgetReservations.balanceReservedMicros}), 0)::bigint`,
    }).from(budgetReservations).where(and(eq(budgetReservations.userId, userId), eq(budgetReservations.status, 'pending'))),
  ])

  const plan = effectivePlan(subscriptions, now)
  const settings = parseBillingSettings(setting?.value)
  const defaultLimit = plan === 'eight'
    ? settings.eightWeeklyLimitMicros
    : plan === 'fat'
      ? settings.fatWeeklyLimitMicros
      : 0
  const weeklyLimitMicros = account?.weeklyLimitOverrideMicros ?? defaultLimit
  const weeklySpentMicros = period?.spentMicros ?? 0
  const weeklyPendingMicros = Number(pending?.weekly ?? 0)
  const weeklyRemainingMicros = Math.max(0, weeklyLimitMicros - weeklySpentMicros - weeklyPendingMicros)

  return {
    plan,
    weeklyLimitMicros,
    weeklySpentMicros,
    weeklyPendingMicros,
    weeklyRemainingMicros,
    weeklyRemainingPercentage: remainingPercentage(weeklyLimitMicros, weeklySpentMicros + weeklyPendingMicros),
    weeklyPeriodStart: periodStart,
    weeklyResetAt: utcWeekEnd(now),
    weeklyLimitOverridden: account?.weeklyLimitOverrideMicros !== null && account?.weeklyLimitOverrideMicros !== undefined,
    balancePendingMicros: Number(pending?.balance ?? 0),
    onHold: Boolean(account?.holdAt && !account.holdClearedAt),
  }
}

export async function getBillingEntitlements(userId: string, now = new Date()): Promise<BillingEntitlements> {
  return db.transaction((tx) => loadBillingEntitlements(tx, userId, now))
}
