import { parseAuthSettings } from '../settings/application-settings.js'
import { insertNewAccountPreferences } from '../settings/new-account-defaults.js'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { dataProfileInputSchema, idSchema, type ProfileList } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, chats, dataProfiles, users } from '../database/schema.js'
import { requireUser } from '../auth/service.js'
import { authenticateApiKey } from '../api-keys/routes.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import { withProfile, type ProfileScope } from './context.js'
import { acceptProfileDeletion } from './deletion.js'

export async function resolveProfile(userId: string, selected?: unknown): Promise<ProfileScope> {
  if (selected !== undefined && !idSchema.safeParse(selected).success) throw new AppError(400, 'invalid_profile', 'Invalid profile ID')
  const [row] = await db.select().from(dataProfiles).where(and(
    eq(dataProfiles.userId, userId), isNull(dataProfiles.deletionRequestedAt),
    selected ? eq(dataProfiles.id, selected as string) : eq(dataProfiles.isDefault, true),
  )).limit(1)
  if (!row) throw new AppError(404, 'profile_unavailable', 'This profile is no longer available')
  return { userId, profileId: row.id }
}

export async function publishProfileList(userId: string): Promise<void> {
  const [row] = await db.update(users).set({ stateRevision: sql`${users.stateRevision} + 1` })
    .where(eq(users.id, userId)).returning({ revision: users.stateRevision })
  if (row) await withProfile(undefined, () => publishStateChange({ userId, revision: row.revision, scopes: ['profiles'] }))
}

export async function profileList(userId: string): Promise<ProfileList> {
  const rows = await db.select().from(dataProfiles).where(and(eq(dataProfiles.userId, userId), isNull(dataProfiles.deletionRequestedAt))).orderBy(asc(dataProfiles.createdAt), asc(dataProfiles.id))
  return {
    profiles: rows.map((row) => ({ id: row.id, name: row.name, color: row.color, isDefault: row.isDefault, createdAt: row.createdAt.toISOString() })),
    defaultProfileId: rows.find((row) => row.isDefault)!.id,
  }
}

export async function registerDataProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profiles', async (request) => profileList(requireUser(request).id))
  app.post('/api/profiles', async (request, reply) => {
    const user = requireUser(request)
    const input = dataProfileInputSchema.parse(request.body)
    const id = newId()
    await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update')
      await tx.insert(dataProfiles).values({ id, userId: user.id, ...input })
      const [settings] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, 'auth'))
      await withProfile({ userId: user.id, profileId: id }, () => insertNewAccountPreferences(tx, user.id, parseAuthSettings(settings?.value)))
    })
    await publishProfileList(user.id)
    return reply.code(201).send({ ...(await profileList(user.id)), createdProfileId: id })
  })
  app.patch('/api/profiles/:id', async (request) => {
    const user = requireUser(request)
    const id = idSchema.parse((request.params as { id: string }).id)
    const input = dataProfileInputSchema.partial().parse(request.body)
    const [row] = await db.update(dataProfiles).set({ ...input, updatedAt: new Date() }).where(and(eq(dataProfiles.id, id), eq(dataProfiles.userId, user.id), isNull(dataProfiles.deletionRequestedAt))).returning()
    if (!row) throw new AppError(404, 'profile_unavailable', 'This profile is no longer available')
    await publishProfileList(user.id)
    return profileList(user.id)
  })
  app.delete('/api/profiles/:id', async (request, reply) => {
    const user = requireUser(request)
    const id = idSchema.parse((request.params as { id: string }).id)
    const name = (request.body as { name?: unknown } | undefined)?.name
    await acceptProfileDeletion(user.id, id, name)
    await publishProfileList(user.id)
    return reply.code(202).send(await profileList(user.id))
  })
}

function sharedRoute(url: string): boolean {
  return /^\/(?:health|ready|api\/(?:auth|mobile\/(?:auth|me|config)|me|profiles|billing|usage|friends|pools|api-keys|codex|invite-codes|admin|shares|management\/(?:auth|tokens|instance|users|operations|audit)))(?:[/?]|$)/.test(url)
}

/** Wrap the handler, rather than entering ALS in a hook's separate async chain. */
export function registerProfileContext(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const handler = route.handler
    route.handler = async function (request, reply) {
      if (request.url.startsWith('/v1/')) await authenticateApiKey(request, request.url.startsWith('/v1/models') ? 'models' : 'responses')
      if (!request.user || sharedRoute(request.url)) return withProfile(undefined, () => handler.call(this, request, reply))
      let selected: unknown = request.headers['x-pulpo-profile-id'] ?? (request.query as { profileId?: string } | undefined)?.profileId
      if (request.adminChatAccess) {
        const [chat] = await db.select({ profileId: chats.profileId }).from(chats).where(eq(chats.id, request.adminChatAccess.chatId))
        selected = chat?.profileId
      }
      const scope = await resolveProfile(request.user.id, selected)
      return withProfile(scope, () => handler.call(this, request, reply))
    }
  })
}
