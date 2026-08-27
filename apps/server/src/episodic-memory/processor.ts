import { and, desc, eq, inArray } from 'drizzle-orm'
import type { EmbeddingJob } from '../jobs.js'
import { db } from '../database/client.js'
import { auditEvents, episodicMemoryGenerations } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { readEpisodicMemorySettings } from './settings.js'
import { EPISODIC_MEMORY_PROFILES } from './profiles.js'
import { OllamaClient } from './ollama.js'
import { EPISODIC_MEMORY_AUDIT_ACTIONS } from './audit.js'
import { watchCancellation } from './cancellation.js'
import { measureEpisodicMemoryOperation } from './metrics.js'
import {
  activeGeneration,
  buildAndActivateGeneration,
  deleteUserEpisodicMemory,
  EpisodicIndexCancelledError,
  EpisodicUserMemoryDisabledError,
  reconcileChatGeneration,
  reconcileUserGeneration,
} from './indexer.js'

export async function processEmbeddingJob(job: EmbeddingJob): Promise<void> {
  if (job.type === 'delete-user') {
    await deleteUserEpisodicMemory(job.userId)
    return
  }
  const settings = await readEpisodicMemorySettings()
  if (!settings.enabled) return
  if (job.type === 'index-chat') {
    const generation = await activeGeneration()
    if (generation) {
      try {
        await reconcileChatGeneration(generation, job.chatId, job.userId)
      } catch (error) {
        if (!(error instanceof EpisodicUserMemoryDisabledError)) throw error
        await deleteUserEpisodicMemory(job.userId)
      }
    }
    return
  }
  if (job.type === 'index-user') {
    const generation = await activeGeneration()
    if (generation) {
      try {
        await reconcileUserGeneration(generation, job.userId)
      } catch (error) {
        if (!(error instanceof EpisodicUserMemoryDisabledError)) throw error
        await deleteUserEpisodicMemory(job.userId)
      }
    }
    return
  }
  const profile = EPISODIC_MEMORY_PROFILES[settings.profile]

  const [active] = await db.select().from(episodicMemoryGenerations)
    .where(eq(episodicMemoryGenerations.active, true)).limit(1)
  if (!job.force && active?.profile === profile.id && active.status === 'ready') return

  if (job.force) {
    await db.update(episodicMemoryGenerations).set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(episodicMemoryGenerations.active, false), inArray(episodicMemoryGenerations.status, ['pending', 'pulling', 'indexing'])))
  }
  const [existing] = await db.select().from(episodicMemoryGenerations)
    .where(and(
      eq(episodicMemoryGenerations.profile, profile.id),
      eq(episodicMemoryGenerations.active, false),
      inArray(episodicMemoryGenerations.status, ['pending', 'pulling', 'indexing']),
    )).orderBy(desc(episodicMemoryGenerations.createdAt)).limit(1)
  const generationId = existing?.id ?? newId()
  if (!existing) await db.insert(episodicMemoryGenerations).values({
    id: generationId,
    profile: profile.id,
    model: profile.model,
    dimension: profile.dimension,
    status: 'pending',
  })

  let cancellation: ReturnType<typeof watchCancellation> | undefined
  try {
    await db.update(episodicMemoryGenerations).set({
      status: 'pulling', error: null, startedAt: new Date(), cancelRequestedAt: null, updatedAt: new Date(),
    }).where(eq(episodicMemoryGenerations.id, generationId))
    cancellation = watchCancellation(async () => {
      const [generation] = await db.select({ cancelRequestedAt: episodicMemoryGenerations.cancelRequestedAt })
        .from(episodicMemoryGenerations).where(eq(episodicMemoryGenerations.id, generationId)).limit(1)
      return Boolean(generation?.cancelRequestedAt)
    })
    const client = new OllamaClient(undefined, undefined, cancellation.signal)
    const status = await client.status()
    if (!status.healthy) throw new Error(status.error ?? 'Ollama is unavailable')
    let installed = status.installedModels.find((model) => model.name === profile.model)
    if (!installed) {
      installed = await client.pullModel(profile, {
        onProgress: (completed, total) => { void db.update(episodicMemoryGenerations).set({
          downloadCompletedBytes: completed, downloadTotalBytes: total, updatedAt: new Date(),
        }).where(eq(episodicMemoryGenerations.id, generationId)) },
      })
      await db.insert(auditEvents).values({
        id: newId(), action: EPISODIC_MEMORY_AUDIT_ACTIONS.modelInstall,
        targetType: 'episodic_memory_generation', targetId: generationId,
        metadata: { profile: profile.id, model: profile.model, digest: installed.digest, size: installed.size },
      })
    }
    await measureEpisodicMemoryOperation(
      'embedding',
      () => client.embed(profile, 'Pulpo episodic memory model validation'),
      1,
    )
    const [generation] = await db.select({ cancelRequestedAt: episodicMemoryGenerations.cancelRequestedAt })
      .from(episodicMemoryGenerations).where(eq(episodicMemoryGenerations.id, generationId)).limit(1)
    if (generation?.cancelRequestedAt) {
      await db.update(episodicMemoryGenerations).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(episodicMemoryGenerations.id, generationId))
      return
    }
    await db.update(episodicMemoryGenerations).set({
      modelDigest: installed.digest,
      downloadCompletedBytes: installed.size,
      downloadTotalBytes: installed.size,
      status: 'indexing',
      updatedAt: new Date(),
    }).where(eq(episodicMemoryGenerations.id, generationId))
    await buildAndActivateGeneration(generationId, client)
  } catch (error) {
    if (error instanceof EpisodicIndexCancelledError || cancellation?.signal.aborted) {
      await db.update(episodicMemoryGenerations).set({
        status: 'cancelled', error: null, completedAt: new Date(), updatedAt: new Date(),
      }).where(eq(episodicMemoryGenerations.id, generationId))
      return
    }
    await db.update(episodicMemoryGenerations).set({
      status: 'failed', error: error instanceof Error ? error.message : String(error), completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(episodicMemoryGenerations.id, generationId))
    await db.insert(auditEvents).values({
      id: newId(), action: EPISODIC_MEMORY_AUDIT_ACTIONS.failure, targetType: 'episodic_memory_generation', targetId: generationId,
      metadata: { profile: profile.id, error: error instanceof Error ? error.message : String(error) },
    })
    throw error
  } finally {
    cancellation?.stop()
  }
}
