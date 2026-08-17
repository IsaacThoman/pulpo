import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  adminUsageQuerySchema,
  adminUsagePayloadScopeSchema,
  revealAdminUsagePayloadSchema,
  type AdminUsageQuery,
  type AdminUsageRequest,
} from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { agentRuns, apiKeys, applicationSettings, auditEvents, chats, generationAttempts, models, ocrAttempts, requestLogs, responses, toolExecutions, users, workspaceLeases } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { reconcileWorkspaceLeases } from '../agent/controller.js'
import { workspaceControllerRequest } from '../agent/controller-http.js'
import { parseAgentSettings } from '../settings/application-settings.js'
import { getConfig } from '../config.js'
import { profileAvatarUrl } from '../profile/service.js'
import { requireInteractiveAdmin } from '../management/auth.js'

const querySchema = adminUsageQuerySchema
type UsageQuery = AdminUsageQuery
export const ADMIN_USAGE_PAYLOAD_REVEAL_PATH = '/api/admin/usage-payloads/:requestId/reveal'

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() })

export function encodeAdminUsageCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id })).toString('base64url')
}

export function decodeAdminUsageCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return { createdAt: new Date(parsed.createdAt), id: parsed.id }
  } catch {
    throw new AppError(400, 'invalid_usage_cursor', 'Usage cursor is invalid')
  }
}

export function adminUsagePayloadStatus(value: unknown, expiresAt: Date | null = null, now = Date.now()): 'available' | 'expired' | 'not_stored' {
  if (expiresAt && expiresAt.getTime() <= now) return 'expired'
  return value == null ? 'not_stored' : 'available'
}

export function reconcileAdminUsageCosts(input: {
  requestCostMicros: number
  attempts: Array<{ costMicros: number }>
  tools: Array<{ billedCostMicros: number; providerCostMicros: number }>
}) {
  const modelCostMicros = input.attempts.reduce((sum, row) => sum + row.costMicros, 0)
  const toolBilledCostMicros = input.tools.reduce((sum, row) => sum + row.billedCostMicros, 0)
  const toolProviderCostMicros = input.tools.reduce((sum, row) => sum + row.providerCostMicros, 0)
  return {
    requestCostMicros: input.requestCostMicros,
    modelCostMicros,
    toolBilledCostMicros,
    toolProviderCostMicros,
    remainderMicros: input.requestCostMicros - modelCostMicros - toolBilledCostMicros,
  }
}

export function adminUsagePayloadAudit(input: {
  actorUserId: string
  requestId: string
  responseId: string
  scope: string
  resourceId: string | null
  payloadExpiresAt: Date | null
}) {
  return {
    id: newId(), actorUserId: input.actorUserId, action: 'usage.payload.reveal', targetType: 'request_log', targetId: input.requestId,
    metadata: { responseId: input.responseId, scope: input.scope, resourceId: input.resourceId, payloadExpiresAt: iso(input.payloadExpiresAt) },
  }
}

function since(range: string): Date | null {
  const duration: Record<string, number> = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, '90d': 7_776_000_000 }
  return range === 'all' ? null : new Date(Date.now() - duration[range]!)
}

function filters(input: UsageQuery, includeCursor = false): SQL[] {
  const values: SQL[] = []
  const start = since(input.range)
  if (start) values.push(gte(requestLogs.createdAt, start))
  if (input.status) values.push(eq(requestLogs.status, input.status))
  if (input.origin) values.push(eq(requestLogs.origin, input.origin))
  if (input.model) values.push(or(eq(requestLogs.requestedModelId, input.model), eq(requestLogs.actualModelId, input.model), eq(requestLogs.currentModelId, input.model))!)
  if (input.userId) values.push(eq(requestLogs.userId, input.userId))
  if (input.apiKeyId) values.push(eq(requestLogs.apiKeyId, input.apiKeyId))
  if (input.agent) values.push(eq(responses.agentMode, input.agent === 'true'))
  if (input.retry) values.push(input.retry === 'true' ? sql`${requestLogs.retryCount} > 0` : eq(requestLogs.retryCount, 0))
  if (input.fallback) values.push(eq(requestLogs.fallbackUsed, input.fallback === 'true'))
  if (input.ocr) values.push(eq(requestLogs.ocrStatus, input.ocr))
  if (input.errorCategory) values.push(eq(requestLogs.errorCategory, input.errorCategory))
  if (input.tool) values.push(sql`exists (
    select 1 from ${agentRuns} ar
    inner join ${toolExecutions} te on te.agent_run_id = ar.id
    where ar.response_id = ${requestLogs.responseId} and te.tool_name = ${input.tool}
  )`)
  if (input.q) {
    const pattern = `%${input.q}%`
    values.push(or(
      ilike(users.name, pattern), ilike(users.email, pattern), ilike(apiKeys.name, pattern), ilike(apiKeys.prefix, pattern),
      sql`${requestLogs.id}::text ilike ${pattern}`, sql`${requestLogs.responseId}::text ilike ${pattern}`,
    )!)
  }
  if (includeCursor && input.cursor) {
    const cursor = decodeAdminUsageCursor(input.cursor)
    values.push(or(lt(requestLogs.createdAt, cursor.createdAt), and(eq(requestLogs.createdAt, cursor.createdAt), lt(requestLogs.id, cursor.id)))!)
  }
  return values
}

function bucket(input: UsageQuery): SQL<string> {
  if (input.range === '24h') return sql<string>`date_trunc('hour', ${requestLogs.createdAt} at time zone ${input.timeZone})::text`
  if (input.range === 'all') return sql<string>`date_trunc('month', ${requestLogs.createdAt} at time zone ${input.timeZone})::text`
  return sql<string>`date_trunc('day', ${requestLogs.createdAt} at time zone ${input.timeZone})::text`
}

function iso(value: Date | null): string | null { return value?.toISOString() ?? null }

async function modelNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (!unique.length) return new Map()
  return new Map((await db.select({ id: models.id, name: models.name }).from(models).where(inArray(models.id, unique))).map((row) => [row.id, row.name]))
}

interface RequestSelectRow {
  log: typeof requestLogs.$inferSelect
  response: { agentMode: boolean }
  user: Pick<typeof users.$inferSelect, 'id' | 'name' | 'email' | 'avatarObjectKey' | 'avatarVersion'>
  apiKey: { id: string; name: string; prefix: string } | null
  turns: number
  toolCalls: number
}

async function serializeRequests(rows: RequestSelectRow[]): Promise<AdminUsageRequest[]> {
  const names = await modelNames(rows.flatMap((row) => [row.log.requestedModelId, row.log.actualModelId, row.log.currentModelId]))
  return rows.map(({ log, response, user, apiKey, turns, toolCalls }) => {
    const actualId = log.actualModelId ?? log.currentModelId
    return {
      id: log.id,
      responseId: log.responseId,
      createdAt: log.createdAt.toISOString(),
      startedAt: iso(log.startedAt),
      completedAt: iso(log.completedAt),
      origin: log.origin,
      status: log.status,
      requestedModel: { id: log.requestedModelId, name: names.get(log.requestedModelId) ?? log.requestedModelId },
      actualModel: actualId ? { id: actualId, name: names.get(actualId) ?? actualId } : null,
      agentMode: response.agentMode,
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: profileAvatarUrl(user) },
      apiKey,
      turns: Number(turns),
      toolCalls: Number(toolCalls),
      retryCount: log.retryCount,
      fallbackUsed: log.fallbackUsed,
      stickyFallbackUsed: log.stickyFallbackUsed,
      ocrStatus: log.ocrStatus,
      errorCategory: log.errorCategory,
      errorMessage: log.errorMessage,
      inputTokens: log.inputTokens,
      cachedInputTokens: log.cachedInputTokens,
      cacheWriteTokens: log.cacheWriteTokens,
      outputTokens: log.outputTokens,
      reasoningTokens: log.reasoningTokens,
      costMicros: log.costMicros,
      durationMs: log.durationMs,
      tokensPerSecond: log.tokensPerSecond,
      payloadExpiresAt: iso(log.payloadExpiresAt),
      hasStoredPayloads: log.requestPayload !== null || log.responsePayload !== null || response.agentMode || Number(toolCalls) > 0 || log.ocrStatus !== 'not_requested',
    }
  })
}

async function selectRequests(where: SQL | undefined, limit?: number) {
  let query = db.select({
    log: requestLogs,
    response: { agentMode: responses.agentMode },
    user: { id: users.id, name: users.name, email: users.email, avatarObjectKey: users.avatarObjectKey, avatarVersion: users.avatarVersion },
    apiKey: { id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix },
    turns: sql<number>`(
      select case when count(*) filter (where ga.purpose = 'generation') > 0
        then greatest(coalesce(max(ga.turn_number), 0), 1) else 0 end
      from ${generationAttempts} ga where ga.request_log_id = ${requestLogs.id}
    )::int`,
    toolCalls: sql<number>`(
      select count(*) from ${agentRuns} ar inner join ${toolExecutions} te on te.agent_run_id = ar.id
      where ar.response_id = ${requestLogs.responseId}
    )::int`,
  }).from(requestLogs)
    .innerJoin(responses, eq(requestLogs.responseId, responses.id))
    .innerJoin(users, eq(requestLogs.userId, users.id))
    .leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
    .where(where)
    .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
    .$dynamic()
  if (limit !== undefined) query = query.limit(limit)
  return await query
}

export async function registerAdminUsageRoutes(app: FastifyInstance): Promise<void> {
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
    const modelId = sql<string>`coalesce(${requestLogs.actualModelId}, ${requestLogs.currentModelId}, ${requestLogs.requestedModelId})`
    const day = bucket(input)
    const errorPredicate = sql`${requestLogs.status} in ('failed', 'cancelled', 'incomplete')`

    const [daily, topModelRows, topUserRows, topApiKeys, toolTotalsRows, topTools] = await Promise.all([
      db.select({
        day, modelId,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${requestLogs.inputTokens} + ${requestLogs.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint`,
        errors: sql<number>`count(*) filter (where ${errorPredicate})::int`,
      }).from(requestLogs).innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
        .where(where).groupBy(sql`1`, sql`2`).orderBy(sql`1 asc`),
      db.select({ id: modelId, calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint` })
        .from(requestLogs).innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
        .where(where).groupBy(modelId).orderBy(desc(sql`sum(${requestLogs.costMicros})`)).limit(10),
      db.select({
        id: users.id, name: users.name, email: users.email, avatarObjectKey: users.avatarObjectKey, avatarVersion: users.avatarVersion,
        calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint`,
      }).from(requestLogs).innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
        .where(where).groupBy(users.id).orderBy(desc(sql`sum(${requestLogs.costMicros})`)).limit(10),
      db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint` })
        .from(requestLogs).innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).innerJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
        .where(where).groupBy(apiKeys.id).orderBy(desc(sql`sum(${requestLogs.costMicros})`)).limit(10),
      db.select({
        billedCostMicros: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint`,
        providerCostMicros: sql<number>`coalesce(sum(${toolExecutions.providerCostMicros}), 0)::bigint`,
      }).from(toolExecutions).innerJoin(agentRuns, eq(toolExecutions.agentRunId, agentRuns.id)).innerJoin(requestLogs, eq(agentRuns.responseId, requestLogs.responseId))
        .innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id)).where(where),
      db.select({
        name: toolExecutions.toolName, calls: sql<number>`count(*)::int`,
        billedCostMicros: sql<number>`coalesce(sum(${toolExecutions.billedCostMicros}), 0)::bigint`,
        providerCostMicros: sql<number>`coalesce(sum(${toolExecutions.providerCostMicros}), 0)::bigint`,
      }).from(toolExecutions).innerJoin(agentRuns, eq(toolExecutions.agentRunId, agentRuns.id)).innerJoin(requestLogs, eq(agentRuns.responseId, requestLogs.responseId))
        .innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
        .where(where).groupBy(toolExecutions.toolName).orderBy(desc(sql`sum(${toolExecutions.billedCostMicros})`), desc(sql`count(*)`)).limit(10),
    ])

    const [summary] = await db.select({
      requests: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${requestLogs.status} in ('queued', 'in_progress'))::int`,
      completed: sql<number>`count(*) filter (where ${requestLogs.status} = 'completed')::int`,
      errors: sql<number>`count(*) filter (where ${errorPredicate})::int`,
      inputTokens: sql<number>`coalesce(sum(${requestLogs.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${requestLogs.outputTokens}), 0)::bigint`,
      spendMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint`,
      activeUsers: sql<number>`count(distinct ${requestLogs.userId})::int`,
      p95LatencyMs: sql<number | null>`(percentile_cont(0.95) within group (order by ${requestLogs.durationMs}) filter (where ${requestLogs.durationMs} is not null))::float8`,
      successRate: sql<number>`coalesce(count(*) filter (where ${requestLogs.status} = 'completed')::float / nullif(count(*) filter (where ${requestLogs.status} not in ('queued', 'in_progress')), 0), 0)::float8`,
    }).from(requestLogs).innerJoin(responses, eq(requestLogs.responseId, responses.id)).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id)).where(where)
    const names = await modelNames(topModelRows.map((row) => row.id))
    const toolTotals = toolTotalsRows[0]
    return {
      summary: {
        requests: Number(summary?.requests ?? 0), active: Number(summary?.active ?? 0), completed: Number(summary?.completed ?? 0), errors: Number(summary?.errors ?? 0),
        inputTokens: Number(summary?.inputTokens ?? 0), outputTokens: Number(summary?.outputTokens ?? 0), spendMicros: Number(summary?.spendMicros ?? 0),
        activeUsers: Number(summary?.activeUsers ?? 0), p95LatencyMs: summary?.p95LatencyMs == null ? null : Number(summary.p95LatencyMs),
        successRate: Number(summary?.successRate ?? 0), toolSpendMicros: Number(toolTotals?.billedCostMicros ?? 0), providerToolCostMicros: Number(toolTotals?.providerCostMicros ?? 0),
      },
      daily: daily.map((row) => ({ ...row, requests: Number(row.requests), tokens: Number(row.tokens), costMicros: Number(row.costMicros), errors: Number(row.errors) })),
      topModels: topModelRows.map((row) => ({ ...row, name: names.get(row.id) ?? row.id, calls: Number(row.calls), costMicros: Number(row.costMicros) })),
      topUsers: topUserRows.map((row) => ({ id: row.id, name: row.name, email: row.email, avatarUrl: profileAvatarUrl(row), calls: Number(row.calls), costMicros: Number(row.costMicros) })),
      topApiKeys: topApiKeys.map((row) => ({ ...row, calls: Number(row.calls), costMicros: Number(row.costMicros) })),
      topTools: topTools.map((row) => ({ ...row, calls: Number(row.calls), billedCostMicros: Number(row.billedCostMicros), providerCostMicros: Number(row.providerCostMicros) })),
    }
  })

  app.get('/api/admin/usage/requests', async (request) => {
    requireAdmin(request)
    const input = querySchema.parse(request.query)
    const rows = await selectRequests(and(...filters(input, true)), input.limit + 1)
    const page = rows.slice(0, input.limit)
    const data = await serializeRequests(page)
    const last = page.at(-1)?.log
    return { data, nextCursor: rows.length > input.limit && last ? encodeAdminUsageCursor({ createdAt: last.createdAt, id: last.id }) : null }
  })

  app.get('/api/admin/usage/requests/:id', async (request) => {
    requireAdmin(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    let requestId = id
    let [log] = await db.select().from(requestLogs).where(eq(requestLogs.id, requestId)).limit(1)
    if (!log) {
      const [attempt] = await db.select({ requestLogId: generationAttempts.requestLogId }).from(generationAttempts).where(eq(generationAttempts.id, id)).limit(1)
      if (!attempt) throw notFound('Usage request')
      requestId = attempt.requestLogId
      ;[log] = await db.select().from(requestLogs).where(eq(requestLogs.id, requestId)).limit(1)
    }
    if (!log) throw notFound('Usage request')
    const selected = await selectRequests(eq(requestLogs.id, requestId), 1)
    const [serialized] = await serializeRequests(selected)
    if (!serialized) throw notFound('Usage request')
    const [attemptRows, ocrRows, runRows] = await Promise.all([
      db.select().from(generationAttempts).where(eq(generationAttempts.requestLogId, requestId)).orderBy(asc(generationAttempts.startedAt)),
      db.select().from(ocrAttempts).where(eq(ocrAttempts.requestLogId, requestId)).orderBy(asc(ocrAttempts.createdAt)),
      db.select().from(agentRuns).where(eq(agentRuns.responseId, log.responseId)).limit(1),
    ])
    const agentRun = runRows[0] ?? null
    const toolRows = agentRun ? await db.select().from(toolExecutions).where(eq(toolExecutions.agentRunId, agentRun.id)).orderBy(asc(toolExecutions.createdAt)) : []
    const names = await modelNames(attemptRows.map((row) => row.modelId))
    const reconciliation = reconcileAdminUsageCosts({ requestCostMicros: log.costMicros, attempts: attemptRows, tools: toolRows })
    const payloads = [
      { scope: 'request' as const, resourceId: null, label: 'Request payload', status: adminUsagePayloadStatus(log.requestPayload, log.payloadExpiresAt), expiresAt: iso(log.payloadExpiresAt) },
      { scope: 'response' as const, resourceId: null, label: 'Response payload', status: adminUsagePayloadStatus(log.responsePayload, log.payloadExpiresAt), expiresAt: iso(log.payloadExpiresAt) },
      ...(agentRun ? [{ scope: 'agent_context' as const, resourceId: agentRun.id, label: 'Agent context', status: adminUsagePayloadStatus(agentRun.context), expiresAt: null }] : []),
      ...ocrRows.flatMap((row, index) => [
        { scope: 'ocr_request' as const, resourceId: row.id, label: `OCR ${index + 1} request`, status: adminUsagePayloadStatus(row.requestPayload, log.payloadExpiresAt), expiresAt: iso(log.payloadExpiresAt) },
        { scope: 'ocr_response' as const, resourceId: row.id, label: `OCR ${index + 1} response`, status: adminUsagePayloadStatus(row.responsePayload, log.payloadExpiresAt), expiresAt: iso(log.payloadExpiresAt) },
      ]),
      ...toolRows.flatMap((row, index) => [
        { scope: 'tool_arguments' as const, resourceId: row.id, label: `${row.toolName} ${index + 1} arguments`, status: adminUsagePayloadStatus(row.arguments), expiresAt: null },
        { scope: 'tool_output' as const, resourceId: row.id, label: `${row.toolName} ${index + 1} output`, status: adminUsagePayloadStatus(row.output), expiresAt: null },
      ]),
    ]
    return {
      request: serialized,
      attempts: attemptRows.map((row) => ({
        id: row.id, model: { id: row.modelId, name: names.get(row.modelId) ?? row.modelId }, upstreamModelId: row.upstreamModelId,
        source: row.source, purpose: row.purpose, retryAttempt: row.retryAttempt, turnNumber: row.turnNumber, status: row.status,
        retryReason: row.retryReason, fallbackFromModelId: row.fallbackFromModelId, upstreamResponseId: row.upstreamResponseId,
        errorCategory: row.errorCategory, errorMessage: row.errorMessage, firstTokenMs: row.firstTokenMs, durationMs: row.durationMs,
        inputTokens: row.inputTokens, cachedInputTokens: row.cachedInputTokens, cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens, reasoningTokens: row.reasoningTokens, costMicros: row.costMicros,
        startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt),
      })),
      tools: toolRows.map((row) => ({
        id: row.id, turnNumber: row.turnNumber, operationId: row.operationId, name: row.toolName, status: row.status,
        provider: row.provider, providerAttempts: row.providerAttempts, providerCostMicros: row.providerCostMicros, billedCostMicros: row.billedCostMicros,
        exitCode: row.exitCode, error: row.error, startedAt: iso(row.startedAt), completedAt: iso(row.completedAt),
        durationMs: row.startedAt && row.completedAt ? Math.max(0, row.completedAt.getTime() - row.startedAt.getTime()) : null,
      })),
      ocrAttempts: ocrRows.map((row) => ({
        id: row.id, attachmentId: row.attachmentId, providerId: row.providerId, modelId: row.modelId, status: row.status,
        cached: row.cached, errorMessage: row.errorMessage, durationMs: row.durationMs, createdAt: row.createdAt.toISOString(),
        completedAt: ['completed', 'failed'].includes(row.status) ? row.updatedAt.toISOString() : null,
      })),
      agentRun: agentRun ? {
        id: agentRun.id, status: agentRun.status, modelTurns: agentRun.modelTurns, toolCalls: agentRun.toolCalls, error: agentRun.error,
        startedAt: iso(agentRun.startedAt), completedAt: iso(agentRun.completedAt),
      } : null,
      reconciliation,
      payloads,
    }
  })

  app.post(ADMIN_USAGE_PAYLOAD_REVEAL_PATH, async (request) => {
    const admin = requireInteractiveAdmin(request)
    const { requestId } = z.object({ requestId: z.uuid() }).parse(request.params)
    const input = revealAdminUsagePayloadSchema.parse(request.body)
    adminUsagePayloadScopeSchema.parse(input.scope)
    const [log] = await db.select().from(requestLogs).where(eq(requestLogs.id, requestId)).limit(1)
    if (!log) throw notFound('Usage request')
    const expiring = ['request', 'response', 'ocr_request', 'ocr_response'].includes(input.scope)
    if (expiring && log.payloadExpiresAt && log.payloadExpiresAt.getTime() <= Date.now()) {
      throw new AppError(410, 'usage_payload_expired', 'The stored payload has expired')
    }
    let value: unknown
    if (input.scope === 'request') value = log.requestPayload
    else if (input.scope === 'response') value = log.responsePayload
    else if (input.scope === 'agent_context') {
      const [row] = await db.select({ id: agentRuns.id, context: agentRuns.context }).from(agentRuns).where(and(eq(agentRuns.responseId, log.responseId), input.resourceId ? eq(agentRuns.id, input.resourceId) : undefined)).limit(1)
      if (!row) throw notFound('Agent context')
      value = row.context
    } else if (input.scope === 'ocr_request' || input.scope === 'ocr_response') {
      if (!input.resourceId) throw new AppError(400, 'payload_resource_required', 'OCR payload resource ID is required')
      const [row] = await db.select().from(ocrAttempts).where(and(eq(ocrAttempts.id, input.resourceId), eq(ocrAttempts.requestLogId, requestId))).limit(1)
      if (!row) throw notFound('OCR attempt')
      value = input.scope === 'ocr_request' ? row.requestPayload : row.responsePayload
    } else {
      if (!input.resourceId) throw new AppError(400, 'payload_resource_required', 'Tool payload resource ID is required')
      const [row] = await db.select({ arguments: toolExecutions.arguments, output: toolExecutions.output }).from(toolExecutions)
        .innerJoin(agentRuns, eq(toolExecutions.agentRunId, agentRuns.id))
        .where(and(eq(toolExecutions.id, input.resourceId), eq(agentRuns.responseId, log.responseId))).limit(1)
      if (!row) throw notFound('Tool execution')
      value = input.scope === 'tool_arguments' ? row.arguments : row.output
    }
    if (value == null) throw new AppError(404, 'usage_payload_not_stored', 'This payload was not stored')
    await db.insert(auditEvents).values(adminUsagePayloadAudit({
      actorUserId: admin.id, requestId, responseId: log.responseId, scope: input.scope,
      resourceId: input.resourceId, payloadExpiresAt: log.payloadExpiresAt,
    }))
    return { scope: input.scope, resourceId: input.resourceId, value }
  })
}
