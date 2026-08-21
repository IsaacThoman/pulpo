import { and, eq, gte, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  apiKeys,
  budgetReservations,
  budgetReservationFunders,
  creditLedger,
  modelPricingVersions,
  responses,
  usageEvents,
  users,
  weeklyUsagePeriods,
  poolMembers,
  billingAccounts,
} from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  bumpAccountRevisions,
  friendPeerIds,
  publishScopedStateChanges,
} from '../friends/sync.js'
import {
  calculateCostMicros,
  calculateReservationMicros,
  calculateRollingReservationMicros,
  type Pricing,
} from './pricing.js'
import { loadBillingEntitlements } from '../billing/entitlements.js'
import {
  allocateReservationMicros,
  allocateResizedReservationMicros,
  allocateSettlementMicros,
  availableAccountBalanceMicros,
  allocatePoolBalanceMicros,
  allocateProportionallyMicros,
} from '../billing/allocation.js'
import { activePoolMembers, activePoolMembership, pendingFundingByUser } from '../pools/service.js'

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
    const membership = await activePoolMembership(tx, input.userId)
    if (membership) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${membership.pool.id}`}))`)
    const poolRows = membership ? await activePoolMembers(tx, membership.pool.id) : []
    const participantIds = membership ? poolRows.map((row) => row.user.id).sort() : [input.userId]
    const lockedUsers = await tx.select().from(users).where(inArray(users.id, participantIds)).orderBy(users.id).for('update')
    const user = lockedUsers.find((row) => row.id === input.userId)
    if (!user || user.blocked) throw new AppError(403, 'account_blocked', 'The account cannot make requests')
    const entitlements = await loadBillingEntitlements(tx, input.userId)
    if (entitlements.onHold) throw new AppError(403, 'billing_hold', 'Billing access is temporarily on hold')
    const allocation = allocateReservationMicros(amount, entitlements.weeklyRemainingMicros)
    const pendingByUser = await pendingFundingByUser(tx, participantIds)
    const holdRows = await tx.select({ userId: billingAccounts.userId, holdAt: billingAccounts.holdAt, holdClearedAt: billingAccounts.holdClearedAt }).from(billingAccounts).where(inArray(billingAccounts.userId, participantIds))
    const held = new Set(holdRows.filter((row) => row.holdAt && !row.holdClearedAt).map((row) => row.userId))
    const balances = lockedUsers.filter((row) => !row.blocked && (row.id === input.userId || !held.has(row.id))).map((row) => ({
      userId: row.id,
      availableMicros: availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pendingByUser.get(row.id) ?? 0 }),
    }))
    const funding = allocatePoolBalanceMicros({ amountMicros: allocation.balanceMicros, callerUserId: input.userId, balances })
    if (allocation.balanceMicros > 0 && !funding.size) {
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
    const reservationId = newId()
    await tx.insert(budgetReservations).values({
      id: reservationId,
      responseId: input.responseId,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      poolId: membership?.pool.id,
      amountMicros: amount,
      weeklyPeriodStart: allocation.weeklyMicros > 0 ? entitlements.weeklyPeriodStart : null,
      weeklyReservedMicros: allocation.weeklyMicros,
      balanceReservedMicros: allocation.balanceMicros,
    })
    if (funding.size) await tx.insert(budgetReservationFunders).values([...funding].map(([userId, reservedMicros]) => ({ reservationId, userId, reservedMicros })))
    await tx.update(responses).set({ pricingVersionId: input.pricing.id }).where(eq(responses.id, input.responseId))
  })
  return amount
}

function nowYear(): number { return new Date().getUTCFullYear() }
function nowMonth(): number { return new Date().getUTCMonth() }

export async function chargeMeteredUsage(input: {
  userId: string
  costMicros: number
  type: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  if (!Number.isSafeInteger(input.costMicros) || input.costMicros < 0) throw new AppError(400, 'invalid_metered_cost', 'Metered usage cost is invalid')
  if (input.costMicros === 0) return
  const changes = await db.transaction(async (tx) => {
    const membership = await activePoolMembership(tx, input.userId)
    if (membership) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${membership.pool.id}`}))`)
    const poolRows = membership ? await activePoolMembers(tx, membership.pool.id) : []
    const participantIds = membership ? poolRows.map((row) => row.user.id).sort() : [input.userId]
    const lockedUsers = await tx.select().from(users).where(inArray(users.id, participantIds)).orderBy(users.id).for('update')
    const caller = lockedUsers.find((row) => row.id === input.userId)
    if (!caller || caller.blocked) throw new AppError(403, 'account_blocked', 'The account cannot make requests')
    const entitlements = await loadBillingEntitlements(tx, input.userId)
    if (entitlements.onHold) throw new AppError(403, 'billing_hold', 'Billing access is temporarily on hold')
    const allocation = allocateReservationMicros(input.costMicros, entitlements.weeklyRemainingMicros)
    const pendingByUser = await pendingFundingByUser(tx, participantIds)
    const holdRows = await tx.select({ userId: billingAccounts.userId, holdAt: billingAccounts.holdAt, holdClearedAt: billingAccounts.holdClearedAt }).from(billingAccounts).where(inArray(billingAccounts.userId, participantIds))
    const held = new Set(holdRows.filter((row) => row.holdAt && !row.holdClearedAt).map((row) => row.userId))
    const balances = lockedUsers.filter((row) => !row.blocked && (row.id === input.userId || !held.has(row.id))).map((row) => ({
      userId: row.id,
      availableMicros: availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pendingByUser.get(row.id) ?? 0 }),
    }))
    const funding = allocatePoolBalanceMicros({ amountMicros: allocation.balanceMicros, callerUserId: input.userId, balances })
    if (allocation.balanceMicros > 0 && !funding.size) throw new AppError(402, 'insufficient_balance', 'Insufficient balance for dictation')

    const ownChanges: Array<{ userId: string; revision: number }> = []
    for (const fundingUser of lockedUsers) {
      const debit = funding.get(fundingUser.id) ?? 0
      if (debit <= 0) continue
      const balanceAfter = fundingUser.balanceMicros - debit
      const [updated] = await tx.update(users).set({ balanceMicros: balanceAfter, stateRevision: sql`${users.stateRevision} + 1` })
        .where(eq(users.id, fundingUser.id)).returning({ userId: users.id, revision: users.stateRevision })
      if (updated) ownChanges.push(updated)
      await tx.insert(creditLedger).values({
        id: newId(), userId: fundingUser.id, responseId: null, type: input.type, amountMicros: -debit, balanceAfterMicros: balanceAfter,
        metadata: { ...input.metadata, totalCostMicros: input.costMicros, weeklyCostMicros: allocation.weeklyMicros, balanceCostMicros: debit, callerUserId: input.userId, poolId: membership?.pool.id ?? null },
      })
    }
    if (allocation.balanceMicros === 0) await tx.insert(creditLedger).values({
      id: newId(), userId: caller.id, responseId: null, type: input.type, amountMicros: 0, balanceAfterMicros: caller.balanceMicros,
      metadata: { ...input.metadata, totalCostMicros: input.costMicros, weeklyCostMicros: allocation.weeklyMicros, balanceCostMicros: 0, poolId: membership?.pool.id ?? null },
    })
    if (allocation.weeklyMicros > 0) {
      await tx.insert(weeklyUsagePeriods).values({
        userId: caller.id, periodStart: entitlements.weeklyPeriodStart, spentMicros: allocation.weeklyMicros,
      }).onConflictDoUpdate({
        target: [weeklyUsagePeriods.userId, weeklyUsagePeriods.periodStart],
        set: { spentMicros: sql`${weeklyUsagePeriods.spentMicros} + ${allocation.weeklyMicros}`, updatedAt: new Date() },
      })
    }
    if (!ownChanges.some((change) => change.userId === caller.id)) {
      const [updated] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, caller.id)).returning({ userId: users.id, revision: users.stateRevision })
      if (updated) ownChanges.push(updated)
    }
    const peers = await friendPeerIds(tx, caller.id, { acceptedOnly: true })
    const poolIds = membership ? poolRows.map((row) => row.user.id).filter((id) => !ownChanges.some((change) => change.userId === id)) : []
    return {
      ownChanges,
      friendChanges: await bumpAccountRevisions(tx, peers),
      poolChanges: await bumpAccountRevisions(tx, poolIds),
    }
  })
  await Promise.all([
    publishScopedStateChanges(changes.ownChanges, ['usage', 'billing']),
    publishScopedStateChanges(changes.friendChanges, ['friends']),
    publishScopedStateChanges(changes.poolChanges, ['pool', 'usage', 'billing']),
  ])
}

export async function settleBudget(input: {
  responseId: string
  usage: ResponseUsage
  latencyMs: number
  requestCount?: number
  costMicrosOverride?: number
  additionalCostMicros?: number
}): Promise<number> {
  const settlement = await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(budgetReservations)
      .where(eq(budgetReservations.responseId, input.responseId))
      .for('update')
    if (!reservation) throw new AppError(409, 'reservation_missing', 'Budget reservation is missing')
    if (reservation.status === 'settled') return {
      cost: reservation.settledAmountMicros ?? 0,
      ownChanges: [],
      friendChanges: [],
      poolChanges: [],
    }
    const [response] = await tx.select().from(responses).where(eq(responses.id, input.responseId)).limit(1)
    const [pricing] = response?.pricingVersionId
      ? await tx.select().from(modelPricingVersions).where(eq(modelPricingVersions.id, response.pricingVersionId)).limit(1)
      : []
    if (!response || !pricing) throw new AppError(409, 'pricing_snapshot_missing', 'Pricing snapshot is missing')
    const generationCost = input.costMicrosOverride ?? (calculateCostMicros(input.usage, pricing) + Math.max(0, (input.requestCount ?? 1) - 1) * pricing.perRequestPriceMicros)
    const cost = generationCost + Math.max(0, input.additionalCostMicros ?? 0)
    if (cost > reservation.amountMicros) throw new AppError(409, 'reservation_exceeded', 'Usage exceeded the reserved budget')
    const funders = await tx.select().from(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
    const funderIds = funders.map((row) => row.userId).sort()
    const fundingUsers = funderIds.length ? await tx.select().from(users).where(inArray(users.id, funderIds)).orderBy(users.id).for('update') : []
    const user = fundingUsers.find((row) => row.id === reservation.userId) ?? (await tx.select().from(users).where(eq(users.id, reservation.userId)).limit(1))[0]
    if (!user) throw new AppError(409, 'user_missing', 'User is missing')
    const allocation = allocateSettlementMicros(cost, reservation.weeklyReservedMicros)
    const weeklyCost = allocation.weeklyMicros
    const balanceCost = allocation.balanceMicros
    const callerReserved = funders.find((row) => row.userId === reservation.userId)?.reservedMicros ?? 0
    const settledFunding = new Map<string, number>()
    const ownCost = Math.min(balanceCost, callerReserved)
    if (ownCost > 0) settledFunding.set(reservation.userId, ownCost)
    const sharedCost = balanceCost - ownCost
    if (sharedCost > 0) {
      const shared = allocateProportionallyMicros(sharedCost, funders.filter((row) => row.userId !== reservation.userId).map((row) => ({ userId: row.userId, availableMicros: row.reservedMicros })))
      if (!shared.size) throw new AppError(409, 'reservation_funding_missing', 'Pool reservation funding is missing')
      for (const [userId, amount] of shared) settledFunding.set(userId, amount)
    }
    const ownChanges: Array<{ userId: string; revision: number }> = []
    for (const fundingUser of fundingUsers) {
      const debit = settledFunding.get(fundingUser.id) ?? 0
      if (debit <= 0) continue
      const balanceAfter = fundingUser.balanceMicros - debit
      const [updated] = await tx.update(users).set({ balanceMicros: balanceAfter, stateRevision: sql`${users.stateRevision} + 1` })
        .where(eq(users.id, fundingUser.id)).returning({ userId: users.id, revision: users.stateRevision })
      if (updated) ownChanges.push(updated)
      await tx.insert(creditLedger).values({
        id: newId(), userId: fundingUser.id, responseId: response.id, type: 'usage', amountMicros: -debit,
        balanceAfterMicros: balanceAfter,
        metadata: { reservationMicros: reservation.amountMicros, totalCostMicros: cost, weeklyCostMicros: weeklyCost, balanceCostMicros: debit, callerUserId: reservation.userId, poolId: reservation.poolId },
      })
    }
    if (balanceCost === 0) await tx.insert(creditLedger).values({
      id: newId(), userId: user.id, responseId: response.id, type: 'usage', amountMicros: 0,
      balanceAfterMicros: user.balanceMicros,
      metadata: { reservationMicros: reservation.amountMicros, totalCostMicros: cost, weeklyCostMicros: weeklyCost, balanceCostMicros: 0, poolId: reservation.poolId },
    })
    if (!ownChanges.some((change) => change.userId === user.id)) {
      const [updatedCaller] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, user.id)).returning({ userId: users.id, revision: users.stateRevision })
      if (updatedCaller) ownChanges.push(updatedCaller)
    }
    await tx.update(budgetReservations).set({
      status: 'settled',
      settledAmountMicros: cost,
      settledWeeklyMicros: weeklyCost,
      settledBalanceMicros: balanceCost,
      settledAt: new Date(),
    }).where(eq(budgetReservations.id, reservation.id))
    for (const [userId, settledMicros] of settledFunding) await tx.update(budgetReservationFunders).set({ settledMicros }).where(and(eq(budgetReservationFunders.reservationId, reservation.id), eq(budgetReservationFunders.userId, userId)))
    if (weeklyCost > 0 && reservation.weeklyPeriodStart) {
      await tx.insert(weeklyUsagePeriods).values({
        userId: user.id,
        periodStart: reservation.weeklyPeriodStart,
        spentMicros: weeklyCost,
      }).onConflictDoUpdate({
        target: [weeklyUsagePeriods.userId, weeklyUsagePeriods.periodStart],
        set: {
          spentMicros: sql`${weeklyUsagePeriods.spentMicros} + ${weeklyCost}`,
          updatedAt: new Date(),
        },
      })
    }
    const [poolSnapshot] = reservation.poolId ? await tx.select({ total: sql<number>`coalesce(sum(${users.balanceMicros}), 0)::bigint` })
      .from(poolMembers).innerJoin(users, eq(users.id, poolMembers.userId)).where(and(
        eq(poolMembers.poolId, reservation.poolId), lte(poolMembers.joinedAt, reservation.createdAt),
        or(isNull(poolMembers.leftAt), gt(poolMembers.leftAt, reservation.createdAt)),
      )) : []
    await tx.insert(usageEvents).values({
      id: newId(),
      userId: user.id,
      apiKeyId: reservation.apiKeyId,
      responseId: response.id,
      modelId: response.actualModelId ?? response.modelId,
      pricingVersionId: pricing.id,
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      outputTokens: input.usage.outputTokens,
      reasoningTokens: input.usage.reasoningTokens,
      costMicros: cost,
      weeklyCostMicros: weeklyCost,
      balanceCostMicros: balanceCost,
      poolBalanceAfterMicros: reservation.poolId ? Number(poolSnapshot?.total ?? 0) : null,
      weeklyPeriodStart: reservation.weeklyPeriodStart,
      latencyMs: input.latencyMs,
    }).onConflictDoNothing()
    const peers = await friendPeerIds(tx, user.id, { acceptedOnly: true })
    const poolChanges = reservation.poolId ? (await activePoolMembers(tx, reservation.poolId)).map((row) => row.user.id) : []
    return {
      cost,
      ownChanges,
      friendChanges: await bumpAccountRevisions(tx, peers),
      poolChanges: await bumpAccountRevisions(tx, poolChanges.filter((id) => !ownChanges.some((change) => change.userId === id))),
    }
  })
  await Promise.all([
    publishScopedStateChanges(settlement.ownChanges, ['usage', 'billing']),
    publishScopedStateChanges(settlement.friendChanges, ['friends']),
    publishScopedStateChanges(settlement.poolChanges, ['pool', 'usage', 'billing']),
  ])
  return settlement.cost
}

async function replaceReservationFunding(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  reservation: typeof budgetReservations.$inferSelect,
  balanceMicros: number,
  errorMessage: string,
): Promise<void> {
  if (reservation.poolId) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${reservation.poolId}`}))`)
  const existing = await tx.select().from(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
  const active = reservation.poolId ? await activePoolMembers(tx, reservation.poolId) : []
  const activeIds = new Set(active.map((row) => row.user.id))
  const ids = [...new Set([reservation.userId, ...activeIds, ...existing.map((row) => row.userId)])].sort()
  const lockedUsers = await tx.select().from(users).where(inArray(users.id, ids)).orderBy(users.id).for('update')
  const pending = await pendingFundingByUser(tx, ids)
  const holdRows = await tx.select({ userId: billingAccounts.userId, holdAt: billingAccounts.holdAt, holdClearedAt: billingAccounts.holdClearedAt }).from(billingAccounts).where(inArray(billingAccounts.userId, ids))
  const held = new Set(holdRows.filter((row) => row.holdAt && !row.holdClearedAt).map((row) => row.userId))
  const current = new Map(existing.map((row) => [row.userId, row.reservedMicros]))
  const balances = lockedUsers.filter((row) => !row.blocked && (row.id === reservation.userId || !held.has(row.id))).map((row) => {
    const available = availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pending.get(row.id) ?? 0, currentBalanceReservedMicros: current.get(row.id) ?? 0 })
    return { userId: row.id, availableMicros: activeIds.has(row.id) || row.id === reservation.userId ? available : Math.min(available, current.get(row.id) ?? 0) }
  })
  const funding = allocatePoolBalanceMicros({ amountMicros: balanceMicros, callerUserId: reservation.userId, balances })
  if (balanceMicros > 0 && !funding.size) throw new AppError(402, 'insufficient_balance', errorMessage)
  await tx.delete(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
  if (funding.size) await tx.insert(budgetReservationFunders).values([...funding].map(([userId, reservedMicros]) => ({ reservationId: reservation.id, userId, reservedMicros })))
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
    const entitlements = await loadBillingEntitlements(tx, reservation.userId)
    if (entitlements.onHold) throw new AppError(403, 'billing_hold', 'Billing access is temporarily on hold')
    const allocation = allocateResizedReservationMicros({
      amountMicros: amount,
      weeklyRemainingMicros: entitlements.weeklyRemainingMicros,
      currentWeeklyReservedMicros: reservation.weeklyReservedMicros,
      reservationPeriodStart: reservation.weeklyPeriodStart,
      currentPeriodStart: entitlements.weeklyPeriodStart,
    })
    await replaceReservationFunding(tx, reservation, allocation.balanceMicros, 'Insufficient balance for the next agent turn')
    await tx.update(budgetReservations).set({
      amountMicros: amount,
      weeklyReservedMicros: allocation.weeklyMicros,
      balanceReservedMicros: allocation.balanceMicros,
      weeklyPeriodStart: allocation.weeklyMicros > 0 ? (reservation.weeklyPeriodStart ?? entitlements.weeklyPeriodStart) : null,
    }).where(eq(budgetReservations.id, reservation.id))
  })
}

export async function extendBudgetReservationFixedCost(responseId: string, additionalMicros: number): Promise<void> {
  if (!Number.isSafeInteger(additionalMicros) || additionalMicros < 0) throw new AppError(400, 'invalid_reservation_amount', 'Additional reservation must be a non-negative integer')
  if (additionalMicros === 0) return
  await db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)).for('update')
    if (!reservation || reservation.status !== 'pending') throw new AppError(409, 'reservation_missing', 'Agent budget reservation is unavailable')
    const entitlements = await loadBillingEntitlements(tx, reservation.userId)
    if (entitlements.onHold) throw new AppError(403, 'billing_hold', 'Billing access is temporarily on hold')
    const amount = reservation.amountMicros + additionalMicros
    const allocation = allocateResizedReservationMicros({
      amountMicros: amount,
      weeklyRemainingMicros: entitlements.weeklyRemainingMicros,
      currentWeeklyReservedMicros: reservation.weeklyReservedMicros,
      reservationPeriodStart: reservation.weeklyPeriodStart,
      currentPeriodStart: entitlements.weeklyPeriodStart,
    })
    await replaceReservationFunding(tx, reservation, allocation.balanceMicros, 'Insufficient balance for the requested web tool')
    await tx.update(budgetReservations).set({
      amountMicros: amount,
      weeklyReservedMicros: allocation.weeklyMicros,
      balanceReservedMicros: allocation.balanceMicros,
      weeklyPeriodStart: allocation.weeklyMicros > 0 ? (reservation.weeklyPeriodStart ?? entitlements.weeklyPeriodStart) : null,
    }).where(eq(budgetReservations.id, reservation.id))
  })
}

export async function releaseBudget(responseId: string): Promise<void> {
  await db
    .update(budgetReservations)
    .set({ status: 'released', settledAmountMicros: 0, settledAt: new Date() })
    .where(and(eq(budgetReservations.responseId, responseId), eq(budgetReservations.status, 'pending')))
}
