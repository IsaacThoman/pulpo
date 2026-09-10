import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { generationAttempts, ocrAttempts, requestLogs } from '../database/schema.js'
import { notFound } from '../lib/errors.js'
import { detailedPayloadCaptureIsActive } from '../logging/detailed-payload-retention.js'

export function registerAdminUsagePayloadRoutes(app: FastifyInstance): void {
  app.get('/api/admin/usage/requests/:id/payloads', async (request, reply) => {
    requireAdmin(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    reply.header('Cache-Control', 'no-store')
    return db.transaction(async (tx) => {
      const [call] = await tx.select({ id: generationAttempts.id, requestLogId: generationAttempts.requestLogId })
        .from(generationAttempts).where(eq(generationAttempts.id, id)).limit(1)
      // Bodies belong to the parent request and can contain multiple agent turns/retries.
      const [log] = await tx.select({
        id: requestLogs.id,
        responseId: requestLogs.responseId,
        createdAt: requestLogs.createdAt,
        captureDetailedPayloads: requestLogs.captureDetailedPayloads,
        payloadExpiresAt: requestLogs.payloadExpiresAt,
        requestPayload: requestLogs.requestPayload,
        responsePayload: requestLogs.responsePayload,
      }).from(requestLogs).where(eq(requestLogs.id, call?.requestLogId ?? id)).for('share').limit(1)
      if (!log) throw notFound('Request log')
      const ocr = await tx.select().from(ocrAttempts).where(eq(ocrAttempts.requestLogId, log.id)).orderBy(asc(ocrAttempts.createdAt))
      // Check after fetching OCR so crossing a deadline during the read cannot expose bodies.
      const now = new Date()
      const captureActive = detailedPayloadCaptureIsActive(log, now)
      const available = captureActive && (log.requestPayload != null || log.responsePayload != null
        || ocr.some((attempt) => attempt.requestPayload != null || attempt.responsePayload != null))
      return {
        scope: 'request',
        modelCallId: call?.id ?? null,
        requestLogId: log.id,
        responseId: log.responseId,
        createdAt: log.createdAt.toISOString(),
        payloadExpiresAt: log.payloadExpiresAt?.toISOString() ?? null,
        captureActive,
        available,
        unavailableReason: available ? null
          : log.payloadExpiresAt !== null && log.payloadExpiresAt <= now ? 'expired'
            : captureActive ? 'not_yet_captured' : 'not_captured_or_cleared',
        requestPayload: captureActive ? log.requestPayload : null,
        responsePayload: captureActive ? log.responsePayload : null,
        ocrAttempts: ocr.map((attempt) => ({ ...attempt,
          requestPayload: captureActive ? attempt.requestPayload : null,
          responsePayload: captureActive ? attempt.responsePayload : null,
        })),
      }
    })
  })
}
