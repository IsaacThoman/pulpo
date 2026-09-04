import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { newChatAutoExpireSchema } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings, userPreferences, users } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { publishStateChange } from '../responses/events.js'
import { embeddingQueue, maintenanceQueue } from '../jobs.js'
import { DEFAULT_TRASH_RETENTION, parseTrashRetention, trashRetentionValues } from '../chats/trash.js'
import { normalizedPreferencePatch, preferencesWithModelDefaults } from './model-preferences.js'
import { automaticChatExpirationValues, parseAutomaticChatExpiration } from '../chats/expiration.js'
import { parseAuthSettings, parsePersonalizationSettings } from './application-settings.js'
import { deleteUserEpisodicMemory } from '../episodic-memory/indexer.js'
import { scheduleUserIndex } from '../episodic-memory/queue.js'
import {
  listMemoryDocumentRevisions,
  MemoryDocumentError,
  readMemoryDocument,
  restoreMemoryDocumentRevision,
  updateMemoryDocument,
} from '../memory-document/service.js'

const preferencesSchema = z.record(z.string(), z.unknown())

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (request) => {
    const user = requireUser(request)
    const [[row], [authSetting], [personalizationSetting]] = await Promise.all([
      db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1),
      db.select({ value: applicationSettings.value })
        .from(applicationSettings)
        .where(eq(applicationSettings.key, 'auth'))
        .limit(1),
      db.select({ value: applicationSettings.value })
        .from(applicationSettings)
        .where(eq(applicationSettings.key, 'personalization'))
        .limit(1),
    ])
    const values = preferencesWithModelDefaults(row?.values as Record<string, unknown> | undefined)
    const newAccountFavoriteModelIds = parseAuthSettings(authSetting?.value).newAccountModelDefaults.favoriteModelIds
    return {
      values: {
        ...values,
        trashRetention: parseTrashRetention(values?.trashRetention ?? DEFAULT_TRASH_RETENTION),
        automaticChatExpiration: parseAutomaticChatExpiration(values?.automaticChatExpiration),
      },
      newAccountFavoriteModelIds,
      instructionPresets: parsePersonalizationSettings(personalizationSetting?.value).instructionPresets,
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
    if ('newChatAutoExpire' in patch && !newChatAutoExpireSchema.safeParse(patch.newChatAutoExpire).success) {
      throw new AppError(400, 'invalid_new_chat_expiration', 'Choose whether new chats should expire automatically')
    }
    if ('memoryEnabled' in patch && typeof patch.memoryEnabled !== 'boolean') {
      throw new AppError(400, 'invalid_memory_setting', 'Choose whether Memories should be enabled')
    }
    let previousTrashRetention = DEFAULT_TRASH_RETENTION
    let previousMemoryEnabled = false
    let saved: typeof userPreferences.$inferSelect | undefined
    let stateRevision: number | undefined
    await db.transaction(async (tx) => {
      // Share the management-settings lock so a stale full-document apply can
      // never overwrite a concurrent account PATCH.
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      const [existing] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1)
      previousTrashRetention = parseTrashRetention((existing?.values as Record<string, unknown> | undefined)?.trashRetention)
      previousMemoryEnabled = (existing?.values as { memoryEnabled?: unknown } | undefined)?.memoryEnabled === true
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
    if ('memoryEnabled' in patch && patch.memoryEnabled !== previousMemoryEnabled) {
      const enabled = patch.memoryEnabled === true
      if (!enabled) {
        const jobs = await embeddingQueue.getJobs(['waiting', 'delayed', 'prioritized'])
        await Promise.all(jobs.filter((job) => 'userId' in job.data && job.data.userId === user.id).map((job) => job.remove()))
        await deleteUserEpisodicMemory(user.id)
      } else {
        await scheduleUserIndex(user.id, 'memory-consent-enabled')
      }
    }
    return { values: saved!.values, updatedAt: saved!.updatedAt.toISOString() }
  })

  app.get('/api/memory-document', async (request) => {
    const user = requireUser(request)
    const document = await readMemoryDocument(user.id)
    return { ...document, updatedAt: document.updatedAt?.toISOString() ?? null }
  })

  app.put('/api/memory-document', async (request, reply) => {
    const user = requireUser(request)
    const input = z.object({
      content: z.string(),
      expectedRevision: z.number().int().nonnegative(),
    }).parse(request.body)
    try {
      const document = await updateMemoryDocument({
        userId: user.id,
        expectedRevision: input.expectedRevision,
        content: input.content,
        editor: 'user',
        summary: input.content.trim() ? 'Edited in Settings' : 'Cleared in Settings',
      })
      return { ...document, updatedAt: document.updatedAt?.toISOString() ?? null }
    } catch (error) {
      if (!(error instanceof MemoryDocumentError)) throw error
      if (error.code === 'memory_document_conflict') {
        return reply.code(409).send({ error: {
          message: error.message,
          type: 'invalid_request_error',
          code: error.code,
          param: 'expectedRevision',
        }, currentRevision: error.currentRevision })
      }
      throw new AppError(400, error.code, error.message)
    }
  })

  app.get('/api/memory-document/revisions', async (request) => {
    const user = requireUser(request)
    const revisions = await listMemoryDocumentRevisions(user.id)
    return { data: revisions.map((revision) => ({
      ...revision,
      versionCreatedAt: revision.versionCreatedAt.toISOString(),
      supersededAt: revision.supersededAt.toISOString(),
    })) }
  })

  app.post('/api/memory-document/revisions/:id/restore', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const input = z.object({ expectedRevision: z.number().int().nonnegative() }).parse(request.body)
    try {
      const document = await restoreMemoryDocumentRevision({ userId: user.id, revisionId: id, expectedRevision: input.expectedRevision })
      return { ...document, updatedAt: document.updatedAt?.toISOString() ?? null }
    } catch (error) {
      if (!(error instanceof MemoryDocumentError)) throw error
      if (error.code === 'memory_document_conflict') {
        return reply.code(409).send({ error: {
          message: error.message,
          type: 'invalid_request_error',
          code: error.code,
          param: 'expectedRevision',
        }, currentRevision: error.currentRevision })
      }
      throw new AppError(error.code === 'memory_document_revision_not_found' ? 404 : 400, error.code, error.message)
    }
  })
}
