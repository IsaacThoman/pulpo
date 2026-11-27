import { sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  analyticsRangeQuerySchema,
  searchAnalyticsFiltersSchema,
  type AdminSearchOverview,
  type AdminSearchRequestRow,
  type SearchAnalyticsFilters,
  type SearchKpis,
  type SearchRequestAttempt,
  type SearchRequestOutcome,
  type SearchRequestPhases,
} from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { bucketLabel, csvValues, inWindow, numberOrNull, resolveWindow, windowPayload } from './window.js'
import { loadBuckets } from './request-routes.js'

const RECENT_LIMIT = 100
/** Searches that reached a provider and finished; the rest say nothing about latency. */
const TIMED = sql`s.outcome in ('success', 'empty', 'error')`
/** Attempts that called a provider and ran to an outcome of its own. */
const CALLED = sql`a->>'outcome' not in ('skipped_budget', 'skipped_unhealthy', 'cancelled')`
const ATTEMPT_MS = sql`(a->>'durationMs')::int`
const PHASES = ['requestMs', 'settingsMs', 'reserveMs', 'providerMs', 'settleMs', 'releaseMs'] as const

function textList(values: string[]): SQL {
  return sql.join(values.map((value) => sql`${value}`), sql`, `)
}

function where(conditions: SQL[]): SQL {
  return conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``
}

function searchConditions(filters: SearchAnalyticsFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters.kind) conditions.push(sql`s.kind = ${filters.kind}`)
  const categories = csvValues(filters.category)
  if (categories.length) conditions.push(sql`s.category in (${textList(categories)})`)
  const outcomes = csvValues(filters.outcome)
  if (outcomes.length) conditions.push(sql`s.outcome in (${textList(outcomes)})`)
  const providers = csvValues(filters.provider)
  if (providers.length) {
    conditions.push(sql`exists (select 1 from jsonb_array_elements(s.attempts) x where x->>'provider' in (${textList(providers)}))`)
  }
  return conditions
}

/** Attempt-level filters: a provider filter also narrows which attempts count. */
function attemptConditions(filters: SearchAnalyticsFilters): SQL[] {
  const providers = csvValues(filters.provider)
  return providers.length ? [CALLED, sql`a->>'provider' in (${textList(providers)})`] : [CALLED]
}

const ATTEMPTS = sql`search_requests s cross join lateral jsonb_array_elements(s.attempts) a`

type KpiRecord = {
  searches: number; timed: number; errors: number; empty: number; fallbacks: number; users: number
  attempts: number; timeouts: number; p50: unknown; p90: unknown; p95: unknown
}

async function loadKpis(from: Date | null, to: Date, filters: SQL[]): Promise<SearchKpis> {
  const [row] = await db.execute<KpiRecord>(sql`select count(*)::int as searches,
      (count(*) filter (where ${TIMED}))::int as timed,
      (count(*) filter (where s.outcome = 'error'))::int as errors,
      (count(*) filter (where s.outcome = 'empty'))::int as empty,
      (count(*) filter (where ${TIMED} and s.fallback))::int as fallbacks,
      count(distinct s.user_id)::int as users,
      coalesce(sum((select count(*) from jsonb_array_elements(s.attempts) a where ${CALLED})), 0)::int as attempts,
      coalesce(sum((select count(*) from jsonb_array_elements(s.attempts) a where a->>'outcome' = 'timeout')), 0)::int as timeouts,
      percentile_cont(0.5) within group (order by s.duration_ms) filter (where ${TIMED}) as p50,
      percentile_cont(0.9) within group (order by s.duration_ms) filter (where ${TIMED}) as p90,
      percentile_cont(0.95) within group (order by s.duration_ms) filter (where ${TIMED}) as p95
    from search_requests s ${where([inWindow(sql`s.created_at`, from, to), ...filters])}`)
  const timed = Number(row?.timed ?? 0)
  const attempts = Number(row?.attempts ?? 0)
  return {
    searches: Number(row?.searches ?? 0), timed,
    p50Ms: numberOrNull(row?.p50), p90Ms: numberOrNull(row?.p90), p95Ms: numberOrNull(row?.p95),
    failureRate: timed ? Number(row?.errors ?? 0) / timed : 0,
    emptyRate: timed ? Number(row?.empty ?? 0) / timed : 0,
    fallbackRate: timed ? Number(row?.fallbacks ?? 0) / timed : 0,
    timeoutRate: attempts ? Number(row?.timeouts ?? 0) / attempts : 0,
    users: Number(row?.users ?? 0),
  }
}

type RecentRecord = {
  id: string; created_at: string; user_id: string | null; user_name: string | null; user_email: string | null
  kind: 'query' | 'places'; category: string; page: number; outcome: SearchRequestOutcome; provider: string | null
  fallback: boolean; result_count: number; duration_ms: number; phases: SearchRequestPhases
  attempts: SearchRequestAttempt[]; query_length: number; filters: string[]
}

function recentRow(row: RecentRecord): AdminSearchRequestRow {
  return {
    id: row.id, createdAt: new Date(row.created_at).toISOString(),
    user: row.user_id ? { id: row.user_id, name: row.user_name ?? '', email: row.user_email ?? '' } : null,
    kind: row.kind, category: row.category, page: row.page, outcome: row.outcome, provider: row.provider,
    fallback: row.fallback, resultCount: row.result_count, durationMs: row.duration_ms,
    phases: row.phases ?? {}, attempts: row.attempts ?? [], queryLength: row.query_length, filters: row.filters ?? [],
  }
}

export async function registerAdminSearchAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/analytics/search', async (request): Promise<AdminSearchOverview> => {
    requireAdmin(request)
    const window = resolveWindow(analyticsRangeQuerySchema.parse(request.query))
    const filters = searchAnalyticsFiltersSchema.parse(request.query)
    const searchFilters = searchConditions(filters)
    const current = [inWindow(sql`s.created_at`, window.from, window.to), ...searchFilters]
    const attempts = [...current, ...attemptConditions(filters)]
    const bucket = bucketLabel(sql`s.created_at`, window.bucket, window.timeZone)
    const [kpis, previous, outcomes, providers, phases, series, providerSeries, buckets, recent] = await Promise.all([
      loadKpis(window.from, window.to, searchFilters),
      window.previousFrom && window.from ? loadKpis(window.previousFrom, window.from, searchFilters) : Promise.resolve(null),
      db.execute<{ id: string; count: number }>(sql`select s.outcome as id, count(*)::int as count
        from search_requests s ${where(current)} group by 1 order by 2 desc`),
      db.execute<{ provider: string; category: string; attempts: number; successes: number; empty: number; errors: number; timeouts: number; p50: unknown; p90: unknown; p95: unknown }>(sql`select a->>'provider' as provider, s.category,
          count(*)::int as attempts,
          (count(*) filter (where a->>'outcome' = 'success'))::int as successes,
          (count(*) filter (where a->>'outcome' = 'empty'))::int as empty,
          (count(*) filter (where a->>'outcome' = 'error'))::int as errors,
          (count(*) filter (where a->>'outcome' = 'timeout'))::int as timeouts,
          percentile_cont(0.5) within group (order by ${ATTEMPT_MS}) as p50,
          percentile_cont(0.9) within group (order by ${ATTEMPT_MS}) as p90,
          percentile_cont(0.95) within group (order by ${ATTEMPT_MS}) as p95
        from ${ATTEMPTS} ${where(attempts)} group by 1, 2 order by 3 desc limit 40`),
      db.execute<Record<string, unknown>>(sql`select avg(s.duration_ms)::float8 as total,
          ${sql.join(PHASES.map((phase) => sql`coalesce(avg(coalesce((s.phases->>${phase})::float8, 0)), 0)::float8 as ${sql.identifier(phase)}`), sql`, `)}
        from search_requests s ${where([...current, TIMED])}`),
      db.execute<{ bucket: string; searches: number; p50: unknown; p90: unknown }>(sql`select ${bucket} as bucket, count(*)::int as searches,
          percentile_cont(0.5) within group (order by s.duration_ms) as p50,
          percentile_cont(0.9) within group (order by s.duration_ms) as p90
        from search_requests s ${where([...current, TIMED])} group by 1 order by 1`),
      db.execute<{ bucket: string; provider: string; attempts: number; p50: unknown; p90: unknown }>(sql`select ${bucket} as bucket, a->>'provider' as provider, count(*)::int as attempts,
          percentile_cont(0.5) within group (order by ${ATTEMPT_MS}) as p50,
          percentile_cont(0.9) within group (order by ${ATTEMPT_MS}) as p90
        from ${ATTEMPTS} ${where(attempts)} group by 1, 2 order by 1`),
      loadBuckets(window, async () => {
        const [row] = await db.execute<{ earliest: string | null }>(sql`select min(s.created_at)::text as earliest from search_requests s ${where(searchFilters)}`)
        return row?.earliest ? new Date(row.earliest) : null
      }),
      db.execute<RecentRecord>(sql`select s.id, s.created_at::text as created_at, u.id as user_id, u.name as user_name, u.email as user_email,
          s.kind, s.category, s.page, s.outcome, s.provider, s.fallback, s.result_count, s.duration_ms, s.phases, s.attempts, s.query_length, s.filters
        from search_requests s left join users u on u.id = s.user_id
        ${where(current)} order by s.created_at desc, s.id desc limit ${RECENT_LIMIT}`),
    ])

    const [phaseRow] = phases
    const phase = (key: typeof PHASES[number]) => Number(phaseRow?.[key] ?? 0)
    const totalMs = Number(phaseRow?.total ?? 0)
    const accounted = PHASES.reduce((sum, key) => sum + phase(key), 0)
    const byBucket = new Map([...series].map((row) => [row.bucket, row]))
    const labels = buckets.length ? buckets : [...byBucket.keys()]
    return {
      window: windowPayload(window),
      kpis: { current: kpis, previous },
      outcomes: [...outcomes].map((row) => ({ id: row.id, label: row.id, count: Number(row.count) })),
      providers: [...providers].map((row) => ({
        provider: row.provider, category: row.category, attempts: Number(row.attempts), successes: Number(row.successes),
        empty: Number(row.empty), errors: Number(row.errors), timeouts: Number(row.timeouts),
        p50Ms: numberOrNull(row.p50), p90Ms: numberOrNull(row.p90), p95Ms: numberOrNull(row.p95),
      })),
      phases: {
        requestMs: phase('requestMs'), settingsMs: phase('settingsMs'), reserveMs: phase('reserveMs'), providerMs: phase('providerMs'),
        settleMs: phase('settleMs'), releaseMs: phase('releaseMs'), otherMs: Math.max(0, totalMs - accounted), totalMs,
      },
      series: labels.map((label) => {
        const row = byBucket.get(label)
        return { bucket: label, searches: Number(row?.searches ?? 0), p50Ms: numberOrNull(row?.p50), p90Ms: numberOrNull(row?.p90) }
      }),
      providerSeries: [...providerSeries].map((row) => ({
        bucket: row.bucket, provider: row.provider, attempts: Number(row.attempts), p50Ms: numberOrNull(row.p50), p90Ms: numberOrNull(row.p90),
      })),
      recent: [...recent].map(recentRow),
    }
  })
}
