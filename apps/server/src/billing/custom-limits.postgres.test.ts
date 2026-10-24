import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import {
  billingAccounts,
  billingCustomLimits,
  budgetReservationCustomFunders,
  budgetReservations,
  chats,
  customLimitSpend,
  modelPricingVersions,
  models,
  poolMembers,
  pools,
  providerConnections,
  responses,
  usageEvents,
  users,
} from '../database/schema.js'
import { reserveBudget, resizeBudgetReservation, retainBudgetReservation, settleBudget } from '../accounting/service.js'
import { loadCustomAllowances, loadCustomLimitUserUsage } from './custom-limits.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../config.js', async original => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }) }
})
const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Budget tests require a migrated disposable database named pulpo_budget_test')
}

// Limits only name these fixture models or users, so budget tests sharing the database are unaffected.
const providerId = randomUUID()
const limitedModelId = `custom-limit-${randomUUID()}`
const otherModelId = `custom-limit-other-${randomUUID()}`
const userIds: string[] = [], limitIds: string[] = [], poolIds: string[] = []
const pricing = (modelId: string) => ({ id: randomUUID(), modelId, inputPriceMicros: 1_000_000, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 1_000_000, perRequestPriceMicros: 0 })
const limitedPricing = pricing(limitedModelId), otherPricing = pricing(otherModelId)
const usage = { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 0, totalTokens: 101 }

async function account(options: { plan?: 'baby' | 'eight' | 'fat'; role?: 'user' | 'admin'; balanceMicros?: number; dailyLimitMicros?: number } = {}) {
  const id = randomUUID(); userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, username: id, name: 'Custom limit QA', balanceMicros: options.balanceMicros ?? 1_000_000, role: options.role ?? 'user' })
  if (options.plan || options.dailyLimitMicros !== undefined) {
    await db.insert(billingAccounts).values({
      userId: id, planOverride: options.plan ?? null, weeklyLimitOverrideMicros: 0, fiveHourLimitOverrideMicros: 0, dailyLimitOverrideMicros: options.dailyLimitMicros ?? null,
    })
  }
  return id
}
async function request(userId: string, modelId = limitedModelId, actualModelId?: string) {
  const chatId = randomUUID(), responseId = randomUUID()
  await db.insert(chats).values({ id: chatId, userId, modelId })
  await db.insert(responses).values({ id: responseId, userId, chatId, modelId, actualModelId, input: [] })
  return { responseId, userId, maxOutputTokens: 16_000, requestInput: 'x', pricing: modelId === limitedModelId ? limitedPricing : otherPricing }
}
async function limit(values: Partial<typeof billingCustomLimits.$inferInsert> & Pick<typeof billingCustomLimits.$inferInsert, 'limitMicros'>) {
  const id = randomUUID(); limitIds.push(id)
  await db.insert(billingCustomLimits).values({ id, name: 'QA limit', period: 'daily', target: 'everyone', modelIds: [limitedModelId], ...values })
  return id
}
async function reservation(responseId: string) {
  return (await db.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)))[0]!
}
async function customFunders(responseId: string) {
  const row = await reservation(responseId)
  return db.select().from(budgetReservationCustomFunders).where(eq(budgetReservationCustomFunders.reservationId, row.id))
}
async function balance(userId: string) {
  return (await db.select({ balanceMicros: users.balanceMicros }).from(users).where(eq(users.id, userId)))[0]!.balanceMicros
}
async function pool(members: string[]) {
  const id = randomUUID(); poolIds.push(id)
  await db.insert(pools).values({ id, ownerUserId: members[0]! })
  await db.insert(poolMembers).values(members.map((userId) => ({ id: randomUUID(), poolId: id, userId })))
}

describe.skipIf(!enabled)('custom limit allowances in PostgreSQL', () => {
  beforeAll(async () => {
    await db.insert(providerConnections).values({ id: providerId, name: 'Custom limit fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values([limitedModelId, otherModelId].map((id) => ({ id, providerConnectionId: providerId, upstreamModelId: 'fixture', name: id, contextWindow: 128_000, maxOutputTokens: 16_000 })))
    await db.insert(modelPricingVersions).values([limitedPricing, otherPricing])
  })
  afterAll(async () => {
    if (poolIds.length) await db.delete(pools).where(inArray(pools.id, poolIds))
    if (limitIds.length) await db.delete(billingCustomLimits).where(inArray(billingCustomLimits.id, limitIds))
    if (userIds.length) {
      await db.delete(usageEvents).where(inArray(usageEvents.userId, userIds))
      await db.delete(chats).where(inArray(chats.userId, userIds))
      // The database refuses to remove its last unblocked administrator, so the
      // fixture admin stays in this disposable database, like other admin fixtures.
      await db.delete(users).where(and(inArray(users.id, userIds), ne(users.role, 'admin')))
    }
    await db.delete(models).where(inArray(models.id, [limitedModelId, otherModelId]))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await queryClient.end()
  })

  it('spends the allowance before credits, then falls through to credits', async () => {
    const userId = await account()
    const limitId = await limit({ limitMicros: 10_001, target: 'users', userIds: [userId] })
    const first = await request(userId)
    expect(await reserveBudget(first)).toEqual({ amountMicros: 16_001, maxOutputTokens: 16_000 })
    expect(await reservation(first.responseId)).toMatchObject({ customReservedMicros: 10_001, balanceReservedMicros: 6_000 })
    expect(await customFunders(first.responseId)).toMatchObject([{ limitId, ownerUserId: userId, reservedMicros: 10_001 }])

    // The allowance is fully reserved, so the next request is funded by credits alone.
    const second = await request(userId)
    expect(await reserveBudget(second)).toEqual({ amountMicros: 16_001, maxOutputTokens: 16_000 })
    expect(await reservation(second.responseId)).toMatchObject({ customReservedMicros: 0, balanceReservedMicros: 16_001 })

    await settleBudget({ responseId: first.responseId, usage, latencyMs: 1 })
    expect(await reservation(first.responseId)).toMatchObject({ status: 'settled', settledCustomMicros: 101, settledBalanceMicros: 0 })
    expect(await balance(userId)).toBe(1_000_000)
    const [event] = await db.select().from(usageEvents).where(eq(usageEvents.responseId, first.responseId))
    expect(event).toMatchObject({ costMicros: 101, customCostMicros: 101, balanceCostMicros: 0 })
    const [allowance] = await db.transaction((tx) => loadCustomAllowances(tx, { userId, plan: 'baby' }))
    expect(allowance).toMatchObject({ spentMicros: 101, pendingMicros: 0, remainingMicros: 9_900 })
  })

  it('keeps the allowance when a reservation shrinks or grows', async () => {
    const userId = await account()
    await limit({ limitMicros: 5_000, target: 'users', userIds: [userId] })
    const input = await request(userId)
    await reserveBudget(input)
    await retainBudgetReservation(input.responseId, 3_000)
    expect(await reservation(input.responseId)).toMatchObject({ amountMicros: 3_000, customReservedMicros: 3_000, balanceReservedMicros: 0 })
    await resizeBudgetReservation({ ...input, accruedCostMicros: 0 })
    expect(await reservation(input.responseId)).toMatchObject({ amountMicros: 16_001, customReservedMicros: 5_000, balanceReservedMicros: 11_001 })
  })

  it('only funds the models it names, including fallback answers from them', async () => {
    const userId = await account()
    await limit({ limitMicros: 1_000, target: 'users', userIds: [userId] })
    const other = await request(userId, otherModelId)
    await reserveBudget(other)
    expect((await reservation(other.responseId)).customReservedMicros).toBe(0)
    const fallback = await request(userId, otherModelId, limitedModelId)
    await reserveBudget(fallback)
    expect((await reservation(fallback.responseId)).customReservedMicros).toBe(1_000)
  })

  it('targets subscription plans and covers admins too', async () => {
    await limit({ limitMicros: 1_000, target: 'plans', plans: ['fat'] })
    const eight = await request(await account({ plan: 'eight' }))
    await reserveBudget(eight)
    expect((await reservation(eight.responseId)).customReservedMicros).toBe(0)
    const fat = await request(await account({ plan: 'fat' }))
    await reserveBudget(fat)
    expect((await reservation(fat.responseId)).customReservedMicros).toBe(1_000)
    const admin = await request(await account({ role: 'admin', plan: 'fat' }))
    await reserveBudget(admin)
    expect((await reservation(admin.responseId)).customReservedMicros).toBe(1_000)
  })

  it('ignores disabled limits', async () => {
    const userId = await account()
    await limit({ limitMicros: 1_000, target: 'users', userIds: [userId], enabled: false })
    const input = await request(userId)
    await reserveBudget(input)
    expect((await reservation(input.responseId)).customReservedMicros).toBe(0)
  })

  it('funds requests beyond the daily usage tier cap, which only limits the rest', async () => {
    const userId = await account({ dailyLimitMicros: 0 })
    await limit({ limitMicros: 9_000, target: 'users', userIds: [userId] })
    const input = await request(userId)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 9_000, maxOutputTokens: 8_999 })
    expect(await reservation(input.responseId)).toMatchObject({ customReservedMicros: 9_000, balanceReservedMicros: 0 })
  })

  it('shares the chosen part of an allowance with pool members', async () => {
    const owner = await account({ balanceMicros: 0 })
    const member = await account({ balanceMicros: 0 })
    await pool([owner, member])
    const limitId = await limit({ limitMicros: 20_000, sharePercent: 50, target: 'users', userIds: [owner] })
    const borrowed = await request(member)
    expect(await reserveBudget(borrowed)).toEqual({ amountMicros: 10_000, maxOutputTokens: 9_999 })
    expect(await customFunders(borrowed.responseId)).toMatchObject([{ limitId, ownerUserId: owner, reservedMicros: 10_000 }])
    // The shared half is reserved, so the member has nothing left to draw.
    await expect(reserveBudget(await request(member))).rejects.toMatchObject({ code: 'insufficient_balance' })
    // The owner still has the other half.
    const own = await request(owner)
    expect(await reserveBudget(own)).toEqual({ amountMicros: 10_000, maxOutputTokens: 9_999 })

    await settleBudget({ responseId: borrowed.responseId, usage, latencyMs: 1 })
    const [spend] = await db.select().from(customLimitSpend).where(eq(customLimitSpend.limitId, limitId))
    expect(spend).toMatchObject({ ownerUserId: owner, userId: member, spentMicros: 101 })
    const [limitRow] = await db.select().from(billingCustomLimits).where(eq(billingCustomLimits.id, limitId))
    expect(await db.transaction((tx) => loadCustomLimitUserUsage(tx, limitRow!))).toEqual([
      { userId: owner, ownSpentMicros: 0, sharedSpentMicros: 101, pendingMicros: 10_000 },
    ])
  })

  it('keeps spent allowance when the response is deleted', async () => {
    const userId = await account()
    await limit({ limitMicros: 1_000, target: 'users', userIds: [userId] })
    const input = await request(userId)
    await reserveBudget(input)
    await settleBudget({ responseId: input.responseId, usage, latencyMs: 1 })
    await db.delete(responses).where(eq(responses.id, input.responseId))
    const [allowance] = await db.transaction((tx) => loadCustomAllowances(tx, { userId, plan: 'baby' }))
    expect(allowance).toMatchObject({ spentMicros: 101, remainingMicros: 899 })
  })

  it('counts spend within each period', async () => {
    const userId = await account()
    const now = new Date('2026-10-22T15:30:00.000Z')
    const rolling = await limit({ name: 'Rolling', limitMicros: 1_000, period: 'five_hour', target: 'users', userIds: [userId] })
    const weekly = await limit({ name: 'Weekly', limitMicros: 1_000, period: 'weekly', target: 'users', userIds: [userId], modelIds: [] })
    const spend = (limitId: string, spentMicros: number, createdAt: string, periodStart: string | null) => db.insert(customLimitSpend).values({
      id: randomUUID(), limitId, ownerUserId: userId, userId, spentMicros, createdAt: new Date(createdAt), periodStart: periodStart ? new Date(periodStart) : null,
    })
    await spend(rolling, 100, '2026-10-22T09:00:00.000Z', null) // Outside the rolling window.
    await spend(rolling, 300, '2026-10-22T13:00:00.000Z', null)
    await spend(weekly, 250, '2026-10-21T12:00:00.000Z', '2026-10-19T00:00:00.000Z')
    await spend(weekly, 400, '2026-10-18T12:00:00.000Z', '2026-10-12T00:00:00.000Z') // The previous week.
    const loaded = await db.transaction((tx) => loadCustomAllowances(tx, { userId, plan: 'baby', now }))
    const byName = new Map(loaded.map((row) => [row.name, row]))
    expect(byName.get('Rolling')).toMatchObject({ spentMicros: 300, remainingMicros: 700, resetAt: null, freesAt: new Date('2026-10-22T18:00:00.000Z') })
    expect(byName.get('Weekly')).toMatchObject({ spentMicros: 250, remainingMicros: 750, resetAt: new Date('2026-10-26T00:00:00.000Z') })
  })
})
