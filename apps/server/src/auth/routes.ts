import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  beginTwoFactorEnrollmentInputSchema,
  beginBrowserPasskeyRegistrationInputSchema,
  beginPasskeyRegistrationInputSchema,
  browserPasskeyRegistrationTokenSchema,
  browserPasskeyRegistrationVerifySchema,
  changePasswordInputSchema,
  confirmTwoFactorEnrollmentInputSchema,
  loginInputSchema,
  passkeySensitiveChangeSchema,
  renamePasskeyInputSchema,
  setupInputSchema,
  signupInputSchema,
  updateProfileInputSchema,
  verifyPasskeyAuthenticationInputSchema,
  verifyPasskeyRegistrationInputSchema,
  verifyTwoFactorChangeInputSchema,
} from '@pulpo/contracts'
import { z } from 'zod'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, passwordCredentials, passwordResetTokens, sessions, users } from '../database/schema.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { sendPasswordReset } from '../lib/mail.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { insertNewAccountPreferences } from '../settings/new-account-defaults.js'
import { publishStateChange } from '../responses/events.js'
import {
  createPasswordHash,
  createSession,
  bearerSessionToken,
  destroySession,
  requireUser,
  revokeOtherSessions,
  serializeUser,
  verifyPassword,
} from './service.js'
import {
  beginBrowserPasskeyRegistration,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  browserRegistrationOptions,
  deletePasskey,
  finishBrowserPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
  recordDirectPasskeyAdd,
  recordDirectPasskeyDelete,
  renamePasskey,
  requirePasskeySensitiveAuth,
} from './passkeys.js'
import {
  beginTwoFactorEnrollment,
  clearTwoFactor,
  confirmTwoFactorEnrollment,
  hasTwoFactor,
  replaceRecoveryCodes,
  requireLoginSecondFactor,
  twoFactorStatus,
  verifySecondFactor,
} from './two-factor.js'

async function requireCurrentPassword(userId: string, password: string): Promise<void> {
  const [credential] = await db.select().from(passwordCredentials)
    .where(eq(passwordCredentials.userId, userId)).limit(1)
  if (!credential || !(await verifyPassword(credential.passwordHash, password))) {
    throw unauthorized('Current password is incorrect')
  }
}

async function recordTwoFactorChange(
  request: Parameters<typeof revokeOtherSessions>[0],
  userId: string,
  action: string,
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(), actorUserId: userId, action, targetType: 'user', targetId: userId,
  })
  await revokeOtherSessions(request, userId)
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/settings', async () => {
    const [setting] = await db.select({ value: applicationSettings.value })
      .from(applicationSettings)
      .where(eq(applicationSettings.key, 'auth'))
      .limit(1)
    const { signupEnabled, pendingDetails, adminEmail, pendingMessage, apiKeysEnabled, maxAttachmentBytes } = parseAuthSettings(setting?.value)
    return { signupEnabled, pendingDetails, adminEmail, pendingMessage, apiKeysEnabled, maxAttachmentBytes }
  })

  app.get('/api/auth/setup-status', async () => {
    const [existingUser] = await db.select({ id: users.id }).from(users).limit(1)
    return { required: !existingUser }
  })

  app.post('/api/auth/setup', async (request, reply) => {
    const input = setupInputSchema.parse(request.body)
    const userId = newId()
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747743)`)
      const [existingUser] = await tx.select({ id: users.id }).from(users).limit(1)
      if (existingUser) throw new AppError(409, 'setup_complete', 'Pulpo has already been set up')
      const [setting] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
        .where(eq(applicationSettings.key, 'auth')).limit(1)
      const authSettings = parseAuthSettings(setting?.value)
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        name: input.name,
        username: input.username,
        role: 'admin',
        balanceMicros: 100_000_000,
        storageLimitBytes: 5_000 * 1024 * 1024,
      })
      await tx.insert(passwordCredentials).values({ userId, passwordHash: await createPasswordHash(input.password) })
      await insertNewAccountPreferences(tx, userId, authSettings)
    })
    await createSession(userId, request, reply)
    const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    reply.code(201)
    return { user: serializeUser(created!) }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginInputSchema.parse(request.body)
    const [row] = await db
      .select({ user: users, credential: passwordCredentials })
      .from(users)
      .innerJoin(passwordCredentials, eq(users.id, passwordCredentials.userId))
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .limit(1)
    if (!row || row.user.blocked || !(await verifyPassword(row.credential.passwordHash, input.password))) {
      throw unauthorized('Invalid email or password')
    }
    await requireLoginSecondFactor(row.user.id, input.twoFactorCode)
    await createSession(row.user.id, request, reply)
    return { user: serializeUser(row.user) }
  })

  app.post('/api/auth/passkey/options', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    return beginPasskeyAuthentication({ flow: 'web-authentication' })
  })

  app.post('/api/auth/passkey/verify', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const input = verifyPasskeyAuthenticationInputSchema.parse(request.body)
    const { user } = await finishPasskeyAuthentication({
      ceremonyToken: input.ceremonyToken,
      response: input.response,
      flows: ['web-authentication'],
    })
    await createSession(user.id, request, reply)
    return { user: serializeUser(user) }
  })

  app.post('/api/auth/passkey/browser-registration/options', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { ceremonyToken } = browserPasskeyRegistrationTokenSchema.parse(request.body)
    reply.header('cache-control', 'no-store')
    return browserRegistrationOptions(ceremonyToken)
  })

  app.post('/api/auth/passkey/browser-registration/verify', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const input = browserPasskeyRegistrationVerifySchema.parse(request.body)
    reply.header('cache-control', 'no-store')
    return finishBrowserPasskeyRegistration(input.ceremonyToken, input.response)
  })

  app.post('/api/auth/signup', async (request, reply) => {
    const input = signupInputSchema.parse(request.body)
    const [setting] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'auth')).limit(1)
    const authSettings = parseAuthSettings(setting?.value)
    if (!authSettings.signupEnabled) throw new AppError(403, 'signup_disabled', 'New signups are disabled')
    const userId = newId()
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747743)`)
      const [existingUser] = await tx.select({ id: users.id }).from(users).limit(1)
      if (!existingUser) throw new AppError(409, 'setup_required', 'Create the initial administrator before accepting signups')
      const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${input.email})`).limit(1)
      if (existing) throw new AppError(409, 'email_taken', 'An account with this email already exists')
      const [existingUsername] = await tx.select({ id: users.id }).from(users)
        .where(sql`lower(${users.username}) = ${input.username}`).limit(1)
      if (existingUsername) throw new AppError(409, 'username_taken', 'That username is already taken', 'invalid_request_error', 'username')
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        name: input.name,
        username: input.username,
        role: authSettings.defaultSignupRole,
        balanceMicros: authSettings.defaultBalanceMicros,
        storageLimitBytes: authSettings.defaultStorageLimitBytes,
      })
      await tx.insert(passwordCredentials).values({ userId, passwordHash: await createPasswordHash(input.password) })
      await insertNewAccountPreferences(tx, userId, authSettings)
    })
    await createSession(userId, request, reply)
    const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    reply.code(201)
    return { user: serializeUser(created!) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(request, reply)
    reply.code(204).send()
  })

  app.post('/api/auth/forgot-password', async (request, reply) => {
    const { email } = z.object({ email: z.email() }).parse(request.body)
    const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${email})`).limit(1)
    if (user) {
      const token = randomToken(32)
      await db.insert(passwordResetTokens).values({
        id: newId(), userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      })
      await sendPasswordReset(email, token).catch(() => {
        request.log.error('Password reset email delivery failed')
      })
    }
    reply.code(202)
    return { accepted: true }
  })

  app.post('/api/auth/reset-password', async (request, reply) => {
    const input = z.object({ token: z.string().min(20), password: z.string().min(8).max(1_000) }).parse(request.body)
    const [reset] = await db.select().from(passwordResetTokens).where(and(
      eq(passwordResetTokens.tokenHash, hashToken(input.token)), isNull(passwordResetTokens.consumedAt), gt(passwordResetTokens.expiresAt, new Date()),
    )).limit(1)
    if (!reset) throw new AppError(400, 'reset_token_invalid', 'This password reset link is invalid or expired')
    await db.transaction(async (tx) => {
      await tx.update(passwordCredentials).set({ passwordHash: await createPasswordHash(input.password), changedAt: new Date() }).where(eq(passwordCredentials.userId, reset.userId))
      await tx.update(passwordResetTokens).set({ consumedAt: new Date() }).where(eq(passwordResetTokens.id, reset.id))
      await tx.delete(sessions).where(eq(sessions.userId, reset.userId))
    })
    reply.code(204).send()
  })

  app.get('/api/me', async (request) => ({ user: requireUser(request) }))

  app.patch('/api/me', async (request) => {
    const user = requireUser(request)
    const input = updateProfileInputSchema.parse(request.body)
    let updated: typeof users.$inferSelect | undefined
    try {
      ;[updated] = await db.update(users).set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.profileColor !== undefined ? { profileColor: input.profileColor?.toLowerCase() ?? null } : {}),
        stateRevision: sql`${users.stateRevision} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id)).returning()
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
        throw new AppError(409, 'username_taken', 'That username is already taken', 'invalid_request_error', 'username')
      }
      throw cause
    }
    if (!updated) throw unauthorized()
    await publishStateChange({ userId: user.id, revision: updated.stateRevision })
    return { user: serializeUser(updated) }
  })

  app.post('/api/me/password', async (request, reply) => {
    const user = requireUser(request)
    const input = changePasswordInputSchema.parse(request.body)
    const [credential] = await db.select().from(passwordCredentials)
      .where(eq(passwordCredentials.userId, user.id)).limit(1)
    if (!credential || !(await verifyPassword(credential.passwordHash, input.currentPassword))) {
      throw unauthorized('Current password is incorrect')
    }
    await db.update(passwordCredentials).set({
      passwordHash: await createPasswordHash(input.newPassword),
      changedAt: new Date(),
    }).where(eq(passwordCredentials.userId, user.id))
    reply.code(204).send()
  })

  app.get('/api/me/passkeys', async (request, reply) => {
    const user = requireUser(request)
    reply.header('cache-control', 'no-store')
    return listPasskeys(user.id)
  })

  app.post('/api/me/passkeys/registration/options', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    const input = beginPasskeyRegistrationInputSchema.parse(request.body)
    await requirePasskeySensitiveAuth(user.id, input.currentPassword, input.verificationCode)
    reply.header('cache-control', 'no-store')
    return beginPasskeyRegistration({
      user,
      name: input.name,
      native: Boolean(bearerSessionToken(request.headers.authorization)),
    })
  })

  app.post('/api/me/passkeys/registration/verify', async (request, reply) => {
    const user = requireUser(request)
    const input = verifyPasskeyRegistrationInputSchema.parse(request.body)
    const passkey = await finishPasskeyRegistration({
      userId: user.id,
      ceremonyToken: input.ceremonyToken,
      response: input.response,
      native: Boolean(bearerSessionToken(request.headers.authorization)),
    })
    await recordDirectPasskeyAdd(request, user.id, passkey)
    reply.code(201)
    return { passkey }
  })

  app.post('/api/me/passkeys/browser-registration', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    const input = beginBrowserPasskeyRegistrationInputSchema.parse(request.body)
    await requirePasskeySensitiveAuth(user.id, input.currentPassword, input.verificationCode)
    reply.header('cache-control', 'no-store')
    return beginBrowserPasskeyRegistration({ request, user, name: input.name, state: input.state })
  })

  app.patch('/api/me/passkeys/:id', async (request) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const { name } = renamePasskeyInputSchema.parse(request.body)
    return { passkey: await renamePasskey(user.id, id, name) }
  })

  app.delete('/api/me/passkeys/:id', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const user = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = passkeySensitiveChangeSchema.parse(request.body)
    await requirePasskeySensitiveAuth(user.id, input.currentPassword, input.verificationCode)
    await deletePasskey(user.id, id)
    await recordDirectPasskeyDelete(request, user.id)
    reply.code(204).send()
  })

  app.get('/api/me/two-factor', async (request) => {
    const user = requireUser(request)
    return twoFactorStatus(user.id)
  })

  app.post('/api/me/two-factor/enrollment', async (request, reply) => {
    const user = requireUser(request)
    const input = beginTwoFactorEnrollmentInputSchema.parse(request.body)
    await requireCurrentPassword(user.id, input.currentPassword)
    if (await hasTwoFactor(user.id)) {
      if (!input.verificationCode) {
        throw new AppError(400, 'two_factor_code_required', 'Enter your current authenticator or recovery code.')
      }
      await verifySecondFactor(user.id, input.verificationCode)
    }
    reply.header('cache-control', 'no-store').code(201)
    return beginTwoFactorEnrollment(user)
  })

  app.post('/api/me/two-factor/enrollment/confirm', async (request, reply) => {
    const user = requireUser(request)
    const input = confirmTwoFactorEnrollmentInputSchema.parse(request.body)
    const replacing = await hasTwoFactor(user.id)
    const recoveryCodes = await confirmTwoFactorEnrollment(user.id, input.code)
    await recordTwoFactorChange(request, user.id, replacing ? 'account.two_factor.replace' : 'account.two_factor.enable')
    reply.header('cache-control', 'no-store')
    return { recoveryCodes }
  })

  app.post('/api/me/two-factor/recovery-codes', async (request, reply) => {
    const user = requireUser(request)
    const input = verifyTwoFactorChangeInputSchema.parse(request.body)
    await requireCurrentPassword(user.id, input.currentPassword)
    if (!(await hasTwoFactor(user.id))) throw new AppError(409, 'two_factor_not_enabled', 'Two-factor authentication is not enabled.')
    await verifySecondFactor(user.id, input.verificationCode)
    const recoveryCodes = await replaceRecoveryCodes(user.id)
    await recordTwoFactorChange(request, user.id, 'account.two_factor.recovery_codes.regenerate')
    reply.header('cache-control', 'no-store')
    return { recoveryCodes }
  })

  app.delete('/api/me/two-factor', async (request, reply) => {
    const user = requireUser(request)
    const input = verifyTwoFactorChangeInputSchema.parse(request.body)
    await requireCurrentPassword(user.id, input.currentPassword)
    if (!(await hasTwoFactor(user.id))) throw new AppError(409, 'two_factor_not_enabled', 'Two-factor authentication is not enabled.')
    await verifySecondFactor(user.id, input.verificationCode)
    await clearTwoFactor(user.id)
    await recordTwoFactorChange(request, user.id, 'account.two_factor.disable')
    reply.code(204).send()
  })
}
