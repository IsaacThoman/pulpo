import { and, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { billingCustomLimits, budgetReservations, models, responses, usageEvents } from '../database/schema.js'
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
  spentMicros: number
  pendingMicros: number
  remainingMicros: number
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
    const [[spent], [pending]] = await Promise.all([
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
    ])
    const spentMicros = Number(spent?.total ?? 0)
    const pendingMicros = Math.max(0, Number(pending?.total ?? 0) - (input.currentReservationMicros ?? 0))
    const oldest = spent?.oldest ?? null
    return {
      id: limit.id,
      name: limit.name,
      period: limit.period as CustomLimitPeriod,
      limitMicros: limit.limitMicros,
      modelIds: limit.modelIds,
      spentMicros,
      pendingMicros,
      remainingMicros: Math.max(0, limit.limitMicros - spentMicros - pendingMicros),
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
