import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { applicationSettings, providerDiagnostics, requestLogs } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { parseLoggingSettings } from '../settings/application-settings.js'
import { detailedPayloadPolicy, detailedPayloadCaptureIsActive } from './detailed-payload-retention.js'
import { diagnosticPayload, safeDiagnosticText, type DiagnosticPayload } from './diagnostic-sanitizer.js'

export interface DiagnosticContext {
  userId?: string; requestLogId?: string; modelCallId?: string; operationId?: string
  purpose: string; providerId?: string; modelId?: string; upstreamModelId?: string
  observation?: { seen: boolean }
  metadata?: Record<string, unknown>
}
export const diagnosticContext = new AsyncLocalStorage<DiagnosticContext>()
export const withDiagnosticContext = <T>(context: DiagnosticContext, fn: () => T): T => diagnosticContext.run(context, fn)

export async function beginDiagnostic(context: DiagnosticContext) {
  return db.transaction(async tx => {
    // Shares the settings/cleanup lock, including when no logging settings row exists yet.
    await tx.execute(sql`select pg_advisory_xact_lock_shared(1886747744)`)
    const [log] = context.requestLogId ? await tx.select({ userId: requestLogs.userId, createdAt: requestLogs.createdAt, captureDetailedPayloads: requestLogs.captureDetailedPayloads, payloadExpiresAt: requestLogs.payloadExpiresAt }).from(requestLogs).where(eq(requestLogs.id, context.requestLogId)).limit(1) : []
    const userId = context.userId ?? log?.userId
    if (!userId) return null
    const [settings] = await tx.select({ value: applicationSettings.value }).from(applicationSettings).where(eq(applicationSettings.key, 'logging')).limit(1)
    const createdAt = new Date()
    const policy = log ? { captureDetailedPayloads: detailedPayloadCaptureIsActive(log), payloadExpiresAt: log.payloadExpiresAt }
      : detailedPayloadPolicy(parseLoggingSettings(settings?.value), createdAt)
    const id = newId()
    await tx.insert(providerDiagnostics).values({ id, userId, requestLogId: context.requestLogId, modelCallId: context.modelCallId,
      operationId: context.operationId, purpose: context.purpose, providerId: context.providerId, modelId: context.modelId,
      upstreamModelId: context.upstreamModelId, metadata: context.metadata ?? {}, ...policy, retentionStartedAt: log?.createdAt ?? createdAt, createdAt })
    return { id, capture: policy.captureDetailedPayloads }
  })
}

export async function updateDiagnostic(id: string, metadata: Record<string, unknown>, status?: string) {
  // Metadata must be operational only; transport callers whitelist its fields.
  await db.update(providerDiagnostics).set({ metadata: sql`${providerDiagnostics.metadata} || ${JSON.stringify(metadata)}::jsonb`,
    ...(status ? { status, completedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(providerDiagnostics.id, id))
  if (typeof metadata.firstTokenMs === 'number') await db.execute(sql`update generation_attempts a set first_token_ms = ${metadata.firstTokenMs} from provider_diagnostics d where d.id = ${id} and a.id = d.model_call_id and a.first_token_ms is null`)
}
export async function writeDiagnosticPayload(id: string, side: 'requestPayload' | 'responsePayload', payload: DiagnosticPayload) {
  await db.update(providerDiagnostics).set({ [side]: payload, updatedAt: new Date() }).where(and(eq(providerDiagnostics.id, id),
    eq(providerDiagnostics.captureDetailedPayloads, true), or(isNull(providerDiagnostics.payloadExpiresAt), gt(providerDiagnostics.payloadExpiresAt, sql`clock_timestamp()`))))
}

/** Reconstructed capture for transports (e.g. Codex) without an HTTP fetch hook. */
export async function recordReconstructedDiagnostic(context: DiagnosticContext, request: unknown, response: unknown, metadata: Record<string, unknown>, status: string) {
  const row = await beginDiagnostic(context)
  if (!row) return
  if (row.capture) {
    await writeDiagnosticPayload(row.id, 'requestPayload', diagnosticPayload(request, 'reconstructed'))
    await writeDiagnosticPayload(row.id, 'responsePayload', diagnosticPayload(response, 'reconstructed'))
  }
  await updateDiagnostic(row.id, metadata, status)
}

export function diagnosticFailure(error: unknown) {
  const e = error as { code?: unknown; name?: unknown; message?: unknown }
  return { failureStage: 'transport', errorCode: safeDiagnosticText(e?.code), errorMessage: safeDiagnosticText(e?.message ?? 'Provider request failed') }
}
