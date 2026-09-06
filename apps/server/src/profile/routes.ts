import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser, serializeUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { users } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { publishStateChange } from '../responses/events.js'
import { getBlobStore } from '../storage/index.js'
import { normalizeProfileAvatar, parseProfileAvatarCrop, PROFILE_AVATAR_MAX_BYTES } from './avatar.js'
import {
  bumpAccountRevisions,
  friendPeerIds,
  publishScopedStateChanges,
} from '../friends/sync.js'

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users/:id/avatar', async (request, reply) => {
    requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const [profile] = await db.select({ key: users.avatarObjectKey, version: users.avatarVersion })
      .from(users).where(eq(users.id, id)).limit(1)
    if (!profile?.key) throw notFound('Profile picture')
    const etag = `"avatar-${id}-${profile.version}"`
    reply.header('cache-control', 'private, max-age=31536000, immutable').header('etag', etag)
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.type('image/webp').send(Buffer.from(await getBlobStore().get(profile.key)))
  })

  app.put('/api/me/avatar', async (request, reply) => {
    const user = requireUser(request)
    let part
    let source
    try {
      part = await request.file({ limits: { fileSize: PROFILE_AVATAR_MAX_BYTES, files: 1, fields: 1, fieldSize: 1024 } })
      if (!part) throw new AppError(400, 'avatar_file_required', 'Choose a profile picture to upload')
      source = await part.toBuffer()
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'avatar_too_large', 'Profile pictures may be at most 5 MiB')
      }
      throw cause
    }
    if (part.file.truncated) throw new AppError(413, 'avatar_too_large', 'Profile pictures may be at most 5 MiB')
    const cropField = part.fields.crop
    const crop = parseProfileAvatarCrop(cropField && !Array.isArray(cropField) && cropField.type === 'field' ? cropField.value : cropField)
    const image = await normalizeProfileAvatar(source, part.mimetype, crop)
    const key = `users/${user.id}/avatar/${newId()}.webp`
    await getBlobStore().put(key, image, { contentType: 'image/webp', contentLength: image.byteLength })
    let previousKey: string | null = null
    try {
      const { updated, friendChanges } = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`avatar:${user.id}`}))`)
        const [current] = await tx.select().from(users).where(eq(users.id, user.id)).limit(1)
        if (!current || current.deletionRequestedAt) throw notFound('User')
        previousKey = current.avatarObjectKey
        const [updated] = await tx.update(users).set({
          avatarObjectKey: key,
          avatarVersion: current.avatarVersion + 1,
          stateRevision: sql`${users.stateRevision} + 1`,
          updatedAt: new Date(),
        }).where(eq(users.id, user.id)).returning()
        const peers = await friendPeerIds(tx, user.id)
        return { updated, friendChanges: await bumpAccountRevisions(tx, peers) }
      })
      if (!updated) throw notFound('User')
      await publishStateChange({ userId: user.id, revision: updated.stateRevision })
      await publishScopedStateChanges(friendChanges, ['friends'])
      if (previousKey) await getBlobStore().delete(previousKey).catch(() => undefined)
      reply.code(200)
      return { user: serializeUser(updated) }
    } catch (cause) {
      await getBlobStore().delete(key).catch(() => undefined)
      throw cause
    }
  })

  app.delete('/api/me/avatar', async (request, reply) => {
    const user = requireUser(request)
    let previousKey: string | null = null
    const { updated, friendChanges } = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`avatar:${user.id}`}))`)
      const [current] = await tx.select({ key: users.avatarObjectKey }).from(users).where(eq(users.id, user.id)).limit(1)
      previousKey = current?.key ?? null
      const [updated] = await tx.update(users).set({
        avatarObjectKey: null,
        avatarVersion: sql`${users.avatarVersion} + 1`,
        stateRevision: sql`${users.stateRevision} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id)).returning()
      const peers = await friendPeerIds(tx, user.id)
      return { updated, friendChanges: await bumpAccountRevisions(tx, peers) }
    })
    if (!updated) throw notFound('User')
    await publishStateChange({ userId: user.id, revision: updated.stateRevision })
    await publishScopedStateChanges(friendChanges, ['friends'])
    if (previousKey) await getBlobStore().delete(previousKey).catch(() => undefined)
    reply.code(200)
    return { user: serializeUser(updated) }
  })
}
