import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { episodicMemorySettingsSchema, type EpisodicMemoryAdminStatus, type EpisodicMemoryGeneration, type EpisodicMemorySettings } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, episodicMemoryGenerations } from '../database/schema.js'
import { embeddingQueue } from '../jobs.js'
import { newId } from '../lib/ids.js'
import { parseEpisodicMemorySettings } from '../settings/application-settings.js'
import { OllamaClient } from './ollama.js'
import { EPISODIC_MEMORY_PROFILE_LIST } from './profiles.js'
import { EPISODIC_MEMORY_AUDIT_ACTIONS, settingsAuditEvents } from './audit.js'

export async function readEpisodicMemorySettings(): Promise<EpisodicMemorySettings> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'episodicMemory')).limit(1)
  return parseEpisodicMemorySettings(row?.value)
}

function generationDto(row: typeof episodicMemoryGenerations.$inferSelect): EpisodicMemoryGeneration {
  return {
    id: row.id,
    profile: episodicMemorySettingsSchema.shape.profile.parse(row.profile),
    model: row.model,
    modelDigest: row.modelDigest,
    dimension: row.dimension,
    status: row.status as EpisodicMemoryGeneration['status'],
    totalItems: row.totalItems,
    completedItems: row.completedItems,
    failedItems: row.failedItems,
    error: row.error,
    active: row.active,
    downloadTotalBytes: row.downloadTotalBytes,
    downloadCompletedBytes: row.downloadCompletedBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function readEpisodicMemoryAdminStatus(client = new OllamaClient()): Promise<EpisodicMemoryAdminStatus> {
  const [settings, ollama, generations] = await Promise.all([
    readEpisodicMemorySettings(),
    client.status(),
    db.select().from(episodicMemoryGenerations).orderBy(desc(episodicMemoryGenerations.createdAt)).limit(20),
  ])
  const active = generations.find((generation) => generation.active) ?? null
  const building = generations.find((generation) => !generation.active && ['pending', 'pulling', 'indexing'].includes(generation.status)) ?? null
  return {
    settings,
    profiles: EPISODIC_MEMORY_PROFILE_LIST,
    ollama,
    activeGeneration: active ? generationDto(active) : null,
    buildingGeneration: building ? generationDto(building) : null,
  }
}

export async function enqueueEpisodicReconciliation(force = false): Promise<void> {
  await embeddingQueue.add('reconcile', { type: 'reconcile', force }, {
    jobId: `reconcile-${force ? 'forced' : 'current'}-${Date.now()}`,
  })
}

export async function updateEpisodicMemorySettings(
  actorUserId: string,
  input: unknown,
): Promise<EpisodicMemorySettings> {
  const next = episodicMemorySettingsSchema.parse(input)
  const previous = await readEpisodicMemorySettings()
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
    await tx.insert(applicationSettings).values({ key: 'episodicMemory', value: next, updatedBy: actorUserId })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value: next, updatedBy: actorUserId, updatedAt: new Date() } })
    const events = settingsAuditEvents(previous, next)
    if (events.length) await tx.insert(auditEvents).values(events.map((event) => ({
      id: newId(), actorUserId, action: event.action, targetType: 'episodic_memory', metadata: event.metadata,
    })))
    if (!next.enabled) {
      await tx.update(episodicMemoryGenerations).set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(episodicMemoryGenerations.active, false), inArray(episodicMemoryGenerations.status, ['pending', 'pulling', 'indexing'])))
    }
  })
  if (next.enabled && (!previous.enabled || previous.profile !== next.profile)) await enqueueEpisodicReconciliation()
  return next
}

export async function requestEpisodicMemoryRebuild(actorUserId: string): Promise<void> {
  const settings = await readEpisodicMemorySettings()
  if (!settings.enabled) throw new Error('Episodic memory must be enabled before rebuilding')
  await db.insert(auditEvents).values({
    id: newId(), actorUserId, action: EPISODIC_MEMORY_AUDIT_ACTIONS.rebuild, targetType: 'episodic_memory', metadata: { profile: settings.profile },
  })
  await enqueueEpisodicReconciliation(true)
}

export async function cancelEpisodicMemoryBuild(actorUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(episodicMemoryGenerations).set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(episodicMemoryGenerations.active, false), inArray(episodicMemoryGenerations.status, ['pending', 'pulling', 'indexing'])))
    await tx.insert(auditEvents).values({
      id: newId(), actorUserId, action: EPISODIC_MEMORY_AUDIT_ACTIONS.cancel, targetType: 'episodic_memory', metadata: {},
    })
  })
  const jobs = await embeddingQueue.getJobs(['waiting', 'delayed', 'prioritized'])
  await Promise.all(jobs.filter((job) => job.data.type === 'reconcile').map((job) => job.remove()))
}

export async function hasActiveEpisodicMemory(): Promise<boolean> {
  const settings = await readEpisodicMemorySettings()
  if (!settings.enabled) return false
  const [generation] = await db.select({ id: episodicMemoryGenerations.id }).from(episodicMemoryGenerations)
    .where(and(eq(episodicMemoryGenerations.active, true), eq(episodicMemoryGenerations.status, 'ready'), ne(episodicMemoryGenerations.modelDigest, ''))).limit(1)
  return Boolean(generation)
}
