import { AsyncLocalStorage } from 'node:async_hooks'
import { sql } from 'drizzle-orm'
import { newId } from '../lib/ids.js'
import { diagnosticDb, diagnosticClient } from './diagnostic-database.js'
import { diagnosticPayload, safeDiagnosticText, type DiagnosticPayload } from './diagnostic-sanitizer.js'
import { DiagnosticWriter } from './diagnostic-writer.js'

export const DIAGNOSTIC_ROW_RETENTION_DAYS = 90
export interface DiagnosticContext {
  userId?: string; requestLogId?: string; modelCallId?: string; operationId?: string
  purpose: string; providerId?: string; modelId?: string; upstreamModelId?: string
  observation?: { seen: boolean }; metadata?: Record<string, unknown>
}
export const diagnosticContext = new AsyncLocalStorage<DiagnosticContext>()
export const withDiagnosticContext = <T>(context: DiagnosticContext, fn: () => T): T => diagnosticContext.run(context, fn)
let lastReport = 0, dropped = 0
export function reportDiagnosticFailure(event = 'observer_failed', count = 1): void {
  dropped += count
  if (Date.now() - lastReport < 60_000) return
  lastReport = Date.now()
  try { console.warn(JSON.stringify({ event: 'diagnostics.dropped', reason: event, count: dropped })) } catch {}
  dropped = 0
}
export function observeDiagnostic<T>(fn: () => T): T | undefined {
  try { return fn() } catch { reportDiagnosticFailure(); return undefined }
}
interface Policy { epoch: number; enabled: boolean; retention_seconds: number | null }
let policy: Policy = { epoch: -1, enabled: false, retention_seconds: null }, refreshedAt = 0
let refreshing: Promise<void> | undefined
export function refreshDiagnosticPolicy(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const [row] = await diagnosticDb.execute<Policy & Record<string, unknown>>(sql`select epoch, enabled, retention_seconds from diagnostic_policy where id = 1`)
      if (row) { policy = row; refreshedAt = Date.now() }
    } catch { policy = { epoch: -1, enabled: false, retention_seconds: null }; refreshedAt = Date.now(); reportDiagnosticFailure('policy_unavailable') }
  })().finally(() => { refreshing = undefined })
  return refreshing
}
export interface DiagnosticRecord extends DiagnosticContext {
  id: string; capture: boolean; epoch: number; createdAt: string; status: string
  queuedStart?: boolean; completedAt?: string; requestPayload?: DiagnosticPayload; responsePayload?: DiagnosticPayload
}
const writer = new DiagnosticWriter(persistDiagnostics, reportDiagnosticFailure)
export async function persistDiagnostics(rows: string[]): Promise<void> {
  // The policy row is locked only for this one bounded insert statement. A disable
  // changes its epoch: old queued copies can still save metadata, never payloads.
  await diagnosticDb.execute(sql`
    with policy as materialized (select * from diagnostic_policy where id = 1 for share),
    incoming as (select * from jsonb_to_recordset(${`[${rows.join(',')}]`}::jsonb) as x(
      id uuid, "userId" uuid, "requestLogId" uuid, "modelCallId" uuid, "operationId" text, purpose text,
      "providerId" text, "modelId" text, "upstreamModelId" text, metadata jsonb, capture boolean, epoch bigint,
      "createdAt" timestamptz, "completedAt" timestamptz, status text, "requestPayload" text, "responsePayload" text)),
    resolved as (select x.*, coalesce(x."userId", log.user_id) as owner,
      coalesce(log.created_at, x."createdAt") as collected,
      least(log.payload_expires_at, coalesce(log.created_at, x."createdAt") + make_interval(secs => p.retention_seconds), x."createdAt" + interval '90 days') as expires,
      p.enabled and x.capture and x.epoch = p.epoch and (p.expired_before is null or coalesce(log.created_at, x."createdAt") > p.expired_before) and (x."requestLogId" is null or log.capture_detailed_payloads) as allowed
      from incoming x cross join policy p left join request_logs log on log.id = x."requestLogId")
    , saved as (insert into provider_diagnostics (id, user_id, request_log_id, model_call_id, operation_id, purpose, provider_id, model_id, upstream_model_id,
      metadata, status, created_at, completed_at, retention_started_at, payload_expires_at, capture_detailed_payloads, payload_epoch, request_payload, response_payload)
    select id, owner, "requestLogId", "modelCallId", "operationId", purpose, "providerId", "modelId", "upstreamModelId",
      coalesce(metadata, '{}'), status, "createdAt", "completedAt", collected, expires, allowed and expires > clock_timestamp(), epoch,
      case when allowed and expires > clock_timestamp() then "requestPayload" end,
      case when allowed and expires > clock_timestamp() then "responsePayload" end
      from resolved where owner is not null and "createdAt" > now() - interval '90 days'
    on conflict (id) do update set metadata = provider_diagnostics.metadata || excluded.metadata,
      status = excluded.status, completed_at = excluded.completed_at, updated_at = now(),
      capture_detailed_payloads = provider_diagnostics.capture_detailed_payloads and excluded.capture_detailed_payloads and provider_diagnostics.payload_expires_at > clock_timestamp(),
      request_payload = case when provider_diagnostics.capture_detailed_payloads and excluded.capture_detailed_payloads and provider_diagnostics.payload_expires_at > clock_timestamp() then coalesce(excluded.request_payload, provider_diagnostics.request_payload) end,
      response_payload = case when provider_diagnostics.capture_detailed_payloads and excluded.capture_detailed_payloads and provider_diagnostics.payload_expires_at > clock_timestamp() then coalesce(excluded.response_payload, provider_diagnostics.response_payload) end,
      payload_expires_at = least(provider_diagnostics.payload_expires_at, excluded.payload_expires_at)
    returning model_call_id, metadata)
    update generation_attempts a set first_token_ms = (s.metadata->>'firstTokenMs')::int from saved s
      where a.id = s.model_call_id and a.first_token_ms is null and jsonb_typeof(s.metadata->'firstTokenMs') = 'number'
  `)
}
function enqueue(row: DiagnosticRecord): void {
  writer.enqueue(row.id, { ...row, observation: undefined,
    requestPayload: row.requestPayload ? JSON.stringify(row.requestPayload) : undefined,
    responsePayload: row.responsePayload ? JSON.stringify(row.responsePayload) : undefined })
}
export function beginDiagnostic(context: DiagnosticContext): DiagnosticRecord | undefined {
  return observeDiagnostic(() => {
    if (Date.now() - refreshedAt > 5000) void refreshDiagnosticPolicy()
    // A stale/unavailable cache fails closed for bodies. Metadata remains best effort.
    const row: DiagnosticRecord = { ...context, id: newId(), capture: policy.enabled && Date.now() - refreshedAt < 30_000,
      epoch: Number(policy.epoch), createdAt: new Date().toISOString(), status: 'in_progress' }
    return row
  })
}
export function updateDiagnostic(row: DiagnosticRecord, metadata: Record<string, unknown>, status?: string): void {
  observeDiagnostic(() => { row.metadata = { ...row.metadata, ...metadata }; if (status) { row.status = status; row.completedAt = new Date().toISOString() }; if (status || !row.queuedStart) { row.queuedStart = true; enqueue(row) } })
}
export function writeDiagnosticPayload(row: DiagnosticRecord, side: 'requestPayload' | 'responsePayload', payload: DiagnosticPayload): void {
  observeDiagnostic(() => { if (row.capture) row[side] = payload })
}
export function recordReconstructedDiagnostic(context: DiagnosticContext, request: unknown, response: unknown, metadata: Record<string, unknown>, status: string): void {
  observeDiagnostic(() => {
    const row = beginDiagnostic(context)
    if (!row) return
    if (row.capture) { writeDiagnosticPayload(row, 'requestPayload', diagnosticPayload(request, 'reconstructed')); writeDiagnosticPayload(row, 'responsePayload', diagnosticPayload(response, 'reconstructed')) }
    updateDiagnostic(row, metadata, status)
  })
}
export function flushDiagnostics(): Promise<void> { return writer.flush() }
export async function closeDiagnostics(): Promise<void> { await writer.close(); await diagnosticClient.end({ timeout: 1 }).catch(() => undefined) }
export function diagnosticFailure(error: unknown) {
  const e = error as { code?: unknown; name?: unknown; message?: unknown }
  return { failureStage: 'transport', errorCode: safeDiagnosticText(e?.code), errorMessage: safeDiagnosticText(e?.message ?? 'Provider request failed') }
}
