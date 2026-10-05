import { sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  adminRequestFiltersSchema,
  adminRequestSortSchema,
  analyticsRangeQuerySchema,
  clientPlatformSchema,
  type AdminRequestDetail,
  type AdminRequestFilters,
  type AdminRequestPage,
  type AdminRequestRow,
  type AdminRequestSort,
  type AdminRequestsOverview,
  type AdminRequestTimelineItem,
  type NamedCount,
  type RequestKpis,
  type RequestSeriesPoint,
} from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { AppError, notFound } from '../lib/errors.js'
import { bucketLabel, bucketSeriesSql, csvValues, inWindow, numberOrNull, resolveWindow, windowPayload, type ResolvedWindow } from './window.js'
import { loadModelNames } from './model-names.js'

const FROM = sql`from request_logs l
  join responses r on r.id = l.response_id
  left join request_analytics a on a.response_id = l.response_id`
const PLATFORM = sql`coalesce(a.client_platform, case when l.origin = 'api' then 'api' else 'unknown' end)`
const TTFT = sql`(extract(epoch from (r.first_reply_text_at - r.request_received_at)) * 1000)`
const FAILED = sql`l.status in ('failed', 'incomplete')`

function textList(values: string[]): SQL {
  return sql.join(values.map((value) => sql`${value}`), sql`, `)
}

export function requestFilterConditions(filters: AdminRequestFilters): SQL[] {
  const conditions: SQL[] = []
  const statuses = csvValues(filters.status)
  if (statuses.length) conditions.push(sql`l.status::text in (${textList(statuses)})`)
  const origins = csvValues(filters.origin)
  if (origins.length) conditions.push(sql`l.origin in (${textList(origins)})`)
  const platforms = csvValues(filters.platform)
  if (platforms.length) conditions.push(sql`${PLATFORM} in (${textList(platforms)})`)
  const modelIds = csvValues(filters.model)
  if (modelIds.length) conditions.push(sql`(l.requested_model_id in (${textList(modelIds)}) or l.actual_model_id in (${textList(modelIds)}))`)
  if (filters.userId) conditions.push(sql`l.user_id = ${filters.userId}::uuid`)
  if (filters.apiKeyId) conditions.push(sql`l.api_key_id = ${filters.apiKeyId}::uuid`)
  const categories = csvValues(filters.errorCategory)
  if (categories.length) conditions.push(sql`l.error_category in (${textList(categories)})`)
  if (filters.retry) conditions.push(filters.retry === 'true' ? sql`l.retry_count > 0` : sql`l.retry_count = 0`)
  if (filters.fallback) conditions.push(sql`l.fallback_used = ${filters.fallback === 'true'}::boolean`)
  if (filters.agent) conditions.push(sql`r.agent_mode = ${filters.agent === 'true'}::boolean`)
  if (filters.ocr) conditions.push(filters.ocr === 'true' ? sql`l.ocr_status <> 'not_requested'` : sql`l.ocr_status = 'not_requested'`)
  return conditions
}

function where(conditions: SQL[]): SQL {
  return conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``
}

const KPI_COLUMNS = sql`
  count(*)::int as requests,
  (count(*) filter (where l.status = 'completed'))::int as completed,
  (count(*) filter (where l.status = 'failed'))::int as failed,
  (count(*) filter (where l.status = 'cancelled'))::int as cancelled,
  (count(*) filter (where l.status = 'incomplete'))::int as incomplete,
  (count(*) filter (where l.status in ('queued', 'in_progress')))::int as in_flight,
  percentile_cont(0.5) within group (order by ${TTFT}) as ttft_p50,
  percentile_cont(0.95) within group (order by ${TTFT}) as ttft_p95,
  percentile_cont(0.5) within group (order by l.duration_ms) as duration_p50,
  percentile_cont(0.95) within group (order by l.duration_ms) as duration_p95,
  coalesce(sum(l.cost_micros), 0)::bigint as cost_micros`

type KpiRow = {
  requests: number; completed: number; failed: number; cancelled: number; incomplete: number; in_flight: number
  ttft_p50: unknown; ttft_p95: unknown; duration_p50: unknown; duration_p95: unknown; cost_micros: unknown
}

function kpiCounts(row: KpiRow | undefined) {
  const completed = Number(row?.completed ?? 0)
  const failed = Number(row?.failed ?? 0)
  const incomplete = Number(row?.incomplete ?? 0)
  const cancelled = Number(row?.cancelled ?? 0)
  const finished = completed + failed + incomplete + cancelled
  return {
    requests: Number(row?.requests ?? 0), completed, failed, cancelled, incomplete,
    inFlight: Number(row?.in_flight ?? 0),
    successRate: finished ? completed / finished : 0,
    errorRate: finished ? (failed + incomplete) / finished : 0,
    ttftP50Ms: numberOrNull(row?.ttft_p50), ttftP95Ms: numberOrNull(row?.ttft_p95),
    durationP50Ms: numberOrNull(row?.duration_p50), durationP95Ms: numberOrNull(row?.duration_p95),
    costMicros: Number(row?.cost_micros ?? 0),
  }
}

async function loadKpis(from: Date | null, to: Date, filters: SQL[]): Promise<RequestKpis> {
  const [row] = await db.execute<KpiRow & {
    input_tokens: unknown; cached_input_tokens: unknown; output_tokens: unknown; reasoning_tokens: unknown; users: number
  }>(sql`select ${KPI_COLUMNS},
      coalesce(sum(l.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(l.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(l.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(l.reasoning_tokens), 0)::bigint as reasoning_tokens,
      count(distinct l.user_id)::int as users
    ${FROM} ${where([inWindow(sql`l.created_at`, from, to), ...filters])}`)
  return {
    ...kpiCounts(row),
    inputTokens: Number(row?.input_tokens ?? 0),
    cachedInputTokens: Number(row?.cached_input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    reasoningTokens: Number(row?.reasoning_tokens ?? 0),
    users: Number(row?.users ?? 0),
  }
}

/** Gap-filled bucket labels for the window, using `earliest` when it has no start. */
export async function loadBuckets(window: ResolvedWindow, earliest: () => Promise<Date | null>): Promise<string[]> {
  const series = bucketSeriesSql(window, window.from ? null : await earliest())
  if (!series) return []
  const rows = await db.execute<{ bucket: string }>(series)
  return [...rows].map((row) => row.bucket)
}

async function loadSeries(window: ResolvedWindow, filters: SQL[]): Promise<RequestSeriesPoint[]> {
  const [rows, buckets] = await Promise.all([
    db.execute<KpiRow & { bucket: string }>(sql`select ${bucketLabel(sql`l.created_at`, window.bucket, window.timeZone)} as bucket, ${KPI_COLUMNS}
      ${FROM} ${where([inWindow(sql`l.created_at`, window.from, window.to), ...filters])}
      group by 1 order by 1`),
    loadBuckets(window, async () => {
      const [row] = await db.execute<{ earliest: string | null }>(sql`select min(l.created_at)::text as earliest ${FROM} ${where(filters)}`)
      return row?.earliest ? new Date(row.earliest) : null
    }),
  ])
  const byBucket = new Map([...rows].map((row) => [row.bucket, row]))
  const labels = buckets.length ? buckets : [...byBucket.keys()]
  return labels.map((bucket) => {
    const counts = kpiCounts(byBucket.get(bucket))
    return {
      bucket,
      completed: counts.completed, failed: counts.failed, cancelled: counts.cancelled,
      incomplete: counts.incomplete, inFlight: counts.inFlight, costMicros: counts.costMicros,
      ttftP50Ms: counts.ttftP50Ms, ttftP95Ms: counts.ttftP95Ms,
      durationP50Ms: counts.durationP50Ms, durationP95Ms: counts.durationP95Ms,
    }
  })
}

function decodeLosslessText(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : value
  } catch {
    return value
  }
}

function namedCounts(rows: Iterable<{ id: string | null; label: string | null; count: number; cost_micros?: unknown }>): NamedCount[] {
  return [...rows].map((row) => ({
    id: row.id ?? 'unknown',
    label: row.label || row.id || 'unknown',
    count: Number(row.count),
    ...(row.cost_micros !== undefined ? { costMicros: Number(row.cost_micros) } : {}),
  }))
}

type RequestRowRecord = {
  id: string; response_id: string; created_at: string; status: string; origin: string; platform: string
  user_id: string | null; user_name: string | null; user_email: string | null
  api_key_id: string | null; api_key_name: string | null; api_key_prefix: string | null
  requested_model_id: string; actual_model_id: string | null; agent_mode: boolean
  retry_count: number; fallback_used: boolean; sticky_fallback_used: boolean; ocr_status: string
  error_category: string | null; error_message: string | null
  input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_tokens: number
  cost_micros: unknown; ttft_ms: unknown; duration_ms: number | null; tokens_per_second: unknown
  attempts: number; tool_calls: number; sort_value: string | null
}

const ROW_COLUMNS = sql`
  l.id, l.response_id, l.created_at::text as created_at, l.status::text as status, l.origin, ${PLATFORM} as platform,
  u.id as user_id, u.name as user_name, u.email as user_email,
  k.id as api_key_id, k.name as api_key_name, k.prefix as api_key_prefix,
  l.requested_model_id, coalesce(l.actual_model_id, l.current_model_id) as actual_model_id, r.agent_mode,
  l.retry_count, l.fallback_used, l.sticky_fallback_used, l.ocr_status, l.error_category, l.error_message,
  l.input_tokens, l.cached_input_tokens, l.output_tokens, l.reasoning_tokens, l.cost_micros,
  ${TTFT} as ttft_ms, l.duration_ms, l.tokens_per_second,
  (select count(*) from generation_attempts g where g.request_log_id = l.id)::int as attempts,
  coalesce(run.tool_calls, 0)::int as tool_calls`
const ROW_JOINS = sql`
  left join users u on u.id = l.user_id
  left join api_keys k on k.id = l.api_key_id
  left join agent_runs run on run.response_id = l.response_id`

function requestRow(row: RequestRowRecord): AdminRequestRow {
  const platform = clientPlatformSchema.safeParse(row.platform)
  return {
    id: row.id,
    responseId: row.response_id,
    createdAt: new Date(row.created_at).toISOString(),
    status: row.status,
    origin: row.origin,
    platform: platform.success ? platform.data : 'unknown',
    user: row.user_id ? { id: row.user_id, name: row.user_name ?? '', email: row.user_email ?? '' } : null,
    apiKey: row.api_key_id ? { id: row.api_key_id, name: row.api_key_name ?? '', prefix: row.api_key_prefix ?? '' } : null,
    requestedModelId: row.requested_model_id,
    actualModelId: row.actual_model_id,
    agentMode: row.agent_mode,
    retryCount: row.retry_count,
    fallbackUsed: row.fallback_used,
    stickyFallbackUsed: row.sticky_fallback_used,
    ocrStatus: row.ocr_status,
    errorCategory: row.error_category,
    errorMessage: row.error_message === null ? null : decodeLosslessText(row.error_message),
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    costMicros: Number(row.cost_micros),
    ttftMs: numberOrNull(row.ttft_ms) === null ? null : Math.max(0, Math.round(Number(row.ttft_ms))),
    durationMs: row.duration_ms,
    tokensPerSecond: numberOrNull(row.tokens_per_second),
    attempts: row.attempts,
    toolCalls: row.tool_calls,
  }
}

const cursorSchema = z.tuple([z.union([z.string(), z.number()]), z.uuid()])

export function encodeRequestCursor(value: string | number, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString('base64url')
}

export function decodeRequestCursor(cursor: string): [string | number, string] {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch {
    throw new AppError(400, 'invalid_cursor', 'The page cursor is invalid')
  }
}

const SORTS: Record<AdminRequestSort, { value: SQL; order: SQL; cursorValue: (raw: string) => SQL; required?: SQL }> = {
  // Timestamps travel as Postgres text so the cursor keeps microsecond precision.
  newest: { value: sql`l.created_at::text`, order: sql`l.created_at desc, l.id desc`, cursorValue: (raw) => sql`(l.created_at, l.id) < (${raw}::timestamptz` },
  slowest: { value: sql`l.duration_ms::text`, order: sql`l.duration_ms desc, l.id desc`, cursorValue: (raw) => sql`(l.duration_ms, l.id) < (${Number(raw)}::int`, required: sql`l.duration_ms is not null` },
  costliest: { value: sql`l.cost_micros::text`, order: sql`l.cost_micros desc, l.id desc`, cursorValue: (raw) => sql`(l.cost_micros, l.id) < (${Number(raw)}::bigint` },
}

const listQuerySchema = z.object({
  sort: adminRequestSortSchema.default('newest'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function registerAdminRequestAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/analytics/requests/overview', async (request): Promise<AdminRequestsOverview> => {
    requireAdmin(request)
    const window = resolveWindow(analyticsRangeQuerySchema.parse(request.query))
    const filters = requestFilterConditions(adminRequestFiltersSchema.parse(request.query))
    const current = [inWindow(sql`l.created_at`, window.from, window.to), ...filters]
    const failedCurrent = [...current, FAILED]
    const [kpis, previous, series, byCategory, byModel, topMessages, reliability, fallbackPaths, topModels, topUsers, topApiKeys, modelNames] = await Promise.all([
      loadKpis(window.from, window.to, filters),
      window.previousFrom && window.from ? loadKpis(window.previousFrom, window.from, filters) : Promise.resolve(null),
      loadSeries(window, filters),
      db.execute<{ id: string | null; label: string | null; count: number }>(sql`select coalesce(l.error_category, 'unknown') as id, coalesce(l.error_category, 'unknown') as label, count(*)::int as count
        ${FROM} ${where(failedCurrent)} group by 1, 2 order by 3 desc limit 12`),
      db.execute<{ id: string | null; label: string | null; count: number }>(sql`select coalesce(l.actual_model_id, l.current_model_id, l.requested_model_id) as id, null as label, count(*)::int as count
        ${FROM} ${where(failedCurrent)} group by 1 order by 3 desc limit 12`),
      db.execute<{ message: string | null; category: string | null; count: number; last_seen_at: string }>(sql`select l.error_message as message, l.error_category as category, count(*)::int as count, max(l.created_at)::text as last_seen_at
        ${FROM} ${where([...failedCurrent, sql`l.error_message is not null`])} group by 1, 2 order by 3 desc limit 8`),
      db.execute<{ model_id: string; requests: number; failures: number; retried: number; fallbacks: number; ttft_p50: unknown }>(sql`select l.requested_model_id as model_id, count(*)::int as requests,
          (count(*) filter (where ${FAILED}))::int as failures,
          (count(*) filter (where l.retry_count > 0))::int as retried,
          (count(*) filter (where l.fallback_used))::int as fallbacks,
          percentile_cont(0.5) within group (order by ${TTFT}) as ttft_p50
        ${FROM} ${where(current)} group by 1 order by 2 desc limit 15`),
      db.execute<{ from_model_id: string; to_model_id: string; count: number }>(sql`select g.fallback_from_model_id as from_model_id, g.model_id as to_model_id, count(*)::int as count
        from generation_attempts g
        join request_logs l on l.id = g.request_log_id
        join responses r on r.id = l.response_id
        left join request_analytics a on a.response_id = l.response_id
        ${where([...current, sql`g.fallback_from_model_id is not null`])}
        group by 1, 2 order by 3 desc limit 15`),
      db.execute<{ id: string; label: string | null; count: number; cost_micros: unknown }>(sql`select l.requested_model_id as id, null as label, count(*)::int as count, coalesce(sum(l.cost_micros), 0)::bigint as cost_micros
        ${FROM} ${where(current)} group by 1 order by 3 desc limit 10`),
      db.execute<{ id: string; label: string | null; count: number; cost_micros: unknown }>(sql`select u.id, coalesce(nullif(u.name, ''), u.email) as label, count(*)::int as count, coalesce(sum(l.cost_micros), 0)::bigint as cost_micros
        ${FROM} join users u on u.id = l.user_id ${where(current)} group by 1, 2 order by 3 desc limit 10`),
      db.execute<{ id: string; label: string | null; count: number; cost_micros: unknown }>(sql`select k.id, k.name as label, count(*)::int as count, coalesce(sum(l.cost_micros), 0)::bigint as cost_micros
        ${FROM} join api_keys k on k.id = l.api_key_id ${where(current)} group by 1, 2 order by 3 desc limit 10`),
      loadModelNames(),
    ])
    const withModelName = (rows: NamedCount[]) => rows.map((row) => ({ ...row, label: modelNames[row.id] ?? row.id }))
    return {
      window: windowPayload(window),
      kpis: { current: kpis, previous },
      series,
      errors: {
        byCategory: namedCounts(byCategory),
        byModel: withModelName(namedCounts(byModel)),
        topMessages: [...topMessages].map((row) => ({
          message: decodeLosslessText(row.message).slice(0, 500),
          category: row.category,
          count: Number(row.count),
          lastSeenAt: new Date(row.last_seen_at).toISOString(),
        })),
      },
      reliability: [...reliability].map((row) => ({
        modelId: row.model_id,
        modelName: modelNames[row.model_id] ?? row.model_id,
        requests: Number(row.requests),
        failures: Number(row.failures),
        retried: Number(row.retried),
        fallbacks: Number(row.fallbacks),
        ttftP50Ms: numberOrNull(row.ttft_p50),
      })),
      fallbackPaths: [...fallbackPaths].map((row) => ({ fromModelId: row.from_model_id, toModelId: row.to_model_id, count: Number(row.count) })),
      topModels: withModelName(namedCounts(topModels)),
      topUsers: namedCounts(topUsers),
      topApiKeys: namedCounts(topApiKeys),
      modelNames,
    }
  })

  app.get('/api/admin/analytics/requests', async (request): Promise<AdminRequestPage> => {
    requireAdmin(request)
    const window = resolveWindow(analyticsRangeQuerySchema.parse(request.query))
    const filters = requestFilterConditions(adminRequestFiltersSchema.parse(request.query))
    const list = listQuerySchema.parse(request.query)
    const sort = SORTS[list.sort]
    const conditions = [inWindow(sql`l.created_at`, window.from, window.to), ...filters]
    if (sort.required) conditions.push(sort.required)
    if (list.cursor) {
      const [value, id] = decodeRequestCursor(list.cursor)
      conditions.push(sql`${sort.cursorValue(String(value))}, ${id}::uuid)`)
    }
    const rows = [...await db.execute<RequestRowRecord>(sql`select ${ROW_COLUMNS}, ${sort.value} as sort_value
      ${FROM} ${ROW_JOINS} ${where(conditions)}
      order by ${sort.order} limit ${list.limit + 1}`)]
    const page = rows.slice(0, list.limit)
    const last = page.at(-1)
    return {
      data: page.map(requestRow),
      nextCursor: rows.length > list.limit && last?.sort_value != null ? encodeRequestCursor(last.sort_value, last.id) : null,
    }
  })

  app.get('/api/admin/analytics/requests/:id', async (request): Promise<AdminRequestDetail> => {
    requireAdmin(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const [row] = await db.execute<RequestRowRecord & {
      preset_selections: unknown; parameters: string | null; branch_reason: string | null; client_version: string | null
    }>(sql`select ${ROW_COLUMNS}, null as sort_value, r.preset_selections, r.parameters, r.branch_reason, a.client_version
      ${FROM} ${ROW_JOINS} where l.id = ${id}::uuid`)
    if (!row) throw notFound('Request')
    const [attempts, tools, ocr] = await Promise.all([
      db.execute<{
        id: string; started_at: string; completed_at: string | null; status: string; purpose: string; model_id: string
        upstream_model_id: string | null; retry_attempt: number; turn_number: number | null; retry_reason: string | null
        fallback_from_model_id: string | null; error_category: string | null; error_message: string | null
        first_token_ms: number | null; duration_ms: number | null; input_tokens: number; output_tokens: number; cost_micros: unknown
      }>(sql`select id, started_at::text, completed_at::text, status, purpose, model_id, upstream_model_id, retry_attempt, turn_number,
          retry_reason, fallback_from_model_id, error_category, error_message, first_token_ms, duration_ms, input_tokens, output_tokens, cost_micros
        from generation_attempts where request_log_id = ${id}::uuid order by started_at limit 500`),
      db.execute<{
        id: string; started_at: string | null; completed_at: string | null; status: string; tool_name: string
        provider: string | null; error: string | null; billed_cost_micros: unknown
      }>(sql`select t.id, t.started_at::text, t.completed_at::text, t.status::text, t.tool_name, t.provider, t.error, t.billed_cost_micros
        from tool_executions t join agent_runs run on run.id = t.agent_run_id
        where run.response_id = ${row.response_id}::uuid order by coalesce(t.started_at, t.created_at) limit 500`),
      db.execute<{
        id: string; status: string; provider_id: string | null; model_id: string | null; cached: boolean
        duration_ms: number | null; error_message: string | null
      }>(sql`select id, status, provider_id, model_id, cached, duration_ms, error_message
        from ocr_attempts where request_log_id = ${id}::uuid order by created_at limit 100`),
    ])
    const timeline: AdminRequestTimelineItem[] = [
      ...[...attempts].map((attempt): AdminRequestTimelineItem => ({
        kind: 'attempt',
        id: attempt.id,
        startedAt: new Date(attempt.started_at).toISOString(),
        completedAt: attempt.completed_at ? new Date(attempt.completed_at).toISOString() : null,
        status: attempt.status,
        purpose: attempt.purpose,
        modelId: attempt.model_id,
        upstreamModelId: attempt.upstream_model_id,
        retryAttempt: attempt.retry_attempt,
        turnNumber: attempt.turn_number,
        retryReason: attempt.retry_reason,
        fallbackFromModelId: attempt.fallback_from_model_id,
        errorCategory: attempt.error_category,
        errorMessage: attempt.error_message === null ? null : decodeLosslessText(attempt.error_message),
        firstTokenMs: attempt.first_token_ms,
        durationMs: attempt.duration_ms,
        inputTokens: attempt.input_tokens,
        outputTokens: attempt.output_tokens,
        costMicros: Number(attempt.cost_micros),
      })),
      ...[...tools].map((tool): AdminRequestTimelineItem => ({
        kind: 'tool',
        id: tool.id,
        startedAt: tool.started_at ? new Date(tool.started_at).toISOString() : null,
        completedAt: tool.completed_at ? new Date(tool.completed_at).toISOString() : null,
        status: tool.status,
        toolName: tool.tool_name,
        provider: tool.provider,
        error: tool.error === null ? null : decodeLosslessText(tool.error),
        billedCostMicros: Number(tool.billed_cost_micros),
      })),
    ].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
    let parameters: Record<string, unknown> = {}
    try {
      const parsed: unknown = row.parameters ? JSON.parse(row.parameters) : {}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parameters = parsed as Record<string, unknown>
    } catch { /* malformed legacy parameters are shown as empty */ }
    return {
      request: requestRow(row),
      timeline,
      ocrAttempts: [...ocr].map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        providerId: attempt.provider_id,
        modelId: attempt.model_id,
        cached: attempt.cached,
        durationMs: attempt.duration_ms,
        errorMessage: attempt.error_message === null ? null : decodeLosslessText(attempt.error_message),
      })),
      settings: {
        presetSelections: (row.preset_selections ?? {}) as Record<string, string>,
        parameters,
        branchReason: row.branch_reason,
        clientVersion: row.client_version,
      },
    }
  })
}
