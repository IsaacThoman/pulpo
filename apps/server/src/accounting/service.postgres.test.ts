import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { agentRuns, apiKeys, applicationSettings, billingAccounts, budgetReservationAllowanceFunders, budgetReservations, fiveHourUsagePeriods, sharedAllowancePeriods, sharedFiveHourUsagePeriods, creditLedger, budgetReservationFunders, chats, generationAttempts, models, modelPricingVersions, pools, poolMembers, providerConnections, requestLogs, responses, toolExecutions, users, usageEvents, weeklyUsagePeriods } from '../database/schema.js'
import { chargeMeteredUsage, extendBudgetReservationFixedCost, releaseBudget, reserveBudget, resizeBudgetReservation, retainBudgetReservation, settleBudget } from './service.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../config.js', async original => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }) }
})
const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Budget tests require a migrated disposable database named pulpo_budget_test')
}
const userIds: string[] = [], poolIds: string[] = []
const providerId = randomUUID(), modelId = `budget-${randomUUID()}`
const pricing = { id: randomUUID(), inputPriceMicros: 1_000_000, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 1_000_000, perRequestPriceMicros: 0 }
const usage = { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 0, totalTokens: 101 }
async function account(balanceMicros: number, weekly?: number, fiveHour = weekly) {
  const id = randomUUID(); userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, username: id, name: 'Budget QA', balanceMicros })
  if (weekly !== undefined) await db.insert(billingAccounts).values({ userId: id, planOverride: 'eight', weeklyLimitOverrideMicros: weekly, fiveHourLimitOverrideMicros: fiveHour })
  return id
}
async function fatAccount(weekly: number, fiveHour = weekly) {
  const id = await account(0)
  await db.insert(billingAccounts).values({ userId: id, planOverride: 'fat', weeklyLimitOverrideMicros: weekly, fiveHourLimitOverrideMicros: fiveHour })
  return id
}
async function spent(table: typeof weeklyUsagePeriods | typeof fiveHourUsagePeriods | typeof sharedAllowancePeriods | typeof sharedFiveHourUsagePeriods, userId: string) {
  const column = 'ownerUserId' in table ? table.ownerUserId : table.userId
  const [row] = await db.execute<{ total: string }>(sql`select coalesce(sum(${table.spentMicros}), 0)::bigint as total from ${table} where ${column} = ${userId}`)
  return Number(row?.total ?? 0)
}
async function request(userId: string, maxOutputTokens = 16_000, apiKeyId?: string) {
  const chatId = randomUUID(), responseId = randomUUID()
  await db.insert(chats).values({ id: chatId, userId, modelId })
  await db.insert(responses).values({ id: responseId, userId, chatId, modelId, input: [] })
  return { responseId, userId, maxOutputTokens, apiKeyId, requestInput: 'x', pricing }
}
async function key(userId: string, monthlyBudgetMicros: number | null, lifetimeBudgetMicros: number | null = null) {
  const id = randomUUID()
  await db.insert(apiKeys).values({ id, userId, name: 'Budget QA', prefix: id, secretHash: 'unused-test-hash', monthlyBudgetMicros, lifetimeBudgetMicros })
  return id
}
async function reservation(responseId: string) {
  return (await db.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)))[0]!
}
async function pool(members: string[]) {
  const id = randomUUID(); poolIds.push(id)
  await db.insert(pools).values({ id, ownerUserId: members[0]! })
  await db.insert(poolMembers).values(members.map(userId => ({ id: randomUUID(), poolId: id, userId })))
  return id
}

describe.skipIf(!enabled)('budget-aware reservations in PostgreSQL', () => {
  beforeAll(async () => {
    await db.insert(providerConnections).values({ id: providerId, name: 'Budget fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Budget fixture', contextWindow: 128_000, maxOutputTokens: 16_000 })
    await db.insert(modelPricingVersions).values({ ...pricing, modelId })
  })
  afterAll(async () => {
    if (poolIds.length) await db.delete(pools).where(inArray(pools.id, poolIds))
    if (userIds.length) {
      await db.delete(usageEvents).where(inArray(usageEvents.userId, userIds))
      await db.delete(chats).where(inArray(chats.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(models).where(eq(models.id, modelId))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await queryClient.end()
  })

  it('stores model defaults and enforces positive minimum allocations in PostgreSQL', async () => {
    const [model] = await db.select().from(models).where(eq(models.id, modelId))
    expect(model?.minimumOutputReservationTokens).toBe(8_000)
    await expect(db.update(models).set({ minimumOutputReservationTokens: 0 }).where(eq(models.id, modelId))).rejects.toThrow()
    const userId = await account(3_001), input = await request(userId)
    expect(await reserveBudget({ ...input, minimumOutputReservationTokens: 1_500 })).toEqual({ amountMicros: 3_001, maxOutputTokens: 3_000 })
    await expect(resizeBudgetReservation({ ...input, accruedCostMicros: 0, minimumOutputReservationTokens: 12_000 })).rejects.toMatchObject({ code: 'insufficient_balance' })
  })

  it('reserves the entire affordable cap and releases unused funding at settlement', async () => {
    const userId = await account(10_001), input = await request(userId)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 10_001, maxOutputTokens: 10_000 })
    expect((await reservation(input.responseId)).amountMicros).toBe(10_001)
    await settleBudget({ responseId: input.responseId, usage, latencyMs: 1 })
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]?.balanceMicros).toBe(9_900)
    expect((await reserveBudget(await request(userId))).maxOutputTokens).toBe(9_899)
  })

  it('rejects below the floor without a hold, but accepts a smaller explicit ceiling', async () => {
    const userId = await account(8_000), input = await request(userId)
    await expect(reserveBudget(input)).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect(await reservation(input.responseId)).toBeUndefined()
    expect(await reserveBudget(await request(userId, 100))).toEqual({ amountMicros: 101, maxOutputTokens: 100 })
  })

  it('serializes concurrent admissions so only fully funded requests start', async () => {
    const userId = await account(12_001)
    const inputs = await Promise.all([request(userId), request(userId)])
    const results = await Promise.allSettled(inputs.map(reserveBudget))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const rows = await db.select().from(budgetReservations).where(eq(budgetReservations.userId, userId))
    expect(rows.reduce((sum, row) => sum + row.amountMicros, 0)).toBe(12_001)
  })

  it('uses the tighter subscription window plus available balance', async () => {
    const userId = await account(2_000, 20_000, 8_000), input = await request(userId)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 10_000, maxOutputTokens: 9_999 })
    expect(await reservation(input.responseId)).toMatchObject({ weeklyReservedMicros: 8_000, fiveHourReservedMicros: 8_000, balanceReservedMicros: 2_000 })
  })

  it('serializes simultaneous subscription resizes before reading remaining funds', async () => {
    const userId = await account(0, 20_000)
    const first = await request(userId, 8_000), second = await request(userId, 8_000)
    await reserveBudget(first); await reserveBudget(second)
    await Promise.all([first, second].map(input => resizeBudgetReservation({ ...input, maxOutputTokens: 32_000, accruedCostMicros: 0 })))
    const rows = await db.select().from(budgetReservations).where(eq(budgetReservations.userId, userId))
    expect(rows.reduce((sum, row) => sum + row.weeklyReservedMicros, 0)).toBe(20_000)
    expect(rows.every(row => row.amountMicros >= 8_001)).toBe(true)
  })

  it('shares pool credit without allowing overlapping concurrent claims', async () => {
    const caller = await account(1_000), peer = await account(11_001)
    await pool([caller, peer])
    const inputs = await Promise.all([request(caller), request(peer)])
    const results = await Promise.allSettled(inputs.map(reserveBudget))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const funding = await db.select().from(budgetReservationFunders).where(inArray(budgetReservationFunders.userId, [caller, peer]))
    expect(funding.reduce((sum, row) => sum + row.reservedMicros, 0)).toBe(12_001)
  })

  it('does not use blocked or held pool balances', async () => {
    const caller = await account(7_000), blocked = await account(20_000), held = await account(20_000)
    await pool([caller, blocked, held])
    await db.update(users).set({ blocked: true }).where(eq(users.id, blocked))
    await db.insert(billingAccounts).values({ userId: held, holdAt: new Date() })
    await expect(reserveBudget(await request(caller))).rejects.toMatchObject({ code: 'insufficient_balance' })
  })

  it('applies monthly and lifetime API budgets to admissions, resizes, and tool extensions', async () => {
    const userId = await account(100_000), apiKeyId = await key(userId, 20_000, 10_001)
    const input = await request(userId, 32_000, apiKeyId)
    expect((await reserveBudget(input)).maxOutputTokens).toBe(10_000)
    expect((await resizeBudgetReservation({ ...input, accruedCostMicros: 1_000 })).maxOutputTokens).toBe(9_000)
    await expect(extendBudgetReservationFixedCost(input.responseId, 1)).rejects.toMatchObject({ code: 'lifetime_budget_exceeded' })
    await settleBudget({ responseId: input.responseId, usage, latencyMs: 1 })
    expect((await reserveBudget(await request(userId, 32_000, apiKeyId))).maxOutputTokens).toBe(9_899)
    const smallKey = await key(userId, 8_000)
    await expect(reserveBudget(await request(userId, 32_000, smallKey))).rejects.toMatchObject({ code: 'monthly_budget_exceeded' })
  })

  it('subtracts other API-key reservations and prevents concurrent key overspending', async () => {
    const userId = await account(100_000), apiKeyId = await key(userId, 18_000)
    const inputs = await Promise.all([request(userId, 32_000, apiKeyId), request(userId, 32_000, apiKeyId)])
    const results = await Promise.allSettled(inputs.map(reserveBudget))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rows = await db.select().from(budgetReservations).where(eq(budgetReservations.apiKeyId, apiKeyId))
    expect(rows.reduce((sum, row) => sum + row.amountMicros, 0)).toBe(18_000)
  })

  it('recalculates against the next input and fallback pricing while retaining accrued costs', async () => {
    const userId = await account(30_000), input = await request(userId, 32_000)
    await reserveBudget(input)
    const result = await resizeBudgetReservation({ ...input, accruedCostMicros: 2_000, requestInput: 'x'.repeat(398), pricing: { ...pricing, outputPriceMicros: 3_000_000 } })
    expect(result).toEqual({ amountMicros: 30_000, maxOutputTokens: 9_300 })
    await expect(resizeBudgetReservation({ ...input, accruedCostMicros: 25_000 })).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect((await reservation(input.responseId)).amountMicros).toBe(result.amountMicros)
  })

  it('releases idle generation headroom for tools, retains their costs, and permits cancellation', async () => {
    const userId = await account(20_000), input = await request(userId, 32_000)
    await reserveBudget(input)
    await retainBudgetReservation(input.responseId, 1_000)
    await extendBudgetReservationFixedCost(input.responseId, 2_000)
    expect((await reservation(input.responseId)).amountMicros).toBe(3_000)
    const next = await resizeBudgetReservation({ ...input, accruedCostMicros: 3_000 })
    expect(next).toEqual({ amountMicros: 20_000, maxOutputTokens: 16_999 })
    await releaseBudget(input.responseId)
    expect((await reserveBudget(await request(userId, 32_000))).maxOutputTokens).toBe(19_999)
  })

  it('coordinates a reservation resize with metered charges', async () => {
    const userId = await account(20_000), input = await request(userId, 8_000)
    await reserveBudget(input)
    const results = await Promise.allSettled([
      resizeBudgetReservation({ ...input, maxOutputTokens: 32_000, accruedCostMicros: 0 }),
      chargeMeteredUsage({ userId, costMicros: 5_000, type: 'speech' }),
    ])
    expect(results[0]?.status).toBe('fulfilled')
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    expect((await reservation(input.responseId)).amountMicros).toBeLessThanOrEqual(user!.balanceMicros)
  })

  it('serializes subscription settlement with a competing resize', async () => {
    const userId = await account(0, 20_000), first = await request(userId, 8_000), second = await request(userId, 8_000)
    await reserveBudget(first); await reserveBudget(second)
    await Promise.all([
      settleBudget({ responseId: first.responseId, usage, latencyMs: 1 }),
      resizeBudgetReservation({ ...second, maxOutputTokens: 32_000, accruedCostMicros: 0 }),
    ])
    const [period] = await db.select().from(weeklyUsagePeriods).where(eq(weeklyUsagePeriods.userId, userId))
    expect(period!.spentMicros + (await reservation(second.responseId)).weeklyReservedMicros).toBeLessThanOrEqual(20_000)
  })

  it('allows already-incurred usage to settle after the key is revoked and billing is held', async () => {
    const userId = await account(10_000), apiKeyId = await key(userId, 10_000), input = await request(userId, 32_000, apiKeyId)
    await reserveBudget(input)
    await db.update(apiKeys).set({ status: 'disabled' }).where(eq(apiKeys.id, apiKeyId))
    await db.insert(billingAccounts).values({ userId, holdAt: new Date() })
    await retainBudgetReservation(input.responseId, 101)
    await settleBudget({ responseId: input.responseId, usage, latencyMs: 1 })
    expect((await reservation(input.responseId)).settledAmountMicros).toBe(101)
  })

  it('funds a sidecar overrun from the available balance instead of failing settlement', async () => {
    const userId = await account(6_000_000), input = await request(userId, 32_000)
    await reserveBudget(input)
    await retainBudgetReservation(input.responseId, 20_110)
    await extendBudgetReservationFixedCost(input.responseId, 898)
    expect((await reservation(input.responseId)).amountMicros).toBe(21_008)
    const cost = await settleBudget({ responseId: input.responseId, usage, latencyMs: 1, costMicrosOverride: 20_110, additionalCostMicros: 937 })
    expect(cost).toBe(21_047)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    expect(user!.balanceMicros).toBe(6_000_000 - 21_047)
    expect(await settleBudget({ responseId: input.responseId, usage, latencyMs: 1, costMicrosOverride: 20_110, additionalCostMicros: 937 })).toBe(21_047)
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]!.balanceMicros).toBe(6_000_000 - 21_047)
  })

  it('snapshots an itemized cost breakdown on the usage event', async () => {
    const userId = await account(6_000_000), input = await request(userId, 32_000)
    await reserveBudget(input)
    await retainBudgetReservation(input.responseId, 16_800)
    const requestLogId = randomUUID(), runId = randomUUID()
    await db.insert(requestLogs).values({ id: requestLogId, responseId: input.responseId, userId, requestedModelId: modelId })
    await db.insert(generationAttempts).values([
      { id: randomUUID(), requestLogId, modelId, source: 'agent', purpose: 'generation', costMicros: 10_000 },
      { id: randomUUID(), requestLogId, modelId, source: 'tool', purpose: 'title', costMicros: 300 },
      { id: randomUUID(), requestLogId, modelId, source: 'tool', purpose: 'compaction', costMicros: 0 },
    ])
    await db.insert(agentRuns).values({ id: runId, responseId: input.responseId })
    await db.insert(toolExecutions).values([
      { id: randomUUID(), agentRunId: runId, operationId: randomUUID(), toolName: 'web_search', billedCostMicros: 1_000 },
      { id: randomUUID(), agentRunId: runId, operationId: randomUUID(), toolName: 'web_search', billedCostMicros: 1_000 },
      { id: randomUUID(), agentRunId: runId, operationId: randomUUID(), toolName: 'web_fetch', billedCostMicros: 500 },
      { id: randomUUID(), agentRunId: runId, operationId: randomUUID(), toolName: 'web_fetch', billedCostMicros: 0 },
    ])
    expect(await settleBudget({
      responseId: input.responseId, usage, latencyMs: 1,
      costMicrosOverride: 12_500, additionalCostMicros: 4_300, workspace: { minutes: 2, costMicros: 4_000 },
    })).toBe(16_800)
    const [event] = await db.select().from(usageEvents).where(eq(usageEvents.responseId, input.responseId))
    expect(event!.costBreakdown).toEqual([
      { kind: 'model', quantity: 101, costMicros: 10_000 },
      { kind: 'tool', name: 'web_search', quantity: 2, costMicros: 2_000 },
      { kind: 'tool', name: 'web_fetch', quantity: 1, costMicros: 500 },
      { kind: 'task', name: 'title', quantity: 1, costMicros: 300 },
      { kind: 'workspace', quantity: 2, costMicros: 4_000 },
    ])
  })

  it('absorbs only the part of an overrun the account cannot fund', async () => {
    const userId = await account(1_500), input = await request(userId, 1_000)
    await reserveBudget(input)
    await retainBudgetReservation(input.responseId, 1_000)
    await retainBudgetReservation(input.responseId, 5_000)
    expect((await reservation(input.responseId)).amountMicros).toBe(1_000)
    expect(await settleBudget({ responseId: input.responseId, usage, latencyMs: 1, costMicrosOverride: 1_937 })).toBe(1_500)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    expect(user!.balanceMicros).toBe(0)
    const [entry] = await db.select().from(creditLedger).where(eq(creditLedger.responseId, input.responseId))
    expect(entry!.metadata).toMatchObject({ totalCostMicros: 1_500, uncoveredCostMicros: 437 })
  })

  it('never funds an overrun from another pending reservation, the subscription cap, or past an API-key limit', async () => {
    const userId = await account(3_000), first = await request(userId, 1_000), second = await request(userId, 1_500)
    await reserveBudget(first)
    await retainBudgetReservation(first.responseId, 1_000)
    await reserveBudget(second)
    const held = (await reservation(second.responseId)).amountMicros
    expect(await settleBudget({ responseId: first.responseId, usage, latencyMs: 1, costMicrosOverride: 2_500 })).toBe(3_000 - held)
    expect((await reservation(second.responseId)).amountMicros).toBe(held)

    const subscriber = await account(0, 1_200), subscribed = await request(subscriber, 1_000)
    await reserveBudget(subscribed)
    await retainBudgetReservation(subscribed.responseId, 1_000)
    expect(await settleBudget({ responseId: subscribed.responseId, usage, latencyMs: 1, costMicrosOverride: 1_937 })).toBe(1_200)
    const [period] = await db.select().from(weeklyUsagePeriods).where(eq(weeklyUsagePeriods.userId, subscriber))
    expect(period!.spentMicros).toBe(1_200)

    const keyOwner = await account(10_000), apiKeyId = await key(keyOwner, 1_200), limited = await request(keyOwner, 1_000, apiKeyId)
    await reserveBudget(limited)
    await retainBudgetReservation(limited.responseId, 1_000)
    expect(await settleBudget({ responseId: limited.responseId, usage, latencyMs: 1, costMicrosOverride: 1_937 })).toBe(1_200)
    expect((await db.select().from(users).where(eq(users.id, keyOwner)))[0]!.balanceMicros).toBe(8_800)
  })

  it('shares an overrun with pool funders', async () => {
    const caller = await account(1_000), friend = await account(5_000)
    await pool([caller, friend])
    const input = await request(caller, 1_000)
    await reserveBudget(input)
    await retainBudgetReservation(input.responseId, 1_000)
    expect(await settleBudget({ responseId: input.responseId, usage, latencyMs: 1, costMicrosOverride: 1_937 })).toBe(1_937)
    const rows = await db.select().from(users).where(inArray(users.id, [caller, friend]))
    expect(rows.reduce((sum, row) => sum + row.balanceMicros, 0)).toBe(6_000 - 1_937)
    expect(rows.every(row => row.balanceMicros >= 0)).toBe(true)
  })

  it('does not acquire a fresh allowance when an in-flight reservation crosses a window reset', async () => {
    const userId = await account(0, 20_000), input = await request(userId, 8_000)
    await reserveBudget(input)
    await db.update(budgetReservations).set({ weeklyPeriodStart: new Date('2020-01-06'), fiveHourPeriodStart: new Date('2020-01-06') })
      .where(eq(budgetReservations.responseId, input.responseId))
    expect((await resizeBudgetReservation({ ...input, maxOutputTokens: 32_000, accruedCostMicros: 0 })).maxOutputTokens).toBe(8_000)
  })
  it('draws a pool member request from a Fat owner\'s shared half of their weekly usage', async () => {
    const owner = await fatAccount(20_000), member = await account(0)
    await pool([owner, member])
    const input = await request(member)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 10_000, maxOutputTokens: 9_999 })
    expect(await reservation(input.responseId)).toMatchObject({ weeklyReservedMicros: 0, sharedReservedMicros: 10_000, balanceReservedMicros: 0 })
    expect(await db.select().from(budgetReservationAllowanceFunders).where(eq(budgetReservationAllowanceFunders.ownerUserId, owner))).toMatchObject([{ reservedMicros: 10_000 }])
    await settleBudget({ responseId: input.responseId, usage, latencyMs: 1 })
    expect(await reservation(input.responseId)).toMatchObject({ settledSharedMicros: 101, settledBalanceMicros: 0 })
    expect(await spent(weeklyUsagePeriods, owner)).toBe(101)
    expect(await spent(sharedAllowancePeriods, owner)).toBe(101)
    expect(await spent(sharedFiveHourUsagePeriods, member)).toBe(101)
    expect(await spent(weeklyUsagePeriods, member)).toBe(0)
    expect((await db.select().from(usageEvents).where(eq(usageEvents.responseId, input.responseId)))[0]).toMatchObject({ sharedCostMicros: 101, weeklyCostMicros: 0, balanceCostMicros: 0 })
    expect((await db.select().from(users).where(eq(users.id, member)))[0]?.balanceMicros).toBe(0)
    // The owner keeps the rest of their own weekly usage.
    const own = await request(owner)
    expect(await reserveBudget(own)).toEqual({ amountMicros: 16_001, maxOutputTokens: 16_000 })
    expect(await reservation(own.responseId)).toMatchObject({ weeklyReservedMicros: 16_001, sharedReservedMicros: 0 })
  })

  it('counts pending member draws against the owner\'s weekly usage', async () => {
    const owner = await fatAccount(20_000), member = await account(0)
    await pool([owner, member])
    await reserveBudget(await request(member))
    const own = await request(owner)
    expect(await reserveBudget(own)).toEqual({ amountMicros: 10_000, maxOutputTokens: 9_999 })
  })

  it('uses a member\'s own allowance before shared usage and shared usage before balance', async () => {
    const owner = await fatAccount(20_000), member = await account(3_000, 2_000)
    await pool([owner, member])
    const input = await request(member)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 15_000, maxOutputTokens: 14_999 })
    expect(await reservation(input.responseId)).toMatchObject({ weeklyReservedMicros: 2_000, sharedReservedMicros: 10_000, balanceReservedMicros: 3_000 })
    await settleBudget({ responseId: input.responseId, usage: { ...usage, outputTokens: 4_999 }, latencyMs: 1 })
    expect(await reservation(input.responseId)).toMatchObject({ settledWeeklyMicros: 2_000, settledSharedMicros: 3_000, settledBalanceMicros: 0 })
    expect(await spent(fiveHourUsagePeriods, member)).toBe(2_000)
  })

  it('gives each member their own five-hour limit on shared usage', async () => {
    await db.insert(applicationSettings).values({ key: 'billing', value: { sharedFiveHourLimitMicros: 10_000 } })
    try {
      const owner = await fatAccount(50_000), first = await account(0), second = await account(0)
      await pool([owner, first, second])
      expect((await reserveBudget(await request(first))).amountMicros).toBe(10_000)
      await expect(reserveBudget(await request(first))).rejects.toMatchObject({ code: 'insufficient_balance' })
      expect((await reserveBudget(await request(second))).amountMicros).toBe(10_000)
      // Both windows came out of the owner's 25,000 shared limit.
      expect((await reserveBudget(await request(owner))).amountMicros).toBe(16_001)
    } finally {
      await db.delete(applicationSettings).where(eq(applicationSettings.key, 'billing'))
    }
  })

  it('splits shared usage across several Fat owners and grows it on resize', async () => {
    const left = await fatAccount(8_000), right = await fatAccount(16_000), member = await account(0)
    await pool([left, right, member])
    const input = await request(member, 1_000)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 1_001, maxOutputTokens: 1_000 })
    expect((await resizeBudgetReservation({ ...input, maxOutputTokens: 32_000, accruedCostMicros: 0 })).maxOutputTokens).toBe(11_999)
    const rows = await db.select().from(budgetReservationAllowanceFunders).where(eq(budgetReservationAllowanceFunders.reservationId, (await reservation(input.responseId)).id))
    expect(Object.fromEntries(rows.map((row) => [row.ownerUserId, row.reservedMicros]))).toEqual({ [left]: 4_000, [right]: 8_000 })
    await retainBudgetReservation(input.responseId, 300)
    expect(await reservation(input.responseId)).toMatchObject({ amountMicros: 300, sharedReservedMicros: 300 })
    await settleBudget({ responseId: input.responseId, usage, latencyMs: 1 })
    expect((await spent(sharedAllowancePeriods, left)) + (await spent(sharedAllowancePeriods, right))).toBe(101)
  })

  it('charges metered usage to shared allowances', async () => {
    const owner = await fatAccount(20_000), member = await account(1_000)
    await pool([owner, member])
    await chargeMeteredUsage({ userId: member, costMicros: 10_500, type: 'test_metered' })
    expect(await spent(weeklyUsagePeriods, owner)).toBe(10_000)
    expect(await spent(sharedAllowancePeriods, owner)).toBe(10_000)
    expect(await spent(sharedFiveHourUsagePeriods, member)).toBe(10_000)
    expect((await db.select().from(users).where(eq(users.id, member)))[0]?.balanceMicros).toBe(500)
  })

  it('does not share Eight allowances or allowances outside the pool', async () => {
    const eight = await account(0, 20_000), outsider = await fatAccount(20_000), member = await account(0)
    await pool([eight, member])
    void outsider
    await expect(reserveBudget(await request(member))).rejects.toMatchObject({ code: 'insufficient_balance' })
  })
})
