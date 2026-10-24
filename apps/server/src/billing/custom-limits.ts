import { and, eq, gte, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import {
  billingCustomLimits,
  budgetReservationCustomLimitDraws,
  budgetReservations,
  customLimitPoolUsage,
  models,
  responses,
  usageEvents,
  users,
} from '../database/schema.js'
import { loadBillingEntitlements } from './entitlements.js'
import { FIVE_HOURS_MS, utcDayEnd, utcDayStart, utcWeekEnd, utcWeekStart, type BillingPlan } from './plans.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const CUSTOM_LIMIT_PERIODS = ['five_hour', 'daily', 'weekly'] as const
export type CustomLimitPeriod = typeof CUSTOM_LIMIT_PERIODS[number]
export const CUSTOM_LIMIT_TARGETS = ['everyone', 'plans', 'users'] as const
export type CustomLimitTarget = typeof CUSTOM_LIMIT_TARGETS[number]

export const CUSTOM_LIMIT_CODE = 'custom_limit_reached'

export type CustomLimit = typeof billingCustomLimits.$inferSelect

/**
 * Whether a limit covers this user. Admins are exempt unless a limit names them,
 * so a limit for everyone or a plan never locks out the people managing it.
 */
export function customLimitAppliesToUser(limit: Pick<CustomLimit, 'enabled' | 'target' | 'plans' | 'userIds'>, user: {
  userId: string
  role: string
  plan: BillingPlan
}): boolean {
  if (!limit.enabled) return false
  if (limit.target === 'users') return limit.userIds.includes(user.userId)
  if (user.role === 'admin') return false
  if (limit.target === 'plans') return limit.plans.includes(user.plan)
  return limit.target === 'everyone'
}

/** A limit without models covers every model; otherwise the request's model must be listed. */
export function customLimitAppliesToModels(limit: Pick<CustomLimit, 'modelIds'>, modelIds: readonly string[]): boolean {
  return limit.modelIds.length === 0 || modelIds.some((modelId) => limit.modelIds.includes(modelId))
}

export function customLimitPeriodStart(period: string, now: Date): Date {
  if (period === 'weekly') return utcWeekStart(now)
  if (period === 'daily') return utcDayStart(now)
  return new Date(now.getTime() - FIVE_HOURS_MS)
}

/** Daily and weekly limits reset at the period end; the rolling five-hour window has no fixed reset. */
export function customLimitResetAt(period: string, now: Date): Date | null {
  if (period === 'weekly') return utcWeekEnd(now)
  if (period === 'daily') return utcDayEnd(now)
  return null
}

export interface CustomLimitUsage {
  id: string
  name: string
  period: CustomLimitPeriod
  limitMicros: number
  modelIds: string[]
  poolSharePercent: number
  /** Includes what pool members used of this user's shared part. */
  spentMicros: number
  pendingMicros: number
  remainingMicros: number
  /** Pool members' settled and pending use of this user's shared part. */
  poolUsedMicros: number
  resetAt: Date | null
  /** For the rolling window, when the oldest counted usage stops counting. */
  freesAt: Date | null
}

/**
 * Usage of every custom limit that covers the user, or only the limits that also
 * cover `modelIds` when given. Usage counts the requested and answered models, so
 * a fallback or preset redirect cannot step around a model's limit.
 */
export async function loadCustomLimitUsage(tx: Transaction, input: {
  userId: string
  role: string
  plan: BillingPlan
  modelIds?: readonly string[]
  /** A reservation being resized already counts in the pending total. */
  currentReservationMicros?: number
  /** Its draws on this user's shared part are left out too. */
  reservationId?: string
  now?: Date
}): Promise<CustomLimitUsage[]> {
  if (!getConfig().PULPO_BILLING_ENABLED) return []
  const now = input.now ?? new Date()
  const limits = (await tx.select().from(billingCustomLimits).where(eq(billingCustomLimits.enabled, true)))
    .filter((limit) => customLimitAppliesToUser(limit, input)
      && (!input.modelIds || customLimitAppliesToModels(limit, input.modelIds)))
  return Promise.all(limits.map(async (limit) => {
    const periodStart = customLimitPeriodStart(limit.period, now)
    const spentModels: SQL | undefined = limit.modelIds.length
      ? or(inArray(usageEvents.modelId, limit.modelIds), inArray(usageEvents.requestedModelId, limit.modelIds))
      : undefined
    const pendingModels: SQL | undefined = limit.modelIds.length
      ? or(inArray(responses.modelId, limit.modelIds), inArray(responses.actualModelId, limit.modelIds))
      : undefined
    const [[spent], [pending], [poolSpent], [poolPending]] = await Promise.all([
      tx.select({
        total: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
        oldest: sql<Date | null>`min(${usageEvents.createdAt})`.mapWith(usageEvents.createdAt),
      }).from(usageEvents).where(and(
        eq(usageEvents.userId, input.userId),
        gte(usageEvents.createdAt, periodStart),
        spentModels,
      )),
      tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros}), 0)::bigint` })
        .from(budgetReservations).innerJoin(responses, eq(responses.id, budgetReservations.responseId))
        .where(and(eq(budgetReservations.userId, input.userId), eq(budgetReservations.status, 'pending'), pendingModels)),
      tx.select({
        total: sql<number>`coalesce(sum(${customLimitPoolUsage.micros}), 0)::bigint`,
        oldest: sql<Date | null>`min(${customLimitPoolUsage.createdAt})`.mapWith(customLimitPoolUsage.createdAt),
      }).from(customLimitPoolUsage).where(and(
        eq(customLimitPoolUsage.limitId, limit.id),
        eq(customLimitPoolUsage.ownerUserId, input.userId),
        gte(customLimitPoolUsage.createdAt, periodStart),
      )),
      tx.select({ total: sql<number>`coalesce(sum(${budgetReservationCustomLimitDraws.reservedMicros}), 0)::bigint` })
        .from(budgetReservationCustomLimitDraws)
        .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationCustomLimitDraws.reservationId))
        .where(and(
          eq(budgetReservationCustomLimitDraws.limitId, limit.id),
          eq(budgetReservationCustomLimitDraws.ownerUserId, input.userId),
          eq(budgetReservations.status, 'pending'),
          input.reservationId ? ne(budgetReservations.id, input.reservationId) : undefined,
        )),
    ])
    const poolSpentMicros = Number(poolSpent?.total ?? 0)
    const poolPendingMicros = Number(poolPending?.total ?? 0)
    const spentMicros = Number(spent?.total ?? 0) + poolSpentMicros
    const pendingMicros = Math.max(0, Number(pending?.total ?? 0) - (input.currentReservationMicros ?? 0)) + poolPendingMicros
    const oldest = [spent?.oldest, poolSpent?.oldest].filter((value): value is Date => value instanceof Date)
      .reduce<Date | null>((earliest, value) => !earliest || value < earliest ? value : earliest, null)
    return {
      id: limit.id,
      name: limit.name,
      period: limit.period as CustomLimitPeriod,
      limitMicros: limit.limitMicros,
      modelIds: limit.modelIds,
      poolSharePercent: limit.poolSharePercent,
      spentMicros,
      pendingMicros,
      remainingMicros: Math.max(0, limit.limitMicros - spentMicros - pendingMicros),
      poolUsedMicros: poolSpentMicros + poolPendingMicros,
      resetAt: customLimitResetAt(limit.period, now),
      freesAt: limit.period === 'five_hour' && oldest ? new Date(oldest.getTime() + FIVE_HOURS_MS) : null,
    }
  }))
}

/** The applicable limit with the least room left, which bounds a new reservation. */
export function tightestCustomLimit(usage: CustomLimitUsage[]): CustomLimitUsage | null {
  return usage.reduce<CustomLimitUsage | null>((tightest, limit) =>
    !tightest || limit.remainingMicros < tightest.remainingMicros ? limit : tightest, null)
}

/** What pool members may still use of a limit's shared part: the share left, or the owner's remainder if lower. */
export function poolShareAvailableMicros(limit: Pick<CustomLimitUsage, 'limitMicros' | 'poolSharePercent' | 'poolUsedMicros' | 'remainingMicros'>): number {
  const shareMicros = Math.floor((limit.limitMicros * limit.poolSharePercent) / 100)
  return Math.max(0, Math.min(shareMicros - limit.poolUsedMicros, limit.remainingMicros))
}

/** Room in a pool member's shared custom limit that another member's request may use. */
export interface CustomLimitShare {
  limitId: string
  ownerUserId: string
  availableMicros: number
}

export interface CustomLimitDraw {
  limitId: string
  ownerUserId: string
  micros: number
}

/**
 * Shared parts of other pool members' limits that cover `modelIds`. Callers pass
 * the active, unblocked owners and must hold the pool lock and their user rows.
 */
export async function loadCustomLimitShares(tx: Transaction, input: {
  ownerUserIds: readonly string[]
  modelIds: readonly string[]
  reservationId?: string
  now?: Date
}): Promise<CustomLimitShare[]> {
  if (!getConfig().PULPO_BILLING_ENABLED || !input.ownerUserIds.length) return []
  const limits = await tx.select({ modelIds: billingCustomLimits.modelIds }).from(billingCustomLimits)
    .where(and(eq(billingCustomLimits.enabled, true), sql`${billingCustomLimits.poolSharePercent} > 0`))
  if (!limits.some((limit) => customLimitAppliesToModels(limit, input.modelIds))) return []
  const owners = await tx.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, [...input.ownerUserIds]))
  const shares: CustomLimitShare[] = []
  for (const owner of owners.sort((a, b) => a.id.localeCompare(b.id))) {
    const { plan } = await loadBillingEntitlements(tx, owner.id, input.now)
    const usage = await loadCustomLimitUsage(tx, { userId: owner.id, role: owner.role, plan, modelIds: input.modelIds, reservationId: input.reservationId, now: input.now })
    for (const limit of usage) {
      const availableMicros = poolShareAvailableMicros(limit)
      if (availableMicros > 0) shares.push({ limitId: limit.id, ownerUserId: owner.id, availableMicros })
    }
  }
  return shares
}

/** Spread `micros` over shares in order, each up to what it has left. */
export function allocateCustomLimitDraws(micros: number, shares: readonly CustomLimitShare[]): CustomLimitDraw[] {
  const draws: CustomLimitDraw[] = []
  let left = Math.max(0, micros)
  for (const share of shares) {
    if (left <= 0) break
    const take = Math.min(left, Math.max(0, share.availableMicros))
    if (take > 0) draws.push({ limitId: share.limitId, ownerUserId: share.ownerUserId, micros: take })
    left -= take
  }
  return draws
}

/**
 * Lower a reservation's draws when it shrinks or settles at `amountMicros`. The
 * member's own room is used first, so draws only cover what goes beyond it.
 */
export function shrinkCustomLimitDraws(
  amountMicros: number,
  reservedMicros: number,
  draws: ReadonlyArray<{ limitId: string; ownerUserId: string; reservedMicros: number }>,
): CustomLimitDraw[] {
  const drawnMicros = draws.reduce((sum, draw) => sum + draw.reservedMicros, 0)
  const ownMicros = Math.max(0, reservedMicros - drawnMicros)
  return allocateCustomLimitDraws(amountMicros - ownMicros, draws.map((draw) => ({ ...draw, availableMicros: draw.reservedMicros })))
}

function utcTime(value: Date): string {
  return `${value.toISOString().slice(11, 16)} UTC`
}

export function customLimitMessage(limit: Pick<CustomLimitUsage, 'name' | 'period' | 'resetAt' | 'freesAt'>): string {
  if (limit.period === 'five_hour') {
    return `You've reached the "${limit.name}" usage limit for the last 5 hours.${limit.freesAt ? ` Usage starts to free up at ${utcTime(limit.freesAt)}.` : ''}`
  }
  const when = limit.period === 'weekly' ? 'Monday at 00:00 UTC' : 'at 00:00 UTC'
  return `You've reached the "${limit.name}" ${limit.period === 'weekly' ? 'weekly' : 'daily'} usage limit. It resets ${when}.`
}

/** The models a response is billed against for custom limits: requested and, after a fallback, answered. */
export async function responseLimitModelIds(tx: Transaction, responseId: string): Promise<string[]> {
  const [row] = await tx.select({ modelId: responses.modelId, actualModelId: responses.actualModelId })
    .from(responses).where(eq(responses.id, responseId)).limit(1)
  if (!row) return []
  return [...new Set([row.modelId, row.actualModelId].filter((id): id is string => Boolean(id)))]
}

/** Display names for the models a set of limits names, for the billing page. */
export async function customLimitModelNames(tx: Transaction, usage: CustomLimitUsage[]): Promise<Map<string, string>> {
  const ids = [...new Set(usage.flatMap((limit) => limit.modelIds))]
  if (!ids.length) return new Map()
  const rows = await tx.select({ id: models.id, name: models.name }).from(models).where(inArray(models.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
