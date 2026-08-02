import { and, asc, desc, eq, gt, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { agentRuns, apiKeys, applicationSettings, chats, generationAttempts, models, ocrAttempts, requestLogs, responses, users, workspaceLeases } from '../database/schema.js'
import { notFound } from '../lib/errors.js'
import { reconcileWorkspaceLeases } from '../agent/controller.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { getConfig } from '../config.js'

const querySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '90d', 'all']).default('24h'),
  status: z.string().optional(), origin: z.string().optional(), model: z.string().optional(),
  identity: z.string().optional(), retry: z.enum(['true', 'false']).optional(),
  fallback: z.enum(['true', 'false']).optional(), ocr: z.string().optional(), errorCategory: z.string().optional(),
  cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
})

function since(range: string): Date | null {
  const duration: Record<string, number> = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, '90d': 7_776_000_000 }
  return range === 'all' ? null : new Date(Date.now() - duration[range]!)
}

function filters(input: z.infer<typeof querySchema>, includeCursor = false): SQL[] {
  const values: SQL[] = []
  const start = since(input.range)
  if (start) values.push(gte(generationAttempts.startedAt, start))
  if (input.status) values.push(inArray(generationAttempts.status, input.status.split(',')))
  if (input.origin) values.push(eq(generationAttempts.source, input.origin))
  if (input.model) values.push(sql`(${generationAttempts.modelId} = ${input.model} or ${generationAttempts.upstreamModelId} = ${input.model})`)
  if (input.identity) values.push(sql`(${requestLogs.userId}::text = ${input.identity} or ${requestLogs.apiKeyId}::text = ${input.identity})`)
  if (input.retry) values.push(input.retry === 'true' ? gt(generationAttempts.attempt, 1) : eq(generationAttempts.attempt, 1))
  if (input.fallback) values.push(eq(requestLogs.fallbackUsed, input.fallback === 'true'))
  if (input.ocr) values.push(eq(requestLogs.ocrStatus, input.ocr))
  if (input.errorCategory) values.push(eq(generationAttempts.errorCategory, input.errorCategory))
  if (includeCursor && input.cursor) values.push(lt(generationAttempts.startedAt, new Date(input.cursor)))
  return values
}

export async function registerAdminUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/usage/workspaces', async (request) => {
    requireAdmin(request)
    await reconcileWorkspaceLeases()
    const rows = await db.select({
      lease: workspaceLeases,
      user: { id: users.id, name: users.name, email: users.email },
      chat: { id: chats.id, title: chats.title },
      response: { id: responses.id, modelId: responses.modelId, status: responses.status },
    }).from(workspaceLeases)
      .innerJoin(users, eq(workspaceLeases.userId, users.id))
      .innerJoin(chats, eq(workspaceLeases.chatId, chats.id))
      .leftJoin(responses, eq(workspaceLeases.responseId, responses.id))
      .orderBy(desc(workspaceLeases.createdAt)).limit(200)
    const leaseIds = rows.map((row) => row.lease.id)
    const runs = leaseIds.length ? await db.select().from(agentRuns).where(inArray(agentRuns.workspaceLeaseId, leaseIds)).orderBy(desc(agentRuns.createdAt)) : []
    const latestRun = new Map<string, typeof agentRuns.$inferSelect>()
    for (const run of runs) if (run.workspaceLeaseId && !latestRun.has(run.workspaceLeaseId)) latestRun.set(run.workspaceLeaseId, run)
    const [settingsRow] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'agent')).limit(1)
    const settings = parseAgentSettings(settingsRow?.value)
    const config = getConfig()
    const configured = Boolean(config.WORKSPACE_CONTROLLER_URL && config.WORKSPACE_CONTROLLER_TOKEN)
    let controller: { configured: boolean; healthy: boolean; warmCapacity: number; active: number; detail?: string } = { configured, healthy: false, warmCapacity: settings.warmCapacity, active: 0 }
    try {
      if (!configured) throw new Error('Controller URL and token are not configured')
      const response = await workspaceControllerRequest('/healthz', { signal: AbortSignal.timeout(3_000) }, false)
      const health = response.ok ? await response.json() as { warmCapacity?: number; active?: number } : null
      controller = { configured: true, healthy: response.ok, warmCapacity: health?.warmCapacity ?? settings.warmCapacity, active: health?.active ?? 0, detail: response.ok ? undefined : `Controller returned ${response.status}` }
    } catch (error) {
      controller = { configured, healthy: false, warmCapacity: settings.warmCapacity, active: 0, detail: error instanceof Error ? error.message : String(error) }
    }
    const pending = rows.filter((row) => row.lease.status === 'provisioning').sort((a, b) => a.lease.createdAt.getTime() - b.lease.createdAt.getTime())
    const positions = new Map(pending.map((row, index) => [row.lease.id, index + 1]))
    const data = rows.map(({ lease, ...relations }) => ({
      ...lease,
      createdAt: lease.createdAt.toISOString(), updatedAt: lease.updatedAt.toISOString(),
      claimedAt: lease.claimedAt?.toISOString() ?? null, lastUsedAt: lease.lastUsedAt?.toISOString() ?? null,
      expiresAt: lease.expiresAt?.toISOString() ?? null, hardExpiresAt: lease.hardExpiresAt?.toISOString() ?? null,
      releasedAt: lease.releasedAt?.toISOString() ?? null, queuePosition: positions.get(lease.id) ?? null,
      run: latestRun.get(lease.id) ? {
        status: latestRun.get(lease.id)!.status, modelTurns: latestRun.get(lease.id)!.modelTurns,
        toolCalls: latestRun.get(lease.id)!.toolCalls, startedAt: latestRun.get(lease.id)!.startedAt?.toISOString() ?? null,
      } : null,
      ...relations,
      response: relations.response ?? { id: null, modelId: null, status: null },
    }))
    return {
      controller,
      policy: { warmCapacity: settings.warmCapacity, maxActiveWorkspaces: settings.maxActiveWorkspaces, cpu: settings.cpu, memory: settings.memory, ephemeralStorage: settings.ephemeralStorage },
      summary: { ready: rows.filter((row) => row.lease.status === 'ready').length, pending: pending.length, recent: rows.length },
      data,
    }
  })

  app.get('/api/admin/usage/summary', async (request) => {
    requireAdmin(request)
    const input = querySchema.parse(request.query)
    const where = and(...filters(input))
    const [summary] = await db.select({
      total: sql<number>`count(*)::int`, queued: sql<number>`0::int`,
      inProgress: sql<number>`count(*) filter (where ${generationAttempts.status} = 'in_progress')::int`,
      completed: sql<number>`count(*) filter (where ${generationAttempts.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${generationAttempts.status} = 'failed')::int`,
      cancelled: sql<number>`0::int`, incomplete: sql<number>`0::int`,
      inputTokens: sql<number>`coalesce(sum(${generationAttempts.inputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${generationAttempts.cachedInputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${generationAttempts.outputTokens}), 0)::bigint`,
      reasoningTokens: sql<number>`coalesce(sum(${generationAttempts.reasoningTokens}), 0)::bigint`,
      spendMicros: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint`,
      averageLatencyMs: sql<number>`coalesce(avg(${generationAttempts.durationMs}) filter (where ${generationAttempts.durationMs} is not null), 0)::float8`,
      averageTokensPerSecond: sql<number>`coalesce(avg((${generationAttempts.outputTokens} * 1000.0) / nullif(${generationAttempts.durationMs}, 0)) filter (where ${generationAttempts.durationMs} is not null), 0)::float8`,
      successRate: sql<number>`coalesce(count(*) filter (where ${generationAttempts.status} = 'completed')::float / nullif(count(*) filter (where ${generationAttempts.status} <> 'in_progress'), 0), 0)::float8`,
    }).from(generationAttempts).innerJoin(requestLogs, eq(generationAttempts.requestLogId, requestLogs.id)).where(where)
    const daily = await db.select({
      day: sql<string>`date_trunc('day', ${generationAttempts.startedAt})::text`, modelId: generationAttempts.modelId,
      calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint`,
      tokens: sql<number>`coalesce(sum(${generationAttempts.inputTokens} + ${generationAttempts.outputTokens}), 0)::bigint`,
    }).from(generationAttempts).innerJoin(requestLogs, eq(generationAttempts.requestLogId, requestLogs.id)).where(where).groupBy(sql`date_trunc('day', ${generationAttempts.startedAt})`, generationAttempts.modelId).orderBy(asc(sql`date_trunc('day', ${generationAttempts.startedAt})`))
    const topModels = await db.select({ id: generationAttempts.modelId, calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` }).from(generationAttempts).innerJoin(requestLogs, eq(generationAttempts.requestLogId, requestLogs.id)).where(where).groupBy(generationAttempts.modelId).orderBy(desc(sql`count(*)`)).limit(10)
    const topUsers = await db.select({ id: users.id, name: users.name, email: users.email, calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` }).from(generationAttempts).innerJoin(requestLogs, eq(generationAttempts.requestLogId, requestLogs.id)).innerJoin(users, eq(requestLogs.userId, users.id)).where(where).groupBy(users.id).orderBy(desc(sql`count(*)`)).limit(10)
    const topApiKeys = await db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${generationAttempts.costMicros}), 0)::bigint` }).from(generationAttempts).innerJoin(requestLogs, eq(generationAttempts.requestLogId, requestLogs.id)).innerJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id)).where(where).groupBy(apiKeys.id).orderBy(desc(sql`count(*)`)).limit(10)
    return { summary, daily, topModels, topUsers, topApiKeys }
  })

  app.get('/api/admin/usage/requests', async (request) => {
    requireAdmin(request)
    const input = querySchema.parse(request.query)
    const rows = await db.select({ call: generationAttempts, log: requestLogs, user: { id: users.id, name: users.name, email: users.email }, apiKey: { id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix }, modelName: models.name })
      .from(generationAttempts).innerJoin(requestLogs, eq(generationAttempts.requestLogId, requestLogs.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id)).leftJoin(models, eq(generationAttempts.modelId, models.id))
      .where(and(...filters(input, true))).orderBy(desc(generationAttempts.startedAt)).limit(input.limit + 1)
    const page = rows.slice(0, input.limit).map(({ call, log, ...relations }) => ({
      id: call.id, requestLogId: log.id, responseId: log.responseId, origin: call.source, purpose: call.purpose,
      status: call.status, requestedModelId: call.upstreamModelId ?? call.modelId, actualModelId: call.modelId,
      currentModelId: call.modelId, currentAttempt: call.attempt, retryCount: Math.max(0, call.attempt - 1),
      fallbackUsed: Boolean(call.fallbackFromModelId), stickyFallbackUsed: log.stickyFallbackUsed, ocrStatus: log.ocrStatus,
      errorCategory: call.errorCategory, errorMessage: call.errorMessage, inputTokens: call.inputTokens,
      cachedInputTokens: call.cachedInputTokens, outputTokens: call.outputTokens, reasoningTokens: call.reasoningTokens,
      costMicros: call.costMicros, durationMs: call.durationMs,
      tokensPerSecond: call.durationMs ? (call.outputTokens * 1000) / call.durationMs : null,
      createdAt: call.startedAt.toISOString(), ...relations,
    }))
    return { data: page, nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.call.startedAt.toISOString() : null }
  })

  app.get('/api/admin/usage/requests/:id', async (request) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const [call] = await db.select().from(generationAttempts).where(eq(generationAttempts.id, id)).limit(1)
    if (!call) throw notFound('Model call')
    const [log] = await db.select().from(requestLogs).where(eq(requestLogs.id, call.requestLogId)).limit(1)
    const ocr = await db.select().from(ocrAttempts).where(eq(ocrAttempts.requestLogId, call.requestLogId)).orderBy(asc(ocrAttempts.createdAt))
    return { call, request: log ? { ...log, requestPayload: undefined, responsePayload: undefined } : null, ocrAttempts: ocr }
  })
}
