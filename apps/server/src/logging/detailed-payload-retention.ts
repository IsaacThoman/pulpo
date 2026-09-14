import { and, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm'
import { requestLogs } from '../database/schema.js'

export type DetailedPayloadRetention = '1h' | '24h' | '7d' | '30d' | '90d' | 'indefinite'

export interface DetailedPayloadLoggingSettings {
  logDetailedPayloads: boolean
  payloadRetention: DetailedPayloadRetention
}

export interface DetailedPayloadPolicy {
  captureDetailedPayloads: boolean
  payloadExpiresAt: Date | null
}

const retentionMs: Record<Exclude<DetailedPayloadRetention, 'indefinite'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
  '90d': 7_776_000_000,
}

export function detailedPayloadPolicy(
  logging: DetailedPayloadLoggingSettings,
  createdAt = new Date(),
): DetailedPayloadPolicy {
  if (!logging.logDetailedPayloads) return { captureDetailedPayloads: false, payloadExpiresAt: null }
  if (logging.payloadRetention === 'indefinite') return { captureDetailedPayloads: true, payloadExpiresAt: null }
  return {
    captureDetailedPayloads: true,
    payloadExpiresAt: new Date(createdAt.getTime() + retentionMs[logging.payloadRetention]),
  }
}

export function detailedPayloadCaptureIsActive(
  policy: DetailedPayloadPolicy,
  now = new Date(),
): boolean {
  return policy.captureDetailedPayloads
    && (policy.payloadExpiresAt === null || policy.payloadExpiresAt.getTime() > now.getTime())
}

export function activeDetailedPayloadCondition(requestLogId: string, now: Date | SQL = sql`clock_timestamp()`): SQL {
  return and(
    eq(requestLogs.id, requestLogId),
    eq(requestLogs.captureDetailedPayloads, true),
    or(isNull(requestLogs.payloadExpiresAt), gt(requestLogs.payloadExpiresAt, now)),
  )!
}

type ExecuteSql = (query: SQL) => Promise<unknown>

export const PAYLOAD_CLEANUP_BATCH_SIZE = 500

/** Bounded maintenance statements; never acquire the global settings lock. */
export async function purgeExpiredDetailedPayloads(execute: ExecuteSql, now = new Date(), includeProviders = true): Promise<{ clearedRecords: number; deletedRecords: number }> {
  const requests = await execute(sql`
    update request_logs set capture_detailed_payloads = false, request_payload = null, response_payload = null, updated_at = ${now.toISOString()}
    where id in (select id from request_logs where (payload_expires_at <= ${now.toISOString()} or capture_detailed_payloads = false)
      and (capture_detailed_payloads or request_payload is not null or response_payload is not null)
      order by payload_expires_at, id limit ${PAYLOAD_CLEANUP_BATCH_SIZE} for update skip locked)
    returning id
  `)
  const ocr = await execute(sql`
    update ocr_attempts set request_payload = null, response_payload = null, updated_at = ${now.toISOString()}
    where id in (select o.id from ocr_attempts o join request_logs log on log.id = o.request_log_id
      where (not log.capture_detailed_payloads or log.payload_expires_at <= ${now.toISOString()})
      and (o.request_payload is not null or o.response_payload is not null)
      limit ${PAYLOAD_CLEANUP_BATCH_SIZE} for update of o skip locked)
    returning id
  `)
  const diagnostics = includeProviders ? await execute(sql`
    update provider_diagnostics set capture_detailed_payloads = false, request_payload = null, response_payload = null, updated_at = ${now.toISOString()}
    where id in (select d.id from provider_diagnostics d cross join diagnostic_policy p
      where (d.request_payload is not null or d.response_payload is not null)
      and (not p.enabled or not d.capture_detailed_payloads or d.payload_epoch <> p.epoch or d.retention_started_at <= p.expired_before
        or least(d.payload_expires_at, d.retention_started_at + make_interval(secs => p.retention_seconds), d.created_at + interval '90 days') <= ${now.toISOString()})
      limit ${PAYLOAD_CLEANUP_BATCH_SIZE} for update of d skip locked)
    returning id
  `) : []
  const deleted = includeProviders ? await execute(sql`delete from provider_diagnostics where id in (
    select id from provider_diagnostics where created_at <= ${now.toISOString()}::timestamptz - interval '90 days'
    order by created_at limit ${PAYLOAD_CLEANUP_BATCH_SIZE} for update skip locked) returning id`) : []
  return { clearedRecords: [requests, ocr, diagnostics].reduce<number>((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0),
    deletedRecords: Array.isArray(deleted) ? deleted.length : 0 }
}

/** Only this small row is shared with the background writer, never the global advisory lock. */
async function synchronizeDiagnosticPolicy(execute: ExecuteSql, logging: DetailedPayloadLoggingSettings) {
  const seconds = logging.payloadRetention === 'indefinite' ? null : retentionMs[logging.payloadRetention] / 1000
  await execute(sql`update diagnostic_policy set enabled = ${logging.logDetailedPayloads}, retention_seconds = ${seconds},
    epoch = epoch + ${logging.logDetailedPayloads ? 0 : 1},
    expired_before = greatest(expired_before, case when enabled then clock_timestamp() - make_interval(secs => retention_seconds) end,
      case when ${logging.logDetailedPayloads} then clock_timestamp() - make_interval(secs => ${seconds}) end) where id = 1`)
}

/**
 * Applies the current retention policy to payloads that are still retained.
 * Deadlines are based on collection time, so shortening retention immediately
 * expires data older than the new limit. Cleared payloads are never restored.
 */
export async function reconcileDetailedPayloadRetention(
  execute: ExecuteSql,
  logging: DetailedPayloadLoggingSettings,
  now = new Date(),
): Promise<void> {
  if (!logging.logDetailedPayloads) {
    await execute(sql`
      update request_logs
      set capture_detailed_payloads = false,
          request_payload = null,
          response_payload = null,
          payload_expires_at = null,
          updated_at = ${now.toISOString()}
      where capture_detailed_payloads = true
         or request_payload is not null
         or response_payload is not null
    `)
    await execute(sql`
      update ocr_attempts
      set request_payload = null,
          response_payload = null,
          updated_at = ${now.toISOString()}
      where request_payload is not null or response_payload is not null
    `)
    await purgeExpiredDetailedPayloads(execute, now, false)
    await synchronizeDiagnosticPolicy(execute, logging)
    return
  }

  // Expiry is irreversible, including between scheduled cleanup runs.
  await purgeExpiredDetailedPayloads(execute, now, false)

  if (logging.payloadRetention === 'indefinite') {
    await execute(sql`
      update request_logs
      set payload_expires_at = null,
          updated_at = ${now.toISOString()}
      where capture_detailed_payloads = true
        and payload_expires_at > ${now.toISOString()}
    `)
    await synchronizeDiagnosticPolicy(execute, logging)
    return
  }

  const durationSeconds = retentionMs[logging.payloadRetention] / 1_000
  await execute(sql`
    update request_logs
    set payload_expires_at = created_at + make_interval(secs => ${durationSeconds}),
        updated_at = ${now.toISOString()}
    where capture_detailed_payloads = true and (payload_expires_at is null or payload_expires_at > ${now.toISOString()})
  `)
  await synchronizeDiagnosticPolicy(execute, logging)
  await purgeExpiredDetailedPayloads(execute, now, false)
}
