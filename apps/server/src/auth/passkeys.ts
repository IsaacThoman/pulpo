import { createHash } from 'node:crypto'
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import type {
  PasskeyAuthenticationResponse,
  PasskeyRegistrationResponse,
  PasskeySummary,
} from '@pulpo/contracts'
import type { FastifyRequest } from 'fastify'
import { db } from '../database/client.js'
import {
  auditEvents,
  mobilePasskeyAuthCodes,
  passkeyCeremonies,
  passwordCredentials,
  sessions,
  userPasskeyCredentials,
  users,
} from '../database/schema.js'
import { getConfig } from '../config.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { AppError, unauthorized } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import {
  currentSessionId,
  revokeOtherSessions,
  revokeOtherSessionsById,
  verifyPassword,
} from './service.js'
import { hasTwoFactor, verifySecondFactor } from './two-factor.js'

const DIRECT_CEREMONY_TTL_MS = 5 * 60 * 1_000
const BROWSER_REGISTRATION_TTL_MS = 2 * 60 * 1_000
const MOBILE_AUTH_CODE_TTL_MS = 60 * 1_000
const MAX_PASSKEYS = 10
const MOBILE_CALLBACK = 'pulpo://auth/passkey'
const MOBILE_REGISTRATION_CALLBACK = 'pulpo://auth/passkey-enrollment'

export type PasskeyFlow =
  | 'web-authentication'
  | 'native-authentication'
  | 'browser-authentication'
  | 'web-registration'
  | 'native-registration'
  | 'browser-registration'

type UserRow = typeof users.$inferSelect
type CeremonyRow = typeof passkeyCeremonies.$inferSelect

function relyingParty(): { rpId: string; webOrigin: string; nativeOrigin: string } {
  const publicUrl = new URL(getConfig().PUBLIC_URL)
  return {
    rpId: publicUrl.hostname,
    webOrigin: publicUrl.origin,
    nativeOrigin: `https://${publicUrl.hostname}`,
  }
}

function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(userId)
  return new Uint8Array(encoded.buffer as ArrayBuffer)
}

function parsedTransports(value: unknown): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(value)) return undefined
  const allowed = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])
  return value.filter((item): item is AuthenticatorTransportFuture => typeof item === 'string' && allowed.has(item))
}

function passkeySummary(row: typeof userPasskeyCredentials.$inferSelect): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}

async function assertPasskeyNameAvailable(userId: string, name: string, exceptId?: string): Promise<void> {
  const conditions = [
    eq(userPasskeyCredentials.userId, userId),
    sql`lower(${userPasskeyCredentials.name}) = lower(${name})`,
  ]
  if (exceptId) conditions.push(ne(userPasskeyCredentials.id, exceptId))
  const [existing] = await db.select({ id: userPasskeyCredentials.id }).from(userPasskeyCredentials)
    .where(and(...conditions)).limit(1)
  if (existing) throw new AppError(409, 'passkey_name_taken', 'Use a different name for this passkey.')
}

async function assertPasskeyCapacity(userId: string): Promise<void> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(userPasskeyCredentials)
    .where(eq(userPasskeyCredentials.userId, userId))
  if ((result?.count ?? 0) >= MAX_PASSKEYS) {
    throw new AppError(409, 'passkey_limit_reached', `An account can have up to ${MAX_PASSKEYS} passkeys.`)
  }
}

async function registrationOptionsFor(user: Pick<UserRow, 'id' | 'email' | 'name'>, challenge?: string) {
  const credentials = await db.select({
    id: userPasskeyCredentials.credentialId,
    transports: userPasskeyCredentials.transports,
  }).from(userPasskeyCredentials).where(eq(userPasskeyCredentials.userId, user.id))
  const { rpId } = relyingParty()
  return generateRegistrationOptions({
    rpName: getConfig().INSTANCE_NAME,
    rpID: rpId,
    userID: userHandle(user.id),
    userName: user.email,
    userDisplayName: user.name,
    challenge,
    timeout: DIRECT_CEREMONY_TTL_MS,
    attestationType: 'none',
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: parsedTransports(credential.transports),
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
}

async function removeExpiredCeremonies(): Promise<void> {
  await db.delete(passkeyCeremonies).where(sql`${passkeyCeremonies.expiresAt} <= now()`)
  await db.delete(mobilePasskeyAuthCodes).where(sql`${mobilePasskeyAuthCodes.expiresAt} <= now()`)
}

async function insertCeremony(input: {
  challenge: string
  flow: PasskeyFlow
  expectedOrigin: string
  rpId: string
  userId?: string
  initiatingSessionId?: string
  name?: string
  pkceChallenge?: string
  state?: string
  ttlMs?: number
}): Promise<string> {
  await removeExpiredCeremonies()
  const token = randomToken()
  await db.insert(passkeyCeremonies).values({
    tokenHash: hashToken(token),
    challenge: input.challenge,
    flow: input.flow,
    expectedOrigin: input.expectedOrigin,
    rpId: input.rpId,
    userId: input.userId,
    initiatingSessionId: input.initiatingSessionId,
    name: input.name,
    pkceChallenge: input.pkceChallenge,
    state: input.state,
    expiresAt: new Date(Date.now() + (input.ttlMs ?? DIRECT_CEREMONY_TTL_MS)),
  })
  return token
}

async function loadCeremony(token: string, flow: PasskeyFlow): Promise<CeremonyRow> {
  const [ceremony] = await db.select().from(passkeyCeremonies).where(and(
    eq(passkeyCeremonies.tokenHash, hashToken(token)),
    eq(passkeyCeremonies.flow, flow),
    isNull(passkeyCeremonies.consumedAt),
    gt(passkeyCeremonies.expiresAt, new Date()),
  )).limit(1)
  if (!ceremony) throw new AppError(400, 'passkey_ceremony_invalid', 'This passkey request expired. Start again.')
  return ceremony
}

async function consumeCeremony(token: string, flows: PasskeyFlow[]): Promise<CeremonyRow> {
  const [ceremony] = await db.update(passkeyCeremonies).set({ consumedAt: new Date() }).where(and(
    eq(passkeyCeremonies.tokenHash, hashToken(token)),
    inArray(passkeyCeremonies.flow, flows),
    isNull(passkeyCeremonies.consumedAt),
    gt(passkeyCeremonies.expiresAt, new Date()),
  )).returning()
  if (!ceremony) throw new AppError(400, 'passkey_ceremony_invalid', 'This passkey request expired. Start again.')
  return ceremony
}

async function insertVerifiedPasskey(
  userId: string,
  name: string,
  response: PasskeyRegistrationResponse,
  ceremony: CeremonyRow,
): Promise<typeof userPasskeyCredentials.$inferSelect> {
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.expectedOrigin,
      expectedRPID: ceremony.rpId,
      requireUserPresence: true,
      requireUserVerification: true,
    })
  } catch {
    throw new AppError(400, 'passkey_registration_failed', 'The passkey could not be verified. Start again.')
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(400, 'passkey_registration_failed', 'The passkey could not be verified. Start again.')
  }
  const info = verification.registrationInfo
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${users.id} from ${users} where ${users.id} = ${userId} for update`)
    const [[count], [duplicateName]] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` }).from(userPasskeyCredentials)
        .where(eq(userPasskeyCredentials.userId, userId)),
      tx.select({ id: userPasskeyCredentials.id }).from(userPasskeyCredentials).where(and(
        eq(userPasskeyCredentials.userId, userId),
        sql`lower(${userPasskeyCredentials.name}) = lower(${name})`,
      )).limit(1),
    ])
    if ((count?.count ?? 0) >= MAX_PASSKEYS) {
      throw new AppError(409, 'passkey_limit_reached', `An account can have up to ${MAX_PASSKEYS} passkeys.`)
    }
    if (duplicateName) throw new AppError(409, 'passkey_name_taken', 'Use a different name for this passkey.')
    const [created] = await tx.insert(userPasskeyCredentials).values({
      id: newId(),
      userId,
      name,
      credentialId: info.credential.id,
      credentialPublicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter,
      transports: response.response.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    }).returning()
    return created!
  })
}

export async function requirePasskeySensitiveAuth(
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

export async function listPasskeys(userId: string): Promise<{
  passkeys: PasskeySummary[]
  requiresSecondFactor: boolean
}> {
  const credentials = await db.select().from(userPasskeyCredentials)
    .where(eq(userPasskeyCredentials.userId, userId))
    .orderBy(userPasskeyCredentials.createdAt)
  return { passkeys: credentials.map(passkeySummary), requiresSecondFactor: await hasTwoFactor(userId) }
}

export async function beginPasskeyRegistration(input: {
  user: Pick<UserRow, 'id' | 'email' | 'name'>
  name: string
  native: boolean
}): Promise<{ ceremonyToken: string; options: Record<string, unknown> }> {
  await assertPasskeyCapacity(input.user.id)
  await assertPasskeyNameAvailable(input.user.id, input.name)
  const options = await registrationOptionsFor(input.user)
  const rp = relyingParty()
  const ceremonyToken = await insertCeremony({
    challenge: options.challenge,
    flow: input.native ? 'native-registration' : 'web-registration',
    userId: input.user.id,
    name: input.name,
    expectedOrigin: input.native ? rp.nativeOrigin : rp.webOrigin,
    rpId: rp.rpId,
  })
  return { ceremonyToken, options: options as unknown as Record<string, unknown> }
}

export async function finishPasskeyRegistration(input: {
  userId: string
  ceremonyToken: string
  response: PasskeyRegistrationResponse
  native: boolean
}): Promise<PasskeySummary> {
  const ceremony = await consumeCeremony(input.ceremonyToken, [input.native ? 'native-registration' : 'web-registration'])
  if (!ceremony.userId || ceremony.userId !== input.userId || !ceremony.name) throw unauthorized()
  return passkeySummary(await insertVerifiedPasskey(input.userId, ceremony.name, input.response, ceremony))
}

export async function beginBrowserPasskeyRegistration(input: {
  request: FastifyRequest
  user: Pick<UserRow, 'id' | 'email' | 'name'>
  name: string
  state: string
}): Promise<{ url: string }> {
  await assertPasskeyCapacity(input.user.id)
  await assertPasskeyNameAvailable(input.user.id, input.name)
  const options = await registrationOptionsFor(input.user)
  const rp = relyingParty()
  const token = await insertCeremony({
    challenge: options.challenge,
    flow: 'browser-registration',
    userId: input.user.id,
    initiatingSessionId: await currentSessionId(input.request, input.user.id),
    name: input.name,
    state: input.state,
    expectedOrigin: rp.webOrigin,
    rpId: rp.rpId,
    ttlMs: BROWSER_REGISTRATION_TTL_MS,
  })
  const url = new URL('/mobile/passkey/enroll', getConfig().PUBLIC_URL)
  url.hash = new URLSearchParams({ token, state: input.state }).toString()
  return { url: url.toString() }
}

export async function browserRegistrationOptions(token: string): Promise<{
  ceremonyToken: string
  options: Record<string, unknown>
}> {
  const ceremony = await loadCeremony(token, 'browser-registration')
  if (!ceremony.userId) throw unauthorized()
  const [user] = await db.select().from(users).where(eq(users.id, ceremony.userId)).limit(1)
  if (!user || user.blocked) throw unauthorized('Passkey registration failed')
  const options = await registrationOptionsFor(user, ceremony.challenge)
  return { ceremonyToken: token, options: options as unknown as Record<string, unknown> }
}

export async function finishBrowserPasskeyRegistration(
  token: string,
  response: PasskeyRegistrationResponse,
): Promise<{ redirectUrl: string }> {
  const ceremony = await consumeCeremony(token, ['browser-registration'])
  if (!ceremony.userId || !ceremony.name || !ceremony.initiatingSessionId || !ceremony.state) throw unauthorized()
  const [session] = await db.select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.id, ceremony.initiatingSessionId),
    eq(sessions.userId, ceremony.userId),
    gt(sessions.expiresAt, new Date()),
  )).limit(1)
  if (!session) throw unauthorized('The session that started this request has expired.')
  const created = await insertVerifiedPasskey(ceremony.userId, ceremony.name, response, ceremony)
  await db.insert(auditEvents).values({
    id: newId(), actorUserId: ceremony.userId, action: 'account.passkey.add',
    targetType: 'passkey', targetId: created.id, metadata: { name: created.name },
  })
  await revokeOtherSessionsById(ceremony.userId, session.id)
  const redirect = new URL(MOBILE_REGISTRATION_CALLBACK)
  redirect.searchParams.set('state', ceremony.state)
  redirect.searchParams.set('status', 'success')
  return { redirectUrl: redirect.toString() }
}

export async function beginPasskeyAuthentication(input: {
  flow: 'web-authentication' | 'native-authentication' | 'browser-authentication'
  pkceChallenge?: string
  state?: string
}): Promise<{ ceremonyToken: string; options: Record<string, unknown> }> {
  const rp = relyingParty()
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    timeout: DIRECT_CEREMONY_TTL_MS,
    userVerification: 'required',
  })
  const native = input.flow === 'native-authentication'
  const ceremonyToken = await insertCeremony({
    challenge: options.challenge,
    flow: input.flow,
    expectedOrigin: native ? rp.nativeOrigin : rp.webOrigin,
    rpId: rp.rpId,
    pkceChallenge: input.pkceChallenge,
    state: input.state,
  })
  return { ceremonyToken, options: options as unknown as Record<string, unknown> }
}

export async function finishPasskeyAuthentication(input: {
  ceremonyToken: string
  response: PasskeyAuthenticationResponse
  flows: PasskeyFlow[]
}): Promise<{ user: UserRow; ceremony: CeremonyRow }> {
  const ceremony = await consumeCeremony(input.ceremonyToken, input.flows)
  const [row] = await db.select({ credential: userPasskeyCredentials, user: users })
    .from(userPasskeyCredentials)
    .innerJoin(users, eq(users.id, userPasskeyCredentials.userId))
    .where(eq(userPasskeyCredentials.credentialId, input.response.id)).limit(1)
  if (!row || row.user.blocked) throw unauthorized('Passkey sign-in failed')
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.expectedOrigin,
      expectedRPID: ceremony.rpId,
      credential: {
        id: row.credential.credentialId,
        publicKey: Buffer.from(row.credential.credentialPublicKey, 'base64url'),
        counter: row.credential.counter,
        transports: parsedTransports(row.credential.transports),
      },
      requireUserVerification: true,
    })
  } catch {
    throw unauthorized('Passkey sign-in failed')
  }
  if (!verification.verified) throw unauthorized('Passkey sign-in failed')
  await db.update(userPasskeyCredentials).set({
    counter: verification.authenticationInfo.newCounter,
    deviceType: verification.authenticationInfo.credentialDeviceType,
    backedUp: verification.authenticationInfo.credentialBackedUp,
    lastUsedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(userPasskeyCredentials.id, row.credential.id))
  return { user: row.user, ceremony }
}

export async function issueMobilePasskeyAuthCode(userId: string, ceremony: CeremonyRow): Promise<{
  code: string
  state: string
  redirectUrl: string
}> {
  if (!ceremony.pkceChallenge || !ceremony.state) throw unauthorized('Passkey sign-in failed')
  const code = randomToken()
  await db.insert(mobilePasskeyAuthCodes).values({
    tokenHash: hashToken(code),
    userId,
    pkceChallenge: ceremony.pkceChallenge,
    expiresAt: new Date(Date.now() + MOBILE_AUTH_CODE_TTL_MS),
  })
  const redirect = new URL(MOBILE_CALLBACK)
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('state', ceremony.state)
  return { code, state: ceremony.state, redirectUrl: redirect.toString() }
}

export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

export async function exchangeMobilePasskeyAuthCode(code: string, codeVerifier: string): Promise<UserRow> {
  const expectedChallenge = pkceChallenge(codeVerifier)
  const [authorization] = await db.update(mobilePasskeyAuthCodes).set({ consumedAt: new Date() }).where(and(
    eq(mobilePasskeyAuthCodes.tokenHash, hashToken(code)),
    eq(mobilePasskeyAuthCodes.pkceChallenge, expectedChallenge),
    isNull(mobilePasskeyAuthCodes.consumedAt),
    gt(mobilePasskeyAuthCodes.expiresAt, new Date()),
  )).returning()
  if (!authorization) throw unauthorized('Passkey sign-in failed')
  const [user] = await db.select().from(users).where(eq(users.id, authorization.userId)).limit(1)
  if (!user || user.blocked) throw unauthorized('Passkey sign-in failed')
  return user
}

export async function renamePasskey(userId: string, id: string, name: string): Promise<PasskeySummary> {
  await assertPasskeyNameAvailable(userId, name, id)
  const [updated] = await db.update(userPasskeyCredentials).set({ name, updatedAt: new Date() }).where(and(
    eq(userPasskeyCredentials.id, id),
    eq(userPasskeyCredentials.userId, userId),
  )).returning()
  if (!updated) throw new AppError(404, 'passkey_not_found', 'Passkey not found')
  await db.insert(auditEvents).values({
    id: newId(), actorUserId: userId, action: 'account.passkey.rename',
    targetType: 'passkey', targetId: id, metadata: { name },
  })
  return passkeySummary(updated)
}

export async function deletePasskey(userId: string, id: string): Promise<void> {
  const [deleted] = await db.delete(userPasskeyCredentials).where(and(
    eq(userPasskeyCredentials.id, id),
    eq(userPasskeyCredentials.userId, userId),
  )).returning({ id: userPasskeyCredentials.id, name: userPasskeyCredentials.name })
  if (!deleted) throw new AppError(404, 'passkey_not_found', 'Passkey not found')
  await db.insert(auditEvents).values({
    id: newId(), actorUserId: userId, action: 'account.passkey.delete',
    targetType: 'passkey', targetId: id, metadata: { name: deleted.name },
  })
}

export async function recordDirectPasskeyAdd(
  request: FastifyRequest,
  userId: string,
  passkey: PasskeySummary,
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(), actorUserId: userId, action: 'account.passkey.add',
    targetType: 'passkey', targetId: passkey.id, metadata: { name: passkey.name },
  })
  await revokeOtherSessions(request, userId)
}

export async function recordDirectPasskeyDelete(request: FastifyRequest, userId: string): Promise<void> {
  await revokeOtherSessions(request, userId)
}
