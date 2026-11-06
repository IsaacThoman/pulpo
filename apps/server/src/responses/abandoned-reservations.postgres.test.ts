import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { budgetReservations, chats, modelPricingVersions, models, providerConnections, requestLogs, responses, users } from '../database/schema.js'
import { reserveBudget } from '../accounting/service.js'

const { advanceMessageQueue, publishSnapshot } = vi.hoisted(() => ({ advanceMessageQueue: vi.fn(), publishSnapshot: vi.fn() }))
vi.mock('./events.js', () => ({ publishSnapshot, publishStateChange: vi.fn() }))
vi.mock('../chats/message-queue.js', () => ({ advanceMessageQueue }))
vi.mock('../config.js', async original => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }) }
})
const { ABANDONED_RESERVATION_GRACE_MS, sweepAbandonedReservations } = await import('./abandoned-reservations.js')

const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Budget tests require a migrated disposable database named pulpo_budget_test')
}
const providerId = randomUUID(), modelId = `abandoned-${randomUUID()}`
const pricing = { id: randomUUID(), inputPriceMicros: 1_000_000, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 1_000_000, perRequestPriceMicros: 0 }
const userIds: string[] = []
// The shared test database also holds other suites' reservations; only ours are dead.
const dead = new Set<string>()
const generationIsLive = async (responseId: string) => !dead.has(responseId)
const afterGrace = () => new Date(Date.now() + ABANDONED_RESERVATION_GRACE_MS + 60_000)

async function reserved(status: typeof responses.$inferSelect.status, balanceMicros = 20_000) {
  const userId = randomUUID(), chatId = randomUUID(), responseId = randomUUID()
  userIds.push(userId)
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, username: userId, name: 'Abandoned QA', balanceMicros })
  await db.insert(chats).values({ id: chatId, userId, modelId })
  await db.insert(responses).values({ id: responseId, userId, chatId, modelId, input: [], status })
  await db.insert(requestLogs).values({ id: randomUUID(), responseId, userId, requestedModelId: modelId, status })
  await reserveBudget({ responseId, userId, maxOutputTokens: 1_000, requestInput: 'x', pricing })
  return { userId, chatId, responseId }
}
async function reservationOf(responseId: string) {
  return (await db.select().from(budgetReservations).where(eq(budgetReservations.responseId, responseId)))[0]!
}

describe.skipIf(!enabled)('abandoned reservation sweep in PostgreSQL', () => {
  beforeAll(async () => {
    await db.insert(providerConnections).values({ id: providerId, name: 'Abandoned fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Abandoned fixture', contextWindow: 128_000, maxOutputTokens: 16_000 })
    await db.insert(modelPricingVersions).values({ ...pricing, modelId })
  })
  beforeEach(() => { dead.clear(); advanceMessageQueue.mockClear(); publishSnapshot.mockClear() })
  afterAll(async () => {
    if (userIds.length) {
      await db.delete(chats).where(inArray(chats.userId, userIds))
      await db.delete(users).where(inArray(users.id, userIds))
    }
    await db.delete(models).where(eq(models.id, modelId))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await queryClient.end()
  })

  it('releases holds of finished responses that no job owns', async () => {
    const cancelled = await reserved('cancelled')
    dead.add(cancelled.responseId)
    await sweepAbandonedReservations({ generationIsLive, now: afterGrace() })
    expect(await reservationOf(cancelled.responseId)).toMatchObject({ status: 'released' })
    const [response] = await db.select().from(responses).where(eq(responses.id, cancelled.responseId))
    expect(response!.status).toBe('cancelled')
    expect(publishSnapshot).not.toHaveBeenCalled()
  })

  it('fails running responses whose job is gone, then releases their holds', async () => {
    const stuck = await reserved('in_progress')
    dead.add(stuck.responseId)
    await sweepAbandonedReservations({ generationIsLive, now: afterGrace() })
    expect(await reservationOf(stuck.responseId)).toMatchObject({ status: 'released' })
    const [response] = await db.select().from(responses).where(eq(responses.id, stuck.responseId))
    expect(response).toMatchObject({ status: 'failed', error: { message: 'Generation stopped unexpectedly', category: 'worker' } })
    const [log] = await db.select().from(requestLogs).where(eq(requestLogs.responseId, stuck.responseId))
    expect(log).toMatchObject({ status: 'failed', errorCategory: 'worker' })
    expect(publishSnapshot).toHaveBeenCalledWith(expect.objectContaining({ responseId: stuck.responseId, status: 'failed' }))
    expect(advanceMessageQueue).toHaveBeenCalledWith(stuck.chatId)
  })

  it('leaves holds alone while a job owns them or within the grace period', async () => {
    const live = await reserved('in_progress'), recent = await reserved('cancelled')
    dead.add(recent.responseId)
    await sweepAbandonedReservations({ generationIsLive, now: afterGrace() })
    expect(await reservationOf(live.responseId)).toMatchObject({ status: 'pending' })
    const fresh = await reserved('cancelled')
    dead.add(fresh.responseId)
    await sweepAbandonedReservations({ generationIsLive, now: new Date() })
    expect(await reservationOf(fresh.responseId)).toMatchObject({ status: 'pending' })
    const [response] = await db.select().from(responses).where(eq(responses.id, live.responseId))
    expect(response!.status).toBe('in_progress')
  })
})
