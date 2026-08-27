import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  billingAccounts,
  billingSubscriptions,
  budgetReservationFunders,
  budgetReservations,
  fiveHourUsagePeriods,
  weeklyUsagePeriods,
} from '../database/schema.js'
import { parseBillingSettings } from '../settings/application-settings.js'
import { effectivePlan, FIVE_HOURS_MS, fiveHourEnd, remainingPercentage, utcWeekEnd, utcWeekStart, type BillingPlan } from './plans.js'
import { storageDefaultForPlan } from './storage-entitlements.js'

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
  fiveHourLimitMicros: number
  fiveHourSpentMicros: number
  fiveHourPendingMicros: number
  fiveHourRemainingMicros: number
  fiveHourRemainingPercentage: number | null
  fiveHourPeriodStart: Date | null
  fiveHourResetAt: Date | null
  fiveHourLimitOverridden: boolean
  storageLimitBytes: number
  storageLimitOverridden: boolean
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
      balance: sql<number>`coalesce(sum(${budgetReservationFunders.reservedMicros}), 0)::bigint`,
    }).from(budgetReservationFunders).innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationFunders.reservationId))
      .where(and(eq(budgetReservationFunders.userId, userId), eq(budgetReservations.status, 'pending')))
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
      fiveHourLimitMicros: 0,
      fiveHourSpentMicros: 0,
      fiveHourPendingMicros: 0,
      fiveHourRemainingMicros: 0,
      fiveHourRemainingPercentage: null,
      fiveHourPeriodStart: null,
      fiveHourResetAt: null,
      fiveHourLimitOverridden: false,
      storageLimitBytes: 0,
      storageLimitOverridden: false,
      balancePendingMicros: Number(pending?.balance ?? 0),
      onHold: false,
    }
  }

  const fiveHourCutoff = new Date(now.getTime() - FIVE_HOURS_MS)
  const [[account], subscriptions, [setting], [period], [pendingBalance], [activeFiveHourPeriod], [activePendingFiveHour]] = await Promise.all([
    tx.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1),
    tx.select({ plan: billingSubscriptions.plan, status: billingSubscriptions.status, paidThrough: billingSubscriptions.paidThrough })
      .from(billingSubscriptions).where(eq(billingSubscriptions.userId, userId)),
    tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'billing')).limit(1),
    tx.select({ spentMicros: weeklyUsagePeriods.spentMicros }).from(weeklyUsagePeriods)
      .where(and(eq(weeklyUsagePeriods.userId, userId), eq(weeklyUsagePeriods.periodStart, periodStart))).limit(1),
    tx.select({
      balance: sql<number>`coalesce(sum(${budgetReservationFunders.reservedMicros}), 0)::bigint`,
    }).from(budgetReservationFunders).innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationFunders.reservationId))
      .where(and(eq(budgetReservationFunders.userId, userId), eq(budgetReservations.status, 'pending'))),
    tx.select({ periodStart: fiveHourUsagePeriods.periodStart, spentMicros: fiveHourUsagePeriods.spentMicros })
      .from(fiveHourUsagePeriods).where(and(
        eq(fiveHourUsagePeriods.userId, userId),
        gt(fiveHourUsagePeriods.periodStart, fiveHourCutoff),
      )).orderBy(desc(fiveHourUsagePeriods.periodStart)).limit(1),
    tx.select({ periodStart: budgetReservations.fiveHourPeriodStart })
      .from(budgetReservations).where(and(
        eq(budgetReservations.userId, userId),
        eq(budgetReservations.status, 'pending'),
        gt(budgetReservations.fiveHourPeriodStart, fiveHourCutoff),
      )).orderBy(desc(budgetReservations.fiveHourPeriodStart)).limit(1),
  ])

  const fiveHourPeriodStart = activePendingFiveHour?.periodStart
    && (!activeFiveHourPeriod || activePendingFiveHour.periodStart > activeFiveHourPeriod.periodStart)
    ? activePendingFiveHour.periodStart
    : activeFiveHourPeriod?.periodStart ?? null
  const [[pendingWeekly], [pendingFiveHour]] = await Promise.all([
    tx.select({
      weekly: sql<number>`coalesce(sum(${budgetReservations.weeklyReservedMicros}), 0)::bigint`,
    }).from(budgetReservations).where(and(
      eq(budgetReservations.userId, userId),
      eq(budgetReservations.status, 'pending'),
      eq(budgetReservations.weeklyPeriodStart, periodStart),
    )),
    fiveHourPeriodStart
      ? tx.select({ fiveHour: sql<number>`coalesce(sum(${budgetReservations.fiveHourReservedMicros}), 0)::bigint` })
        .from(budgetReservations).where(and(
          eq(budgetReservations.userId, userId),
          eq(budgetReservations.status, 'pending'),
          eq(budgetReservations.fiveHourPeriodStart, fiveHourPeriodStart),
        ))
      : Promise.resolve([{ fiveHour: 0 }]),
  ])

  const plan = effectivePlan(subscriptions, now)
  const settings = parseBillingSettings(setting?.value)
  const defaultLimit = plan === 'eight'
    ? settings.eightWeeklyLimitMicros
    : plan === 'fat'
      ? settings.fatWeeklyLimitMicros
      : 0
  const weeklyLimitMicros = account?.weeklyLimitOverrideMicros ?? defaultLimit
  const defaultFiveHourLimit = plan === 'eight'
    ? settings.eightFiveHourLimitMicros
    : plan === 'fat'
      ? settings.fatFiveHourLimitMicros
      : 0
  const fiveHourLimitMicros = account?.fiveHourLimitOverrideMicros ?? defaultFiveHourLimit
  const storageLimitBytes = account?.storageLimitOverrideBytes ?? storageDefaultForPlan(settings, plan)
  const weeklySpentMicros = period?.spentMicros ?? 0
  const weeklyPendingMicros = Number(pendingWeekly?.weekly ?? 0)
  const weeklyRemainingMicros = Math.max(0, weeklyLimitMicros - weeklySpentMicros - weeklyPendingMicros)
  const fiveHourSpentMicros = activeFiveHourPeriod && fiveHourPeriodStart?.getTime() === activeFiveHourPeriod.periodStart.getTime()
    ? activeFiveHourPeriod.spentMicros
    : 0
  const fiveHourPendingMicros = Number(pendingFiveHour?.fiveHour ?? 0)
  const fiveHourRemainingMicros = Math.max(0, fiveHourLimitMicros - fiveHourSpentMicros - fiveHourPendingMicros)

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
    fiveHourLimitMicros,
    fiveHourSpentMicros,
    fiveHourPendingMicros,
    fiveHourRemainingMicros,
    fiveHourRemainingPercentage: remainingPercentage(fiveHourLimitMicros, fiveHourSpentMicros + fiveHourPendingMicros),
    fiveHourPeriodStart,
    fiveHourResetAt: fiveHourPeriodStart ? fiveHourEnd(fiveHourPeriodStart) : null,
    fiveHourLimitOverridden: account?.fiveHourLimitOverrideMicros !== null && account?.fiveHourLimitOverrideMicros !== undefined,
    storageLimitBytes,
    storageLimitOverridden: account?.storageLimitOverrideBytes !== null && account?.storageLimitOverrideBytes !== undefined,
    balancePendingMicros: Number(pendingBalance?.balance ?? 0),
    onHold: Boolean(account?.holdAt && !account.holdClearedAt),
  }
}

export async function getBillingEntitlements(userId: string, now = new Date()): Promise<BillingEntitlements> {
  return db.transaction((tx) => loadBillingEntitlements(tx, userId, now))
}
