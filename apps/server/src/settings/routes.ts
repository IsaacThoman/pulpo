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

const preferencesSchema = z.record(z.string(), z.unknown())

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (request) => {
    const user = requireUser(request)
    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1)
    const values = preferencesWithModelDefaults(row?.values as Record<string, unknown> | undefined)
    return {
      values: {
        ...values,
        trashRetention: parseTrashRetention(values?.trashRetention ?? DEFAULT_TRASH_RETENTION),
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
