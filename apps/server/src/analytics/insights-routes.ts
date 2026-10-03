import { eq, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  analyticsRangeQuerySchema,
  clientPlatformSchema,
  insightsFiltersSchema,
  type ClientPlatform,
  type InsightsEngagement,
  type InsightsFeatures,
  type InsightsFilters,
  type InsightsModels,
  type InsightsPools,
  type InsightsSettings,
  type InsightsTools,
  type NamedCount,
} from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { parsePersonalizationSettings } from '../settings/application-settings.js'
import { bucketLabel, csvValues, inWindow, numberOrNull, resolveWindow, windowPayload, type ResolvedWindow } from './window.js'
import { loadBuckets } from './request-routes.js'
import { loadModelNames } from './model-names.js'

/** Series beyond this many models fold the rest into "other". */
const SERIES_MODEL_LIMIT = 8
/** Day-bucketed ranges longer than this read hourly rollups instead of raw rows. */
const ROLLUP_MIN_RANGE_MS = 7 * 86_400_000

function textList(values: string[]): SQL {
  return sql.join(values.map((value) => sql`${value}`), sql`, `)
}

/** Filters over a table aliased with these column names (raw analytics or rollups). */
function insightConditions(filters: InsightsFilters, columns: { platform: SQL; plan: SQL; origin: SQL; model: SQL }): SQL[] {
  const conditions: SQL[] = []
  const platforms = csvValues(filters.platform)
  if (platforms.length) conditions.push(sql`${columns.platform} in (${textList(platforms)})`)
  const plans = csvValues(filters.plan)
  if (plans.length) conditions.push(sql`coalesce(nullif(${columns.plan}, ''), 'unknown') in (${textList(plans)})`)
  const origins = csvValues(filters.origin)
  if (origins.length) conditions.push(sql`${columns.origin} in (${textList(origins)})`)
  const modelIds = csvValues(filters.model)
  if (modelIds.length) conditions.push(sql`${columns.model} in (${textList(modelIds)})`)
  return conditions
}

const RAW_COLUMNS = { platform: sql`a.client_platform`, plan: sql`a.plan`, origin: sql`a.origin`, model: sql`a.requested_model_id` }
const ROLLUP_COLUMNS = { platform: sql`h.client_platform`, plan: sql`h.plan`, origin: sql`h.origin`, model: sql`h.model_id` }

function where(conditions: SQL[]): SQL {
  return conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``
}

interface InsightContext {
  window: ResolvedWindow
  filters: InsightsFilters
  /** Conditions for `request_analytics a` within the window. */
  current: SQL[]
  useRollups: boolean
}

function parseContext(request: FastifyRequest): InsightContext {
  requireAdmin(request)
  const window = resolveWindow(analyticsRangeQuerySchema.parse(request.query))
  const filters = insightsFiltersSchema.parse(request.query)
  const span = window.from ? window.to.getTime() - window.from.getTime() : Number.POSITIVE_INFINITY
  return {
    window,
    filters,
    current: [inWindow(sql`a.created_at`, window.from, window.to), ...insightConditions(filters, RAW_COLUMNS)],
    useRollups: window.bucket === 'day' && span > ROLLUP_MIN_RANGE_MS,
  }
}

async function earliestAnalytics(context: InsightContext): Promise<Date | null> {
  const [row] = await db.execute<{ earliest: string | null }>(sql`select min(a.created_at)::text as earliest
    from request_analytics a ${where(insightConditions(context.filters, RAW_COLUMNS))}`)
  return row?.earliest ? new Date(row.earliest) : null
}

/**
 * Counts per bucket and dimension. Long ranges read the hourly rollups, which
 * trail live data by up to ten minutes; short ranges read raw rows.
 */
async function dimensionSeries(context: InsightContext, dimension: 'model' | 'platform'): Promise<Array<{ bucket: string; key: string; requests: number }>> {
  const { window } = context
  if (context.useRollups) {
    const column = dimension === 'model' ? sql`h.model_id` : sql`h.client_platform`
    // Rollup hours are UTC instants; bucketing them in the viewer's zone is exact for whole-hour offsets.
    return [...await db.execute<{ bucket: string; key: string; requests: number }>(sql`select ${bucketLabel(sql`h.hour`, window.bucket, window.timeZone)} as bucket, ${column} as key, sum(h.requests)::int as requests
      from analytics_hourly_rollups h
      ${where([inWindow(sql`h.hour`, window.from ? new Date(Math.floor(window.from.getTime() / 3_600_000) * 3_600_000) : null, window.to), ...insightConditions(context.filters, ROLLUP_COLUMNS)])}
      group by 1, 2 order by 1`)]
  }
  const column = dimension === 'model' ? sql`a.requested_model_id` : sql`a.client_platform`
  return [...await db.execute<{ bucket: string; key: string; requests: number }>(sql`select ${bucketLabel(sql`a.created_at`, window.bucket, window.timeZone)} as bucket, ${column} as key, count(*)::int as requests
    from request_analytics a ${where(context.current)} group by 1, 2 order by 1`)]
}

async function totalRequests(context: InsightContext): Promise<number> {
  const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from request_analytics a ${where(context.current)}`)
  return Number(row?.count ?? 0)
}

function namedCounts(rows: Iterable<{ id: string | null; count: number }>, label: (id: string) => string = (id) => id): NamedCount[] {
  return [...rows].map((row) => {
    const id = row.id ?? 'unknown'
    return { id, label: label(id), count: Number(row.count) }
  })
}

function asPlatform(value: string): ClientPlatform {
  const parsed = clientPlatformSchema.safeParse(value)
  return parsed.success ? parsed.data : 'unknown'
}

export async function registerAdminInsightsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/analytics/insights/models', async (request): Promise<InsightsModels> => {
    const context = parseContext(request)
    const { window } = context
    const previous = window.previousFrom && window.from
      ? [inWindow(sql`a.created_at`, window.previousFrom, window.from), ...insightConditions(context.filters, RAW_COLUMNS)]
      : null
    const [total, rows, previousRows, redirects, seriesRows, buckets, modelNames] = await Promise.all([
      totalRequests(context),
      db.execute<{ model_id: string; requests: number; users: number; cost_micros: unknown; completed: number; finished: number; ttft_p50: unknown; duration_p50: unknown }>(sql`select a.requested_model_id as model_id,
          count(*)::int as requests, count(distinct a.user_id)::int as users, coalesce(sum(a.cost_micros), 0)::bigint as cost_micros,
          (count(*) filter (where a.status = 'completed'))::int as completed,
          (count(*) filter (where a.status in ('completed', 'failed', 'incomplete', 'cancelled')))::int as finished,
          percentile_cont(0.5) within group (order by a.first_token_ms) as ttft_p50,
          percentile_cont(0.5) within group (order by a.duration_ms) as duration_p50
        from request_analytics a ${where(context.current)} group by 1 order by 2 desc limit 50`),
      previous
        ? db.execute<{ model_id: string; requests: number }>(sql`select a.requested_model_id as model_id, count(*)::int as requests
            from request_analytics a ${where(previous)} group by 1`)
        : Promise.resolve(null),
      db.execute<{ requested: string; answered: string; count: number }>(sql`select a.requested_model_id as requested, a.answered_model_id as answered, count(*)::int as count
        from request_analytics a ${where([...context.current, sql`a.answered_model_id is not null and a.answered_model_id <> a.requested_model_id`])}
        group by 1, 2 order by 3 desc limit 20`),
      dimensionSeries(context, 'model'),
      loadBuckets(window, () => earliestAnalytics(context)),
      loadModelNames(),
    ])
    const previousByModel = previousRows ? new Map([...previousRows].map((row) => [row.model_id, Number(row.requests)])) : null
    const models = [...rows].map((row) => {
      const requests = Number(row.requests)
      const costMicros = Number(row.cost_micros)
      const finished = Number(row.finished)
      return {
        modelId: row.model_id,
        modelName: modelNames[row.model_id] ?? row.model_id,
        requests,
        previousRequests: previousByModel ? previousByModel.get(row.model_id) ?? 0 : null,
        users: Number(row.users),
        costMicros,
        avgCostMicros: requests ? Math.round(costMicros / requests) : 0,
        successRate: finished ? Number(row.completed) / finished : 0,
        ttftP50Ms: numberOrNull(row.ttft_p50),
        durationP50Ms: numberOrNull(row.duration_p50),
      }
    })
    const totals = new Map<string, number>()
    for (const row of seriesRows) totals.set(row.key, (totals.get(row.key) ?? 0) + Number(row.requests))
    const kept = new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, SERIES_MODEL_LIMIT).map(([key]) => key))
    const folded = new Map<string, { bucket: string; modelId: string; requests: number }>()
    for (const row of seriesRows) {
      const modelId = kept.has(row.key) ? row.key : 'other'
      const key = `${row.bucket}\u0000${modelId}`
      const current = folded.get(key) ?? { bucket: row.bucket, modelId, requests: 0 }
      current.requests += Number(row.requests)
      folded.set(key, current)
    }
    const bucketOrder = new Map(buckets.map((bucket, index) => [bucket, index]))
    return {
      window: windowPayload(window),
      totalRequests: total,
      series: [...folded.values()].sort((a, b) => (bucketOrder.get(a.bucket) ?? 0) - (bucketOrder.get(b.bucket) ?? 0) || a.bucket.localeCompare(b.bucket)),
      models,
      redirects: [...redirects].map((row) => ({ requestedModelId: row.requested, answeredModelId: row.answered, count: Number(row.count) })),
      modelNames: { ...modelNames, other: 'Other' },
    }
  })

  app.get('/api/admin/analytics/insights/settings', async (request): Promise<InsightsSettings> => {
    const context = parseContext(request)
    const captured = [...context.current, sql`a.preset_selections is not null`]
    const personalized = [...context.current, sql`a.instruction_preset_ids is not null`]
    const [total, settingsCaptured, presetRows, presetNames, reasoning, verbosity, temperature, toggles, instructionRows, [personalizationRow], modelNames] = await Promise.all([
      totalRequests(context),
      db.execute<{ count: number }>(sql`select count(*)::int as count from request_analytics a ${where(captured)}`),
      db.execute<{ preset_id: string; choice_id: string; count: number }>(sql`select selection.key as preset_id, selection.value as choice_id, count(*)::int as count
        from request_analytics a cross join lateral jsonb_each_text(a.preset_selections) as selection
        ${where(captured)} group by 1, 2 order by 3 desc limit 200`),
      db.execute<{ preset_id: string; preset_name: string; model_id: string; choice_id: string; choice_name: string }>(sql`select p.public_id as preset_id, p.name as preset_name, p.model_id,
          c.public_id as choice_id, c.display_name as choice_name
        from model_presets p join model_preset_choices c on c.preset_id = p.id`),
      db.execute<{ id: string | null; count: number }>(sql`select a.reasoning_effort as id, count(*)::int as count
        from request_analytics a ${where(captured)} group by 1 order by 2 desc`),
      db.execute<{ id: string | null; count: number }>(sql`select a.verbosity as id, count(*)::int as count
        from request_analytics a ${where(captured)} group by 1 order by 2 desc`),
      db.execute<{ id: string | null; count: number }>(sql`select case when a.temperature is null then null
            else to_char(floor(a.temperature * 4) / 4, 'FM0.00') || '–' || to_char(floor(a.temperature * 4) / 4 + 0.25, 'FM0.00') end as id,
          count(*)::int as count
        from request_analytics a ${where(captured)} group by 1 order by 1 nulls first`),
      db.execute<{ custom: number; memory: number }>(sql`select (count(*) filter (where a.custom_instructions))::int as custom,
          (count(*) filter (where a.memory_enabled))::int as memory
        from request_analytics a ${where(personalized)}`),
      db.execute<{ id: string; count: number }>(sql`select preset.value as id, count(*)::int as count
        from request_analytics a cross join lateral jsonb_array_elements_text(a.instruction_preset_ids) as preset
        ${where(personalized)} group by 1 order by 2 desc`),
      db.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'personalization')).limit(1),
      loadModelNames(),
    ])
    const presets = new Map<string, InsightsSettings['presets'][number]>()
    const names = new Map([...presetNames].map((row) => [`${row.preset_id}\u0000${row.choice_id}`, row]))
    const presetMeta = new Map([...presetNames].map((row) => [row.preset_id, row]))
    for (const row of presetRows) {
      const meta = presetMeta.get(row.preset_id)
      const preset = presets.get(row.preset_id) ?? {
        presetId: row.preset_id,
        presetName: meta?.preset_name ?? row.preset_id,
        modelId: meta?.model_id ?? null,
        modelName: meta?.model_id ? modelNames[meta.model_id] ?? null : null,
        total: 0,
        choices: [],
      }
      const count = Number(row.count)
      preset.total += count
      preset.choices.push({ choiceId: row.choice_id, choiceName: names.get(`${row.preset_id}\u0000${row.choice_id}`)?.choice_name ?? row.choice_id, count })
      presets.set(row.preset_id, preset)
    }
    const instructionTitles = new Map(parsePersonalizationSettings(personalizationRow?.value).instructionPresets.map((preset) => [preset.id, preset.title]))
    const settingLabel = (id: string) => id === 'unknown' ? 'Model default' : id
    return {
      window: windowPayload(context.window),
      totalRequests: total,
      presets: [...presets.values()].sort((a, b) => b.total - a.total),
      reasoningEffort: namedCounts(reasoning, settingLabel),
      verbosity: namedCounts(verbosity, settingLabel),
      temperature: namedCounts(temperature, settingLabel),
      customInstructions: Number(toggles[0]?.custom ?? 0),
      memoryEnabled: Number(toggles[0]?.memory ?? 0),
      instructionPresets: namedCounts(instructionRows, (id) => instructionTitles.get(id) ?? id),
      settingsCaptured: Number(settingsCaptured[0]?.count ?? 0),
    }
  })

  app.get('/api/admin/analytics/insights/tools', async (request): Promise<InsightsTools> => {
    const context = parseContext(request)
    const { window } = context
    const [total, totals, tools, series, buckets] = await Promise.all([
      totalRequests(context),
      db.execute<{ agent_requests: number; tool_calls: number }>(sql`select (count(*) filter (where a.agent_mode))::int as agent_requests,
          coalesce(sum(a.tool_calls), 0)::int as tool_calls
        from request_analytics a ${where(context.current)}`),
      db.execute<{ tool_name: string; calls: number; failures: number; requests: number; cost_micros: unknown }>(sql`select t.tool_name, sum(t.calls)::int as calls,
          sum(t.failures)::int as failures, count(distinct t.analytics_id)::int as requests, coalesce(sum(t.cost_micros), 0)::bigint as cost_micros
        from request_analytics_tools t join request_analytics a on a.id = t.analytics_id
        ${where([inWindow(sql`t.created_at`, window.from, window.to), ...context.current])}
        group by 1 order by 2 desc limit 50`),
      db.execute<{ bucket: string; agent_requests: number; tool_calls: number }>(sql`select ${bucketLabel(sql`a.created_at`, window.bucket, window.timeZone)} as bucket,
          (count(*) filter (where a.agent_mode))::int as agent_requests, coalesce(sum(a.tool_calls), 0)::int as tool_calls
        from request_analytics a ${where(context.current)} group by 1 order by 1`),
      loadBuckets(window, () => earliestAnalytics(context)),
    ])
    const byBucket = new Map([...series].map((row) => [row.bucket, row]))
    return {
      window: windowPayload(window),
      totalRequests: total,
      agentRequests: Number(totals[0]?.agent_requests ?? 0),
      toolCalls: Number(totals[0]?.tool_calls ?? 0),
      tools: [...tools].map((row) => ({
        toolName: row.tool_name, calls: Number(row.calls), failures: Number(row.failures),
        requests: Number(row.requests), costMicros: Number(row.cost_micros),
      })),
      series: (buckets.length ? buckets : [...byBucket.keys()]).map((bucket) => ({
        bucket,
        agentRequests: Number(byBucket.get(bucket)?.agent_requests ?? 0),
        toolCalls: Number(byBucket.get(bucket)?.tool_calls ?? 0),
      })),
    }
  })

  app.get('/api/admin/analytics/insights/pools', async (request): Promise<InsightsPools> => {
    const context = parseContext(request)
    const { window } = context
    const [total, poolCounts, pooled, funding, pools] = await Promise.all([
      totalRequests(context),
      db.execute<{ active_pools: number; pooled_users: number }>(sql`select
          (select count(*) from pools where closed_at is null)::int as active_pools,
          (select count(*) from pool_members m join pools p on p.id = m.pool_id where m.left_at is null and p.closed_at is null)::int as pooled_users`),
      db.execute<{ count: number }>(sql`select count(*)::int as count from request_analytics a ${where([...context.current, sql`a.pool_id is not null`])}`),
      db.execute<{ subscription: unknown; shared: unknown; credit: unknown }>(sql`select coalesce(sum(u.weekly_cost_micros), 0)::bigint as subscription,
          coalesce(sum(u.shared_cost_micros), 0)::bigint as shared, coalesce(sum(u.balance_cost_micros), 0)::bigint as credit
        from usage_events u ${where([inWindow(sql`u.created_at`, window.from, window.to)])}`),
      db.execute<{ pool_id: string; owner_name: string | null; members: number; requests: number; users: number; cost_micros: unknown }>(sql`select a.pool_id,
          coalesce(nullif(owner.name, ''), owner.email) as owner_name,
          (select count(*) from pool_members m where m.pool_id = a.pool_id and m.left_at is null)::int as members,
          count(*)::int as requests, count(distinct a.user_id)::int as users, coalesce(sum(a.cost_micros), 0)::bigint as cost_micros
        from request_analytics a
        join pools p on p.id = a.pool_id
        join users owner on owner.id = p.owner_user_id
        ${where(context.current)}
        group by a.pool_id, owner.name, owner.email order by 6 desc limit 25`),
    ])
    return {
      window: windowPayload(window),
      activePools: Number(poolCounts[0]?.active_pools ?? 0),
      pooledUsers: Number(poolCounts[0]?.pooled_users ?? 0),
      pooledRequests: Number(pooled[0]?.count ?? 0),
      totalRequests: total,
      funding: {
        subscriptionMicros: Number(funding[0]?.subscription ?? 0),
        sharedAllowanceMicros: Number(funding[0]?.shared ?? 0),
        creditMicros: Number(funding[0]?.credit ?? 0),
      },
      pools: [...pools].map((row) => ({
        poolId: row.pool_id, ownerName: row.owner_name ?? '', members: Number(row.members),
        requests: Number(row.requests), users: Number(row.users), costMicros: Number(row.cost_micros),
      })),
    }
  })

  app.get('/api/admin/analytics/insights/features', async (request): Promise<InsightsFeatures> => {
    const context = parseContext(request)
    const captured = [...context.current, sql`a.attachment_count is not null`]
    const [total, platforms, platformSeries, origins, plans, features, kinds, branches] = await Promise.all([
      totalRequests(context),
      db.execute<{ platform: string; requests: number; users: number }>(sql`select a.client_platform as platform, count(*)::int as requests, count(distinct a.user_id)::int as users
        from request_analytics a ${where(context.current)} group by 1 order by 2 desc`),
      dimensionSeries(context, 'platform'),
      db.execute<{ id: string; count: number }>(sql`select a.origin as id, count(*)::int as count
        from request_analytics a ${where(context.current)} group by 1 order by 2 desc`),
      db.execute<{ plan: string; requests: number; users: number; cost_micros: unknown }>(sql`select coalesce(a.plan, 'unknown') as plan, count(*)::int as requests,
          count(distinct a.user_id)::int as users, coalesce(sum(a.cost_micros), 0)::bigint as cost_micros
        from request_analytics a ${where(context.current)} group by 1 order by 2 desc`),
      db.execute<{ captured: number; dictation: number; attachments: number }>(sql`select count(*)::int as captured,
          (count(*) filter (where a.used_dictation))::int as dictation,
          (count(*) filter (where a.attachment_count > 0))::int as attachments
        from request_analytics a ${where(captured)}`),
      db.execute<{ id: string; count: number }>(sql`select kind.value as id, count(*)::int as count
        from request_analytics a cross join lateral jsonb_array_elements_text(a.attachment_kinds) as kind
        ${where(captured)} group by 1 order by 2 desc`),
      db.execute<{ id: string; count: number }>(sql`select a.branch_reason as id, count(*)::int as count
        from request_analytics a ${where([...context.current, sql`a.branch_reason is not null`])} group by 1 order by 2 desc`),
    ])
    return {
      window: windowPayload(context.window),
      totalRequests: total,
      platforms: [...platforms].map((row) => ({ platform: asPlatform(row.platform), requests: Number(row.requests), users: Number(row.users) })),
      platformSeries: platformSeries.map((row) => ({ bucket: row.bucket, platform: asPlatform(row.key), requests: Number(row.requests) })),
      origins: namedCounts(origins),
      plans: [...plans].map((row) => ({ plan: row.plan, requests: Number(row.requests), users: Number(row.users), costMicros: Number(row.cost_micros) })),
      dictation: Number(features[0]?.dictation ?? 0),
      withAttachments: Number(features[0]?.attachments ?? 0),
      attachmentKinds: namedCounts(kinds),
      branchReasons: namedCounts(branches),
      featuresCaptured: Number(features[0]?.captured ?? 0),
    }
  })

  app.get('/api/admin/analytics/insights/engagement', async (request): Promise<InsightsEngagement> => {
    const context = parseContext(request)
    const { window } = context
    const filtersOnly = insightConditions(context.filters, RAW_COLUMNS)
    const anchor = window.to.toISOString()
    const tz = window.timeZone
    const [active, firstSeen, series, cohortRows, perUser, buckets] = await Promise.all([
      db.execute<{ dau: number; wau: number; mau: number }>(sql`select
          (count(distinct a.user_id) filter (where a.created_at >= ${anchor}::timestamptz - interval '1 day'))::int as dau,
          (count(distinct a.user_id) filter (where a.created_at >= ${anchor}::timestamptz - interval '7 days'))::int as wau,
          count(distinct a.user_id)::int as mau
        from request_analytics a
        ${where([sql`a.created_at >= ${anchor}::timestamptz - interval '30 days' and a.created_at < ${anchor}::timestamptz`, ...filtersOnly])}`),
      db.execute<{ active: number; new_users: number }>(sql`with first_seen as (
          select a.user_id, min(a.created_at) as first_at from request_analytics a ${where(filtersOnly)} group by 1
        ), active as (
          select distinct a.user_id from request_analytics a ${where(context.current)}
        )
        select count(*)::int as active,
          (count(*) filter (where ${inWindow(sql`f.first_at`, window.from, window.to)}))::int as new_users
        from active join first_seen f using (user_id)`),
      db.execute<{ bucket: string; users: number; new_users: number }>(sql`with first_seen as (
          select a.user_id, min(a.created_at) as first_at from request_analytics a ${where(filtersOnly)} group by 1
        )
        select ${bucketLabel(sql`a.created_at`, window.bucket, tz)} as bucket,
          count(distinct a.user_id)::int as users,
          count(distinct a.user_id) filter (where ${bucketLabel(sql`f.first_at`, window.bucket, tz)} = ${bucketLabel(sql`a.created_at`, window.bucket, tz)})::int as new_users
        from request_analytics a join first_seen f using (user_id)
        ${where(context.current)} group by 1 order by 1`),
      db.execute<{ cohort: string; week: number; users: number }>(sql`with first_seen as (
          select a.user_id, date_trunc('week', min(a.created_at) at time zone ${tz}::text) as cohort
          from request_analytics a ${where(filtersOnly)} group by 1
        ), activity as (
          select distinct a.user_id, date_trunc('week', a.created_at at time zone ${tz}::text) as week
          from request_analytics a
          ${where([sql`a.created_at >= ${anchor}::timestamptz - interval '9 weeks'`, ...filtersOnly])}
        )
        select to_char(f.cohort, 'YYYY-MM-DD') as cohort,
          (extract(epoch from (activity.week - f.cohort)) / 604800)::int as week,
          count(distinct activity.user_id)::int as users
        from first_seen f join activity using (user_id)
        where f.cohort >= date_trunc('week', ${anchor}::timestamptz at time zone ${tz}::text) - interval '7 weeks'
        group by 1, 2 order by 1, 2`),
      db.execute<{ user_id: string; name: string | null; requests: number; cost_micros: unknown; active_days: number }>(sql`select a.user_id,
          coalesce(nullif(u.name, ''), u.email) as name, count(*)::int as requests,
          coalesce(sum(a.cost_micros), 0)::bigint as cost_micros,
          count(distinct (a.created_at at time zone ${tz}::text)::date)::int as active_days
        from request_analytics a join users u on u.id = a.user_id
        ${where(context.current)} group by 1, 2 order by 4 desc`),
      loadBuckets(window, () => earliestAnalytics(context)),
    ])
    const seriesByBucket = new Map([...series].map((row) => [row.bucket, row]))
    const cohorts = new Map<string, number[]>()
    for (const row of cohortRows) {
      const retention = cohorts.get(row.cohort) ?? []
      if (row.week >= 0 && row.week < 8) retention[row.week] = Number(row.users)
      cohorts.set(row.cohort, retention)
    }
    const users = [...perUser]
    const totalCost = users.reduce((sum, row) => sum + Number(row.cost_micros), 0)
    const share = (count: number) => totalCost > 0
      ? users.slice(0, count).reduce((sum, row) => sum + Number(row.cost_micros), 0) / totalCost
      : 0
    const activeRow = firstSeen[0]
    const activeUsers = Number(activeRow?.active ?? 0)
    const newUsers = Number(activeRow?.new_users ?? 0)
    return {
      window: windowPayload(window),
      dau: Number(active[0]?.dau ?? 0),
      wau: Number(active[0]?.wau ?? 0),
      mau: Number(active[0]?.mau ?? 0),
      activeUsers,
      newUsers,
      returningUsers: Math.max(0, activeUsers - newUsers),
      activeSeries: (buckets.length ? buckets : [...seriesByBucket.keys()]).map((bucket) => ({
        bucket,
        users: Number(seriesByBucket.get(bucket)?.users ?? 0),
        newUsers: Number(seriesByBucket.get(bucket)?.new_users ?? 0),
      })),
      cohorts: [...cohorts.entries()].map(([cohortStart, counts]) => {
        const size = counts[0] ?? 0
        return {
          cohortStart,
          size,
          retention: Array.from({ length: counts.length }, (_, week) => size ? (counts[week] ?? 0) / size : 0),
        }
      }),
      concentration: {
        top1PctShare: share(Math.max(1, Math.ceil(users.length * 0.01))),
        top10PctShare: share(Math.max(1, Math.ceil(users.length * 0.1))),
        top10UsersShare: share(10),
      },
      topUsers: users.slice(0, 15).map((row) => ({
        userId: row.user_id,
        name: row.name ?? '',
        requests: Number(row.requests),
        costMicros: Number(row.cost_micros),
        activeDays: Number(row.active_days),
      })),
    }
  })
}
