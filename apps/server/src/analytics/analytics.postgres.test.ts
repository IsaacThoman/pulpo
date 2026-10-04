import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Fastify, { type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import type { AdminRequestDetail, AdminRequestPage, AdminRequestsOverview, InsightsEngagement, InsightsFeatures, InsightsModels, InsightsPools, InsightsSettings, InsightsTools } from '@pulpo/contracts'
import { db, queryClient } from '../database/client.js'
import {
  agentRuns, analyticsHourlyRollups, budgetReservations, chats, generationAttempts, modelPresetChoices, modelPresets, models,
  poolMembers, pools, providerConnections, requestAnalytics, requestAnalyticsTools, requestLogs, responses, toolExecutions, usageEvents, users,
} from '../database/schema.js'
import { finalizeRequestAnalytics, recordRequestAdmission, sweepRequestAnalytics } from './capture.js'
import { refreshAnalyticsRollups } from './rollups.js'
import { registerAdminRequestAnalyticsRoutes } from './request-routes.js'
import { registerAdminInsightsRoutes } from './insights-routes.js'
import { registerAdminUsageRoutes } from '../admin/usage-routes.js'

// Run against a migrated, disposable database: the backfill check clears request_analytics.
const enabled = process.env.PULPO_ANALYTICS_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_analytics_test') {
  throw new Error('Analytics tests require a migrated disposable database named pulpo_analytics_test')
}

// One connection keeps the suite usable with single-session servers such as PGlite.
vi.mock('../database/client.js', async () => {
  const [{ drizzle }, { default: postgres }, schema] = await Promise.all([
    import('drizzle-orm/postgres-js'), import('postgres'), import('../database/schema.js'),
  ])
  const queryClient = postgres(process.env.DATABASE_URL ?? 'postgres://invalid', { max: 1, prepare: false })
  return { db: drizzle(queryClient, { schema }), queryClient }
})

const providerId = randomUUID()
const modelA = `analytics-a-${randomUUID()}`
const modelB = `analytics-b-${randomUUID()}`
const userIds = [randomUUID(), randomUUID(), randomUUID()]
const poolId = randomUUID()
const presetId = randomUUID()
const responseIds: string[] = []
const now = Date.now()
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000)

async function seedResponse(input: {
  userId: string
  modelId: string
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled'
  createdAt: Date
  agent?: boolean
  fallbackTo?: string
  costMicros?: number
  ttftMs?: number
  errorCategory?: string
}) {
  const chatId = randomUUID()
  const responseId = randomUUID()
  const logId = randomUUID()
  responseIds.push(responseId)
  await db.insert(chats).values({ id: chatId, userId: input.userId, modelId: input.modelId })
  await db.insert(responses).values({
    id: responseId, chatId, userId: input.userId, modelId: input.modelId, input: [], status: input.status,
    agentMode: input.agent ?? false, presetSelections: { effort: 'high' },
    parameters: { reasoning: { effort: 'high' }, temperature: 0.7 },
    requestReceivedAt: input.createdAt,
    firstReplyTextAt: input.ttftMs === undefined ? null : new Date(input.createdAt.getTime() + input.ttftMs),
    completedAt: input.status === 'in_progress' ? null : new Date(input.createdAt.getTime() + 2_000),
    createdAt: input.createdAt,
  })
  await db.insert(requestLogs).values({
    id: logId, responseId, userId: input.userId, requestedModelId: input.modelId,
    actualModelId: input.fallbackTo ?? input.modelId, status: input.status,
    fallbackUsed: Boolean(input.fallbackTo), retryCount: input.fallbackTo ? 1 : 0,
    errorCategory: input.errorCategory ?? null, errorMessage: input.errorCategory ? 'Upstream exploded' : null,
    inputTokens: 100, outputTokens: 50, costMicros: input.costMicros ?? 1_000,
    durationMs: input.status === 'in_progress' ? null : 2_000, createdAt: input.createdAt,
  })
  await db.insert(generationAttempts).values({
    id: randomUUID(), requestLogId: logId, modelId: input.modelId, status: input.fallbackTo ? 'failed' : input.status,
    startedAt: input.createdAt, inputTokens: 100, outputTokens: 50,
  })
  if (input.fallbackTo) {
    await db.insert(generationAttempts).values({
      id: randomUUID(), requestLogId: logId, modelId: input.fallbackTo, fallbackFromModelId: input.modelId,
      retryAttempt: 2, status: input.status, startedAt: new Date(input.createdAt.getTime() + 500),
    })
  }
  if (input.agent) {
    const runId = randomUUID()
    await db.insert(agentRuns).values({ id: runId, responseId, status: 'completed', toolCalls: 2 })
    await db.insert(toolExecutions).values([
      { id: randomUUID(), agentRunId: runId, operationId: randomUUID(), toolName: 'web_search', status: 'completed', billedCostMicros: 300 },
      { id: randomUUID(), agentRunId: runId, operationId: randomUUID(), toolName: 'shell', status: 'failed' },
    ])
  }
  await db.insert(budgetReservations).values({
    id: randomUUID(), userId: input.userId, responseId, poolId: input.userId === userIds[0] ? poolId : null,
    amountMicros: 5_000, balanceReservedMicros: 5_000, status: input.status === 'in_progress' ? 'pending' : 'settled',
  })
  if (input.status === 'completed') {
    await db.insert(usageEvents).values({
      id: randomUUID(), userId: input.userId, responseId, modelId: input.fallbackTo ?? input.modelId, requestedModelId: input.modelId,
      inputTokens: 100, outputTokens: 50, costMicros: input.costMicros ?? 1_000, balanceCostMicros: input.costMicros ?? 1_000,
      latencyMs: 2_000, createdAt: input.createdAt,
    })
  }
  return { responseId, logId, chatId }
}

function appForAdmin() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.user = { id: userIds[0], role: 'admin' } as FastifyRequest['user']
  })
  // Surface the database error behind Drizzle's generic "Failed query" message.
  app.setErrorHandler((error, _request, reply) => {
    // Mirrors the app's handler: validation errors are client errors.
    const status = error instanceof ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500
    const { message, cause } = error as { message?: string; cause?: unknown }
    void reply.code(status).send({ message, cause: String(cause ?? '') })
  })
  return app
}

describe.skipIf(!enabled)('admin analytics in PostgreSQL', () => {
  const app = appForAdmin()

  beforeAll(async () => {
    await db.insert(providerConnections).values({ id: providerId, name: 'Analytics fixture', encryptedApiKey: 'unused' })
    await db.insert(models).values([
      { id: modelA, providerConnectionId: providerId, upstreamModelId: 'a', name: 'Model A', contextWindow: 100_000, maxOutputTokens: 8_000 },
      { id: modelB, providerConnectionId: providerId, upstreamModelId: 'b', name: 'Model B', contextWindow: 100_000, maxOutputTokens: 8_000 },
    ])
    await db.insert(modelPresets).values({ id: presetId, modelId: modelA, publicId: 'effort', name: 'Effort', icon: 'brain' })
    await db.insert(modelPresetChoices).values({ id: randomUUID(), presetId, publicId: 'high', displayName: 'High' })
    await db.insert(users).values(userIds.map((id, index) => ({ id, email: `${id}@example.test`, username: id, name: `Analyst ${index}` })))
    await db.insert(pools).values({ id: poolId, ownerUserId: userIds[0]! })
    await db.insert(poolMembers).values({ id: randomUUID(), poolId, userId: userIds[0]! })

    await seedResponse({ userId: userIds[0]!, modelId: modelA, status: 'completed', createdAt: minutesAgo(30), ttftMs: 400, agent: true, costMicros: 2_000 })
    await seedResponse({ userId: userIds[0]!, modelId: modelA, status: 'completed', createdAt: minutesAgo(30), ttftMs: 800, fallbackTo: modelB })
    await seedResponse({ userId: userIds[1]!, modelId: modelB, status: 'failed', createdAt: minutesAgo(90), errorCategory: 'upstream_error' })
    await seedResponse({ userId: userIds[1]!, modelId: modelB, status: 'in_progress', createdAt: minutesAgo(1) })
    await seedResponse({ userId: userIds[2]!, modelId: modelA, status: 'completed', createdAt: minutesAgo(60 * 24 * 10), ttftMs: 600 })

    // Capture admission for the first response the way createResponse does.
    await db.delete(requestAnalytics).where(inArray(requestAnalytics.responseId, responseIds))
    for (const responseId of responseIds) {
      const [response] = await db.select().from(responses).where(eq(responses.id, responseId))
      await recordRequestAdmission({
        responseId, ownerUserId: response!.userId, billingUserId: response!.userId, apiKeyId: null,
        requestedModelId: response!.modelId, answeredModelId: response!.modelId, origin: 'web',
        client: { platform: responseId === responseIds[0] ? 'ios' : 'web', version: '1.2.3' },
        presetSelections: { effort: 'high' }, effectiveParameters: { reasoning: { effort: 'high' }, temperature: 0.7 },
        maxOutputTokens: 4_096, agentMode: response!.agentMode, branchReason: 'message',
        attachmentMimeTypes: responseId === responseIds[0] ? ['image/png', 'application/pdf'] : [],
        usedDictation: responseId === responseIds[0], inputChars: 42,
      })
      await db.update(requestAnalytics).set({ createdAt: response!.createdAt }).where(eq(requestAnalytics.responseId, responseId))
    }
    await registerAdminRequestAnalyticsRoutes(app)
    await registerAdminInsightsRoutes(app)
    await registerAdminUsageRoutes(app)
  })

  afterAll(async () => {
    await app.close()
    await db.delete(requestAnalytics).where(inArray(requestAnalytics.userId, userIds))
    await db.delete(chats).where(inArray(chats.userId, userIds))
    await db.delete(usageEvents).where(inArray(usageEvents.userId, userIds))
    await db.delete(poolMembers).where(eq(poolMembers.poolId, poolId))
    await db.delete(pools).where(eq(pools.id, poolId))
    await db.delete(users).where(inArray(users.id, userIds))
    await db.delete(modelPresets).where(eq(modelPresets.id, presetId))
    await db.delete(analyticsHourlyRollups).where(inArray(analyticsHourlyRollups.modelId, [modelA, modelB]))
    await db.delete(models).where(inArray(models.id, [modelA, modelB]))
    await db.delete(providerConnections).where(eq(providerConnections.id, providerId))
    await queryClient.end()
  })

  it('captures admission settings and finalizes settled outcomes', async () => {
    const finalized = await finalizeRequestAnalytics(responseIds)
    expect(finalized).toBe(responseIds.length)
    const rows = await db.select().from(requestAnalytics).where(inArray(requestAnalytics.responseId, responseIds))
    const first = rows.find((row) => row.responseId === responseIds[0])!
    expect(first).toMatchObject({
      clientPlatform: 'ios', clientVersion: '1.2.3', reasoningEffort: 'high', temperature: 0.7,
      attachmentCount: 2, attachmentKinds: ['image', 'pdf'], usedDictation: true, status: 'completed',
      firstTokenMs: 400, costMicros: 2_000, toolCalls: 2, poolId,
    })
    expect(first.finalizedAt).not.toBeNull()
    const inFlight = rows.find((row) => row.responseId === responseIds[3])!
    expect(inFlight.finalizedAt).toBeNull()
    const tools = await db.select().from(requestAnalyticsTools).where(eq(requestAnalyticsTools.analyticsId, first.id))
    expect(tools.map((tool) => [tool.toolName, tool.calls, tool.failures]).sort()).toEqual([['shell', 1, 1], ['web_search', 1, 0]])
  })

  it('closes analytics rows whose response was purged', async () => {
    const orphan = await seedResponse({ userId: userIds[2]!, modelId: modelB, status: 'in_progress', createdAt: minutesAgo(5) })
    await recordRequestAdmission({
      responseId: orphan.responseId, ownerUserId: userIds[2]!, billingUserId: userIds[2]!, apiKeyId: null,
      requestedModelId: modelB, answeredModelId: modelB, origin: 'web', client: null, presetSelections: {},
      effectiveParameters: {}, maxOutputTokens: null, agentMode: false, branchReason: 'message',
      attachmentMimeTypes: [], usedDictation: null, inputChars: 1,
    })
    await db.delete(chats).where(eq(chats.id, orphan.chatId))
    await sweepRequestAnalytics()
    const [row] = await db.select().from(requestAnalytics).where(sql`${requestAnalytics.userId} = ${userIds[2]} and ${requestAnalytics.responseId} is null`)
    expect(row).toMatchObject({ status: 'cancelled' })
    expect(row?.finalizedAt).not.toBeNull()
  })

  it('serves the requests overview with previous-period comparison', async () => {
    const response = await app.inject(`/api/admin/analytics/requests/overview?range=24h&timeZone=America/Chicago&model=${modelA},${modelB}`)
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json<AdminRequestsOverview>()
    expect(body.window.bucket).toBe('hour')
    expect(body.kpis.current).toMatchObject({ requests: 4, completed: 2, failed: 1, inFlight: 1, users: 2 })
    expect(body.kpis.current.successRate).toBeCloseTo(2 / 3)
    expect(body.kpis.previous).toMatchObject({ requests: 0 })
    expect(body.series.length).toBeGreaterThanOrEqual(24)
    expect(body.series.reduce((sum, point) => sum + point.completed, 0)).toBe(2)
    expect(body.errors.byCategory).toEqual([{ id: 'upstream_error', label: 'upstream_error', count: 1 }])
    expect(body.errors.topMessages[0]).toMatchObject({ message: 'Upstream exploded', count: 1 })
    expect(body.fallbackPaths).toEqual([{ fromModelId: modelA, toModelId: modelB, count: 1 }])
    expect(body.topModels[0]).toMatchObject({ id: modelA, label: 'Model A', count: 2 })
  })

  it('filters the overview by platform and agent mode', async () => {
    const ios = (await app.inject(`/api/admin/analytics/requests/overview?range=24h&platform=ios&model=${modelA},${modelB}`)).json<AdminRequestsOverview>()
    expect(ios.kpis.current.requests).toBe(1)
    const agent = (await app.inject(`/api/admin/analytics/requests/overview?range=7d&agent=true&model=${modelA},${modelB}`)).json<AdminRequestsOverview>()
    expect(agent.kpis.current.requests).toBe(1)
    expect(agent.window.bucket).toBe('day')
  })

  it('pages through requests without gaps or repeats for every sort', async () => {
    for (const sort of ['newest', 'slowest', 'costliest']) {
      const seen: string[] = []
      let cursor: string | null = null
      do {
        const query: string = `range=30d&limit=1&sort=${sort}&model=${modelA},${modelB}${cursor ? `&cursor=${cursor}` : ''}`
        const page: AdminRequestPage = (await app.inject(`/api/admin/analytics/requests?${query}`)).json()
        seen.push(...page.data.map((row) => row.id))
        cursor = page.nextCursor
      } while (cursor && seen.length < 20)
      expect(new Set(seen).size).toBe(seen.length)
      // Five live request logs (the purged chat's log is gone); the in-flight one has no duration.
      expect(seen.length).toBe(sort === 'slowest' ? 4 : 5)
    }
    const invalid = await app.inject('/api/admin/analytics/requests?cursor=not-a-cursor')
    expect(invalid.statusCode).toBe(400)
  })

  it('returns a request timeline with attempts and tools', async () => {
    const [log] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseIds[0]!))
    const detail = (await app.inject(`/api/admin/analytics/requests/${log!.id}`)).json<AdminRequestDetail>()
    expect(detail.request).toMatchObject({ platform: 'ios', ttftMs: 400, toolCalls: 2, attempts: 1 })
    expect(detail.timeline.map((item) => item.kind).sort()).toEqual(['attempt', 'tool', 'tool'])
    expect(detail.settings?.parameters).toMatchObject({ temperature: 0.7 })
    expect((await app.inject(`/api/admin/analytics/requests/${randomUUID()}`)).statusCode).toBe(404)
  })

  it('serves every insights section from raw rows and rollups', async () => {
    await refreshAnalyticsRollups(null)
    const rollups = await db.select().from(analyticsHourlyRollups).where(inArray(analyticsHourlyRollups.modelId, [modelA, modelB]))
    expect(rollups.reduce((sum, row) => sum + row.requests, 0)).toBe(6)
    for (const range of ['24h', '30d']) {
      const filter = `range=${range}&model=${modelA},${modelB}&timeZone=Europe/Madrid`
      const modelsResponse = await app.inject(`/api/admin/analytics/insights/models?${filter}`)
      expect(modelsResponse.statusCode, modelsResponse.body).toBe(200)
      const models = modelsResponse.json<InsightsModels>()
      expect(models.models.find((row) => row.modelId === modelA)?.modelName).toBe('Model A')
      expect(models.series.reduce((sum, row) => sum + row.requests, 0)).toBe(models.totalRequests)
      const settings = (await app.inject(`/api/admin/analytics/insights/settings?${filter}`)).json<InsightsSettings>()
      expect(settings.presets.find((preset) => preset.presetId === 'effort')?.choices[0]).toMatchObject({ choiceName: 'High' })
      expect(settings.reasoningEffort.find((row) => row.id === 'high')).toBeDefined()
      const tools = (await app.inject(`/api/admin/analytics/insights/tools?${filter}`)).json<InsightsTools>()
      expect(tools.tools.map((tool) => tool.toolName).sort()).toEqual(['shell', 'web_search'])
      const poolsBody = (await app.inject(`/api/admin/analytics/insights/pools?${filter}`)).json<InsightsPools>()
      expect(poolsBody.pools.find((pool) => pool.poolId === poolId)).toMatchObject({ requests: 2 })
      const features = (await app.inject(`/api/admin/analytics/insights/features?${filter}`)).json<InsightsFeatures>()
      expect(features.platforms.find((row) => row.platform === 'ios')).toMatchObject({ requests: 1 })
      expect(features.attachmentKinds.map((kind) => kind.id).sort()).toEqual(['image', 'pdf'])
      const engagement = (await app.inject(`/api/admin/analytics/insights/engagement?${filter}`)).json<InsightsEngagement>()
      expect(engagement.activeUsers).toBeGreaterThan(0)
      expect(engagement.topUsers.length).toBeGreaterThan(0)
    }
    const allTime = await app.inject(`/api/admin/analytics/insights/models?range=all&model=${modelA}`)
    expect(allTime.statusCode).toBe(200)
  })

  it('keeps the legacy model-call list and summary working', async () => {
    const summary = await app.inject(`/api/admin/usage/summary?range=30d&model=${modelB}`)
    expect(summary.statusCode, summary.body).toBe(200)
    expect(summary.json()).toMatchObject({ summary: { total: 3, completed: 1, failed: 1, inProgress: 1 } })
    // Two attempts share a start time to exercise the id tiebreak.
    const [log] = await db.select({ id: requestLogs.id }).from(requestLogs).where(eq(requestLogs.responseId, responseIds[2]!))
    const [attempt] = await db.select().from(generationAttempts).where(eq(generationAttempts.requestLogId, log!.id))
    await db.insert(generationAttempts).values({ id: randomUUID(), requestLogId: log!.id, modelId: modelB, status: 'failed', retryAttempt: 2, startedAt: attempt!.startedAt })
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: { data: Array<{ id: string }>; nextCursor: string | null } = (await app.inject(`/api/admin/usage/requests?range=30d&limit=1&model=${modelB}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json()
      seen.push(...page.data.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor && seen.length < 20)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(4)
    const legacyCursor = await app.inject(`/api/admin/usage/requests?range=30d&cursor=${encodeURIComponent(new Date().toISOString())}`)
    expect(legacyCursor.statusCode).toBe(200)
    expect((await app.inject('/api/admin/usage/requests/not-a-uuid')).statusCode).toBe(400)
  })

  it('backfills analytics from existing responses and orphaned usage', async () => {
    const migration = readFileSync(new URL('../../drizzle/0091_admin_request_analytics.sql', import.meta.url), 'utf8')
    const backfill = migration.slice(migration.indexOf('-- Backfill analytics')).split('--> statement-breakpoint')
    await db.delete(requestAnalytics)
    await db.insert(usageEvents).values({
      id: randomUUID(), userId: userIds[2]!, responseId: null, modelId: modelB, requestedModelId: modelA,
      inputTokens: 1, outputTokens: 1, costMicros: 10, latencyMs: 100,
    })
    for (const statement of backfill) await db.execute(sql.raw(statement))
    const rows = await db.select().from(requestAnalytics).where(inArray(requestAnalytics.userId, userIds))
    const purged = rows.filter((row) => row.responseId === null)
    expect(purged).toHaveLength(1)
    expect(purged[0]).toMatchObject({ requestedModelId: modelA, answeredModelId: modelB, status: 'completed', clientPlatform: 'unknown' })
    const agent = rows.find((row) => row.responseId === responseIds[0])!
    expect(agent).toMatchObject({ reasoningEffort: 'high', temperature: 0.7, toolCalls: 2, firstTokenMs: 400 })
    const tools = await db.select().from(requestAnalyticsTools).where(eq(requestAnalyticsTools.analyticsId, agent.id))
    expect(tools).toHaveLength(2)
  })
})
