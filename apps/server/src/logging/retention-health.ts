import { sql, type SQL } from 'drizzle-orm'
import { db } from '../database/client.js'

export interface RetentionHealth {
  sampledAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; consecutiveFailures: number
  clearedRecords: number; deletedRecords: number; overdueRecords: number; backlogCapped: boolean; oldestOverdueAt: string | null; alert: string | null
}
/** Admin polling reads one stored snapshot, never the diagnostic tables. */
export async function retentionHealth(): Promise<RetentionHealth> {
  const [row] = await db.execute<{ state: Record<string, unknown> }>(sql`select value as state from application_settings where key = 'diagnosticCleanup'`)
  const state = row?.state ?? {}, failures = Number(state.consecutiveFailures ?? 0), overdue = Number(state.overdueRecords ?? 0)
  const lastSuccessAt = typeof state.lastSuccessAt === 'string' ? state.lastSuccessAt : null
  const sampledAt = typeof state.sampledAt === 'string' ? state.sampledAt : null
  const oldest = typeof state.oldestOverdueAt === 'string' ? state.oldestOverdueAt : null
  const stalled = !lastSuccessAt || Date.now() - Date.parse(lastSuccessAt) > 5 * 60_000
  const growing = overdue > Number(state.previousOverdueRecords ?? 0) && oldest != null && Date.now() - Date.parse(oldest) > 2 * 60_000
  return { sampledAt, lastSuccessAt, lastFailureAt: typeof state.lastFailureAt === 'string' ? state.lastFailureAt : null,
    consecutiveFailures: failures, clearedRecords: Number(state.clearedRecords ?? 0), deletedRecords: Number(state.deletedRecords ?? 0),
    overdueRecords: overdue, backlogCapped: state.backlogCapped === true,
    oldestOverdueAt: oldest, alert: failures >= 3 ? 'Diagnostic cleanup has failed repeatedly.' : growing ? 'The diagnostic cleanup backlog is growing.' : stalled ? 'Diagnostic cleanup has not reported success in five minutes.' : null }
}
/** Worker-only bounded sample: counts are lower bounds when a branch hits its limit. */
export async function sampleRetentionBacklog(execute: (query: SQL) => Promise<unknown> = query => db.execute(query)) {
  const rows = await execute(sql`
    with requests as (select payload_expires_at as expires from request_logs
      where (payload_expires_at <= now() or not capture_detailed_payloads) and (capture_detailed_payloads or request_payload is not null or response_payload is not null) limit 501),
    ocr as (select log.payload_expires_at as expires from ocr_attempts o join request_logs log on log.id = o.request_log_id
      where (not log.capture_detailed_payloads or log.payload_expires_at <= now()) and (o.request_payload is not null or o.response_payload is not null) limit 501),
    diagnostics as (select least(d.payload_expires_at, d.retention_started_at + make_interval(secs => p.retention_seconds), d.created_at + interval '90 days') as expires
      from provider_diagnostics d cross join diagnostic_policy p where (d.request_payload is not null or d.response_payload is not null) and d.created_at > now() - interval '90 days'
      and (not p.enabled or not d.capture_detailed_payloads or d.payload_epoch <> p.epoch or d.retention_started_at <= p.expired_before or least(d.payload_expires_at, d.retention_started_at + make_interval(secs => p.retention_seconds), d.created_at + interval '90 days') <= now()) limit 501),
    old_rows as (select created_at + interval '90 days' as expires from provider_diagnostics where created_at <= now() - interval '90 days' limit 501)
    select count(*)::text as overdue, min(expires)::text as oldest,
      (select count(*) = 501 from requests) or (select count(*) = 501 from ocr) or (select count(*) = 501 from diagnostics) or (select count(*) = 501 from old_rows) as capped
    from (select * from requests union all select * from ocr union all select * from diagnostics union all select * from old_rows) backlog
  `)
  const [row] = rows as Array<{ overdue: string; oldest: string | null; capped: boolean }>
  return { sampledAt: new Date().toISOString(), overdueRecords: Number(row?.overdue ?? 0), oldestOverdueAt: row?.oldest ?? null, backlogCapped: row?.capped ?? false }
}
