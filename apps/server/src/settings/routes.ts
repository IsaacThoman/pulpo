import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { memories, userPreferences, users } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { AppError, notFound } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'
import { maintenanceQueue } from '../jobs.js'
import { DEFAULT_TRASH_RETENTION, parseTrashRetention, trashRetentionValues } from '../chats/trash.js'
import { normalizedPreferencePatch, preferencesWithModelDefaults } from './model-preferences.js'
import { automaticChatExpirationValues, parseAutomaticChatExpiration } from '../chats/expiration.js'

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
    const values = preferencesWithModelDefaults(row?.values as Record<string, unknown> | undefined)
    return {
      values: {
        ...values,
        trashRetention: parseTrashRetention(values?.trashRetention ?? DEFAULT_TRASH_RETENTION),
        automaticChatExpiration: parseAutomaticChatExpiration(values?.automaticChatExpiration),
        nickname: profile?.nickname ?? '',
        leaderboardVisible: profile?.leaderboardVisible ?? false,
        leaderboardColor: profile?.leaderboardColor ?? '#10b981',
      },
      updatedAt: row?.updatedAt.toISOString() ?? null,
    }
  })

  app.patch('/api/settings', async (request) => {
    const user = requireUser(request)
    const patch = normalizedPreferencePatch(preferencesSchema.parse(request.body))
    if ('trashRetention' in patch && !trashRetentionValues.includes(patch.trashRetention as typeof trashRetentionValues[number])) {
      throw new AppError(400, 'invalid_trash_retention', 'Choose a valid trash retention period')
    }
    if ('automaticChatExpiration' in patch && !automaticChatExpirationValues.includes(patch.automaticChatExpiration as typeof automaticChatExpirationValues[number])) {
      throw new AppError(400, 'invalid_chat_expiration', 'Choose a valid automatic chat expiration period')
    }
    const nickname = typeof patch.nickname === 'string'
      ? patch.nickname.trim() || null
      : patch.nickname === null ? null : undefined
    const leaderboardVisible = typeof patch.leaderboardVisible === 'boolean' ? patch.leaderboardVisible : undefined
    const leaderboardColor = typeof patch.leaderboardColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.leaderboardColor) ? patch.leaderboardColor : undefined
    let previousTrashRetention = DEFAULT_TRASH_RETENTION
    let saved: typeof userPreferences.$inferSelect | undefined
    let stateRevision: number | undefined
    await db.transaction(async (tx) => {
      // Share the management-settings lock so a stale full-document apply can
      // never overwrite a concurrent account PATCH.
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      const [existing] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1)
      previousTrashRetention = parseTrashRetention((existing?.values as Record<string, unknown> | undefined)?.trashRetention)
      const insertValues = preferencesWithModelDefaults(patch)
      const defaults = JSON.stringify(preferencesWithModelDefaults())
      const patchJson = JSON.stringify(patch)
      ;[saved] = await tx.insert(userPreferences).values({ userId: user.id, values: insertValues })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            // One SQL expression prevents concurrent PATCH requests from losing unrelated fields.
            values: sql`${defaults}::jsonb || ${userPreferences.values} || ${patchJson}::jsonb`,
            updatedAt: new Date(),
          },
        }).returning()
      const [revision] = await tx.update(users).set({
        nickname, leaderboardVisible, leaderboardColor,
        stateRevision: sql`${users.stateRevision} + 1`,
      }).where(eq(users.id, user.id)).returning({ revision: users.stateRevision })
      stateRevision = revision?.revision
    })
    if (stateRevision !== undefined) await publishStateChange({ userId: user.id, revision: stateRevision })
    if ('trashRetention' in patch && parseTrashRetention(patch.trashRetention) !== previousTrashRetention) {
      await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId: user.id } }, {
        jobId: `purge-chats-settings-${user.id}-${Date.now()}`,
      })
    }
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
