import { and, asc, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { creditLedger, models, usageEvents, users } from '../database/schema.js'
import { decodeUsageCursor, encodeUsageCursor, publicModel, publicParticipant } from './public.js'

function sinceFromQuery(query: unknown): Date {
  const days = Math.min(365, Math.max(1, Number((query as { days?: string }).days ?? 30)))
  return new Date(Date.now() - days * 86_400_000)
}

function leaderboardSince(query: unknown): Date | null {
  const days = (query as { days?: string }).days ?? '30'
  return days === 'all'
    ? null
    : new Date(Date.now() - Math.min(365, Math.max(1, Number(days) || 30)) * 86_400_000)
}

function eligibleUsageFilters(since: Date | null): SQL[] {
  return [eq(users.blocked, false), ...(since ? [gte(usageEvents.createdAt, since)] : [])]
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
    const since = leaderboardSince(request.query)
    const rows = await db.select({
      userId: users.id,
      name: users.name,
      nickname: users.nickname,
      visible: users.leaderboardVisible,
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
      .where(eq(users.blocked, false))
      .groupBy(users.id).orderBy(desc(sql`coalesce(sum(${usageEvents.costMicros}), 0)`)).limit(100)
    return { data: rows.map((row, index) => {
      const participant = publicParticipant(row)
      return {
        userId: row.visible ? row.userId : `anonymous-${index + 1}`,
        ...participant,
        balanceMicros: Number(row.balanceMicros),
        calls: Number(row.calls),
        tokens: Number(row.tokens),
        costMicros: Number(row.costMicros),
      }
    }) }
  })

  app.get('/api/usage/leaderboard/activity', async (request) => {
    requireUser(request)
    const since = leaderboardSince(request.query)
    const rangeWhere = and(...eligibleUsageFilters(since))
    const allWhere = and(...eligibleUsageFilters(null))
    const modelKey = sql<string>`case when ${models.visible} then ${models.id} else 'other' end`
    const [summary, daily, contribution, topModels] = await Promise.all([
      db.select({
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
        firstUsedAt: sql<string | null>`min(${usageEvents.createdAt})::text`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).where(rangeWhere),
      db.select({
        day: sql<string>`date_trunc('day', ${usageEvents.createdAt})::date`,
        modelId: modelKey,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).innerJoin(models, eq(usageEvents.modelId, models.id))
        .where(rangeWhere).groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`, modelKey).orderBy(asc(sql`date_trunc('day', ${usageEvents.createdAt})`)),
      db.select({
        day: sql<string>`date_trunc('day', ${usageEvents.createdAt})::date`,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).where(allWhere)
        .groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`).orderBy(asc(sql`date_trunc('day', ${usageEvents.createdAt})`)),
      db.select({
        modelId: modelKey,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).innerJoin(models, eq(usageEvents.modelId, models.id))
        .where(rangeWhere).groupBy(modelKey).orderBy(desc(sql`sum(${usageEvents.costMicros})`)).limit(10),
    ])
    const totals = summary[0]
    return {
      summary: {
        calls: Number(totals?.calls ?? 0), inputTokens: Number(totals?.inputTokens ?? 0),
        outputTokens: Number(totals?.outputTokens ?? 0), costMicros: Number(totals?.costMicros ?? 0),
        firstUsedAt: totals?.firstUsedAt ?? null,
      },
      daily: daily.map((row) => ({ ...row, calls: Number(row.calls), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), costMicros: Number(row.costMicros) })),
      contribution: contribution.map((row) => ({ ...row, calls: Number(row.calls), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), costMicros: Number(row.costMicros) })),
      topModels: topModels.map((row) => ({ ...row, calls: Number(row.calls), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), costMicros: Number(row.costMicros) })),
    }
  })

  app.get('/api/usage/leaderboard/records', async (request) => {
    requireUser(request)
    const query = request.query as { days?: string; cursor?: string; limit?: string }
    const since = leaderboardSince(query)
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50))
    const cursor = query.cursor ? decodeUsageCursor(query.cursor) : null
    const cursorFilter = cursor ? or(
      lt(usageEvents.createdAt, cursor.createdAt),
      and(eq(usageEvents.createdAt, cursor.createdAt), lt(usageEvents.id, cursor.id)),
    ) : undefined
    const rows = await db.select({
      usage: usageEvents,
      userName: users.name,
      userNickname: users.nickname,
      userVisible: users.leaderboardVisible,
      userColor: users.leaderboardColor,
      modelId: models.id,
      modelName: models.name,
      modelLogo: models.logo,
      modelVisible: models.visible,
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).innerJoin(models, eq(usageEvents.modelId, models.id))
      .where(and(...eligibleUsageFilters(since), cursorFilter)).orderBy(desc(usageEvents.createdAt), desc(usageEvents.id)).limit(limit + 1)
    const page = rows.slice(0, limit)
    const last = page.at(-1)?.usage
    return {
      data: page.map((row) => ({
        id: row.usage.id,
        createdAt: row.usage.createdAt.toISOString(),
        participant: publicParticipant({ visible: row.userVisible, name: row.userName, nickname: row.userNickname, color: row.userColor }),
        model: publicModel({ visible: row.modelVisible, id: row.modelId, name: row.modelName, logo: row.modelLogo }),
        inputTokens: row.usage.inputTokens,
        outputTokens: row.usage.outputTokens,
        costMicros: Number(row.usage.costMicros),
        latencyMs: row.usage.latencyMs,
      })),
      nextCursor: rows.length > limit && last ? encodeUsageCursor({ createdAt: last.createdAt, id: last.id }) : null,
    }
  })

  app.get('/api/admin/usage', async (request) => {
    requireAdmin(request)
    const since = sinceFromQuery(request.query)
    return { data: await db.select().from(usageEvents).where(gte(usageEvents.createdAt, since)).orderBy(desc(usageEvents.createdAt)).limit(1_000) }
  })
}
