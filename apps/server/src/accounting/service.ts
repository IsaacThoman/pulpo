import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'
import type { ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  apiKeys,
  budgetReservations,
  creditLedger,
  modelPricingVersions,
  responses,
  usageEvents,
  users,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  availableReservationCapacityMicros,
  calculateCostMicros,
  calculateReservationMicros,
  calculateRollingReservationMicros,
  type Pricing,
} from './pricing.js'

export interface ActivePricing extends Pricing {
  id: string
}

export async function getActivePricing(modelId: string): Promise<ActivePricing> {
  const now = new Date()
  const [row] = await db
    .select()
    .from(modelPricingVersions)
    .where(and(
      eq(modelPricingVersions.modelId, modelId),
      lte(modelPricingVersions.effectiveFrom, now),
      or(isNull(modelPricingVersions.effectiveTo), gte(modelPricingVersions.effectiveTo, now)),
    ))
    .orderBy(sql`${modelPricingVersions.effectiveFrom} desc`)
    .limit(1)
  if (!row) throw new AppError(409, 'pricing_not_configured', 'The selected model has no active pricing')
  return row
}

export async function reserveBudget(input: {
  responseId: string
  userId: string
  apiKeyId?: string | null
  requestInput: unknown
  maxOutputTokens: number
  pricing: ActivePricing
}): Promise<number> {
  const amount = calculateReservationMicros(input.requestInput, input.maxOutputTokens, input.pricing)
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update')
    if (!user || user.blocked) throw new AppError(403, 'account_blocked', 'The account cannot make requests')
    const [reserved] = await tx
      .select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros}), 0)::bigint` })
      .from(budgetReservations)
      .where(and(eq(budgetReservations.userId, input.userId), eq(budgetReservations.status, 'pending')))
    if (user.balanceMicros - Number(reserved?.total ?? 0) < amount) {
      throw new AppError(402, 'insufficient_balance', 'Insufficient balance for the maximum request cost')
    }
    if (input.apiKeyId) {
      const [key] = await tx.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).limit(1)
      if (!key || key.status !== 'active') throw new AppError(401, 'invalid_api_key', 'Invalid API key', 'authentication_error')
      const monthStart = new Date(Date.UTC(nowYear(), nowMonth(), 1))
      const [spent] = await tx
        .select({ total: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint` })
        .from(usageEvents)
        .where(and(eq(usageEvents.apiKeyId, key.id), gte(usageEvents.createdAt, monthStart)))
      const [keyReserved] = await tx
        .select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros}), 0)::bigint` })
        .from(budgetReservations)
        .where(and(eq(budgetReservations.apiKeyId, key.id), eq(budgetReservations.status, 'pending')))
      const committed = Number(spent?.total ?? 0) + Number(keyReserved?.total ?? 0) + amount
      if (key.monthlyBudgetMicros !== null && committed > key.monthlyBudgetMicros) {
        throw new AppError(402, 'monthly_budget_exceeded', 'API key monthly budget exceeded')
      }
      if (key.lifetimeBudgetMicros !== null) {
        const [lifetime] = await tx
          .select({ total: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint` })
          .from(usageEvents)
          .where(eq(usageEvents.apiKeyId, key.id))
        if (Number(lifetime?.total ?? 0) + Number(keyReserved?.total ?? 0) + amount > key.lifetimeBudgetMicros) {
          throw new AppError(402, 'lifetime_budget_exceeded', 'API key lifetime budget exceeded')
        }
      }
    }
    await tx.insert(budgetReservations).values({
      id: newId(),
      responseId: input.responseId,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      amountMicros: amount,
    })
    await tx.update(responses).set({ pricingVersionId: input.pricing.id }).where(eq(responses.id, input.responseId))
  })
  return amount
}

function nowYear(): number { return new Date().getUTCFullYear() }
function nowMonth(): number { return new Date().getUTCMonth() }

export async function settleBudget(input: {
  responseId: string
  usage: ResponseUsage
  latencyMs: number
  requestCount?: number
  costMicrosOverride?: number
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(budgetReservations)
      .where(eq(budgetReservations.responseId, input.responseId))
      .for('update')
    if (!reservation) throw new AppError(409, 'reservation_missing', 'Budget reservation is missing')
    if (reservation.status === 'settled') return reservation.settledAmountMicros ?? 0
    const [response] = await tx.select().from(responses).where(eq(responses.id, input.responseId)).limit(1)
    const [pricing] = response?.pricingVersionId
      ? await tx.select().from(modelPricingVersions).where(eq(modelPricingVersions.id, response.pricingVersionId)).limit(1)
      : []
    if (!response || !pricing) throw new AppError(409, 'pricing_snapshot_missing', 'Pricing snapshot is missing')
    const cost = input.costMicrosOverride ?? (calculateCostMicros(input.usage, pricing) + Math.max(0, (input.requestCount ?? 1) - 1) * pricing.perRequestPriceMicros)
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, reservation.userId))
      .for('update')
    if (!user) throw new AppError(409, 'user_missing', 'User is missing')
    const balanceAfter = user.balanceMicros - cost
    await tx.update(users).set({ balanceMicros: balanceAfter, stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, user.id))
    await tx.update(budgetReservations).set({
      status: 'settled',
      settledAmountMicros: cost,
      settledAt: new Date(),
    }).where(eq(budgetReservations.id, reservation.id))
    await tx.insert(creditLedger).values({
      id: newId(),
      userId: user.id,
      responseId: response.id,
      type: 'usage',
      amountMicros: -cost,
      balanceAfterMicros: balanceAfter,
      metadata: { reservationMicros: reservation.amountMicros },
    })
    await tx.insert(usageEvents).values({
      id: newId(),
      userId: user.id,
      apiKeyId: reservation.apiKeyId,
      responseId: response.id,
      modelId: response.actualModelId ?? response.modelId,
      pricingVersionId: pricing.id,
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens,
      outputTokens: input.usage.outputTokens,
      reasoningTokens: input.usage.reasoningTokens,
      costMicros: cost,
      latencyMs: input.latencyMs,
    }).onConflictDoNothing()
    return cost
  })
}

export async function resizeBudgetReservation(input: {
  responseId: string
  accruedCostMicros: number
  requestInput: unknown
  maxOutputTokens: number
  pricing: ActivePricing
}): Promise<void> {
  const amount = calculateRollingReservationMicros(input.accruedCostMicros, input.requestInput, input.maxOutputTokens, input.pricing)
  await db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(budgetReservations).where(eq(budgetReservations.responseId, input.responseId)).for('update')
    if (!reservation || reservation.status !== 'pending') throw new AppError(409, 'reservation_missing', 'Agent budget reservation is unavailable')
    const [user] = await tx.select().from(users).where(eq(users.id, reservation.userId)).for('update')
    const [reserved] = await tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros}), 0)::bigint` }).from(budgetReservations).where(and(eq(budgetReservations.userId, reservation.userId), eq(budgetReservations.status, 'pending')))
    const available = user ? availableReservationCapacityMicros(user.balanceMicros, Number(reserved?.total ?? 0), reservation.amountMicros) : 0
    if (!user || available < amount) throw new AppError(402, 'insufficient_balance', 'Insufficient balance for the next agent turn')
    await tx.update(budgetReservations).set({ amountMicros: amount }).where(eq(budgetReservations.id, reservation.id))
  })
}

export async function extendBudgetReservationFixedCost(responseId: string, additionalMicros: number): Promise<void> {
  if (!Number.isSafeInteger(additionalMicros) || additionalMicros < 0) throw new AppError(400, 'invalid_reservation_amount', 'Additional reservation must be a non-negative integer')
  if (additionalMicros === 0) return
  await db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)).for('update')
    if (!reservation || reservation.status !== 'pending') throw new AppError(409, 'reservation_missing', 'Agent budget reservation is unavailable')
    const [user] = await tx.select().from(users).where(eq(users.id, reservation.userId)).for('update')
    const [reserved] = await tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros}), 0)::bigint` }).from(budgetReservations).where(and(eq(budgetReservations.userId, reservation.userId), eq(budgetReservations.status, 'pending')))
    if (!user || user.balanceMicros - Number(reserved?.total ?? 0) < additionalMicros) throw new AppError(402, 'insufficient_balance', 'Insufficient balance for the requested web tool')
    await tx.update(budgetReservations).set({ amountMicros: reservation.amountMicros + additionalMicros }).where(eq(budgetReservations.id, reservation.id))
  })
}

export async function releaseBudget(responseId: string): Promise<void> {
  await db
    .update(budgetReservations)
    .set({ status: 'released', settledAmountMicros: 0, settledAt: new Date() })
    .where(and(eq(budgetReservations.responseId, responseId), eq(budgetReservations.status, 'pending')))
}
