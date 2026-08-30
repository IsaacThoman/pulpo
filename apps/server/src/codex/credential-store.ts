import { createModels, type Credential, type CredentialInfo, type CredentialStore, type MutableModels } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { and, eq, sql } from 'drizzle-orm'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { userProviderCredentials } from '../database/schema.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { CODEX_PI_PROVIDER_ID } from './constants.js'

const SUPPORTED_PLANS = new Set(['plus', 'pro'])

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function parseCredential(value: string): Credential {
  const parsed: unknown = JSON.parse(decryptSecret(value, getConfig().ENCRYPTION_KEY))
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) throw new Error('Invalid stored provider credential')
  return parsed as Credential
}

function encodeCredential(value: Credential): string {
  return encryptSecret(JSON.stringify(value), getConfig().ENCRYPTION_KEY)
}

export function codexPlanType(credential: Credential): string {
  if (credential.type !== 'oauth' || typeof credential.access !== 'string') return 'unknown'
  try {
    const payload = credential.access.split('.')[1]
    if (!payload) return 'unknown'
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const value = claims['https://api.openai.com/auth.chatgpt_plan_type']
    return typeof value === 'string' && value.trim() ? value.toLowerCase() : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function isSupportedCodexPlan(planType: string): boolean {
  return planType === 'unknown' || SUPPORTED_PLANS.has(planType)
}

export function safeCodexErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (codexErrorRequiresReauthentication(error)) return 'Codex authentication failed. Reconnect in Settings.'
  if (/rate.?limit|429|usage.?limit/i.test(message)) return 'Your Codex subscription limit has been reached. Try again later.'
  return 'Codex generation failed. Try again.'
}

export function codexErrorRequiresReauthentication(error: unknown): boolean {
  return /auth|token|unauthorized|401/i.test(error instanceof Error ? error.message : String(error))
}

export function redactedCodexError(error: unknown): Error {
  return new Error(safeCodexErrorMessage(error))
}

export class UserCredentialStore implements CredentialStore {
  constructor(readonly userId: string) {}

  async read(providerId: string, options?: { signal?: AbortSignal }): Promise<Credential | undefined> {
    assertNotAborted(options?.signal)
    const [row] = await db.select({ encryptedCredential: userProviderCredentials.encryptedCredential })
      .from(userProviderCredentials)
      .where(and(eq(userProviderCredentials.userId, this.userId), eq(userProviderCredentials.providerId, providerId)))
      .limit(1)
    assertNotAborted(options?.signal)
    return row ? parseCredential(row.encryptedCredential) : undefined
  }

  async list(options?: { signal?: AbortSignal }): Promise<readonly CredentialInfo[]> {
    assertNotAborted(options?.signal)
    const rows = await db.select({ providerId: userProviderCredentials.providerId, encryptedCredential: userProviderCredentials.encryptedCredential })
      .from(userProviderCredentials).where(eq(userProviderCredentials.userId, this.userId))
    assertNotAborted(options?.signal)
    return rows.map((row) => ({ providerId: row.providerId, type: parseCredential(row.encryptedCredential).type }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined> {
    assertNotAborted(options?.signal)
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`provider-credential:${this.userId}:${providerId}`}))`)
      assertNotAborted(options?.signal)
      const [row] = await tx.select({ encryptedCredential: userProviderCredentials.encryptedCredential })
        .from(userProviderCredentials)
        .where(and(eq(userProviderCredentials.userId, this.userId), eq(userProviderCredentials.providerId, providerId)))
        .limit(1)
      const current = row ? parseCredential(row.encryptedCredential) : undefined
      const next = await fn(current)
      assertNotAborted(options?.signal)
      if (!next) return current
      const now = new Date()
      const planType = codexPlanType(next)
      await tx.insert(userProviderCredentials).values({
        userId: this.userId, providerId, encryptedCredential: encodeCredential(next), status: 'connected',
        planType, lastError: null, connectedAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userProviderCredentials.userId, userProviderCredentials.providerId],
        set: { encryptedCredential: encodeCredential(next), status: 'connected', planType, lastError: null, updatedAt: now },
      })
      return next
    })
  }

  async delete(providerId: string, options?: { signal?: AbortSignal }): Promise<void> {
    assertNotAborted(options?.signal)
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`provider-credential:${this.userId}:${providerId}`}))`)
      assertNotAborted(options?.signal)
      await tx.delete(userProviderCredentials).where(and(
        eq(userProviderCredentials.userId, this.userId), eq(userProviderCredentials.providerId, providerId),
      ))
    })
  }

  async deleteIfMatches(providerId: string, expected: Credential): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`provider-credential:${this.userId}:${providerId}`}))`)
      const [row] = await tx.select({ encryptedCredential: userProviderCredentials.encryptedCredential })
        .from(userProviderCredentials)
        .where(and(eq(userProviderCredentials.userId, this.userId), eq(userProviderCredentials.providerId, providerId)))
        .limit(1)
      if (!row || JSON.stringify(parseCredential(row.encryptedCredential)) !== JSON.stringify(expected)) return
      await tx.delete(userProviderCredentials).where(and(
        eq(userProviderCredentials.userId, this.userId), eq(userProviderCredentials.providerId, providerId),
      ))
    })
  }
}

export function createCodexModels(userId: string): MutableModels {
  const result = createModels({ credentials: new UserCredentialStore(userId) })
  result.setProvider(openaiCodexProvider())
  return result
}

export async function markCodexReauthenticationRequired(userId: string, error: string): Promise<void> {
  await db.update(userProviderCredentials).set({ status: 'reauthentication_required', lastError: error, updatedAt: new Date() })
    .where(and(eq(userProviderCredentials.userId, userId), eq(userProviderCredentials.providerId, CODEX_PI_PROVIDER_ID)))
}
