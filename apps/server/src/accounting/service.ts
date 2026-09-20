import { and, eq, gte, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { ResponseUsage } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  apiKeys,
  budgetReservations,
  budgetReservationFunders,
  creditLedger,
  fiveHourUsagePeriods,
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
  budgetOutputReservation,
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
  minimumOutputReservationTokens?: number
  pricing: ActivePricing
}): Promise<{ amountMicros: number; maxOutputTokens: number }> {
  return db.transaction(async (tx) => {
    const membership = await activePoolMembership(tx, input.userId)
    if (membership) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${membership.pool.id}`}))`)
    const poolRows = membership ? await activePoolMembers(tx, membership.pool.id) : []
    const participantIds = membership ? poolRows.map((row) => row.user.id).sort() : [input.userId]
    const lockedUsers = await tx.select().from(users).where(inArray(users.id, participantIds)).orderBy(users.id).for('update')
    const user = lockedUsers.find((row) => row.id === input.userId)
    if (!user || user.blocked) throw new AppError(403, 'account_blocked', 'The account cannot make requests')
    const entitlements = await loadBillingEntitlements(tx, input.userId)
    if (entitlements.onHold) throw new AppError(403, 'billing_hold', 'Billing access is temporarily on hold')
    const pendingByUser = await pendingFundingByUser(tx, participantIds)
    const holdRows = await tx.select({ userId: billingAccounts.userId, holdAt: billingAccounts.holdAt, holdClearedAt: billingAccounts.holdClearedAt }).from(billingAccounts).where(inArray(billingAccounts.userId, participantIds))
    const held = new Set(holdRows.filter((row) => row.holdAt && !row.holdClearedAt).map((row) => row.userId))
    const balances = lockedUsers.filter((row) => !row.blocked && (row.id === input.userId || !held.has(row.id))).map((row) => ({
      userId: row.id,
      availableMicros: Math.max(0, availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pendingByUser.get(row.id) ?? 0 })),
    }))
    const capacity = await reservationCapacity(tx, input.apiKeyId,
      Math.min(entitlements.weeklyRemainingMicros, entitlements.fiveHourRemainingMicros)
        + balances.reduce((sum, row) => sum + row.availableMicros, 0))
    const reservation = budgetOutputReservation({ ...input, capacityMicros: capacity.amountMicros })
    if (!reservation) throw new AppError(402, capacity.code, capacity.message)
    const amount = reservation.amountMicros
    const allocation = allocateReservationMicros(amount, entitlements.weeklyRemainingMicros, entitlements.fiveHourRemainingMicros)
    const fiveHourPeriodStart = allocation.fiveHourMicros > 0 ? entitlements.fiveHourPeriodStart ?? new Date() : null
    const funding = allocatePoolBalanceMicros({ amountMicros: allocation.balanceMicros, callerUserId: input.userId, balances })
    if (allocation.balanceMicros > 0 && !funding.size) throw new AppError(402, 'insufficient_balance', 'Insufficient balance for the request')
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
      fiveHourPeriodStart,
      fiveHourReservedMicros: allocation.fiveHourMicros,
      balanceReservedMicros: allocation.balanceMicros,
    })
    if (funding.size) await tx.insert(budgetReservationFunders).values([...funding].map(([userId, reservedMicros]) => ({ reservationId, userId, reservedMicros })))
    await tx.update(responses).set({ pricingVersionId: input.pricing.id }).where(eq(responses.id, input.responseId))
    return reservation
  })
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Called only after locking the billing users, so pending holds cannot race. */
async function reservationCapacity(tx: Transaction, apiKeyId: string | null | undefined, accountCapacity: number, currentReservationMicros = 0) {
  let capacity = { amountMicros: accountCapacity, code: 'insufficient_balance', message: 'Insufficient balance for input and the minimum output allowance' }
  if (!apiKeyId) return capacity
  const [key] = await tx.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).for('update')
  if (!key || key.status !== 'active') throw new AppError(401, 'invalid_api_key', 'Invalid API key', 'authentication_error')
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [spent] = await tx.select({
    monthly: sql<number>`coalesce(sum(${usageEvents.costMicros}) filter (where ${gte(usageEvents.createdAt, monthStart)}), 0)::bigint`,
    lifetime: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
  }).from(usageEvents).where(eq(usageEvents.apiKeyId, apiKeyId))
  const [reserved] = await tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.amountMicros}), 0)::bigint` })
    .from(budgetReservations).where(and(eq(budgetReservations.apiKeyId, apiKeyId), eq(budgetReservations.status, 'pending')))
  const otherPending = Math.max(0, Number(reserved?.total ?? 0) - currentReservationMicros)
  for (const [limit, spentMicros, code, message] of [
    [key.monthlyBudgetMicros, Number(spent?.monthly ?? 0), 'monthly_budget_exceeded', 'API key monthly budget exceeded'],
    [key.lifetimeBudgetMicros, Number(spent?.lifetime ?? 0), 'lifetime_budget_exceeded', 'API key lifetime budget exceeded'],
  ] as const) {
    if (limit !== null && limit - spentMicros - otherPending < capacity.amountMicros) {
      capacity = { amountMicros: limit - spentMicros - otherPending, code, message }
    }
  }
  return capacity
}

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
    const allocation = allocateReservationMicros(input.costMicros, entitlements.weeklyRemainingMicros, entitlements.fiveHourRemainingMicros)
    const fiveHourPeriodStart = allocation.fiveHourMicros > 0
      ? entitlements.fiveHourPeriodStart ?? new Date()
      : null
    const pendingByUser = await pendingFundingByUser(tx, participantIds)
    const holdRows = await tx.select({ userId: billingAccounts.userId, holdAt: billingAccounts.holdAt, holdClearedAt: billingAccounts.holdClearedAt }).from(billingAccounts).where(inArray(billingAccounts.userId, participantIds))
    const held = new Set(holdRows.filter((row) => row.holdAt && !row.holdClearedAt).map((row) => row.userId))
    const balances = lockedUsers.filter((row) => !row.blocked && (row.id === input.userId || !held.has(row.id))).map((row) => ({
      userId: row.id,
      availableMicros: availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pendingByUser.get(row.id) ?? 0 }),
    }))
    const funding = allocatePoolBalanceMicros({ amountMicros: allocation.balanceMicros, callerUserId: input.userId, balances })
    if (allocation.balanceMicros > 0 && !funding.size) throw new AppError(402, 'insufficient_balance', 'Insufficient balance for metered usage')

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
        metadata: { ...input.metadata, totalCostMicros: input.costMicros, weeklyCostMicros: allocation.weeklyMicros, fiveHourCostMicros: allocation.fiveHourMicros, balanceCostMicros: debit, callerUserId: input.userId, poolId: membership?.pool.id ?? null },
      })
    }
    if (allocation.balanceMicros === 0) await tx.insert(creditLedger).values({
      id: newId(), userId: caller.id, responseId: null, type: input.type, amountMicros: 0, balanceAfterMicros: caller.balanceMicros,
      metadata: { ...input.metadata, totalCostMicros: input.costMicros, weeklyCostMicros: allocation.weeklyMicros, fiveHourCostMicros: allocation.fiveHourMicros, balanceCostMicros: 0, poolId: membership?.pool.id ?? null },
    })
    if (allocation.weeklyMicros > 0) {
      await tx.insert(weeklyUsagePeriods).values({
        userId: caller.id, periodStart: entitlements.weeklyPeriodStart, spentMicros: allocation.weeklyMicros,
      }).onConflictDoUpdate({
        target: [weeklyUsagePeriods.userId, weeklyUsagePeriods.periodStart],
        set: { spentMicros: sql`${weeklyUsagePeriods.spentMicros} + ${allocation.weeklyMicros}`, updatedAt: new Date() },
      })
    }
    if (allocation.fiveHourMicros > 0 && fiveHourPeriodStart) {
      await tx.insert(fiveHourUsagePeriods).values({
        userId: caller.id, periodStart: fiveHourPeriodStart, spentMicros: allocation.fiveHourMicros,
      }).onConflictDoUpdate({
        target: [fiveHourUsagePeriods.userId, fiveHourUsagePeriods.periodStart],
        set: { spentMicros: sql`${fiveHourUsagePeriods.spentMicros} + ${allocation.fiveHourMicros}`, updatedAt: new Date() },
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
  inferenceReferenceCostMicros?: number
}): Promise<number> {
  const settlement = await db.transaction(async (tx) => {
    const [lockedReservation] = await tx
      .select()
      .from(budgetReservations)
      .where(eq(budgetReservations.responseId, input.responseId))
      .for('update')
    if (!lockedReservation) throw new AppError(409, 'reservation_missing', 'Budget reservation is missing')
    if (lockedReservation.status === 'settled') return {
      cost: lockedReservation.settledAmountMicros ?? 0,
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
    const incurredCost = generationCost + Math.max(0, input.additionalCostMicros ?? 0)
    // Reservations are estimates. Actual usage above the estimate is funded from
    // whatever the account can still cover; only the unfundable rest is absorbed.
    const reservation = lockedReservation.status === 'pending' && incurredCost > lockedReservation.amountMicros
      ? await coverReservationOverrun(tx, lockedReservation, incurredCost)
      : lockedReservation
    const cost = Math.min(incurredCost, reservation.amountMicros)
    const uncoveredCostMicros = incurredCost - cost
    if (uncoveredCostMicros > 0) {
      console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-accounting', event: 'settlement.overrun_absorbed', responseId: input.responseId, incurredCostMicros: incurredCost, chargedCostMicros: cost, uncoveredCostMicros }))
    }
    const overrun = uncoveredCostMicros > 0 ? { uncoveredCostMicros } : {}
    const funders = await tx.select().from(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
    // Subscription-only settlement must lock the caller too: otherwise another
    // reservation can observe old spent usage and newly released pending usage.
    const funderIds = [...new Set([reservation.userId, ...funders.map((row) => row.userId)])].sort()
    const fundingUsers = funderIds.length ? await tx.select().from(users).where(inArray(users.id, funderIds)).orderBy(users.id).for('update') : []
    const user = fundingUsers.find((row) => row.id === reservation.userId) ?? (await tx.select().from(users).where(eq(users.id, reservation.userId)).limit(1))[0]
    if (!user) throw new AppError(409, 'user_missing', 'User is missing')
    const allocation = allocateSettlementMicros(cost, reservation.weeklyReservedMicros, reservation.fiveHourReservedMicros)
    const weeklyCost = allocation.weeklyMicros
    const fiveHourCost = allocation.fiveHourMicros
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
        metadata: { reservationMicros: reservation.amountMicros, totalCostMicros: cost, weeklyCostMicros: weeklyCost, fiveHourCostMicros: fiveHourCost, balanceCostMicros: debit, callerUserId: reservation.userId, poolId: reservation.poolId, ...overrun },
      })
    }
    if (balanceCost === 0) await tx.insert(creditLedger).values({
      id: newId(), userId: user.id, responseId: response.id, type: 'usage', amountMicros: 0,
      balanceAfterMicros: user.balanceMicros,
      metadata: { reservationMicros: reservation.amountMicros, totalCostMicros: cost, weeklyCostMicros: weeklyCost, fiveHourCostMicros: fiveHourCost, balanceCostMicros: 0, poolId: reservation.poolId, ...overrun },
    })
    if (!ownChanges.some((change) => change.userId === user.id)) {
      const [updatedCaller] = await tx.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` }).where(eq(users.id, user.id)).returning({ userId: users.id, revision: users.stateRevision })
      if (updatedCaller) ownChanges.push(updatedCaller)
    }
    await tx.update(budgetReservations).set({
      status: 'settled',
      settledAmountMicros: cost,
      settledWeeklyMicros: weeklyCost,
      settledFiveHourMicros: fiveHourCost,
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
    if (fiveHourCost > 0 && reservation.fiveHourPeriodStart) {
      await tx.insert(fiveHourUsagePeriods).values({
        userId: user.id,
        periodStart: reservation.fiveHourPeriodStart,
        spentMicros: fiveHourCost,
      }).onConflictDoUpdate({
        target: [fiveHourUsagePeriods.userId, fiveHourUsagePeriods.periodStart],
        set: {
          spentMicros: sql`${fiveHourUsagePeriods.spentMicros} + ${fiveHourCost}`,
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
      inferenceReferenceCostMicros: Math.max(0, input.inferenceReferenceCostMicros ?? 0),
      weeklyCostMicros: weeklyCost,
      fiveHourCostMicros: fiveHourCost,
      balanceCostMicros: balanceCost,
      poolBalanceAfterMicros: reservation.poolId ? Number(poolSnapshot?.total ?? 0) : null,
      weeklyPeriodStart: reservation.weeklyPeriodStart,
      fiveHourPeriodStart: reservation.fiveHourPeriodStart,
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

async function lockReservationBalances(
  tx: Transaction,
  reservation: typeof budgetReservations.$inferSelect,
) {
  if (reservation.poolId) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${reservation.poolId}`}))`)
  const existing = await tx.select().from(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
  const active = reservation.poolId ? await activePoolMembers(tx, reservation.poolId) : []
  const activeIds = new Set(active.map((row) => row.user.id))
  const ids = [...new Set([reservation.userId, ...activeIds, ...existing.map((row) => row.userId)])].sort()
  const lockedUsers = await tx.select().from(users).where(inArray(users.id, ids)).orderBy(users.id).for('update')
  const caller = lockedUsers.find(row => row.id === reservation.userId)
  if (!caller || caller.blocked) throw new AppError(403, 'account_blocked', 'The account cannot make requests')
  const pending = await pendingFundingByUser(tx, ids)
  const holdRows = await tx.select({ userId: billingAccounts.userId, holdAt: billingAccounts.holdAt, holdClearedAt: billingAccounts.holdClearedAt }).from(billingAccounts).where(inArray(billingAccounts.userId, ids))
  const held = new Set(holdRows.filter((row) => row.holdAt && !row.holdClearedAt).map((row) => row.userId))
  const current = new Map(existing.map((row) => [row.userId, row.reservedMicros]))
  const balances = lockedUsers.filter((row) => !row.blocked && (row.id === reservation.userId || !held.has(row.id))).map((row) => {
    const available = Math.max(0, availableAccountBalanceMicros({ balanceMicros: row.balanceMicros, pendingBalanceMicros: pending.get(row.id) ?? 0, currentBalanceReservedMicros: current.get(row.id) ?? 0 }))
    return { userId: row.id, availableMicros: activeIds.has(row.id) || row.id === reservation.userId ? available : Math.min(available, current.get(row.id) ?? 0) }
  })
  return balances
}

async function resizeLockedReservation<T extends { amountMicros: number }>(
  tx: Transaction,
  reservation: typeof budgetReservations.$inferSelect,
  calculate: (capacityMicros: number, currentAmountMicros: number) => T | null,
): Promise<T> {
  const balances = await lockReservationBalances(tx, reservation)
  const entitlements = await loadBillingEntitlements(tx, reservation.userId)
  if (entitlements.onHold) throw new AppError(403, 'billing_hold', 'Billing access is temporarily on hold')
  const allocate = (amountMicros: number) => allocateResizedReservationMicros({
    amountMicros,
    weeklyRemainingMicros: entitlements.weeklyRemainingMicros,
    currentWeeklyReservedMicros: reservation.weeklyReservedMicros,
    reservationWeeklyPeriodStart: reservation.weeklyPeriodStart,
    currentWeeklyPeriodStart: entitlements.weeklyPeriodStart,
    fiveHourRemainingMicros: entitlements.fiveHourRemainingMicros,
    currentFiveHourReservedMicros: reservation.fiveHourReservedMicros,
    reservationFiveHourPeriodStart: reservation.fiveHourPeriodStart,
    currentFiveHourPeriodStart: entitlements.fiveHourPeriodStart,
  })
  const subscriptionCapacity = allocate(Number.MAX_SAFE_INTEGER).weeklyMicros
  const capacity = await reservationCapacity(tx, reservation.apiKeyId,
    subscriptionCapacity + balances.reduce((sum, row) => sum + row.availableMicros, 0), reservation.amountMicros)
  const result = calculate(capacity.amountMicros, reservation.amountMicros)
  if (!result || result.amountMicros > capacity.amountMicros) throw new AppError(402, capacity.code, capacity.message)
  const allocation = allocate(result.amountMicros)
  const funding = allocatePoolBalanceMicros({ amountMicros: allocation.balanceMicros, callerUserId: reservation.userId, balances })
  if (allocation.balanceMicros > 0 && !funding.size) throw new AppError(402, 'insufficient_balance', 'Insufficient balance for the request')
  await tx.delete(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
  if (funding.size) await tx.insert(budgetReservationFunders).values([...funding].map(([userId, reservedMicros]) => ({ reservationId: reservation.id, userId, reservedMicros })))
  await tx.update(budgetReservations).set({
    amountMicros: result.amountMicros,
    weeklyReservedMicros: allocation.weeklyMicros,
    fiveHourReservedMicros: allocation.fiveHourMicros,
    balanceReservedMicros: allocation.balanceMicros,
    weeklyPeriodStart: reservation.weeklyPeriodStart ?? (allocation.weeklyMicros > 0 ? entitlements.weeklyPeriodStart : null),
    fiveHourPeriodStart: reservation.fiveHourPeriodStart ?? (allocation.fiveHourMicros > 0 ? entitlements.fiveHourPeriodStart ?? new Date() : null),
  }).where(eq(budgetReservations.id, reservation.id))
  return result
}

async function updateReservationAmount<T extends { amountMicros: number }>(
  responseId: string,
  calculate: (capacityMicros: number, currentAmountMicros: number) => T | null,
): Promise<T> {
  return db.transaction(async tx => {
    const [reservation] = await tx.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)).for('update')
    if (!reservation || reservation.status !== 'pending') throw new AppError(409, 'reservation_missing', 'Budget reservation is unavailable')
    return resizeLockedReservation(tx, reservation, calculate)
  })
}

/**
 * Grow a locked pending reservation toward the actual cost, as far as the
 * subscription allowance, balances, and API-key limits permit. Settlement must
 * not fail over an estimate, so an unfundable overrun leaves it unchanged.
 */
async function coverReservationOverrun(
  tx: Transaction,
  reservation: typeof budgetReservations.$inferSelect,
  costMicros: number,
): Promise<typeof budgetReservations.$inferSelect> {
  try {
    await resizeLockedReservation(tx, reservation, (capacityMicros, currentAmountMicros) => ({
      amountMicros: Math.max(currentAmountMicros, Math.min(costMicros, capacityMicros)),
    }))
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    return reservation
  }
  const [updated] = await tx.select().from(budgetReservations).where(eq(budgetReservations.id, reservation.id)).limit(1)
  return updated ?? reservation
}

export async function resizeBudgetReservation(input: {
  responseId: string
  accruedCostMicros: number
  requestInput: unknown
  maxOutputTokens: number
  minimumOutputReservationTokens?: number
  pricing: ActivePricing
}): Promise<{ amountMicros: number; maxOutputTokens: number }> {
  return updateReservationAmount(input.responseId, capacityMicros => budgetOutputReservation({ ...input, capacityMicros }))
}

/** Release unused generation capacity only once its provider call has finished. */
export async function retainBudgetReservation(responseId: string, amountMicros: number): Promise<void> {
  if (!Number.isSafeInteger(amountMicros) || amountMicros < 0) throw new AppError(400, 'invalid_reservation_amount', 'Retained reservation must be a non-negative integer')
  await db.transaction(async tx => {
    const [reservation] = await tx.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)).for('update')
    if (!reservation || reservation.status !== 'pending') throw new AppError(409, 'reservation_missing', 'Budget reservation is unavailable')
    // Nothing to release when usage outran the estimate; settlement covers the overrun.
    if (amountMicros >= reservation.amountMicros) return
    if (reservation.poolId) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${reservation.poolId}`}))`)
    const funders = await tx.select().from(budgetReservationFunders).where(eq(budgetReservationFunders.reservationId, reservation.id))
    const ids = [...new Set([reservation.userId, ...funders.map(row => row.userId)])].sort()
    await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids)).orderBy(users.id).for('update')
    // This only returns unused funds; revoked keys and billing holds must not
    // prevent retaining already incurred costs or change the original funders.
    const allocation = allocateSettlementMicros(amountMicros, reservation.weeklyReservedMicros, reservation.fiveHourReservedMicros)
    const funding = allocatePoolBalanceMicros({ amountMicros: allocation.balanceMicros, callerUserId: reservation.userId,
      balances: funders.map(row => ({ userId: row.userId, availableMicros: row.reservedMicros })) })
    for (const funder of funders) await tx.update(budgetReservationFunders).set({ reservedMicros: funding.get(funder.userId) ?? 0 })
      .where(and(eq(budgetReservationFunders.reservationId, reservation.id), eq(budgetReservationFunders.userId, funder.userId)))
    await tx.update(budgetReservations).set({ amountMicros, weeklyReservedMicros: allocation.weeklyMicros,
      fiveHourReservedMicros: allocation.fiveHourMicros, balanceReservedMicros: allocation.balanceMicros,
    }).where(eq(budgetReservations.id, reservation.id))
  })
}

export async function extendBudgetReservationFixedCost(responseId: string, additionalMicros: number): Promise<void> {
  if (!Number.isSafeInteger(additionalMicros) || additionalMicros < 0) throw new AppError(400, 'invalid_reservation_amount', 'Additional reservation must be a non-negative integer')
  if (additionalMicros === 0) return
  await updateReservationAmount(responseId, (_capacity, amountMicros) => ({ amountMicros: amountMicros + additionalMicros }))
}

export async function releaseBudget(responseId: string): Promise<void> {
  await db
    .update(budgetReservations)
    .set({ status: 'released', settledAmountMicros: 0, settledAt: new Date() })
    .where(and(eq(budgetReservations.responseId, responseId), eq(budgetReservations.status, 'pending')))
}
