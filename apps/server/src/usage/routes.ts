import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { creditLedger, modelPresetChoices, modelPresets, models, requestLogs, usageEvents, users } from '../database/schema.js'
import { canonicalUsageModels, decodeUsageCursor, encodeUsageCursor, publicModel, resolveUsageModelAlias, type UsageModelIdentity } from './public.js'
import { friendUserIds } from '../friends/routes.js'
import { profileAvatarUrl } from '../profile/service.js'
import { activePoolMembers, activePoolMembership, poolBalanceMicros } from '../pools/service.js'

async function displayedBalance(userId: string, accountBalanceMicros: number) {
  return db.transaction(async (tx) => {
    const membership = await activePoolMembership(tx, userId)
    return membership ? { balanceMicros: await poolBalanceMicros(tx, membership.pool.id), balanceKind: 'pool' as const } : { balanceMicros: accountBalanceMicros, balanceKind: 'account' as const }
  })
}

const usageRangeSchema = z.enum(['24h', '7d', '30d', '90d', 'all'])
type UsageRange = z.infer<typeof usageRangeSchema>

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const usageQuerySchema = z.object({
  range: usageRangeSchema.default('30d'),
  timeZone: z.string().trim().min(1).max(100).refine(validTimeZone, 'Invalid time zone').default('UTC'),
})

export const usageRecordsQuerySchema = usageQuerySchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const usageCircleSchema = z.enum(['friends', 'pool'])
const usageCircleQuerySchema = usageQuerySchema.extend({ scope: usageCircleSchema.default('friends') })
const usageCircleRecordsQuerySchema = usageRecordsQuerySchema.extend({ scope: usageCircleSchema.default('friends') })

async function usageCircleUserIds(userId: string, scope: z.infer<typeof usageCircleSchema>): Promise<string[]> {
  if (scope === 'friends') return friendUserIds(userId)
  return db.transaction(async (tx) => {
    const membership = await activePoolMembership(tx, userId)
    return membership ? (await activePoolMembers(tx, membership.pool.id)).map((row) => row.user.id) : []
  })
}

export function usageSince(range: UsageRange): Date | null {
  const durations: Record<Exclude<UsageRange, 'all'>, number> = {
    '24h': 86_400_000,
    '7d': 7 * 86_400_000,
    '30d': 30 * 86_400_000,
    '90d': 90 * 86_400_000,
  }
  return range === 'all' ? null : new Date(Date.now() - durations[range])
}

function sinceFromQuery(query: unknown): Date {
  const days = Math.min(365, Math.max(1, Number((query as { days?: string }).days ?? 30)))
  return new Date(Date.now() - days * 86_400_000)
}

export function eligibleUsageFilters(since: Date | null, userIds: string[] | null): SQL[] {
  return [
    eq(users.blocked, false),
    ...(userIds ? [inArray(users.id, userIds)] : []),
    ...(since ? [gte(usageEvents.createdAt, since)] : []),
  ]
}

export async function loadUsageModelAliases(): Promise<Map<string, UsageModelIdentity>> {
  const [catalog, redirects] = await Promise.all([
    db.select({
      modelId: models.id,
      modelName: models.name,
      modelLogo: models.logo,
      modelVisible: models.visible,
    }).from(models),
    db.select({
      ownerModelId: modelPresets.modelId,
      action: modelPresetChoices.action,
    }).from(modelPresetChoices)
      .innerJoin(modelPresets, eq(modelPresets.id, modelPresetChoices.presetId))
      .where(eq(modelPresetChoices.actionType, 'redirect')),
  ])
  const catalogById = new Map(catalog.map((model) => [model.modelId, { ...model, calls: 0, costMicros: 0 }]))
  const aliases = new Map<string, UsageModelIdentity>()
  for (const redirect of redirects) {
    const targetModelId = (redirect.action as { modelId?: unknown }).modelId
    const owner = catalogById.get(redirect.ownerModelId)
    if (typeof targetModelId !== 'string' || !owner) continue
    const existing = aliases.get(targetModelId)
    if (!existing || (owner.modelVisible && !existing.modelVisible) ||
      (owner.modelVisible === existing.modelVisible && owner.modelId < existing.modelId)) {
      aliases.set(targetModelId, owner)
    }
  }
  return aliases
}

export async function loadUsageActivity(input: {
  userIds: string[] | null
  since: Date | null
  timeZone: string
  hidePrivateModels: boolean
}) {
  const rangeWhere = and(...eligibleUsageFilters(input.since, input.userIds))
  const allWhere = and(...eligibleUsageFilters(null, input.userIds))
  const attributedModelId = sql<string>`coalesce(${requestLogs.requestedModelId}, ${usageEvents.modelId})`
  const dayBucket = sql<string>`(${usageEvents.createdAt} at time zone ${input.timeZone})::date`
  const [summary, daily, contribution, topModels, aliases] = await Promise.all([
    db.select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      inferenceReferenceCostMicros: sql<number>`coalesce(sum(${usageEvents.inferenceReferenceCostMicros}), 0)::bigint`,
      firstUsedAt: sql<string | null>`min(${usageEvents.createdAt})::text`,
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).where(rangeWhere),
    db.select({
      day: dayBucket,
      modelId: models.id,
      modelName: models.name,
      modelLogo: models.logo,
      modelVisible: models.visible,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId)).innerJoin(models, eq(models.id, attributedModelId))
      .where(rangeWhere).groupBy(sql`1`, models.id).orderBy(sql`1 asc`),
    db.select({
      day: dayBucket,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).where(allWhere)
      .groupBy(sql`1`).orderBy(sql`1 asc`),
    db.select({
      modelId: models.id,
      modelName: models.name,
      modelLogo: models.logo,
      modelVisible: models.visible,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId)).innerJoin(models, eq(models.id, attributedModelId))
      .where(rangeWhere).groupBy(models.id).orderBy(desc(sql`sum(${usageEvents.costMicros})`)),
    loadUsageModelAliases(),
  ])
  const totals = summary[0]
  const resolvedTopModels = topModels.map((row) => resolveUsageModelAlias({
    ...row, calls: Number(row.calls), costMicros: Number(row.costMicros),
  }, aliases))
  const canonical = canonicalUsageModels(resolvedTopModels)
  const displayedModels = new Map([...canonical.entries()].map(([id, model]) => [
    id,
    input.hidePrivateModels
      ? publicModel({ visible: model.modelVisible, id: model.modelId, name: model.modelName, logo: model.modelLogo })
      : { id: model.modelId, name: model.modelName, logo: model.modelLogo },
  ]))
  const dailyByModel = new Map<string, { day: string; modelId: string; calls: number; inputTokens: number; cacheWriteTokens: number; outputTokens: number; costMicros: number }>()
  for (const row of daily) {
    const resolved = resolveUsageModelAlias({ ...row, calls: Number(row.calls), costMicros: Number(row.costMicros) }, aliases)
    const modelId = displayedModels.get(resolved.modelId)?.id ?? (input.hidePrivateModels ? 'other' : resolved.modelId)
    const key = `${row.day}:${modelId}`
    const current = dailyByModel.get(key) ?? { day: row.day, modelId, calls: 0, inputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costMicros: 0 }
    current.calls += Number(row.calls)
    current.inputTokens += Number(row.inputTokens)
    current.cacheWriteTokens += Number(row.cacheWriteTokens)
    current.outputTokens += Number(row.outputTokens)
    current.costMicros += Number(row.costMicros)
    dailyByModel.set(key, current)
  }
  const topByModel = new Map<string, { modelId: string; name: string; logo: string | null; calls: number; inputTokens: number; cacheWriteTokens: number; outputTokens: number; costMicros: number }>()
  for (let index = 0; index < topModels.length; index += 1) {
    const row = topModels[index]!
    const resolved = resolvedTopModels[index]!
    const displayedModel = displayedModels.get(resolved.modelId)
    const modelId = displayedModel?.id ?? (input.hidePrivateModels ? 'other' : resolved.modelId)
    const current = topByModel.get(modelId) ?? {
      modelId,
      name: displayedModel?.name ?? resolved.modelName,
      logo: displayedModel?.logo ?? resolved.modelLogo,
      calls: 0,
      inputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    }
    current.calls += Number(row.calls)
    current.inputTokens += Number(row.inputTokens)
    current.cacheWriteTokens += Number(row.cacheWriteTokens)
    current.outputTokens += Number(row.outputTokens)
    current.costMicros += Number(row.costMicros)
    topByModel.set(modelId, current)
  }
  return {
    summary: {
      calls: Number(totals?.calls ?? 0), inputTokens: Number(totals?.inputTokens ?? 0),
      cacheWriteTokens: Number(totals?.cacheWriteTokens ?? 0),
      outputTokens: Number(totals?.outputTokens ?? 0), costMicros: Number(totals?.costMicros ?? 0),
      inferenceReferenceCostMicros: Number(totals?.inferenceReferenceCostMicros ?? 0),
      firstUsedAt: totals?.firstUsedAt ?? null,
    },
    daily: [...dailyByModel.values()],
    contribution: contribution.map((row) => ({ ...row, calls: Number(row.calls), inputTokens: Number(row.inputTokens), cacheWriteTokens: Number(row.cacheWriteTokens), outputTokens: Number(row.outputTokens), costMicros: Number(row.costMicros) })),
    topModels: [...topByModel.values()].sort((a, b) => b.costMicros - a.costMicros).slice(0, 10),
  }
}

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/usage/summary', async (request) => {
    const user = requireUser(request)
    const since = sinceFromQuery(request.query)
    const [summary] = await db.select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      averageLatencyMs: sql<number>`coalesce(avg(${usageEvents.latencyMs}), 0)::int`,
    }).from(usageEvents).where(and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, since)))
    return {
      calls: Number(summary?.calls ?? 0),
      inputTokens: Number(summary?.inputTokens ?? 0),
      cachedInputTokens: Number(summary?.cachedInputTokens ?? 0),
      cacheWriteTokens: Number(summary?.cacheWriteTokens ?? 0),
      outputTokens: Number(summary?.outputTokens ?? 0),
      costMicros: Number(summary?.costMicros ?? 0),
      averageLatencyMs: Number(summary?.averageLatencyMs ?? 0),
      ...await displayedBalance(user.id, user.balanceMicros),
      since: since.toISOString(),
    }
  })

  app.get('/api/usage/activity', async (request) => {
    const user = requireUser(request)
    const query = usageQuerySchema.parse(request.query)
    return {
      ...await loadUsageActivity({
        userIds: [user.id],
        since: usageSince(query.range),
        timeZone: query.timeZone,
        hidePrivateModels: false,
      }),
      ...await displayedBalance(user.id, user.balanceMicros),
    }
  })

  app.get('/api/usage/records', async (request) => {
    const user = requireUser(request)
    const query = usageRecordsQuerySchema.parse(request.query)
    const since = usageSince(query.range)
    const cursor = query.cursor ? decodeUsageCursor(query.cursor) : null
    const cursorFilter = cursor ? or(
      lt(usageEvents.createdAt, cursor.createdAt),
      and(eq(usageEvents.createdAt, cursor.createdAt), lt(usageEvents.id, cursor.id)),
    ) : undefined
    const attributedModelId = sql<string>`coalesce(${requestLogs.requestedModelId}, ${usageEvents.modelId})`
    const [rows, aliases] = await Promise.all([db.select({
      usage: usageEvents,
      balanceAfterMicros: sql<number | null>`coalesce(${usageEvents.poolBalanceAfterMicros}, ${creditLedger.balanceAfterMicros})`,
      displayModelId: models.id,
      displayModelName: models.name,
      displayModelLogo: models.logo,
      displayModelVisible: models.visible,
    }).from(usageEvents)
      .leftJoin(creditLedger, and(eq(creditLedger.responseId, usageEvents.responseId), eq(creditLedger.userId, user.id)))
      .leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId))
      .innerJoin(models, eq(models.id, attributedModelId))
      .where(and(eq(usageEvents.userId, user.id), since ? gte(usageEvents.createdAt, since) : undefined, cursorFilter))
      .orderBy(desc(usageEvents.createdAt), desc(usageEvents.id))
      .limit(query.limit + 1), loadUsageModelAliases()])
    const page = rows.slice(0, query.limit)
    const displayModels = page.map((row) => resolveUsageModelAlias({
      modelId: row.displayModelId, modelName: row.displayModelName, modelLogo: row.displayModelLogo,
      modelVisible: row.displayModelVisible, calls: 1, costMicros: Number(row.usage.costMicros),
    }, aliases))
    const canonical = canonicalUsageModels(displayModels)
    const last = page.at(-1)?.usage
    return {
      data: page.map(({ usage, balanceAfterMicros }, index) => ({
        ...usage,
        // Presentation follows the user's selected model; cost and pricing fields
        // remain those of the actual responder recorded on the usage event.
        modelId: canonical.get(displayModels[index]!.modelId)?.modelId ?? displayModels[index]!.modelId,
        inferenceReferenceCostMicros: Number(usage.inferenceReferenceCostMicros),
        subscriptionCoveredMicros: Number(usage.weeklyCostMicros),
        balanceAfterMicros,
      })),
      nextCursor: rows.length > query.limit && last ? encodeUsageCursor({ createdAt: last.createdAt, id: last.id }) : null,
    }
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
    const user = requireUser(request)
    const query = usageCircleQuerySchema.parse(request.query)
    const circle = await usageCircleUserIds(user.id, query.scope)
    const since = usageSince(query.range)
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
    }).from(users).leftJoin(
      usageEvents,
      since
        ? and(eq(usageEvents.userId, users.id), gte(usageEvents.createdAt, since))
        : eq(usageEvents.userId, users.id),
    )
      .where(and(eq(users.blocked, false), inArray(users.id, circle)))
      .groupBy(users.id).orderBy(desc(sql`coalesce(sum(${usageEvents.costMicros}), 0)`))
    return { data: rows.map((row) => ({
        userId: row.userId,
        displayName: row.name,
        username: row.username,
        avatarUrl: profileAvatarUrl({ id: row.userId, avatarObjectKey: row.avatarObjectKey, avatarVersion: row.avatarVersion }),
        profileColor: row.profileColor,
        balanceMicros: Number(row.balanceMicros),
        calls: Number(row.calls),
        tokens: Number(row.tokens),
        costMicros: Number(row.costMicros),
      })) }
  })

  app.get('/api/usage/leaderboard/activity', async (request) => {
    const user = requireUser(request)
    const query = usageCircleQuerySchema.parse(request.query)
    const circle = await usageCircleUserIds(user.id, query.scope)
    return loadUsageActivity({
      userIds: circle,
      since: usageSince(query.range),
      timeZone: query.timeZone,
      hidePrivateModels: true,
    })
  })

  app.get('/api/usage/leaderboard/records', async (request) => {
    const user = requireUser(request)
    const query = usageCircleRecordsQuerySchema.parse(request.query)
    const circle = await usageCircleUserIds(user.id, query.scope)
    const since = usageSince(query.range)
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
    }).from(usageEvents).innerJoin(users, eq(usageEvents.userId, users.id)).leftJoin(requestLogs, eq(requestLogs.responseId, usageEvents.responseId)).innerJoin(models, eq(models.id, attributedModelId))
      .where(and(...eligibleUsageFilters(since, circle), cursorFilter)).orderBy(desc(usageEvents.createdAt), desc(usageEvents.id)).limit(query.limit + 1), loadUsageModelAliases()])
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)?.usage
    return {
      data: page.map((row) => {
        const model = resolveUsageModelAlias({
          modelId: row.modelId, modelName: row.modelName, modelLogo: row.modelLogo,
          modelVisible: row.modelVisible, calls: 1, costMicros: Number(row.usage.costMicros),
        }, aliases)
        return {
        id: row.usage.id,
        createdAt: row.usage.createdAt.toISOString(),
        participant: {
          id: row.userId,
          displayName: row.userName,
          username: row.userUsername,
          avatarUrl: profileAvatarUrl({ id: row.userId, avatarObjectKey: row.userAvatarObjectKey, avatarVersion: row.userAvatarVersion }),
          profileColor: row.userProfileColor,
        },
        model: publicModel({ visible: model.modelVisible, id: model.modelId, name: model.modelName, logo: model.modelLogo }),
        inputTokens: row.usage.inputTokens,
        cacheWriteTokens: row.usage.cacheWriteTokens,
        outputTokens: row.usage.outputTokens,
        costMicros: Number(row.usage.costMicros),
        inferenceReferenceCostMicros: Number(row.usage.inferenceReferenceCostMicros),
        subscriptionCoveredMicros: Number(row.usage.weeklyCostMicros),
      }}),
      nextCursor: rows.length > query.limit && last ? encodeUsageCursor({ createdAt: last.createdAt, id: last.id }) : null,
    }
  })

  app.get('/api/admin/usage', async (request) => {
    requireAdmin(request)
    const since = sinceFromQuery(request.query)
    return { data: await db.select().from(usageEvents).where(gte(usageEvents.createdAt, since)).orderBy(desc(usageEvents.createdAt)).limit(1_000) }
  })
}
