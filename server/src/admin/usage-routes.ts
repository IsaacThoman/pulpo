import { and, asc, desc, eq, gt, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { apiKeys, generationAttempts, models, ocrAttempts, requestLogs, users } from '../database/schema.js'
import { notFound } from '../lib/errors.js'

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
  if (start) values.push(gte(requestLogs.createdAt, start))
  if (input.status) values.push(inArray(requestLogs.status, input.status.split(',') as Array<typeof requestLogs.$inferSelect.status>))
  if (input.origin) values.push(eq(requestLogs.origin, input.origin))
  if (input.model) values.push(sql`(${requestLogs.requestedModelId} = ${input.model} or ${requestLogs.actualModelId} = ${input.model})`)
  if (input.identity) values.push(sql`(${requestLogs.userId}::text = ${input.identity} or ${requestLogs.apiKeyId}::text = ${input.identity})`)
  if (input.retry) values.push(input.retry === 'true' ? gt(requestLogs.retryCount, 0) : eq(requestLogs.retryCount, 0))
  if (input.fallback) values.push(eq(requestLogs.fallbackUsed, input.fallback === 'true'))
  if (input.ocr) values.push(eq(requestLogs.ocrStatus, input.ocr))
  if (input.errorCategory) values.push(eq(requestLogs.errorCategory, input.errorCategory))
  if (includeCursor && input.cursor) values.push(lt(requestLogs.createdAt, new Date(input.cursor)))
  return values
}

export async function registerAdminUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/usage/summary', async (request) => {
    requireAdmin(request)
    const input = querySchema.parse(request.query)
    const where = and(...filters(input))
    const [summary] = await db.select({
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where ${requestLogs.status} = 'queued')::int`,
      inProgress: sql<number>`count(*) filter (where ${requestLogs.status} = 'in_progress')::int`,
      completed: sql<number>`count(*) filter (where ${requestLogs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${requestLogs.status} = 'failed')::int`,
      cancelled: sql<number>`count(*) filter (where ${requestLogs.status} = 'cancelled')::int`,
      incomplete: sql<number>`count(*) filter (where ${requestLogs.status} = 'incomplete')::int`,
      inputTokens: sql<number>`coalesce(sum(${requestLogs.inputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${requestLogs.cachedInputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${requestLogs.outputTokens}), 0)::bigint`,
      reasoningTokens: sql<number>`coalesce(sum(${requestLogs.reasoningTokens}), 0)::bigint`,
      spendMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint`,
      averageLatencyMs: sql<number>`coalesce(avg(${requestLogs.durationMs}) filter (where ${requestLogs.durationMs} is not null), 0)::float8`,
      averageTokensPerSecond: sql<number>`coalesce(avg(${requestLogs.tokensPerSecond}) filter (where ${requestLogs.tokensPerSecond} is not null), 0)::float8`,
      successRate: sql<number>`coalesce(count(*) filter (where ${requestLogs.status} = 'completed')::float / nullif(count(*) filter (where ${requestLogs.status} not in ('queued','in_progress')), 0), 0)::float8`,
    }).from(requestLogs).where(where)
    const daily = await db.select({
      day: sql<string>`date_trunc('day', ${requestLogs.createdAt})::text`,
      modelId: sql<string>`coalesce(${requestLogs.actualModelId}, ${requestLogs.requestedModelId})`,
      calls: sql<number>`count(*)::int`, costMicros: sql<number>`coalesce(sum(${requestLogs.costMicros}), 0)::bigint`,
      tokens: sql<number>`coalesce(sum(${requestLogs.inputTokens} + ${requestLogs.outputTokens}), 0)::bigint`,
    }).from(requestLogs).where(where).groupBy(sql`date_trunc('day', ${requestLogs.createdAt})`, sql`coalesce(${requestLogs.actualModelId}, ${requestLogs.requestedModelId})`).orderBy(asc(sql`date_trunc('day', ${requestLogs.createdAt})`))
    const topModels = await db.select({ id: sql<string>`coalesce(${requestLogs.actualModelId}, ${requestLogs.requestedModelId})`, calls: sql<number>`count(*)::int`, costMicros: sql<number>`sum(${requestLogs.costMicros})::bigint` }).from(requestLogs).where(where).groupBy(sql`coalesce(${requestLogs.actualModelId}, ${requestLogs.requestedModelId})`).orderBy(desc(sql`count(*)`)).limit(10)
    const topUsers = await db.select({ id: users.id, name: users.name, email: users.email, calls: sql<number>`count(*)::int`, costMicros: sql<number>`sum(${requestLogs.costMicros})::bigint` }).from(requestLogs).innerJoin(users, eq(requestLogs.userId, users.id)).where(where).groupBy(users.id).orderBy(desc(sql`count(*)`)).limit(10)
    const topApiKeys = await db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, calls: sql<number>`count(*)::int`, costMicros: sql<number>`sum(${requestLogs.costMicros})::bigint` }).from(requestLogs).innerJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id)).where(where).groupBy(apiKeys.id).orderBy(desc(sql`count(*)`)).limit(10)
    return { summary, daily, topModels, topUsers, topApiKeys }
  })

  app.get('/api/admin/usage/requests', async (request) => {
    requireAdmin(request)
    const input = querySchema.parse(request.query)
    const rows = await db.select({ log: requestLogs, user: { id: users.id, name: users.name, email: users.email }, apiKey: { id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix }, requestedModelName: models.name })
      .from(requestLogs).innerJoin(users, eq(requestLogs.userId, users.id)).leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id)).leftJoin(models, eq(requestLogs.requestedModelId, models.id))
      .where(and(...filters(input, true))).orderBy(desc(requestLogs.createdAt)).limit(input.limit + 1)
    const page = rows.slice(0, input.limit).map(({ log, ...relations }) => ({ ...log, requestPayload: undefined, responsePayload: undefined, ...relations }))
    return { data: page, nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.log.createdAt.toISOString() : null }
  })

  app.get('/api/admin/usage/requests/:id', async (request) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const [log] = await db.select().from(requestLogs).where(eq(requestLogs.id, id)).limit(1)
    if (!log) throw notFound('Request log')
    const [attempts, ocr] = await Promise.all([
      db.select().from(generationAttempts).where(eq(generationAttempts.requestLogId, id)).orderBy(asc(generationAttempts.startedAt)),
      db.select().from(ocrAttempts).where(eq(ocrAttempts.requestLogId, id)).orderBy(asc(ocrAttempts.createdAt)),
    ])
    return { ...log, attempts, ocrAttempts: ocr }
  })
}
