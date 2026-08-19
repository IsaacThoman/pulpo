import { eq } from 'drizzle-orm'
import { db } from '../database/client.js'
import { passwordCredentials } from '../database/schema.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { verifyPassword } from './service.js'
import { hasTwoFactor, verifySecondFactor } from './two-factor.js'

export async function requireSensitiveAuth(
  userId: string,
  currentPassword: string,
  verificationCode?: string,
): Promise<void> {
  const [credential] = await db.select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials).where(eq(passwordCredentials.userId, userId)).limit(1)
  if (!credential || !(await verifyPassword(credential.passwordHash, currentPassword))) {
    throw unauthorized('Current password is incorrect')
  }
  if (!(await hasTwoFactor(userId))) return
  if (!verificationCode) {
    throw new AppError(400, 'two_factor_code_required', 'Enter your current authenticator or recovery code.')
  }
  await verifySecondFactor(userId, verificationCode)
}

export async function requireSecretRevealAuth(
  userId: string,
  currentPassword?: string,
  verificationCode?: string,
): Promise<void> {
  if (await hasTwoFactor(userId)) {
    if (!verificationCode) {
      throw new AppError(400, 'two_factor_code_required', 'Enter your current authenticator or recovery code.')
    }
    await verifySecondFactor(userId, verificationCode)
    return
  }
  if (!currentPassword) throw unauthorized('Current password is required')
  const [credential] = await db.select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials).where(eq(passwordCredentials.userId, userId)).limit(1)
  if (!credential || !(await verifyPassword(credential.passwordHash, currentPassword))) {
    throw unauthorized('Current password is incorrect')
  }
}
