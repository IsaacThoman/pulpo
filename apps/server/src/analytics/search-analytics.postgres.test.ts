import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import type { AdminSearchOverview, SearchRequestAttempt } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import { searchRequests, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { recordSearchRequest, SearchTimer } from '../search/timing.js'
import { registerAdminSearchAnalyticsRoutes } from './search-routes.js'

// Shares the disposable analytics database; rows are scoped to fixture users.
const enabled = process.env.PULPO_ANALYTICS_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_analytics_test') {
  throw new Error('Analytics tests require a migrated disposable database named pulpo_analytics_test')
}

vi.mock('../database/client.js', async () => {
  const [{ drizzle }, { default: postgres }, schema] = await Promise.all([
    import('drizzle-orm/postgres-js'), import('postgres'), import('../database/schema.js'),
  ])
  const queryClient = postgres(process.env.DATABASE_URL ?? 'postgres://invalid', { max: 1, prepare: false })
  return { db: drizzle(queryClient, { schema }), queryClient }
})

const userIds = [randomUUID(), randomUUID()]
const now = Date.now()
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000)
const attempt = (provider: string, outcome: SearchRequestAttempt['outcome'], durationMs: number, resultCount?: number): SearchRequestAttempt =>
  ({ provider, outcome, startMs: 50, durationMs, ...(resultCount !== undefined ? { resultCount } : {}) })

describe.skipIf(!enabled)('admin Search analytics', () => {
  const app = Fastify()
  let role = 'admin'
  app.addHook('onRequest', async (request) => {
    request.user = { id: userIds[0], role } as FastifyRequest['user']
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } })
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'validation_error' } })
    return reply.code(500).send({ error: { message: error instanceof Error ? error.message : String(error) } })
  })

  beforeAll(async () => {
    await db.insert(users).values(userIds.map((id, index) => ({ id, email: `${id}@example.test`, username: id, name: `Searcher ${index}` })))
    const row = (minutes: number, values: Partial<typeof searchRequests.$inferInsert>) => ({
      id: randomUUID(), userId: userIds[0]!, kind: 'query', category: 'web', outcome: 'success', durationMs: 1_000,
      createdAt: minutesAgo(minutes), ...values,
    })
    await db.insert(searchRequests).values([
      row(10, { provider: 'kagi', resultCount: 20, durationMs: 2_000, attempts: [attempt('kagi', 'success', 1_800, 20)],
        phases: { requestMs: 5, settingsMs: 20, reserveMs: 30, providerMs: 1_800, settleMs: 40 }, queryLength: 12, filters: ['region'] }),
      row(20, { category: 'news', provider: 'firecrawl', fallback: true, resultCount: 8, durationMs: 11_200, userId: userIds[1]!,
        attempts: [attempt('kagi', 'timeout', 8_000), attempt('firecrawl', 'success', 3_000, 8)], phases: { providerMs: 11_000, releaseMs: 100 } }),
      row(30, { outcome: 'empty', provider: 'firecrawl', durationMs: 500, attempts: [attempt('firecrawl', 'empty', 450, 0)], phases: { providerMs: 450 } }),
      row(40, { outcome: 'error', durationMs: 300, attempts: [attempt('kagi', 'error', 250)], phases: { providerMs: 250 } }),
      row(5, { outcome: 'cancelled', durationMs: 120, attempts: [attempt('kagi', 'cancelled', 100)] }),
      row(50, { outcome: 'budget', durationMs: 30, attempts: [attempt('kagi', 'skipped_budget', 0)] }),
      row(60 * 24 * 3, { provider: 'kagi', durationMs: 9_999, attempts: [attempt('kagi', 'success', 9_000, 3)] }),
      row(15, { kind: 'places', category: 'places', provider: 'brave', resultCount: 4, durationMs: 900, attempts: [attempt('brave', 'success', 800, 4)] }),
    ])
    await registerAdminSearchAnalyticsRoutes(app)
  })

  afterAll(async () => {
    await app.close()
    await db.delete(users).where(inArray(users.id, userIds))
    await queryClient.end()
  })

  it('breaks Search latency down by outcome, provider, phase and time', async () => {
    const response = await app.inject('/api/admin/analytics/search?range=24h&timeZone=America/Chicago')
    expect(response.statusCode).toBe(200)
    const body = response.json<AdminSearchOverview>()
    expect(body.window.bucket).toBe('hour')
    expect(body.kpis.current).toEqual({
      searches: 7, timed: 5, p50Ms: 900, p90Ms: expect.any(Number), p95Ms: expect.any(Number),
      failureRate: 0.2, emptyRate: 0.2, fallbackRate: 0.2, timeoutRate: 1 / 6, users: 2,
    })
    expect(body.kpis.previous).toMatchObject({ searches: 0, p50Ms: null })
    expect(Object.fromEntries(body.outcomes.map((outcome) => [outcome.id, outcome.count]))).toEqual({
      success: 3, empty: 1, error: 1, cancelled: 1, budget: 1,
    })
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'kagi', category: 'web', attempts: 2, successes: 1, errors: 1, timeouts: 0, p50Ms: 1_025 }),
      expect.objectContaining({ provider: 'kagi', category: 'news', attempts: 1, timeouts: 1, p50Ms: 8_000 }),
      expect.objectContaining({ provider: 'firecrawl', category: 'news', attempts: 1, successes: 1, p50Ms: 3_000 }),
      expect.objectContaining({ provider: 'brave', category: 'places', attempts: 1 }),
    ]))
    expect(body.providers).toHaveLength(5)
    expect(body.phases).toMatchObject({ totalMs: 2_980, providerMs: (1_800 + 11_000 + 450 + 250) / 5, requestMs: 1, releaseMs: 20 })
    expect(body.phases.otherMs).toBeCloseTo(2_980 - (5 + 20 + 30 + 1_800 + 40 + 11_000 + 100 + 450 + 250) / 5)
    expect(body.series.length).toBeGreaterThanOrEqual(24)
    expect(body.series.reduce((sum, point) => sum + point.searches, 0)).toBe(5)
    expect(body.providerSeries.reduce((sum, point) => sum + point.attempts, 0)).toBe(6)
    expect(body.recent).toHaveLength(7)
    expect(body.recent[0]).toMatchObject({ outcome: 'cancelled', user: { id: userIds[0], name: 'Searcher 0' } })
    expect(body.recent.find((row) => row.provider === 'kagi' && row.outcome === 'success')).toMatchObject({
      queryLength: 12, filters: ['region'], phases: { settingsMs: 20 }, attempts: [{ provider: 'kagi', outcome: 'success', resultCount: 20 }],
    })
  })

  it('filters by provider, kind and outcome', async () => {
    const firecrawl = (await app.inject('/api/admin/analytics/search?range=24h&provider=firecrawl')).json<AdminSearchOverview>()
    expect(firecrawl.kpis.current.searches).toBe(2)
    expect(new Set(firecrawl.providers.map((row) => row.provider))).toEqual(new Set(['firecrawl']))
    // Kagi timed out before Firecrawl answered; that timeout belongs to Kagi alone.
    expect(firecrawl.kpis.current.timeoutRate).toBe(0)
    const kagi = (await app.inject('/api/admin/analytics/search?range=24h&provider=kagi')).json<AdminSearchOverview>()
    expect(kagi.kpis.current.timeoutRate).toBe(1 / 3)
    const places = (await app.inject('/api/admin/analytics/search?range=24h&kind=places')).json<AdminSearchOverview>()
    expect(places.recent.map((row) => row.provider)).toEqual(['brave'])
    const errors = (await app.inject('/api/admin/analytics/search?range=7d&outcome=error,empty')).json<AdminSearchOverview>()
    expect(errors.kpis.current.searches).toBe(2)
    expect((await app.inject('/api/admin/analytics/search?kind=other')).statusCode).toBe(400)
  })

  it('stores what the Search route records', async () => {
    const timer = new SearchTimer(new Date(Date.now() - 4))
    await timer.time('settingsMs', async () => undefined)
    timer.attempt('kagi')('success', 3)
    const warn = vi.fn()
    recordSearchRequest({ warn } as never, {
      userId: userIds[1]!, kind: 'query', category: 'images', outcome: 'success', provider: 'kagi', resultCount: 3,
      durationMs: timer.elapsed(), queryLength: 4, filters: ['date'], timer,
    })
    await vi.waitFor(async () => {
      const [row] = await db.select().from(searchRequests).where(and(eq(searchRequests.userId, userIds[1]!), eq(searchRequests.category, 'images')))
      expect(row).toMatchObject({ outcome: 'success', provider: 'kagi', fallback: false, page: 1, filters: ['date'],
        attempts: [{ provider: 'kagi', outcome: 'success', resultCount: 3 }], phases: { requestMs: expect.any(Number), settingsMs: expect.any(Number) } })
      expect(row!.durationMs).toBeGreaterThanOrEqual(4)
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('is admin only', async () => {
    role = 'user'
    try {
      expect((await app.inject('/api/admin/analytics/search')).statusCode).toBe(403)
    } finally {
      role = 'admin'
    }
  })
})
