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

export function activeDetailedPayloadCondition(requestLogId: string, now = new Date()): SQL {
  return and(
    eq(requestLogs.id, requestLogId),
    eq(requestLogs.captureDetailedPayloads, true),
    or(isNull(requestLogs.payloadExpiresAt), gt(requestLogs.payloadExpiresAt, now)),
  )!
}

type ExecuteSql = (query: SQL) => Promise<unknown>

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
          updated_at = ${now}
      where capture_detailed_payloads = true
         or request_payload is not null
         or response_payload is not null
    `)
    await execute(sql`
      update ocr_attempts
      set request_payload = null,
          response_payload = null,
          updated_at = ${now}
      where request_payload is not null or response_payload is not null
    `)
    return
  }

  if (logging.payloadRetention === 'indefinite') {
    await execute(sql`
      update request_logs
      set payload_expires_at = null,
          updated_at = ${now}
      where capture_detailed_payloads = true
        and payload_expires_at is not null
    `)
    return
  }

  const durationSeconds = retentionMs[logging.payloadRetention] / 1_000
  await execute(sql`
    update request_logs
    set payload_expires_at = created_at + make_interval(secs => ${durationSeconds}),
        updated_at = ${now}
    where capture_detailed_payloads = true
  `)
  await execute(sql`
    update request_logs
    set capture_detailed_payloads = false,
        request_payload = null,
        response_payload = null,
        updated_at = ${now}
    where capture_detailed_payloads = true
      and payload_expires_at <= ${now}
  `)
  await execute(sql`
    update ocr_attempts as ocr
    set request_payload = null,
        response_payload = null,
        updated_at = ${now}
    from request_logs as log
    where ocr.request_log_id = log.id
      and log.capture_detailed_payloads = false
      and (ocr.request_payload is not null or ocr.response_payload is not null)
  `)
}
