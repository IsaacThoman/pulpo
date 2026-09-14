import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { generationAttempts, providerDiagnostics, diagnosticPolicy } from '../database/schema.js'
import { notFound } from '../lib/errors.js'
import { diagnosticPayloadAvailability } from '../logging/diagnostic-policy.js'
import { retentionHealth } from '../logging/retention-health.js'

const metadataColumns = {
  id: providerDiagnostics.id, requestLogId: providerDiagnostics.requestLogId, userId: providerDiagnostics.userId,
  modelCallId: providerDiagnostics.modelCallId, operationId: providerDiagnostics.operationId,
  purpose: providerDiagnostics.purpose, providerId: providerDiagnostics.providerId, modelId: providerDiagnostics.modelId,
  upstreamModelId: providerDiagnostics.upstreamModelId, status: providerDiagnostics.status, metadata: providerDiagnostics.metadata,
  createdAt: providerDiagnostics.createdAt, completedAt: providerDiagnostics.completedAt, payloadExpiresAt: providerDiagnostics.payloadExpiresAt,
}
export function registerDiagnosticRoutes(app: FastifyInstance) {
  app.get('/api/admin/usage/diagnostics/retention', async (request, reply) => {
    requireAdmin(request); reply.header('Cache-Control', 'no-store')
    return retentionHealth()
  })
  app.get('/api/admin/usage/diagnostics', async (request, reply) => {
    requireAdmin(request); reply.header('Cache-Control', 'no-store')
    const q = z.object({ requestLogId: z.uuid().optional(), modelCallId: z.uuid().optional(), before: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query)
    const data = await db.select(metadataColumns).from(providerDiagnostics).where(and(q.requestLogId ? eq(providerDiagnostics.requestLogId, q.requestLogId) : undefined,
      q.modelCallId ? eq(providerDiagnostics.modelCallId, q.modelCallId) : undefined,
      q.before ? lt(providerDiagnostics.createdAt, new Date(q.before)) : undefined)).orderBy(desc(providerDiagnostics.createdAt)).limit(q.limit)
    return { data, nextCursor: data.length === q.limit ? data.at(-1)?.createdAt.toISOString() : null }
  })
  app.get('/api/admin/usage/requests/:id/diagnostics', async (request, reply) => {
    requireAdmin(request); reply.header('Cache-Control', 'no-store')
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const [call] = await db.select().from(generationAttempts).where(eq(generationAttempts.id, id)).limit(1)
    return { data: await db.select(metadataColumns).from(providerDiagnostics).where(eq(providerDiagnostics.requestLogId, call?.requestLogId ?? id)).orderBy(desc(providerDiagnostics.createdAt)).limit(100) }
  })
  app.get('/api/admin/usage/diagnostics/:id/payloads', async (request, reply) => {
    requireAdmin(request); reply.header('Cache-Control', 'no-store')
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    return db.transaction(async tx => {
      const [policy] = await tx.select().from(diagnosticPolicy).where(eq(diagnosticPolicy.id, 1)).for('share').limit(1)
      const [row] = await tx.select().from(providerDiagnostics).where(eq(providerDiagnostics.id, id)).for('share').limit(1)
      if (!row) throw notFound('Provider attempt')
      const { active, expiresAt } = diagnosticPayloadAvailability(row, policy)
      return { id, available: active && (row.requestPayload != null || row.responsePayload != null),
        payloadExpiresAt: expiresAt, unavailableReason: active ? null : expiresAt <= new Date() ? 'expired' : 'not_captured_or_cleared',
        requestPayload: active ? row.requestPayload : null, responsePayload: active ? row.responsePayload : null }
    })
  })
}
