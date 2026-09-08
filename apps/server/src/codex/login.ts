import { InMemoryCredentialStore, type AuthEvent, type AuthPrompt, type Credential } from '@earendil-works/pi-ai'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { codexLoginAttempts, userProviderCredentials } from '../database/schema.js'
import type { CodexLoginJob } from '../jobs.js'
import { CODEX_PI_PROVIDER_ID } from './constants.js'
import { codexPlanType, createCodexModels, isSupportedCodexPlan } from './credential-store.js'
import { codexEnabled, lockCodexPolicy } from './policy.js'
import { getConfig } from '../config.js'
import { encryptSecret } from '../lib/crypto.js'

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired'])

export async function processCodexLogin(data: CodexLoginJob): Promise<void> {
  const [attempt] = await db.select().from(codexLoginAttempts).where(eq(codexLoginAttempts.id, data.attemptId)).limit(1)
  if (!attempt || TERMINAL.has(attempt.status)) return
  if (!await codexEnabled()) {
    await db.update(codexLoginAttempts).set({ status: 'cancelled', error: null, updatedAt: new Date() })
      .where(and(eq(codexLoginAttempts.id, data.attemptId), inArray(codexLoginAttempts.status, ['queued', 'waiting'])))
    return
  }
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

  const models = createCodexModels(attempt.userId, new InMemoryCredentialStore())
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
    await completeCodexLogin(data.attemptId, credential)
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

// Pi stores login results in memory. Only this transaction may persist them, so
// disabling or cancelling sign-in cannot overwrite a previously connected account.
export async function completeCodexLogin(attemptId: string, credential: Credential): Promise<void> {
  await db.transaction(async (tx) => {
    await lockCodexPolicy(tx)
    const [attempt] = await tx.select().from(codexLoginAttempts)
      .where(eq(codexLoginAttempts.id, attemptId)).for('update').limit(1)
    if (!attempt || TERMINAL.has(attempt.status)) return
    const now = new Date()
    const enabled = await codexEnabled(tx)
    const expired = Boolean(attempt.expiresAt && attempt.expiresAt <= now)
    const planType = codexPlanType(credential)
    if (!enabled || expired || !isSupportedCodexPlan(planType)) {
      await tx.update(codexLoginAttempts).set({
        status: !enabled ? 'cancelled' : expired ? 'expired' : 'failed',
        error: !enabled ? null : expired ? 'The device code expired. Start a new connection attempt.'
          : 'This Codex connection requires a ChatGPT Plus or Pro plan.',
        updatedAt: now,
      }).where(eq(codexLoginAttempts.id, attemptId))
      return
    }
    // Serialize against refresh/disconnect without holding this lock during OAuth.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`provider-credential:${attempt.userId}:${CODEX_PI_PROVIDER_ID}`}))`)
    const encryptedCredential = encryptSecret(JSON.stringify(credential), getConfig().ENCRYPTION_KEY)
    await tx.insert(userProviderCredentials).values({
      userId: attempt.userId, providerId: CODEX_PI_PROVIDER_ID, encryptedCredential,
      planType, status: 'connected', lastError: null, connectedAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [userProviderCredentials.userId, userProviderCredentials.providerId],
      set: { encryptedCredential, planType, status: 'connected', lastError: null, updatedAt: now },
    })
    await tx.update(codexLoginAttempts).set({ status: 'completed', error: null, updatedAt: now })
      .where(eq(codexLoginAttempts.id, attemptId))
  })
}
