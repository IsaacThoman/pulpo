import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { billingCustomLimits, budgetReservationCustomFunders, budgetReservations, customLimitSpend, models, responses } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { allocateCustomSettlementSplit } from './allocation.js'
import { loadBillingEntitlements } from './entitlements.js'
import { FIVE_HOURS_MS, utcDayEnd, utcDayStart, utcWeekEnd, utcWeekStart, type BillingPlan } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const CUSTOM_LIMIT_PERIODS = ['five_hour', 'daily', 'weekly'] as const
export type CustomLimitPeriod = typeof CUSTOM_LIMIT_PERIODS[number]
export const CUSTOM_LIMIT_TARGETS = ['everyone', 'plans', 'users'] as const
export type CustomLimitTarget = typeof CUSTOM_LIMIT_TARGETS[number]

export type CustomLimit = typeof billingCustomLimits.$inferSelect

/** Whether a limit gives this user an allowance. */
export function customLimitAppliesToUser(limit: Pick<CustomLimit, 'enabled' | 'target' | 'plans' | 'userIds'>, user: {
  userId: string
  plan: BillingPlan
}): boolean {
  if (!limit.enabled) return false
  if (limit.target === 'users') return limit.userIds.includes(user.userId)
  if (limit.target === 'plans') return limit.plans.includes(user.plan)
  return limit.target === 'everyone'
}

/** A limit without models covers every model; otherwise the request's model must be listed. */
export function customLimitAppliesToModels(limit: Pick<CustomLimit, 'modelIds'>, modelIds: readonly string[]): boolean {
  return limit.modelIds.length === 0 || modelIds.some((modelId) => limit.modelIds.includes(modelId))
}

/** Daily and weekly allowances follow UTC periods; the rolling five-hour window has none. */
export function customLimitPeriodStart(period: string, now: Date): Date | null {
  if (period === 'weekly') return utcWeekStart(now)
  if (period === 'daily') return utcDayStart(now)
  return null
}

/** Daily and weekly limits reset at the period end; the rolling five-hour window has no fixed reset. */
export function customLimitResetAt(period: string, now: Date): Date | null {
  if (period === 'weekly') return utcWeekEnd(now)
  if (period === 'daily') return utcDayEnd(now)
  return null
}

/** The part of each allowance pool members may draw on. */
export function sharedCustomLimitMicros(limit: Pick<CustomLimit, 'limitMicros' | 'sharePercent'>): number {
  return Math.floor((limit.limitMicros * limit.sharePercent) / 100)
}

const PERIOD_ORDER: Record<string, number> = { five_hour: 0, daily: 1, weekly: 2 }

/**
 * Spend order across allowances: model-specific ones before those covering every
 * model, so general allowances last longer, then the soonest to reset.
 */
export function compareCustomLimits(a: Pick<CustomLimit, 'id' | 'modelIds' | 'period' | 'createdAt'>, b: Pick<CustomLimit, 'id' | 'modelIds' | 'period' | 'createdAt'>): number {
  return Number(a.modelIds.length === 0) - Number(b.modelIds.length === 0)
    || (PERIOD_ORDER[a.period] ?? 3) - (PERIOD_ORDER[b.period] ?? 3)
    || a.createdAt.getTime() - b.createdAt.getTime()
    || a.id.localeCompare(b.id)
}

/** One user's allowance under one limit, in the current period. */
export interface CustomAllowance {
  limitId: string
  name: string
  period: CustomLimitPeriod
  limitMicros: number
  modelIds: string[]
  sharePercent: number
  /** Whether it also funds the tools, workspace time, and background model calls of matching requests. */
  coversExtras: boolean
  ownerUserId: string
  /** Null for the rolling five-hour window. */
  periodStart: Date | null
  /** Settled spend, by the owner and by pool members. */
  spentMicros: number
  pendingMicros: number
  remainingMicros: number
  sharedLimitMicros: number
  sharedSpentMicros: number
  sharedPendingMicros: number
  /** What pool members can draw now: the shared part or the allowance left, whichever is lower. */
  sharedAvailableMicros: number
  resetAt: Date | null
  /** For the rolling window, when the oldest counted spend stops counting. */
  freesAt: Date | null
}

async function enabledCustomLimits(tx: Transaction): Promise<CustomLimit[]> {
  if (!getConfig().PULPO_BILLING_ENABLED) return []
  const rows = await tx.select().from(billingCustomLimits).where(eq(billingCustomLimits.enabled, true))
  return rows.sort(compareCustomLimits)
}

export async function loadCustomAllowance(tx: Transaction, limit: CustomLimit, ownerUserId: string, now: Date): Promise<CustomAllowance> {
  const periodStart = customLimitPeriodStart(limit.period, now)
  const [[spent], [pending]] = await Promise.all([
    tx.select({
      total: sql<number>`coalesce(sum(${customLimitSpend.spentMicros}), 0)::bigint`,
      shared: sql<number>`coalesce(sum(${customLimitSpend.spentMicros}) filter (where ${customLimitSpend.userId} <> ${customLimitSpend.ownerUserId}), 0)::bigint`,
      oldest: sql<Date | null>`min(${customLimitSpend.createdAt})`.mapWith(customLimitSpend.createdAt),
    }).from(customLimitSpend).where(and(
      eq(customLimitSpend.limitId, limit.id),
      eq(customLimitSpend.ownerUserId, ownerUserId),
      periodStart ? eq(customLimitSpend.periodStart, periodStart) : gt(customLimitSpend.createdAt, new Date(now.getTime() - FIVE_HOURS_MS)),
    )),
    tx.select({
      total: sql<number>`coalesce(sum(${budgetReservationCustomFunders.reservedMicros}), 0)::bigint`,
      shared: sql<number>`coalesce(sum(${budgetReservationCustomFunders.reservedMicros}) filter (where ${budgetReservations.userId} <> ${budgetReservationCustomFunders.ownerUserId}), 0)::bigint`,
    }).from(budgetReservationCustomFunders)
      .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationCustomFunders.reservationId))
      .where(and(
        eq(budgetReservationCustomFunders.limitId, limit.id),
        eq(budgetReservationCustomFunders.ownerUserId, ownerUserId),
        eq(budgetReservations.status, 'pending'),
        periodStart ? eq(budgetReservationCustomFunders.periodStart, periodStart) : undefined,
      )),
  ])
  const spentMicros = Number(spent?.total ?? 0)
  const pendingMicros = Number(pending?.total ?? 0)
  const sharedSpentMicros = Number(spent?.shared ?? 0)
  const sharedPendingMicros = Number(pending?.shared ?? 0)
  const remainingMicros = Math.max(0, limit.limitMicros - spentMicros - pendingMicros)
  const sharedLimitMicros = sharedCustomLimitMicros(limit)
  const oldest = spent?.oldest ?? null
  return {
    limitId: limit.id,
    name: limit.name,
    period: limit.period as CustomLimitPeriod,
    limitMicros: limit.limitMicros,
    modelIds: limit.modelIds,
    sharePercent: limit.sharePercent,
    coversExtras: limit.coversExtras,
    ownerUserId,
    periodStart,
    spentMicros,
    pendingMicros,
    remainingMicros,
    sharedLimitMicros,
    sharedSpentMicros,
    sharedPendingMicros,
    sharedAvailableMicros: Math.min(remainingMicros, Math.max(0, sharedLimitMicros - sharedSpentMicros - sharedPendingMicros)),
    resetAt: customLimitResetAt(limit.period, now),
    freesAt: !periodStart && oldest ? new Date(oldest.getTime() + FIVE_HOURS_MS) : null,
  }
}

/** Every allowance the user has, in spend order, for the billing page. */
export async function loadCustomAllowances(tx: Transaction, input: {
  userId: string
  plan: BillingPlan
  now?: Date
}): Promise<CustomAllowance[]> {
  const now = input.now ?? new Date()
  const limits = (await enabledCustomLimits(tx)).filter((limit) => customLimitAppliesToUser(limit, input))
  return Promise.all(limits.map((limit) => loadCustomAllowance(tx, limit, input.userId, now)))
}

/** An allowance a reservation can draw on, keyed by limit and owner. */
export interface CustomFundingSource {
  limitId: string
  ownerUserId: string
  periodStart: Date | null
  coversExtras: boolean
  availableMicros: number
}

export function customFundingKey(source: Pick<CustomFundingSource, 'limitId' | 'ownerUserId'>): string {
  return `${source.limitId}:${source.ownerUserId}`
}

/**
 * Allowances that can fund a request on `modelIds`, in spend order: the caller's own,
 * then the shared part of other pool members' allowances. Callers pass the active,
 * unblocked pool members and must already hold the pool lock and their user rows.
 */
export async function loadCustomFunding(tx: Transaction, input: {
  userId: string
  plan: BillingPlan
  modelIds: readonly string[]
  sharingOwnerIds: readonly string[]
  now?: Date
}): Promise<CustomFundingSource[]> {
  const now = input.now ?? new Date()
  const limits = (await enabledCustomLimits(tx)).filter((limit) => customLimitAppliesToModels(limit, input.modelIds))
  const sources: CustomFundingSource[] = []
  for (const limit of limits.filter((row) => customLimitAppliesToUser(row, input))) {
    const allowance = await loadCustomAllowance(tx, limit, input.userId, now)
    sources.push({ limitId: limit.id, ownerUserId: input.userId, periodStart: allowance.periodStart, coversExtras: limit.coversExtras, availableMicros: allowance.remainingMicros })
  }
  const shareable = limits.filter((limit) => limit.sharePercent > 0)
  if (!shareable.length) return sources
  for (const ownerUserId of [...new Set(input.sharingOwnerIds)].filter((id) => id !== input.userId).sort()) {
    const entitlements = await loadBillingEntitlements(tx, ownerUserId, now)
    if (entitlements.onHold) continue
    for (const limit of shareable.filter((row) => customLimitAppliesToUser(row, { userId: ownerUserId, plan: entitlements.plan }))) {
      const allowance = await loadCustomAllowance(tx, limit, ownerUserId, now)
      sources.push({ limitId: limit.id, ownerUserId, periodStart: allowance.periodStart, coversExtras: limit.coversExtras, availableMicros: allowance.sharedAvailableMicros })
    }
  }
  return sources
}

/**
 * Charge settled or retained cost to a reservation's allowances, never beyond what each
 * reserved. Allowances that don't cover extras are charged only for the inference part.
 */
export function allocateCustomSettlementMicros(
  amountMicros: number,
  inferenceMicros: number,
  funders: Array<{ limitId: string; ownerUserId: string; reservedMicros: number; coversExtras: boolean }>,
): Map<string, number> {
  return allocateCustomSettlementSplit(amountMicros, inferenceMicros, funders.map((row) => ({ key: customFundingKey(row), reservedMicros: row.reservedMicros, coversExtras: row.coversExtras })))
}

/** Keep settled draws on allowances whose limit still exists. */
export async function recordCustomLimitSpend(tx: Transaction, input: {
  userId: string
  draws: Array<{ limitId: string; ownerUserId: string; periodStart: Date | null; micros: number }>
}): Promise<void> {
  const draws = input.draws.filter((draw) => draw.micros > 0)
  if (!draws.length) return
  const existing = new Set((await tx.select({ id: billingCustomLimits.id }).from(billingCustomLimits)
    .where(inArray(billingCustomLimits.id, [...new Set(draws.map((draw) => draw.limitId))]))).map((row) => row.id))
  const rows = draws.filter((draw) => existing.has(draw.limitId)).map((draw) => ({
    id: newId(), limitId: draw.limitId, ownerUserId: draw.ownerUserId, userId: input.userId, periodStart: draw.periodStart, spentMicros: draw.micros,
  }))
  if (rows.length) await tx.insert(customLimitSpend).values(rows)
}

/** The models a response draws allowances for: requested and, after a fallback, answered. */
export async function responseLimitModelIds(tx: Transaction, responseId: string): Promise<string[]> {
  const [row] = await tx.select({ modelId: responses.modelId, actualModelId: responses.actualModelId })
    .from(responses).where(eq(responses.id, responseId)).limit(1)
  if (!row) return []
  return [...new Set([row.modelId, row.actualModelId].filter((id): id is string => Boolean(id)))]
}

/** Display names for the models a set of allowances names, for the billing page. */
export async function customLimitModelNames(tx: Transaction, allowances: Array<Pick<CustomAllowance, 'modelIds'>>): Promise<Map<string, string>> {
  const ids = [...new Set(allowances.flatMap((allowance) => allowance.modelIds))]
  if (!ids.length) return new Map()
  const rows = await tx.select({ id: models.id, name: models.name }).from(models).where(inArray(models.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** Per-user spend on one limit in its current period, for admins. */
export interface CustomLimitUserUsage {
  userId: string
  /** Spent by the user from their own allowance. */
  ownSpentMicros: number
  /** Spent by pool members from the user's shared allowance. */
  sharedSpentMicros: number
  pendingMicros: number
}

export async function loadCustomLimitUserUsage(tx: Transaction, limit: CustomLimit, now = new Date()): Promise<CustomLimitUserUsage[]> {
  const periodStart = customLimitPeriodStart(limit.period, now)
  const [spent, pending] = await Promise.all([
    tx.select({
      userId: customLimitSpend.ownerUserId,
      own: sql<number>`coalesce(sum(${customLimitSpend.spentMicros}) filter (where ${customLimitSpend.userId} = ${customLimitSpend.ownerUserId}), 0)::bigint`,
      shared: sql<number>`coalesce(sum(${customLimitSpend.spentMicros}) filter (where ${customLimitSpend.userId} <> ${customLimitSpend.ownerUserId}), 0)::bigint`,
    }).from(customLimitSpend).where(and(
      eq(customLimitSpend.limitId, limit.id),
      periodStart ? eq(customLimitSpend.periodStart, periodStart) : gt(customLimitSpend.createdAt, new Date(now.getTime() - FIVE_HOURS_MS)),
    )).groupBy(customLimitSpend.ownerUserId),
    tx.select({
      userId: budgetReservationCustomFunders.ownerUserId,
      total: sql<number>`coalesce(sum(${budgetReservationCustomFunders.reservedMicros}), 0)::bigint`,
    }).from(budgetReservationCustomFunders)
      .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationCustomFunders.reservationId))
      .where(and(
        eq(budgetReservationCustomFunders.limitId, limit.id),
        eq(budgetReservations.status, 'pending'),
        periodStart ? eq(budgetReservationCustomFunders.periodStart, periodStart) : undefined,
      )).groupBy(budgetReservationCustomFunders.ownerUserId),
  ])
  const usage = new Map<string, CustomLimitUserUsage>()
  const row = (userId: string) => {
    const existing = usage.get(userId)
    if (existing) return existing
    const created = { userId, ownSpentMicros: 0, sharedSpentMicros: 0, pendingMicros: 0 }
    usage.set(userId, created)
    return created
  }
  for (const entry of spent) Object.assign(row(entry.userId), { ownSpentMicros: Number(entry.own), sharedSpentMicros: Number(entry.shared) })
  for (const entry of pending) row(entry.userId).pendingMicros = Number(entry.total)
  // Named users are listed even before they spend anything.
  if (limit.target === 'users') for (const userId of limit.userIds) row(userId)
  return [...usage.values()]
}
