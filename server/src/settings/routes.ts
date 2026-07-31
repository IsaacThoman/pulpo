import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { memories, notifications, userPreferences, users } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { notFound } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'

const preferencesSchema = z.record(z.string(), z.unknown())

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (request) => {
    const user = requireUser(request)
    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1)
    return { values: row?.values ?? {}, updatedAt: row?.updatedAt.toISOString() ?? null }
  })

  app.patch('/api/settings', async (request) => {
    const user = requireUser(request)
    const patch = preferencesSchema.parse(request.body)
    const [existing] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1)
    const values = { ...(existing?.values as Record<string, unknown> | undefined), ...patch }
    const [saved] = await db.insert(userPreferences).values({ userId: user.id, values })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { values, updatedAt: new Date() } }).returning()
    const nickname = typeof patch.nickname === 'string' || patch.nickname === null ? patch.nickname : undefined
    const leaderboardVisible = typeof patch.leaderboardVisible === 'boolean' ? patch.leaderboardVisible : undefined
    const leaderboardColor = typeof patch.leaderboardColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.leaderboardColor) ? patch.leaderboardColor : undefined
    const [revision] = await db.update(users).set({
      nickname, leaderboardVisible, leaderboardColor,
      stateRevision: sql`${users.stateRevision} + 1`,
    })
      .where(eq(users.id, user.id)).returning({ revision: users.stateRevision })
    if (revision) await publishStateChange({ userId: user.id, revision: revision.revision })
    return { values: saved!.values, updatedAt: saved!.updatedAt.toISOString() }
  })

  app.get('/api/notifications', async (request) => {
    const user = requireUser(request)
    return { data: await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(100) }
  })

  app.patch('/api/notifications/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const read = z.object({ read: z.boolean() }).parse(request.body).read
    const [updated] = await db.update(notifications).set({ readAt: read ? new Date() : null })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id))).returning()
    if (!updated) throw notFound('Notification')
    return updated
  })

  app.get('/api/memories', async (request) => {
    const user = requireUser(request)
    return { data: await db.select().from(memories).where(eq(memories.userId, user.id)).orderBy(desc(memories.createdAt)) }
  })

  app.post('/api/memories', async (request, reply) => {
    const user = requireUser(request)
    const input = z.object({ content: z.string().trim().min(1).max(2_000), sourceChatId: z.uuid().nullable().default(null) }).parse(request.body)
    const [created] = await db.insert(memories).values({ id: newId(), userId: user.id, ...input }).returning()
    reply.code(201)
    return created
  })

  app.delete('/api/memories/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const deleted = await db.delete(memories).where(and(eq(memories.id, id), eq(memories.userId, user.id))).returning({ id: memories.id })
    if (!deleted.length) throw notFound('Memory')
    reply.code(204).send()
  })
}
