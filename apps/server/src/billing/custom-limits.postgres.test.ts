import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { billingAccounts, billingCustomLimits, chats, modelPricingVersions, models, providerConnections, responses, usageEvents, users } from '../database/schema.js'
import { reserveBudget, resizeBudgetReservation, settleBudget } from '../accounting/service.js'
import { CUSTOM_LIMIT_CODE, loadCustomLimitUsage } from './custom-limits.js'

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
const userIds: string[] = [], limitIds: string[] = []
const pricing = (modelId: string) => ({ id: randomUUID(), modelId, inputPriceMicros: 1_000_000, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 1_000_000, perRequestPriceMicros: 0 })
const limitedPricing = pricing(limitedModelId), otherPricing = pricing(otherModelId)
const usage = { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 0, totalTokens: 101 }

async function account(options: { plan?: 'baby' | 'eight' | 'fat'; role?: 'user' | 'admin' } = {}) {
  const id = randomUUID(); userIds.push(id)
  await db.insert(users).values({ id, email: `${id}@example.test`, username: id, name: 'Custom limit QA', balanceMicros: 1_000_000, role: options.role ?? 'user' })
  if (options.plan) await db.insert(billingAccounts).values({ userId: id, planOverride: options.plan, weeklyLimitOverrideMicros: 0, fiveHourLimitOverrideMicros: 0 })
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
async function spend(userId: string, costMicros: number, createdAt: Date, modelId = limitedModelId, requestedModelId = modelId) {
  await db.insert(usageEvents).values({ id: randomUUID(), userId, modelId, requestedModelId, inputTokens: 1, outputTokens: 1, costMicros, latencyMs: 1, createdAt })
}

describe.skipIf(!enabled)('custom limits in PostgreSQL', () => {
  beforeAll(async () => {
    await db.insert(providerConnections).values({ id: providerId, name: 'Custom limit fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values([limitedModelId, otherModelId].map((id) => ({ id, providerConnectionId: providerId, upstreamModelId: 'fixture', name: id, contextWindow: 128_000, maxOutputTokens: 16_000 })))
    await db.insert(modelPricingVersions).values([limitedPricing, otherPricing])
  })
  afterAll(async () => {
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

  it('caps reservations at what the limit has left, counting pending and settled usage', async () => {
    const userId = await account()
    await limit({ limitMicros: 10_001, target: 'users', userIds: [userId] })
    const first = await request(userId)
    expect(await reserveBudget(first)).toEqual({ amountMicros: 10_001, maxOutputTokens: 10_000 })
    await expect(reserveBudget(await request(userId))).rejects.toMatchObject({ code: CUSTOM_LIMIT_CODE, statusCode: 402 })
    await settleBudget({ responseId: first.responseId, usage, latencyMs: 1 })
    expect(await reserveBudget(await request(userId))).toEqual({ amountMicros: 9_900, maxOutputTokens: 9_899 })
  })

  it('stops a reservation from growing past the limit', async () => {
    const userId = await account()
    await limit({ limitMicros: 9_000, target: 'users', userIds: [userId] })
    const input = await request(userId)
    expect(await reserveBudget(input)).toEqual({ amountMicros: 9_000, maxOutputTokens: 8_999 })
    await expect(resizeBudgetReservation({ ...input, accruedCostMicros: 0, minimumOutputReservationTokens: 12_000 }))
      .rejects.toMatchObject({ code: CUSTOM_LIMIT_CODE })
  })

  it('only limits the models it names, including fallback answers from them', async () => {
    const userId = await account()
    await limit({ limitMicros: 0, target: 'users', userIds: [userId] })
    expect((await reserveBudget(await request(userId, otherModelId))).amountMicros).toBe(16_001)
    await expect(reserveBudget(await request(userId))).rejects.toMatchObject({ code: CUSTOM_LIMIT_CODE })
    const fallback = await request(userId, otherModelId, limitedModelId)
    await expect(reserveBudget(fallback)).rejects.toMatchObject({ code: CUSTOM_LIMIT_CODE })
  })

  it('targets subscription plans and exempts admins unless they are named', async () => {
    await limit({ limitMicros: 0, target: 'plans', plans: ['fat'] })
    expect((await reserveBudget(await request(await account({ plan: 'eight' })))).amountMicros).toBe(16_001)
    await expect(reserveBudget(await request(await account({ plan: 'fat' })))).rejects.toMatchObject({ code: CUSTOM_LIMIT_CODE })

    const adminId = await account({ role: 'admin', plan: 'fat' })
    expect((await reserveBudget(await request(adminId))).amountMicros).toBe(16_001)
    await limit({ limitMicros: 0, target: 'users', userIds: [adminId] })
    await expect(reserveBudget(await request(adminId))).rejects.toMatchObject({ code: CUSTOM_LIMIT_CODE })
  })

  it('ignores disabled limits', async () => {
    const userId = await account()
    await limit({ limitMicros: 0, target: 'users', userIds: [userId], enabled: false })
    expect((await reserveBudget(await request(userId))).amountMicros).toBe(16_001)
  })

  it('counts requested and answered models within each period', async () => {
    const userId = await account()
    const now = new Date('2026-10-22T15:30:00.000Z')
    await limit({ name: 'Rolling', limitMicros: 1_000, period: 'five_hour', target: 'users', userIds: [userId] })
    await limit({ name: 'Weekly', limitMicros: 1_000, period: 'weekly', target: 'users', userIds: [userId], modelIds: [] })
    await spend(userId, 100, new Date('2026-10-22T09:00:00.000Z')) // Outside the rolling window.
    await spend(userId, 200, new Date('2026-10-22T12:00:00.000Z'), otherModelId, limitedModelId) // Fallback answer.
    await spend(userId, 300, new Date('2026-10-22T13:00:00.000Z'))
    await spend(userId, 50, new Date('2026-10-22T14:00:00.000Z'), otherModelId)
    await spend(userId, 400, new Date('2026-10-18T12:00:00.000Z')) // The previous week.
    const loaded = await db.transaction((tx) => loadCustomLimitUsage(tx, { userId, role: 'user', plan: 'baby', now }))
    const byName = new Map(loaded.map((row) => [row.name, row]))
    expect(byName.get('Rolling')).toMatchObject({ spentMicros: 500, remainingMicros: 500, resetAt: null, freesAt: new Date('2026-10-22T17:00:00.000Z') })
    expect(byName.get('Weekly')).toMatchObject({ spentMicros: 650, remainingMicros: 350, resetAt: new Date('2026-10-26T00:00:00.000Z') })
    const forOtherModel = await db.transaction((tx) => loadCustomLimitUsage(tx, { userId, role: 'user', plan: 'baby', modelIds: [otherModelId], now }))
    expect(forOtherModel.map((row) => row.name)).toEqual(['Weekly'])
  })
})
