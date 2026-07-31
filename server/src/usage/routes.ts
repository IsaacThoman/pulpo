import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { creditLedger, usageEvents, users } from '../database/schema.js'

function sinceFromQuery(query: unknown): Date {
  const days = Math.min(365, Math.max(1, Number((query as { days?: string }).days ?? 30)))
  return new Date(Date.now() - days * 86_400_000)
}

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/usage/summary', async (request) => {
    const user = requireUser(request)
    const since = sinceFromQuery(request.query)
    const [summary] = await db.select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      averageLatencyMs: sql<number>`coalesce(avg(${usageEvents.latencyMs}), 0)::int`,
    }).from(usageEvents).where(and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, since)))
    return {
      calls: Number(summary?.calls ?? 0),
      inputTokens: Number(summary?.inputTokens ?? 0),
      outputTokens: Number(summary?.outputTokens ?? 0),
      costMicros: Number(summary?.costMicros ?? 0),
      averageLatencyMs: Number(summary?.averageLatencyMs ?? 0),
      balanceMicros: user.balanceMicros,
      since: since.toISOString(),
    }
  })

  app.get('/api/usage/records', async (request) => {
    const user = requireUser(request)
    const limit = Math.min(200, Math.max(1, Number((request.query as { limit?: string }).limit ?? 50)))
    const rows = await db.select({
      usage: usageEvents,
      balanceAfterMicros: creditLedger.balanceAfterMicros,
    }).from(usageEvents)
      .leftJoin(creditLedger, eq(creditLedger.responseId, usageEvents.responseId))
      .where(eq(usageEvents.userId, user.id))
      .orderBy(desc(usageEvents.createdAt))
      .limit(limit)
    return { data: rows.map(({ usage, balanceAfterMicros }) => ({ ...usage, balanceAfterMicros })) }
  })

  app.get('/api/usage/daily', async (request) => {
    const user = requireUser(request)
    const since = sinceFromQuery(request.query)
    const rows = await db.select({
      day: sql<string>`date_trunc('day', ${usageEvents.createdAt})::date`,
      calls: sql<number>`count(*)::int`,
      tokens: sql<number>`sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens})::bigint`,
      costMicros: sql<number>`sum(${usageEvents.costMicros})::bigint`,
    }).from(usageEvents).where(and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, since)))
      .groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`).orderBy(sql`date_trunc('day', ${usageEvents.createdAt})`)
    return { data: rows.map((row) => ({ ...row, calls: Number(row.calls), tokens: Number(row.tokens), costMicros: Number(row.costMicros) })) }
  })

  app.get('/api/usage/leaderboard', async (request) => {
    requireUser(request)
    const days = (request.query as { days?: string }).days ?? '30'
    const since = days === 'all'
      ? null
      : new Date(Date.now() - Math.min(365, Math.max(1, Number(days) || 30)) * 86_400_000)
    const rows = await db.select({
      userId: users.id,
      name: sql<string>`coalesce(nullif(trim(${users.nickname}), ''), ${users.name})`,
      color: users.leaderboardColor,
      balanceMicros: users.balanceMicros,
      calls: sql<number>`count(${usageEvents.id})::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
    }).from(users).leftJoin(
      usageEvents,
      since
        ? and(eq(usageEvents.userId, users.id), gte(usageEvents.createdAt, since))
        : eq(usageEvents.userId, users.id),
    )
      .where(and(eq(users.leaderboardVisible, true), eq(users.blocked, false)))
      .groupBy(users.id).orderBy(desc(sql`coalesce(sum(${usageEvents.costMicros}), 0)`)).limit(100)
    return { data: rows.map((row) => ({ ...row, calls: Number(row.calls), tokens: Number(row.tokens), costMicros: Number(row.costMicros) })) }
  })

  app.get('/api/admin/usage', async (request) => {
    requireAdmin(request)
    const since = sinceFromQuery(request.query)
    return { data: await db.select().from(usageEvents).where(gte(usageEvents.createdAt, since)).orderBy(desc(usageEvents.createdAt)).limit(1_000) }
  })
}
