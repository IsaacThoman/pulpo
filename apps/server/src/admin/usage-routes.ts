import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { agentRuns, apiKeys, applicationSettings, chats, generationAttempts, models, ocrAttempts, requestLogs, responses, toolExecutions, usageEvents, users, workspaceLeases } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { reconcileWorkspaceLeases } from '../agent/controller.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { getConfig } from '../config.js'
import { profileAvatarUrl } from '../profile/service.js'
import { decodeUsageCursor, encodeUsageCursor, resolveUsageModelAlias } from '../usage/public.js'
import { eligibleUsageFilters, loadUsageActivity, loadUsageModelAliases, usageQuerySchema, usageRecordsQuerySchema, usageSince } from '../usage/routes.js'

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
  if (input.retry) values.push(input.retry === 'true' ? gt(generationAttempts.retryAttempt, 1) : eq(generationAttempts.retryAttempt, 1))
  if (input.fallback) values.push(eq(requestLogs.fallbackUsed, input.fallback === 'true'))
  if (input.ocr) values.push(eq(requestLogs.ocrStatus, input.ocr))
  if (input.errorCategory) values.push(eq(generationAttempts.errorCategory, input.errorCategory))
  if (includeCursor && input.cursor) values.push(lt(generationAttempts.startedAt, new Date(input.cursor)))
  return values
}

export async function registerAdminUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/usage/leaderboard', async (request) => {
    requireAdmin(request)
    const query = usageQuerySchema.parse(request.query)
    const start = usageSince(query.range)
    const rows = await db.select({
      userId: users.id,
      name: users.name,
      username: users.username,
      avatarObjectKey: users.avatarObjectKey,
      avatarVersion: users.avatarVersion,
      profileColor: users.profileColor,
      balanceMicros: users.balanceMicros,
      calls: sql<number>`count(${usageEvents.id})::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
    }).from(users).innerJoin(
      usageEvents,
      start
        ? and(eq(usageEvents.userId, users.id), gte(usageEvents.createdAt, start))
        : eq(usageEvents.userId, users.id),
    )
      .where(eq(users.blocked, false))
      .groupBy(users.id)
      .orderBy(desc(sql`coalesce(sum(${usageEvents.costMicros}), 0)`))

    return { data: rows.map((row) => ({
      userId: row.userId,
      displayName: row.name,
      username: row.username,
      avatarUrl: profileAvatarUrl({
        id: row.userId,
        avatarObjectKey: row.avatarObjectKey,
        avatarVersion: row.avatarVersion,
      }),
      profileColor: row.profileColor,
      balanceMicros: Number(row.balanceMicros),
      calls: Number(row.calls),
      tokens: Number(row.tokens),
      costMicros: Number(row.costMicros),
    })) }
  })

  app.get('/api/admin/usage/leaderboard/activity', async (request) => {
    requireAdmin(request)
    const query = usageQuerySchema.parse(request.query)
    return loadUsageActivity({
      userIds: null,
      since: usageSince(query.range),
      timeZone: query.timeZone,
      hidePrivateModels: false,
    })
  })

  app.get('/api/admin/usage/leaderboard/records', async (request) => {
    requireAdmin(request)
    const query = usageRecordsQuerySchema.parse(request.query)
    const start = usageSince(query.range)
    const cursor = query.cursor ? decodeUsageCursor(query.cursor) : null
    const cursorFilter = cursor ? or(
      lt(usageEvents.createdAt, cursor.createdAt),
      and(eq(usageEvents.createdAt, cursor.createdAt), lt(usageEvents.id, cursor.id)),
    ) : undefined
    const attributedModelId = sql<string>`coalesce(${requestLogs.requestedModelId}, ${usageEvents.modelId})`
    const [rows, aliases] = await Promise.all([db.select({
      usage: usageEvents,
      userId: users.id,
      userName: users.name,
      userUsername: users.username,
      userAvatarObjectKey: users.avatarObjectKey,
      userAvatarVersion: users.avatarVersion,
      userProfileColor: users.profileColor,
      modelId: models.id,
      modelName: models.name,
      modelLogo: models.logo,
      modelVisible: models.visible,
    }).from(usageEvents)
      .innerJoin(users, eq(usageEvents.userId, users.id))
      .leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId))
      .innerJoin(models, eq(models.id, attributedModelId))
      .where(and(...eligibleUsageFilters(start, null), cursorFilter))
      .orderBy(desc(usageEvents.createdAt), desc(usageEvents.id))
      .limit(query.limit + 1), loadUsageModelAliases()])
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)?.usage

    return {
      data: page.map((row) => {
        const model = resolveUsageModelAlias({
          modelId: row.modelId,
          modelName: row.modelName,
          modelLogo: row.modelLogo,
          modelVisible: row.modelVisible,
          calls: 1,
          costMicros: Number(row.usage.costMicros),
        }, aliases)
        return {
          id: row.usage.id,
          createdAt: row.usage.createdAt.toISOString(),
          participant: {
            id: row.userId,
            displayName: row.userName,
            username: row.userUsername,
            avatarUrl: profileAvatarUrl({
              id: row.userId,
              avatarObjectKey: row.userAvatarObjectKey,
              avatarVersion: row.userAvatarVersion,
            }),
            profileColor: row.userProfileColor,
          },
          model: { id: model.modelId, name: model.modelName, logo: model.modelLogo },
          inputTokens: row.usage.inputTokens,
          cacheWriteTokens: row.usage.cacheWriteTokens,
          outputTokens: row.usage.outputTokens,
          costMicros: Number(row.usage.costMicros),
        }
      }),
      nextCursor: rows.length > query.limit && last
        ? encodeUsageCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    }
  })

  app.delete('/api/admin/usage/workspaces/orphans/:name', async (request) => {
    requireAdmin(request)
    const { name } = z.object({ name: z.string().min(1).max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/) }).parse(request.params)
    const config = getConfig()
    if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) {
      throw new AppError(503, 'workspace_controller_unavailable', 'Workspace controller is not configured')
    }
    let response: Response
    try {
      response = await workspaceControllerRequest(`/v1/workspaces/${encodeURIComponent(name)}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      throw new AppError(502, 'workspace_deletion_failed', `Workspace controller could not delete the orphan VM: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      const status = response.status === 404 || response.status === 409 ? response.status : 502
      throw new AppError(status, 'workspace_deletion_failed', response.status === 409 ? 'Workspace is no longer an unleased orphan' : `Workspace controller could not delete the orphan VM (${response.status})`)
    }
    return { status: 'deleted' }
  })

  app.delete('/api/admin/usage/workspaces/:leaseId', async (request) => {
    requireAdmin(request)
    const { leaseId } = z.object({ leaseId: z.string().uuid() }).parse(request.params)
    const [lease] = await db.select().from(workspaceLeases)
      .where(and(eq(workspaceLeases.controllerLeaseId, leaseId), inArray(workspaceLeases.status, ['provisioning', 'ready']))).limit(1)
    if (!lease) throw notFound('Active workspace lease')

    const config = getConfig()
    if (!config.WORKSPACE_CONTROLLER_URL || !config.WORKSPACE_CONTROLLER_TOKEN) {
      throw new AppError(503, 'workspace_controller_unavailable', 'Workspace controller is not configured')
    }
    let response: Response
    try {
      response = await workspaceControllerRequest(`/v1/leases/${leaseId}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      throw new AppError(502, 'workspace_termination_failed', `Workspace controller could not terminate the VM: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      throw new AppError(502, 'workspace_termination_failed', `Workspace controller could not terminate the VM (${response.status})`)
    }

    const now = new Date()
    await db.update(workspaceLeases).set({ status: 'released', capacityState: null, releasedAt: now, updatedAt: now })
      .where(and(eq(workspaceLeases.id, lease.id), inArray(workspaceLeases.status, ['provisioning', 'ready'])))
    return { status: 'released' }
  })

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
    let controllerWorkspaces: Array<{
      id: string; name: string; leaseId: string | null; instanceId: string | null; chatId: string | null; lifecycleState: string; phase: string; ready: boolean; activeOperations: number
      createdAt: string; lastUsedAt: string | null; idleExpiresAt: string | null; hardExpiresAt: string | null; deletionStartedAt: string | null
      imageDigest: string | null; restartCount: number
    }> = []
    try {
      if (!configured) throw new Error('Controller URL and token are not configured')
      const response = await workspaceControllerRequest('/v1/workspaces', { signal: AbortSignal.timeout(3_000) })
      const inventory = response.ok ? await response.json() as { warmCapacity?: number; active?: number; workspaces?: typeof controllerWorkspaces } : null
      controllerWorkspaces = inventory?.workspaces ?? []
      controller = { configured: true, healthy: response.ok, warmCapacity: inventory?.warmCapacity ?? settings.warmCapacity, active: inventory?.active ?? 0, detail: response.ok ? undefined : `Controller returned ${response.status}` }
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
    const leaseRows = new Map(data.flatMap((row) => row.controllerLeaseId ? [[row.controllerLeaseId, row] as const] : []))
    const chatRows = new Map<string, (typeof data)[number]>()
    for (const row of data) if (!chatRows.has(row.chat.id)) chatRows.set(row.chat.id, row)
    const openWorkspaces = controllerWorkspaces.map((workspace) => {
      const row = (workspace.leaseId ? leaseRows.get(workspace.leaseId) : undefined) ?? (workspace.chatId ? chatRows.get(workspace.chatId) : undefined)
      return {
        ...workspace,
        user: row?.user ?? null,
        chat: row?.chat ?? null,
        response: row?.response ?? null,
        run: row?.run ?? null,
      }
    })
    return {
      controller,
      policy: { warmCapacity: settings.warmCapacity, maxActiveWorkspaces: settings.maxActiveWorkspaces, cpu: settings.cpu, memory: settings.memory, ephemeralStorage: settings.ephemeralStorage },
      summary: { ready: rows.filter((row) => row.lease.status === 'ready').length, pending: pending.length, recent: rows.length },
      openWorkspaces,
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
      cacheWriteTokens: sql<number>`coalesce(sum(${generationAttempts.cacheWriteTokens}), 0)::bigint`,
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
      currentModelId: call.modelId, retryAttempt: call.retryAttempt, turnNumber: call.turnNumber,
      retryCount: Math.max(0, call.retryAttempt - 1),
      fallbackUsed: Boolean(call.fallbackFromModelId), stickyFallbackUsed: log.stickyFallbackUsed, ocrStatus: log.ocrStatus,
      errorCategory: call.errorCategory, errorMessage: call.errorMessage, inputTokens: call.inputTokens,
      cachedInputTokens: call.cachedInputTokens, cacheWriteTokens: call.cacheWriteTokens,
      outputTokens: call.outputTokens, reasoningTokens: call.reasoningTokens,
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
    const [agentRun] = log ? await db.select().from(agentRuns).where(eq(agentRuns.responseId, log.responseId)).limit(1) : []
    const tools = agentRun ? await db.select().from(toolExecutions).where(eq(toolExecutions.agentRunId, agentRun.id)).orderBy(asc(toolExecutions.createdAt)) : []
    return { call, request: log ? { ...log, requestPayload: undefined, responsePayload: undefined } : null, ocrAttempts: ocr, toolExecutions: tools }
  })
}
