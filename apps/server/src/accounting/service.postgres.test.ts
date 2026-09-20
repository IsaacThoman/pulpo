import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { apiKeys, billingAccounts, budgetReservations, creditLedger, budgetReservationFunders, chats, models, modelPricingVersions, pools, poolMembers, providerConnections, responses, users, usageEvents, weeklyUsagePeriods } from '../database/schema.js'
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
})
