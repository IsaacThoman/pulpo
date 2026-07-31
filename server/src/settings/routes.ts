import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { memories, userPreferences, users } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { notFound } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'

const preferencesSchema = z.record(z.string(), z.unknown())

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (request) => {
    const user = requireUser(request)
    const [[row], [profile]] = await Promise.all([
      db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1),
      db.select({
        nickname: users.nickname,
        leaderboardVisible: users.leaderboardVisible,
        leaderboardColor: users.leaderboardColor,
      }).from(users).where(eq(users.id, user.id)).limit(1),
    ])
    return {
      values: {
        ...(row?.values as Record<string, unknown> | undefined),
        nickname: profile?.nickname ?? '',
        leaderboardVisible: profile?.leaderboardVisible ?? true,
        leaderboardColor: profile?.leaderboardColor ?? '#10b981',
      },
      updatedAt: row?.updatedAt.toISOString() ?? null,
    }
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
