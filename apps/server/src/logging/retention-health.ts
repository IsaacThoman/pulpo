import { sql } from 'drizzle-orm'
import { db } from '../database/client.js'

export interface RetentionHealth {
  lastSuccessAt: string | null; lastFailureAt: string | null; consecutiveFailures: number
  clearedRecords: number; overdueRecords: number; oldestOverdueAt: string | null; alert: string | null
}
export async function retentionHealth(): Promise<RetentionHealth> {
  const [row] = await db.execute<{ state: Record<string, unknown> | null; overdue: string; oldest: string | null }>(sql`
    select (select value from application_settings where key = 'diagnosticCleanup') as state,
      count(*)::text as overdue, min(expires)::text as oldest from (
        select payload_expires_at as expires from request_logs where (not capture_detailed_payloads or payload_expires_at <= now()) and (request_payload is not null or response_payload is not null)
        union all select log.payload_expires_at from ocr_attempts o join request_logs log on log.id = o.request_log_id
          where (not log.capture_detailed_payloads or log.payload_expires_at <= now()) and (o.request_payload is not null or o.response_payload is not null)
        union all select payload_expires_at from provider_diagnostics where (not capture_detailed_payloads or payload_expires_at <= now()) and (request_payload is not null or response_payload is not null)
        union all select log.payload_expires_at from tool_executions tool
          join agent_runs run on run.id = tool.agent_run_id join request_logs log on log.response_id = run.response_id
          where (not log.capture_detailed_payloads or log.payload_expires_at <= now())
            and (tool.output is not null or tool.arguments <> '{}')
      ) expired
  `)
  const state = row?.state ?? {}, failures = Number(state.consecutiveFailures ?? 0), overdue = Number(row?.overdue ?? 0)
  const lastSuccessAt = typeof state.lastSuccessAt === 'string' ? state.lastSuccessAt : null
  const stalled = !lastSuccessAt || Date.now() - Date.parse(lastSuccessAt) > 5 * 60_000
  const growing = overdue > Number(state.lastOverdueRecords ?? 0) && overdue > 0 && row?.oldest != null && Date.now() - Date.parse(row.oldest) > 2 * 60_000
  return { lastSuccessAt, lastFailureAt: typeof state.lastFailureAt === 'string' ? state.lastFailureAt : null,
    consecutiveFailures: failures, clearedRecords: Number(state.clearedRecords ?? 0), overdueRecords: overdue,
    oldestOverdueAt: row?.oldest ?? null, alert: failures >= 3 ? 'Diagnostic cleanup has failed repeatedly.' : growing ? 'The diagnostic cleanup backlog is growing.' : stalled ? 'Diagnostic cleanup has not reported success in five minutes.' : null }
}
