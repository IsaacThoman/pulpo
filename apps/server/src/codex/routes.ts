import { and, eq, inArray, like } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { codexLoginAttempts, models, queuedMessages, responses, userPreferences, userProviderCredentials } from '../database/schema.js'
import { codexLoginQueue } from '../jobs.js'
import { newId } from '../lib/ids.js'
import { notFound } from '../lib/errors.js'
import { requestCancellation } from '../responses/events.js'
import { removeDeletedModelPreferences } from '../catalog/model-deletion.js'
import { CODEX_MODEL_PREFIX, CODEX_PI_PROVIDER_ID } from './constants.js'
import { UserCredentialStore } from './credential-store.js'

const activeAttemptStatuses = ['queued', 'waiting']

export async function registerCodexRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/account/providers/codex', async (request) => {
    const user = requireUser(request)
    const [credential] = await db.select({
      status: userProviderCredentials.status, planType: userProviderCredentials.planType,
      connectedAt: userProviderCredentials.connectedAt, lastError: userProviderCredentials.lastError,
    }).from(userProviderCredentials).where(and(
      eq(userProviderCredentials.userId, user.id), eq(userProviderCredentials.providerId, CODEX_PI_PROVIDER_ID),
    )).limit(1)
    const [attempt] = await db.select({ id: codexLoginAttempts.id, status: codexLoginAttempts.status })
      .from(codexLoginAttempts).where(and(
        eq(codexLoginAttempts.userId, user.id), inArray(codexLoginAttempts.status, activeAttemptStatuses),
      )).limit(1)
    return {
      connected: credential?.status === 'connected',
      reauthenticationRequired: credential?.status === 'reauthentication_required',
      planType: credential?.planType ?? null,
      connectedAt: credential?.connectedAt ?? null,
      error: credential?.lastError ?? null,
      activeAttemptId: attempt?.id ?? null,
    }
  })

  app.post('/api/account/providers/codex/login', async (request, reply) => {
    const user = requireUser(request)
    await db.update(codexLoginAttempts).set({ status: 'cancelled', updatedAt: new Date() }).where(and(
      eq(codexLoginAttempts.userId, user.id), inArray(codexLoginAttempts.status, activeAttemptStatuses),
    ))
    const attemptId = newId()
    await db.insert(codexLoginAttempts).values({ id: attemptId, userId: user.id, status: 'queued' })
    await codexLoginQueue.add('login', { attemptId }, { jobId: attemptId })
    reply.code(202)
    return { attemptId }
  })

  app.get('/api/account/providers/codex/login/:attemptId', async (request) => {
    const user = requireUser(request)
    const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params)
    let [attempt] = await db.select({
      id: codexLoginAttempts.id, status: codexLoginAttempts.status, userCode: codexLoginAttempts.userCode,
      verificationUri: codexLoginAttempts.verificationUri, intervalSeconds: codexLoginAttempts.intervalSeconds,
      expiresAt: codexLoginAttempts.expiresAt, error: codexLoginAttempts.error,
    }).from(codexLoginAttempts).where(and(eq(codexLoginAttempts.id, attemptId), eq(codexLoginAttempts.userId, user.id))).limit(1)
    if (!attempt) throw notFound('Codex login attempt')
    if (activeAttemptStatuses.includes(attempt.status) && attempt.expiresAt && attempt.expiresAt <= new Date()) {
      ;[attempt] = await db.update(codexLoginAttempts).set({
        status: 'expired', error: 'The device code expired. Start a new connection attempt.', updatedAt: new Date(),
      }).where(and(eq(codexLoginAttempts.id, attemptId), eq(codexLoginAttempts.userId, user.id)))
        .returning({
          id: codexLoginAttempts.id, status: codexLoginAttempts.status, userCode: codexLoginAttempts.userCode,
          verificationUri: codexLoginAttempts.verificationUri, intervalSeconds: codexLoginAttempts.intervalSeconds,
          expiresAt: codexLoginAttempts.expiresAt, error: codexLoginAttempts.error,
        })
    }
    return attempt
  })

  app.delete('/api/account/providers/codex/login/:attemptId', async (request, reply) => {
    const user = requireUser(request)
    const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params)
    const [attempt] = await db.update(codexLoginAttempts).set({ status: 'cancelled', error: null, updatedAt: new Date() })
      .where(and(eq(codexLoginAttempts.id, attemptId), eq(codexLoginAttempts.userId, user.id)))
      .returning({ id: codexLoginAttempts.id })
    if (!attempt) throw notFound('Codex login attempt')
    reply.code(204).send()
  })

  app.delete('/api/account/providers/codex', async (request, reply) => {
    const user = requireUser(request)
    const activeResponses = await db.select({ id: responses.id }).from(responses).where(and(
      eq(responses.userId, user.id), inArray(responses.status, ['queued', 'in_progress']), like(responses.modelId, `${CODEX_MODEL_PREFIX}%`),
    ))
    await Promise.all(activeResponses.map(({ id }) => requestCancellation(id)))
    await new UserCredentialStore(user.id).delete(CODEX_PI_PROVIDER_ID)
    await db.transaction(async (tx) => {
      const now = new Date()
      await tx.update(responses).set({ status: 'cancelled', completedAt: now, updatedAt: now }).where(and(
        eq(responses.userId, user.id), inArray(responses.status, ['queued', 'in_progress']), like(responses.modelId, `${CODEX_MODEL_PREFIX}%`),
      ))
      await tx.update(queuedMessages).set({ status: 'cancelled', error: 'Codex connection removed', updatedAt: now }).where(and(
        eq(queuedMessages.userId, user.id), inArray(queuedMessages.status, ['editing', 'pending', 'dispatching']),
        like(queuedMessages.modelId, `${CODEX_MODEL_PREFIX}%`),
      ))
      await tx.update(codexLoginAttempts).set({ status: 'cancelled', error: null, updatedAt: now }).where(and(
        eq(codexLoginAttempts.userId, user.id), inArray(codexLoginAttempts.status, activeAttemptStatuses),
      ))
      const [preferences] = await tx.select({ values: userPreferences.values }).from(userPreferences)
        .where(eq(userPreferences.userId, user.id)).limit(1)
      if (preferences) {
        let values = preferences.values
        let changed = false
        const modelIds = (await tx.select({ id: models.id }).from(models)
          .where(like(models.id, `${CODEX_MODEL_PREFIX}%`)))
          .map(({ id }) => id)
        for (const modelId of new Set(modelIds)) {
          const result = removeDeletedModelPreferences(values, modelId)
          values = result.value
          changed ||= result.changed
        }
        if (changed) await tx.update(userPreferences).set({ values, updatedAt: now }).where(eq(userPreferences.userId, user.id))
      }
    })
    reply.code(204).send()
  })
}
