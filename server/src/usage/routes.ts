import { and, asc, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { creditLedger, models, requestLogs, usageEvents, users } from '../database/schema.js'
import { canonicalUsageModels, decodeUsageCursor, encodeUsageCursor, publicModel, publicParticipant } from './public.js'

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
    const attributedModelId = sql<string>`coalesce(${requestLogs.requestedModelId}, ${usageEvents.modelId})`
    const rows = await db.select({
      usage: usageEvents,
      balanceAfterMicros: creditLedger.balanceAfterMicros,
      displayModelId: models.id,
      displayModelName: models.name,
      displayModelLogo: models.logo,
      displayModelVisible: models.visible,
    }).from(usageEvents)
      .leftJoin(creditLedger, eq(creditLedger.responseId, usageEvents.responseId))
      .leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId))
      .innerJoin(models, eq(models.id, attributedModelId))
      .where(eq(usageEvents.userId, user.id))
      .orderBy(desc(usageEvents.createdAt))
      .limit(limit)
    const canonical = canonicalUsageModels(rows.map((row) => ({
      modelId: row.displayModelId, modelName: row.displayModelName, modelLogo: row.displayModelLogo,
      modelVisible: row.displayModelVisible, calls: 1, costMicros: Number(row.usage.costMicros),
    })))
    return { data: rows.map(({ usage, balanceAfterMicros, displayModelId }) => ({
      ...usage,
      // Presentation follows the user's selected model; cost and pricing fields
      // remain those of the actual responder recorded on the usage event.
      modelId: canonical.get(displayModelId)?.modelId ?? displayModelId,
      balanceAfterMicros,
    })) }
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
    const attributedModelId = sql<string>`coalesce(${requestLogs.requestedModelId}, ${usageEvents.modelId})`
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
        modelId: models.id,
        modelName: models.name,
        modelLogo: models.logo,
        modelVisible: models.visible,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId)).innerJoin(models, eq(models.id, attributedModelId))
        .where(rangeWhere).groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`, models.id).orderBy(asc(sql`date_trunc('day', ${usageEvents.createdAt})`)),
      db.select({
        day: sql<string>`date_trunc('day', ${usageEvents.createdAt})::date`,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).where(allWhere)
        .groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`).orderBy(asc(sql`date_trunc('day', ${usageEvents.createdAt})`)),
      db.select({
        modelId: models.id,
        modelName: models.name,
        modelLogo: models.logo,
        modelVisible: models.visible,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId)).innerJoin(models, eq(models.id, attributedModelId))
        .where(rangeWhere).groupBy(models.id).orderBy(desc(sql`sum(${usageEvents.costMicros})`)),
    ])
    const totals = summary[0]
    const canonical = canonicalUsageModels(topModels.map((row) => ({
      ...row, calls: Number(row.calls), costMicros: Number(row.costMicros),
    })))
    const publicCanonical = new Map([...canonical.entries()].map(([id, model]) => [id, publicModel({
      visible: model.modelVisible, id: model.modelId, name: model.modelName, logo: model.modelLogo,
    })]))
    const dailyByModel = new Map<string, { day: string; modelId: string; calls: number; inputTokens: number; outputTokens: number; costMicros: number }>()
    for (const row of daily) {
      const modelId = publicCanonical.get(row.modelId)?.id ?? 'other'
      const key = `${row.day}:${modelId}`
      const current = dailyByModel.get(key) ?? { day: row.day, modelId, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 }
      current.calls += Number(row.calls)
      current.inputTokens += Number(row.inputTokens)
      current.outputTokens += Number(row.outputTokens)
      current.costMicros += Number(row.costMicros)
      dailyByModel.set(key, current)
    }
    const topByModel = new Map<string, { modelId: string; calls: number; inputTokens: number; outputTokens: number; costMicros: number }>()
    for (const row of topModels) {
      const modelId = publicCanonical.get(row.modelId)?.id ?? 'other'
      const current = topByModel.get(modelId) ?? { modelId, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 }
      current.calls += Number(row.calls)
      current.inputTokens += Number(row.inputTokens)
      current.outputTokens += Number(row.outputTokens)
      current.costMicros += Number(row.costMicros)
      topByModel.set(modelId, current)
    }
    return {
      summary: {
        calls: Number(totals?.calls ?? 0), inputTokens: Number(totals?.inputTokens ?? 0),
        outputTokens: Number(totals?.outputTokens ?? 0), costMicros: Number(totals?.costMicros ?? 0),
        firstUsedAt: totals?.firstUsedAt ?? null,
      },
      daily: [...dailyByModel.values()],
      contribution: contribution.map((row) => ({ ...row, calls: Number(row.calls), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), costMicros: Number(row.costMicros) })),
      topModels: [...topByModel.values()].sort((a, b) => b.costMicros - a.costMicros).slice(0, 10),
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
    const attributedModelId = sql<string>`coalesce(${requestLogs.requestedModelId}, ${usageEvents.modelId})`
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
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId)).innerJoin(models, eq(models.id, attributedModelId))
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
