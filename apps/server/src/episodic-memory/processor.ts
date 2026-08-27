import { and, desc, eq, inArray } from 'drizzle-orm'
import type { EmbeddingJob } from '../jobs.js'
import { db } from '../database/client.js'
import { episodicMemoryGenerations } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { readEpisodicMemorySettings } from './settings.js'
import { EPISODIC_MEMORY_PROFILES } from './profiles.js'
import { OllamaClient } from './ollama.js'

export async function processEmbeddingJob(job: EmbeddingJob): Promise<void> {
  if (job.type !== 'reconcile') return
  const settings = await readEpisodicMemorySettings()
  if (!settings.enabled) return
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

  const client = new OllamaClient()
  try {
    await db.update(episodicMemoryGenerations).set({
      status: 'pulling', error: null, startedAt: new Date(), cancelRequestedAt: null, updatedAt: new Date(),
    }).where(eq(episodicMemoryGenerations.id, generationId))
    const status = await client.status()
    if (!status.healthy) throw new Error(status.error ?? 'Ollama is unavailable')
    let installed = status.installedModels.find((model) => model.name === profile.model)
    if (!installed) installed = await client.pullModel(profile, {
      onProgress: (completed, total) => { void db.update(episodicMemoryGenerations).set({
        downloadCompletedBytes: completed, downloadTotalBytes: total, updatedAt: new Date(),
      }).where(eq(episodicMemoryGenerations.id, generationId)) },
    })
    await client.embed(profile, 'Pulpo episodic memory model validation')
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
    // The indexing pass reconciles every eligible chat and performs the atomic activation.
  } catch (error) {
    await db.update(episodicMemoryGenerations).set({
      status: 'failed', error: error instanceof Error ? error.message : String(error), completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(episodicMemoryGenerations.id, generationId))
    throw error
  }
}
