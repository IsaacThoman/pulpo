import { randomUUID } from 'node:crypto'
import type { SignupPromoAvailability, SignupPromoConfig, SignupPromoReceipt } from '@pulpo/contracts'
import { eq, inArray, sql } from 'drizzle-orm'
import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { serializeUser } from '../auth/service.js'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, auditEvents, creditLedger, signupPromoClaims, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'
import { registerSignupPromoRoutes } from './signup-promo.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(async () => undefined) }))
vi.mock('../config.js', async original => {
  const config = await original<typeof import('../config.js')>()
  return { ...config, getConfig: () => ({ ...config.getConfig(), PULPO_BILLING_ENABLED: true }) }
})
const enabled = process.env.PULPO_BUDGET_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_budget_test') {
  throw new Error('Signup promotion tests require a migrated disposable database named pulpo_budget_test')
}

const publicPath = '/api/billing/signup-promo'
const adminPath = '/api/admin/billing/signup-promo'
const adminId = randomUUID()
const memberIds: string[] = []
const config: SignupPromoConfig = { enabled: true, amountCents: 100, dailyCapCents: 250, message: 'Welcome, new members!' }
const app = Fastify()

async function account(overrides: Partial<typeof users.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID()
  if (id !== adminId) memberIds.push(id)
  await db.insert(users).values({
    id, email: `${id}@example.test`, username: id, name: 'Signup promo QA', role: 'user', signedUp: true,
    balanceMicros: 400_000, ...overrides,
  })
  return id
}

const get = (url: string, userId?: string) => app.inject({ url, headers: userId ? { 'x-test-user': userId } : {} })
const save = (body = config, userId: string = adminId) => app.inject({ method: 'PUT', url: adminPath, headers: { 'x-test-user': userId }, payload: body })
const claim = (userId: string, amountCents = config.amountCents, expectedUserId = userId) => app.inject({
  method: 'POST', url: `${publicPath}/claim`, headers: { 'x-test-user': userId }, payload: { amountCents, userId: expectedUserId },
})
const offer = async (userId: string) => (await get(publicPath, userId)).json<SignupPromoAvailability>().offer

describe.skipIf(!enabled)('signup credit promotion in PostgreSQL', () => {
  beforeAll(async () => {
    await account({ id: adminId, role: 'admin', signedUp: false })
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user']
      if (typeof id !== 'string') return
      const [user] = await db.select().from(users).where(eq(users.id, id))
      if (user) request.user = serializeUser(user)
    })
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code })
      if (error instanceof ZodError) return reply.code(400).send({ code: 'validation_error' })
      request.log.error(error)
      return reply.send(error)
    })
    registerSignupPromoRoutes(app)
  })

  beforeEach(async () => {
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'signupPromo'))
    vi.mocked(publishStateChange).mockClear()
  })

  afterAll(async () => {
    await app.close()
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'signupPromo'))
    await db.delete(auditEvents).where(eq(auditEvents.targetId, 'signupPromo'))
    await db.delete(signupPromoClaims)
    if (memberIds.length) await db.delete(users).where(inArray(users.id, memberIds))
    // Like other budget fixtures, leave the admin to satisfy the last-admin trigger.
    await queryClient.end()
  })

  it('enforces signup, activation, approval, expiry, and administrator permissions', async () => {
    const existing = await account({ createdAt: new Date(Date.now() - 60_000) })
    expect((await get(publicPath)).statusCode).toBe(401)
    expect((await get(adminPath, existing)).statusCode).toBe(403)
    expect((await save(config, existing)).statusCode).toBe(403)
    expect((await get(adminPath, adminId)).json()).toMatchObject({ enabled: false, amountCents: 100, dailyCapCents: 2_000 })
    expect(await offer(existing)).toBeNull()
    expect((await save({ ...config, dailyCapCents: 99 })).statusCode).toBe(400)
    expect((await save()).json()).toEqual({ ...config, claimedTodayCents: 0 })

    const [member, manual, pending, blocked, deleting] = await Promise.all([
      account(), account({ signedUp: false }), account({ role: 'pending' }), account({ blocked: true }), account({ deletionRequestedAt: new Date() }),
    ])
    expect(await offer(member)).toEqual({ amountCents: config.amountCents, message: config.message })
    expect((await get(publicPath, member)).headers['cache-control']).toBe('no-store')
    for (const userId of [existing, manual, deleting]) {
      expect(await offer(userId)).toBeNull()
      expect((await claim(userId)).statusCode).toBe(409)
    }
    for (const userId of [pending, blocked]) expect((await claim(userId)).statusCode).toBe(403)
    expect((await claim(member, 200)).json()).toEqual({ code: 'signup_promo_changed' })
    expect((await claim(member, 100, manual)).json()).toEqual({ code: 'signup_promo_account_changed' })
    await db.update(users).set({ role: 'user' }).where(eq(users.id, pending))
    expect(await offer(pending)).not.toBeNull()

    await db.update(applicationSettings).set({ value: { ...config, startedAt: new Date(Date.now() - 9 * 86_400_000).toISOString() } })
      .where(eq(applicationSettings.key, 'signupPromo'))
    await db.update(users).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(users.id, member))
    expect(await offer(member)).toBeNull()
    expect((await claim(member)).statusCode).toBe(409)

    expect((await save({ ...config, enabled: false })).statusCode).toBe(200)
    const duringPause = await account()
    expect(await offer(pending)).toBeNull()
    expect((await save()).statusCode).toBe(200)
    expect(await offer(duringPause)).toBeNull()
  })

  it('caps concurrent claims, credits retries once, and counts grants after account deletion', async () => {
    expect((await save()).statusCode).toBe(200)
    const candidates = await Promise.all(Array.from({ length: 5 }, () => account()))
    const [first, ...others] = candidates as [string, ...string[]]
    const duplicates = await Promise.all([claim(first), claim(first)])
    expect(duplicates.map((result) => result.statusCode)).toEqual([200, 200])
    expect(duplicates.map((result) => result.json<SignupPromoReceipt>())).toEqual([{ amountCents: 100 }, { amountCents: 100 }])
    const competing = await Promise.all(others.map((id) => claim(id)))
    expect(competing.map((result) => result.statusCode).sort()).toEqual([200, 409, 409, 409])
    const entries = await db.select().from(creditLedger).where(inArray(creditLedger.userId, candidates))
    expect(entries).toHaveLength(2)
    expect(entries).toEqual(Array.from({ length: 2 }, () => expect.objectContaining({
      type: 'signup_promo', amountMicros: 1_000_000, balanceAfterMicros: 1_400_000,
    })))
    expect(vi.mocked(publishStateChange)).toHaveBeenCalledTimes(2)
    const [credited] = await db.select().from(users).where(eq(users.id, first))
    expect(credited).toMatchObject({ balanceMicros: 1_400_000, stateRevision: 1 })
    expect(await offer(first)).toBeNull()

    await db.delete(users).where(eq(users.id, first))
    expect((await get(adminPath, adminId)).json()).toMatchObject({ claimedTodayCents: 200 })
    const next = await account()
    expect(await offer(next)).toBeNull()
    expect((await claim(next)).json()).toEqual({ code: 'signup_promo_cap_reached' })
    await db.update(signupPromoClaims).set({ claimedAt: sql`date_trunc('day', now(), 'UTC') - interval '1 second'` })
    expect((await get(adminPath, adminId)).json()).toMatchObject({ claimedTodayCents: 0 })
    expect(await offer(next)).not.toBeNull()
    vi.mocked(publishStateChange).mockRejectedValueOnce(new Error('Realtime unavailable'))
    expect((await claim(next)).statusCode).toBe(200)
  })
})
