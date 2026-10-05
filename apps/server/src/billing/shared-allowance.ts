import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  applicationSettings,
  budgetReservationAllowanceFunders,
  budgetReservations,
  sharedAllowancePeriods,
  sharedFiveHourUsagePeriods,
} from '../database/schema.js'
import { parseBillingSettings, type BillingSettings } from '../settings/application-settings.js'
import { loadBillingEntitlements, type BillingEntitlements } from './entitlements.js'
import { FIVE_HOURS_MS, fiveHourEnd } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Part of a Fat subscriber's weekly allowance that other pool members may draw on.
 * It is not extra usage: member draws count against the owner's weekly allowance,
 * and the shared limit only caps how much of it members can take.
 */
export interface SharedOwnerAllowance {
  ownerUserId: string
  weeklyPeriodStart: Date
  weeklyResetAt: Date
  limitMicros: number
  spentMicros: number
  pendingMicros: number
  /** Left under the shared limit, ignoring the owner's own usage. */
  remainingMicros: number
  /** What members can draw now: the shared limit or the owner's weekly remainder, whichever is lower. */
  availableMicros: number
}

/** A member's own five-hour window for drawing on shared allowances. */
export interface SharedFiveHourWindow {
  limitMicros: number
  spentMicros: number
  pendingMicros: number
  remainingMicros: number
  periodStart: Date | null
  resetAt: Date | null
}

export interface PoolAllowance {
  fiveHour: SharedFiveHourWindow
  owners: SharedOwnerAllowance[]
  /** Capacity a member can draw right now across every sharing owner. */
  availableMicros: number
}

export async function loadBillingSettingsTx(tx: Transaction): Promise<BillingSettings> {
  const [row] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'billing')).limit(1)
  return parseBillingSettings(row?.value)
}

export function sharedLimitMicros(entitlements: Pick<BillingEntitlements, 'plan' | 'weeklyLimitMicros'>, settings: Pick<BillingSettings, 'fatSharedWeeklyPercent'>): number {
  if (entitlements.plan !== 'fat') return 0
  return Math.floor((entitlements.weeklyLimitMicros * settings.fatSharedWeeklyPercent) / 100)
}

export async function loadOwnerSharedAllowance(
  tx: Transaction,
  ownerUserId: string,
  entitlements: BillingEntitlements,
  settings: BillingSettings,
): Promise<SharedOwnerAllowance | null> {
  const limitMicros = sharedLimitMicros(entitlements, settings)
  if (limitMicros <= 0 || entitlements.onHold) return null
  const periodStart = entitlements.weeklyPeriodStart
  const [[period], [pending]] = await Promise.all([
    tx.select({ spentMicros: sharedAllowancePeriods.spentMicros }).from(sharedAllowancePeriods)
      .where(and(eq(sharedAllowancePeriods.ownerUserId, ownerUserId), eq(sharedAllowancePeriods.periodStart, periodStart))).limit(1),
    tx.select({ total: sql<number>`coalesce(sum(${budgetReservationAllowanceFunders.reservedMicros}), 0)::bigint` })
      .from(budgetReservationAllowanceFunders)
      .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationAllowanceFunders.reservationId))
      .where(and(
        eq(budgetReservationAllowanceFunders.ownerUserId, ownerUserId),
        eq(budgetReservationAllowanceFunders.weeklyPeriodStart, periodStart),
        eq(budgetReservations.status, 'pending'),
      )),
  ])
  const spentMicros = period?.spentMicros ?? 0
  const pendingMicros = Number(pending?.total ?? 0)
  const remainingMicros = Math.max(0, limitMicros - spentMicros - pendingMicros)
  return {
    ownerUserId,
    weeklyPeriodStart: periodStart,
    weeklyResetAt: entitlements.weeklyResetAt,
    limitMicros,
    spentMicros,
    pendingMicros,
    remainingMicros,
    availableMicros: Math.min(remainingMicros, entitlements.weeklyRemainingMicros),
  }
}

export async function loadSharedFiveHourWindow(
  tx: Transaction,
  userId: string,
  settings: BillingSettings,
  now = new Date(),
): Promise<SharedFiveHourWindow> {
  const cutoff = new Date(now.getTime() - FIVE_HOURS_MS)
  const [[active], [activePending]] = await Promise.all([
    tx.select({ periodStart: sharedFiveHourUsagePeriods.periodStart, spentMicros: sharedFiveHourUsagePeriods.spentMicros })
      .from(sharedFiveHourUsagePeriods)
      .where(and(eq(sharedFiveHourUsagePeriods.userId, userId), gt(sharedFiveHourUsagePeriods.periodStart, cutoff)))
      .orderBy(desc(sharedFiveHourUsagePeriods.periodStart)).limit(1),
    tx.select({ periodStart: budgetReservations.sharedFiveHourPeriodStart })
      .from(budgetReservations).where(and(
        eq(budgetReservations.userId, userId),
        eq(budgetReservations.status, 'pending'),
        gt(budgetReservations.sharedFiveHourPeriodStart, cutoff),
      )).orderBy(desc(budgetReservations.sharedFiveHourPeriodStart)).limit(1),
  ])
  const periodStart = activePending?.periodStart && (!active || activePending.periodStart > active.periodStart)
    ? activePending.periodStart
    : active?.periodStart ?? null
  const [pending] = periodStart
    ? await tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.sharedReservedMicros}), 0)::bigint` })
      .from(budgetReservations).where(and(
        eq(budgetReservations.userId, userId),
        eq(budgetReservations.status, 'pending'),
        eq(budgetReservations.sharedFiveHourPeriodStart, periodStart),
      ))
    : [{ total: 0 }]
  const limitMicros = settings.sharedFiveHourLimitMicros
  const spentMicros = active && periodStart?.getTime() === active.periodStart.getTime() ? active.spentMicros : 0
  const pendingMicros = Number(pending?.total ?? 0)
  return {
    limitMicros,
    spentMicros,
    pendingMicros,
    remainingMicros: Math.max(0, limitMicros - spentMicros - pendingMicros),
    periodStart,
    resetAt: periodStart ? fiveHourEnd(periodStart) : null,
  }
}

/**
 * Shared allowances `userId` may draw from. Callers pass the other active, unblocked
 * pool members and must already hold the pool lock and those members' user rows.
 */
export async function loadPoolAllowance(
  tx: Transaction,
  userId: string,
  candidateOwnerIds: string[],
  now = new Date(),
): Promise<PoolAllowance> {
  const settings = await loadBillingSettingsTx(tx)
  const fiveHour = await loadSharedFiveHourWindow(tx, userId, settings, now)
  const owners: SharedOwnerAllowance[] = []
  if (getConfig().PULPO_BILLING_ENABLED) {
    for (const ownerUserId of [...new Set(candidateOwnerIds)].filter((id) => id !== userId).sort()) {
      const allowance = await loadOwnerSharedAllowance(tx, ownerUserId, await loadBillingEntitlements(tx, ownerUserId, now), settings)
      if (allowance) owners.push(allowance)
    }
  }
  const ownersAvailable = owners.reduce((sum, owner) => sum + owner.availableMicros, 0)
  return { fiveHour, owners, availableMicros: owners.length ? Math.min(fiveHour.remainingMicros, ownersAvailable) : 0 }
}

/** Count settled shared usage against each owner's weekly allowance and shared limit, and the member's window. */
export async function recordSharedUsage(
  tx: Transaction,
  input: {
    userId: string
    fiveHourPeriodStart: Date | null
    draws: Array<{ ownerUserId: string; weeklyPeriodStart: Date; micros: number }>
  },
  weeklyUsage: (ownerUserId: string, periodStart: Date, micros: number) => Promise<void>,
): Promise<number> {
  let total = 0
  for (const draw of input.draws) {
    if (draw.micros <= 0) continue
    total += draw.micros
    await weeklyUsage(draw.ownerUserId, draw.weeklyPeriodStart, draw.micros)
    await tx.insert(sharedAllowancePeriods).values({
      ownerUserId: draw.ownerUserId, periodStart: draw.weeklyPeriodStart, spentMicros: draw.micros,
    }).onConflictDoUpdate({
      target: [sharedAllowancePeriods.ownerUserId, sharedAllowancePeriods.periodStart],
      set: { spentMicros: sql`${sharedAllowancePeriods.spentMicros} + ${draw.micros}`, updatedAt: new Date() },
    })
  }
  if (total > 0 && input.fiveHourPeriodStart) {
    await tx.insert(sharedFiveHourUsagePeriods).values({
      userId: input.userId, periodStart: input.fiveHourPeriodStart, spentMicros: total,
    }).onConflictDoUpdate({
      target: [sharedFiveHourUsagePeriods.userId, sharedFiveHourUsagePeriods.periodStart],
      set: { spentMicros: sql`${sharedFiveHourUsagePeriods.spentMicros} + ${total}`, updatedAt: new Date() },
    })
  }
  return total
}

export interface UsageLimitBar {
  remainingPercentage: number
  availableBarPercentage: number
  pendingMicros: number
  pendingBarPercentage: number
  resetsAt: string | null
}

export function usageLimitBar(input: { availableMicros: number; pendingMicros: number; limitMicros: number; resetsAt: Date | null }): UsageLimitBar {
  const percentage = (micros: number) => input.limitMicros > 0 ? Math.max(0, Math.min(100, (micros / input.limitMicros) * 100)) : 0
  return {
    remainingPercentage: Math.round(percentage(input.availableMicros)),
    availableBarPercentage: percentage(input.availableMicros),
    pendingMicros: input.pendingMicros,
    pendingBarPercentage: percentage(input.pendingMicros),
    resetsAt: input.resetsAt?.toISOString() ?? null,
  }
}

export function sharedAllowanceBar(allowance: SharedOwnerAllowance): UsageLimitBar {
  return usageLimitBar({
    availableMicros: allowance.availableMicros,
    pendingMicros: Math.min(allowance.pendingMicros, Math.max(0, allowance.limitMicros - allowance.spentMicros)),
    limitMicros: allowance.limitMicros,
    resetsAt: allowance.weeklyResetAt,
  })
}

/**
 * Shared usage across every Fat subscriber in the pool, plus the viewer's own five-hour
 * window when someone else shares with them. Null when nobody in the pool shares.
 */
export async function poolSharedUsageSummary(tx: Transaction, viewerUserId: string, memberIds: string[], now = new Date()) {
  if (!getConfig().PULPO_BILLING_ENABLED) return null
  const settings = await loadBillingSettingsTx(tx)
  const owners: SharedOwnerAllowance[] = []
  for (const ownerUserId of [...new Set(memberIds)].sort()) {
    const allowance = await loadOwnerSharedAllowance(tx, ownerUserId, await loadBillingEntitlements(tx, ownerUserId, now), settings)
    if (allowance) owners.push(allowance)
  }
  if (!owners.length) return null
  const sum = (pick: (owner: SharedOwnerAllowance) => number) => owners.reduce((total, owner) => total + pick(owner), 0)
  const total = usageLimitBar({
    availableMicros: sum((owner) => owner.availableMicros),
    pendingMicros: sum((owner) => Math.min(owner.pendingMicros, Math.max(0, owner.limitMicros - owner.spentMicros))),
    limitMicros: sum((owner) => owner.limitMicros),
    resetsAt: owners[0]!.weeklyResetAt,
  })
  const window = owners.some((owner) => owner.ownerUserId !== viewerUserId)
    ? await loadSharedFiveHourWindow(tx, viewerUserId, settings, now)
    : null
  return {
    total,
    fiveHour: window ? usageLimitBar({
      availableMicros: window.remainingMicros,
      pendingMicros: Math.min(window.pendingMicros, Math.max(0, window.limitMicros - window.spentMicros)),
      limitMicros: window.limitMicros,
      resetsAt: window.resetAt,
    }) : null,
  }
}
