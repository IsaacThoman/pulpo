import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../database/client.js'
import { codexLoginAttempts, userProviderCredentials } from '../database/schema.js'
import type { CodexLoginJob } from '../jobs.js'
import { CODEX_PI_PROVIDER_ID } from './constants.js'
import { codexPlanType, createCodexModels, isSupportedCodexPlan, UserCredentialStore } from './credential-store.js'

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired'])

export async function processCodexLogin(data: CodexLoginJob): Promise<void> {
  const [attempt] = await db.select().from(codexLoginAttempts).where(eq(codexLoginAttempts.id, data.attemptId)).limit(1)
  if (!attempt || TERMINAL.has(attempt.status)) return
  const controller = new AbortController()
  let expired = false
  let deviceCodePersistenceFailed = false
  let deviceCodePersistence: Promise<void> | undefined
  const cancellationPoll = setInterval(() => {
    void db.select({ status: codexLoginAttempts.status, expiresAt: codexLoginAttempts.expiresAt })
      .from(codexLoginAttempts).where(eq(codexLoginAttempts.id, data.attemptId)).limit(1)
      .then(([current]) => {
        expired = Boolean(current?.expiresAt && current.expiresAt <= new Date())
        if (!current || current.status === 'cancelled' || expired) controller.abort()
      }).catch(() => undefined)
  }, 1_000)
  cancellationPoll.unref()

  const models = createCodexModels(attempt.userId)
  try {
    const credential = await models.login(CODEX_PI_PROVIDER_ID, 'oauth', {
      signal: controller.signal,
      prompt: async (prompt: AuthPrompt) => {
        if (prompt.type === 'select' && prompt.options.some((option) => option.id === 'device_code')) return 'device_code'
        throw new Error('Codex device login requested unsupported input')
      },
      notify: (event: AuthEvent) => {
        if (event.type !== 'device_code') return
        const expiresAt = new Date(Date.now() + (event.expiresInSeconds ?? 900) * 1_000)
        deviceCodePersistence = (async () => {
          const [updated] = await db.update(codexLoginAttempts).set({
            status: 'waiting', userCode: event.userCode, verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds ?? 5, expiresAt, updatedAt: new Date(),
          }).where(and(eq(codexLoginAttempts.id, data.attemptId), eq(codexLoginAttempts.status, 'queued')))
            .returning({ id: codexLoginAttempts.id })
          if (!updated) throw new Error('Codex login attempt is no longer queued')
        })().catch(() => {
          deviceCodePersistenceFailed = true
          controller.abort()
        })
      },
    })
    await deviceCodePersistence
    const [currentAttempt] = await db.select({ status: codexLoginAttempts.status, expiresAt: codexLoginAttempts.expiresAt })
      .from(codexLoginAttempts).where(eq(codexLoginAttempts.id, data.attemptId)).limit(1)
    if (!currentAttempt || currentAttempt.status === 'cancelled' || currentAttempt.expiresAt && currentAttempt.expiresAt <= new Date()) {
      await new UserCredentialStore(attempt.userId).deleteIfMatches(CODEX_PI_PROVIDER_ID, credential)
      if (currentAttempt?.status !== 'cancelled') await db.update(codexLoginAttempts).set({
        status: 'expired', error: 'The device code expired. Start a new connection attempt.', updatedAt: new Date(),
      }).where(eq(codexLoginAttempts.id, data.attemptId))
      return
    }
    const planType = codexPlanType(credential)
    if (!isSupportedCodexPlan(planType)) {
      await new UserCredentialStore(attempt.userId).deleteIfMatches(CODEX_PI_PROVIDER_ID, credential)
      await db.update(codexLoginAttempts).set({
        status: 'failed', error: 'This Codex connection requires a ChatGPT Plus or Pro plan.', updatedAt: new Date(),
      }).where(eq(codexLoginAttempts.id, data.attemptId))
      return
    }
    await db.update(userProviderCredentials).set({ planType, status: 'connected', lastError: null, updatedAt: new Date() })
      .where(and(eq(userProviderCredentials.userId, attempt.userId), eq(userProviderCredentials.providerId, CODEX_PI_PROVIDER_ID)))
    await db.update(codexLoginAttempts).set({ status: 'completed', error: null, updatedAt: new Date() })
      .where(and(eq(codexLoginAttempts.id, data.attemptId), inArray(codexLoginAttempts.status, ['queued', 'waiting'])))
  } catch {
    const aborted = controller.signal.aborted
    const [current] = await db.select({ status: codexLoginAttempts.status }).from(codexLoginAttempts)
      .where(eq(codexLoginAttempts.id, data.attemptId)).limit(1)
    await db.update(codexLoginAttempts).set({
      status: current?.status === 'cancelled' ? 'cancelled' : aborted && expired ? 'expired' : 'failed',
      error: current?.status === 'cancelled' ? null : deviceCodePersistenceFailed
        ? 'Codex sign-in could not be started. Try connecting again.'
        : aborted && expired
        ? 'The device code expired. Start a new connection attempt.'
        : 'Codex sign-in could not be completed. Try connecting again.',
      updatedAt: new Date(),
    }).where(eq(codexLoginAttempts.id, data.attemptId))
  } finally {
    clearInterval(cancellationPoll)
  }
}
