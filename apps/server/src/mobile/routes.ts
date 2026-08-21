import { eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  mobileConfigSchema,
  mobileBrowserPasskeyOptionsInputSchema,
  nativeLoginInputSchema,
  nativeSignupInputSchema,
  mobilePasskeyCodeExchangeInputSchema,
  mobilePasskeyVerifyInputSchema,
  verifyPasskeyAuthenticationInputSchema,
} from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, passwordCredentials, users } from '../database/schema.js'
import { getConfig } from '../config.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { newUserStorageLimit } from '../billing/storage-entitlements.js'
import { insertNewAccountPreferences } from '../settings/new-account-defaults.js'
import {
  bearerSessionToken,
  createNativeSession,
  createPasswordHash,
  destroyNativeSession,
  serializeUser,
  verifyPassword,
} from '../auth/service.js'
import { requireLoginSecondFactor } from '../auth/two-factor.js'
import {
  beginPasskeyAuthentication,
  exchangeMobilePasskeyAuthCode,
  finishPasskeyAuthentication,
  issueMobilePasskeyAuthCode,
} from '../auth/passkeys.js'
import { mobileDictationEnabled } from './config.js'

export async function registerMobileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mobile/config', async () => {
    const config = getConfig()
    const [[existingUser], settings] = await Promise.all([
      db.select({ id: users.id }).from(users).limit(1),
      db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
        .where(inArray(applicationSettings.key, ['auth', 'dictation'])),
    ])
    const settingsByKey = new Map(settings.map((setting) => [setting.key, setting.value]))
    const auth = parseAuthSettings(settingsByKey.get('auth'))
    return mobileConfigSchema.parse({
      mobileApiVersion: 1,
      instance: { name: config.INSTANCE_NAME, version: config.PULPO_VERSION, publicUrl: config.PUBLIC_URL },
      setupRequired: !existingUser,
      auth: {
        signupEnabled: auth.signupEnabled,
        pendingDetails: auth.pendingDetails,
        adminEmail: auth.adminEmail,
        pendingMessage: auth.pendingMessage,
        inviteCodesEnabled: getConfig().PULPO_BILLING_ENABLED && auth.inviteCodesEnabled,
      },
      limits: { maxAttachmentBytes: auth.maxAttachmentBytes },
      capabilities: {
        bearerSessions: true,
        realtime: true,
        chatDuplication: true,
        publicSharing: true,
        attachments: true,
        folders: true,
        twoFactorAuth: true,
        passkeys: true,
        dictation: mobileDictationEnabled(settingsByKey.get('dictation')),
      },
    })
  })

  app.post('/api/mobile/auth/login', async (request) => {
    const input = nativeLoginInputSchema.parse(request.body)
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
    const session = await createNativeSession(row.user.id, input.deviceLabel, request)
    return { user: serializeUser(row.user), session }
  })

  app.post('/api/mobile/auth/passkey/options', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return beginPasskeyAuthentication({ flow: 'native-authentication' })
  })

  app.post('/api/mobile/auth/passkey/verify', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request) => {
    const input = mobilePasskeyVerifyInputSchema.parse(request.body)
    const { user } = await finishPasskeyAuthentication({
      ceremonyToken: input.ceremonyToken,
      response: input.response,
      flows: ['native-authentication'],
    })
    const session = await createNativeSession(user.id, input.deviceLabel, request)
    return { user: serializeUser(user), session }
  })

  app.post('/api/mobile/auth/passkey/browser/options', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const input = mobileBrowserPasskeyOptionsInputSchema.parse(request.body)
    reply.header('cache-control', 'no-store')
    return beginPasskeyAuthentication({
      flow: 'browser-authentication',
      pkceChallenge: input.codeChallenge,
      state: input.state,
    })
  })

  app.post('/api/mobile/auth/passkey/browser/verify', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const input = verifyPasskeyAuthenticationInputSchema.parse(request.body)
    const { user, ceremony } = await finishPasskeyAuthentication({
      ceremonyToken: input.ceremonyToken,
      response: input.response,
      flows: ['browser-authentication'],
    })
    const { redirectUrl } = await issueMobilePasskeyAuthCode(user.id, ceremony)
    reply.header('cache-control', 'no-store')
    return { redirectUrl }
  })

  app.post('/api/mobile/auth/passkey/browser/exchange', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (request) => {
    const input = mobilePasskeyCodeExchangeInputSchema.parse(request.body)
    const user = await exchangeMobilePasskeyAuthCode(input.code, input.codeVerifier)
    const session = await createNativeSession(user.id, input.deviceLabel, request)
    return { user: serializeUser(user), session }
  })

  app.post('/api/mobile/auth/signup', async (request, reply) => {
    const input = nativeSignupInputSchema.parse(request.body)
    const [setting] = await db.select().from(applicationSettings)
      .where(eq(applicationSettings.key, 'auth')).limit(1)
    const auth = parseAuthSettings(setting?.value)
    if (!auth.signupEnabled) throw new AppError(403, 'signup_disabled', 'New signups are disabled')
    const userId = newId()
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1886747743)`)
      const [existingUser] = await tx.select({ id: users.id }).from(users).limit(1)
      if (!existingUser) throw new AppError(409, 'setup_required', 'Create the initial administrator before accepting signups')
      const [existing] = await tx.select({ id: users.id }).from(users)
        .where(sql`lower(${users.email}) = lower(${input.email})`).limit(1)
      if (existing) throw new AppError(409, 'email_taken', 'An account with this email already exists')
      const [existingUsername] = await tx.select({ id: users.id }).from(users)
        .where(sql`lower(${users.username}) = ${input.username}`).limit(1)
      if (existingUsername) throw new AppError(409, 'username_taken', 'That username is already taken', 'invalid_request_error', 'username')
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        name: input.name,
        username: input.username,
        role: auth.defaultSignupRole,
        balanceMicros: auth.defaultBalanceMicros,
        storageLimitBytes: await newUserStorageLimit(tx),
      })
      await tx.insert(passwordCredentials).values({
        userId,
        passwordHash: await createPasswordHash(input.password),
      })
      await insertNewAccountPreferences(tx, userId, auth)
    })
    const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    const session = await createNativeSession(userId, input.deviceLabel, request)
    reply.code(201)
    return { user: serializeUser(created!), session }
  })

  app.post('/api/mobile/auth/logout', async (request, reply) => {
    if (!bearerSessionToken(request.headers.authorization)) throw unauthorized()
    await destroyNativeSession(request)
    reply.code(204).send()
  })

  app.get('/api/mobile/me', async (request) => {
    if (!request.user) throw unauthorized()
    return { user: request.user }
  })
}
