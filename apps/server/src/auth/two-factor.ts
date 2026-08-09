import { randomBytes } from 'node:crypto'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { db } from '../database/client.js'
import {
  twoFactorRecoveryCodes,
  userTotpCredentials,
  userTotpEnrollments,
} from '../database/schema.js'
import { getConfig } from '../config.js'
import { redis } from '../redis.js'
import { decryptSecret, encryptSecret, hashToken } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'

const TOTP_PERIOD_SECONDS = 30
const TOTP_WINDOW = 1
const ENROLLMENT_TTL_MS = 10 * 60 * 1_000
const FAILED_ATTEMPT_LIMIT = 10
const FAILED_ATTEMPT_TTL_SECONDS = 5 * 60
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type SecondFactorKind = 'totp' | 'recovery'

function totp(secret: string, issuer = 'Pulpo', label = 'Pulpo account'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
}

export function validateTotp(
  secret: string,
  token: string,
  lastUsedCounter = -1,
  timestamp = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(token)) return null
  const value = totp(secret)
  const delta = value.validate({ token, window: TOTP_WINDOW, timestamp })
  if (delta === null) return null
  const counter = Math.floor(timestamp / 1_000 / TOTP_PERIOD_SECONDS) + delta
  return counter > lastUsedCounter ? counter : null
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function recoveryCode(): string {
  const bytes = randomBytes(12)
  const raw = [...bytes].map((value) => RECOVERY_ALPHABET[value! & 31]!).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, recoveryCode)
}

function attemptKey(userId: string): string {
  return `pulpo:two-factor:failed:${userId}`
}

async function assertAttemptsAvailable(userId: string): Promise<void> {
  const attempts = Number(await redis.get(attemptKey(userId)) ?? 0)
  if (attempts >= FAILED_ATTEMPT_LIMIT) {
    throw new AppError(429, 'two_factor_rate_limited', 'Too many verification attempts. Try again in a few minutes.', 'rate_limit_error')
  }
}

async function failedAttempt(userId: string): Promise<never> {
  const key = attemptKey(userId)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, FAILED_ATTEMPT_TTL_SECONDS)
  throw new AppError(401, 'two_factor_code_invalid', 'The authenticator or recovery code is invalid.', 'authentication_error')
}

export async function hasTwoFactor(userId: string): Promise<boolean> {
  const [credential] = await db.select({ userId: userTotpCredentials.userId })
    .from(userTotpCredentials).where(eq(userTotpCredentials.userId, userId)).limit(1)
  return Boolean(credential)
}

export async function verifySecondFactor(userId: string, rawCode: string): Promise<SecondFactorKind> {
  await assertAttemptsAvailable(userId)
  const code = rawCode.trim()
  if (/^\d{6}$/.test(code)) {
    const [credential] = await db.select().from(userTotpCredentials)
      .where(eq(userTotpCredentials.userId, userId)).limit(1)
    if (credential) {
      const secret = decryptSecret(credential.encryptedSecret, getConfig().ENCRYPTION_KEY)
      const counter = validateTotp(secret, code, credential.lastUsedCounter)
      if (counter !== null) {
        const [updated] = await db.update(userTotpCredentials).set({
          lastUsedCounter: counter,
          updatedAt: new Date(),
        }).where(and(
          eq(userTotpCredentials.userId, userId),
          lt(userTotpCredentials.lastUsedCounter, counter),
        )).returning({ userId: userTotpCredentials.userId })
        if (updated) {
          await redis.del(attemptKey(userId))
          return 'totp'
        }
      }
    }
    return failedAttempt(userId)
  }

  const normalized = normalizeRecoveryCode(code)
  if (/^[A-HJ-NP-Z2-9]{12}$/.test(normalized)) {
    const [used] = await db.update(twoFactorRecoveryCodes).set({ usedAt: new Date() }).where(and(
      eq(twoFactorRecoveryCodes.userId, userId),
      eq(twoFactorRecoveryCodes.codeHash, hashToken(normalized)),
      isNull(twoFactorRecoveryCodes.usedAt),
    )).returning({ id: twoFactorRecoveryCodes.id })
    if (used) {
      await redis.del(attemptKey(userId))
      return 'recovery'
    }
  }
  return failedAttempt(userId)
}

export async function requireLoginSecondFactor(userId: string, code: string | undefined): Promise<SecondFactorKind | null> {
  if (!(await hasTwoFactor(userId))) return null
  if (!code) {
    throw new AppError(401, 'two_factor_required', 'Enter your authenticator or recovery code.', 'authentication_error')
  }
  return verifySecondFactor(userId, code)
}

export async function twoFactorStatus(userId: string): Promise<{ enabled: boolean; recoveryCodesRemaining: number }> {
  const [[credential], [recovery]] = await Promise.all([
    db.select({ userId: userTotpCredentials.userId }).from(userTotpCredentials)
      .where(eq(userTotpCredentials.userId, userId)).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(twoFactorRecoveryCodes)
      .where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt))),
  ])
  return { enabled: Boolean(credential), recoveryCodesRemaining: recovery?.count ?? 0 }
}

export async function beginTwoFactorEnrollment(user: { id: string; email: string }): Promise<{
  manualKey: string
  otpauthUri: string
  qrCodeDataUrl: string
  expiresAt: string
}> {
  const secret = new OTPAuth.Secret({ size: 20 }).base32
  const value = totp(secret, getConfig().INSTANCE_NAME, user.email)
  const otpauthUri = value.toString()
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS)
  const encryptedSecret = encryptSecret(secret, getConfig().ENCRYPTION_KEY)
  await db.insert(userTotpEnrollments).values({
    userId: user.id,
    encryptedSecret,
    expiresAt,
  }).onConflictDoUpdate({
    target: userTotpEnrollments.userId,
    set: {
      encryptedSecret,
      expiresAt,
      createdAt: new Date(),
    },
  })
  return {
    manualKey: secret,
    otpauthUri,
    qrCodeDataUrl: await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: 'M', margin: 1, width: 256 }),
    expiresAt: expiresAt.toISOString(),
  }
}

export async function confirmTwoFactorEnrollment(userId: string, code: string): Promise<string[]> {
  await assertAttemptsAvailable(userId)
  const [enrollment] = await db.select().from(userTotpEnrollments)
    .where(eq(userTotpEnrollments.userId, userId)).limit(1)
  if (!enrollment || enrollment.expiresAt <= new Date()) {
    if (enrollment) await db.delete(userTotpEnrollments).where(eq(userTotpEnrollments.userId, userId))
    throw new AppError(400, 'two_factor_enrollment_expired', 'Start two-factor setup again before confirming the code.')
  }
  const secret = decryptSecret(enrollment.encryptedSecret, getConfig().ENCRYPTION_KEY)
  const counter = validateTotp(secret, code)
  if (counter === null) return failedAttempt(userId)
  const recoveryCodes = generateRecoveryCodes()
  let claimRejected = false
  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx.delete(userTotpEnrollments).where(and(
        eq(userTotpEnrollments.userId, userId),
        eq(userTotpEnrollments.encryptedSecret, enrollment.encryptedSecret),
      )).returning({ userId: userTotpEnrollments.userId })
      if (!claimed) {
        claimRejected = true
        throw new Error('Pending two-factor enrollment was already confirmed')
      }
      await tx.insert(userTotpCredentials).values({
        userId,
        encryptedSecret: enrollment.encryptedSecret,
        lastUsedCounter: counter,
        enabledAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: userTotpCredentials.userId,
        set: {
          encryptedSecret: enrollment.encryptedSecret,
          lastUsedCounter: counter,
          enabledAt: new Date(),
          updatedAt: new Date(),
        },
      })
      await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId))
      await tx.insert(twoFactorRecoveryCodes).values(recoveryCodes.map((value) => ({
        id: newId(), userId, codeHash: hashToken(normalizeRecoveryCode(value)),
      })))
    })
  } catch (error) {
    if (claimRejected) return failedAttempt(userId)
    throw error
  }
  await redis.del(attemptKey(userId))
  return recoveryCodes
}

export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const recoveryCodes = generateRecoveryCodes()
  await db.transaction(async (tx) => {
    await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId))
    await tx.insert(twoFactorRecoveryCodes).values(recoveryCodes.map((value) => ({
      id: newId(), userId, codeHash: hashToken(normalizeRecoveryCode(value)),
    })))
  })
  return recoveryCodes
}

export async function clearTwoFactor(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userTotpEnrollments).where(eq(userTotpEnrollments.userId, userId))
    await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId))
    await tx.delete(userTotpCredentials).where(eq(userTotpCredentials.userId, userId))
  })
  await redis.del(attemptKey(userId))
}
