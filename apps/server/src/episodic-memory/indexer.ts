import { and, asc, eq, inArray, isNull, ne, notInArray, or, gt, sql } from 'drizzle-orm'
import type { EpisodicMemoryProfile } from '@pulpo/contracts'
import { db } from '../database/client.js'
import {
  auditEvents,
  chats,
  chatTurnEmbeddings,
  episodicMemoryGenerations,
  memories,
  responses,
  savedMemoryEmbeddings,
  userPreferences,
} from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { activeLineageChunks, contentHash } from './chunks.js'
import { OllamaClient } from './ollama.js'
import { EPISODIC_MEMORY_AUDIT_ACTIONS } from './audit.js'
import { EPISODIC_MEMORY_PROFILES } from './profiles.js'
import { readEpisodicMemorySettings } from './settings.js'

const EMBEDDING_BATCH_SIZE = 16

type Generation = typeof episodicMemoryGenerations.$inferSelect

export class EpisodicIndexCancelledError extends Error {
  constructor() {
    super('Episodic memory indexing was cancelled')
    this.name = 'EpisodicIndexCancelledError'
  }
}

export class EpisodicUserMemoryDisabledError extends Error {
  constructor(readonly userId: string) {
    super('The user disabled Memories while episodic indexing was running')
    this.name = 'EpisodicUserMemoryDisabledError'
  }
}

function eligibleChatCondition(now = new Date()) {
  return and(
    eq(chats.temporary, false),
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
    or(isNull(chats.expiresAt), gt(chats.expiresAt, now)),
  )
}

export async function userMemoryIsEnabled(userId: string): Promise<boolean> {
  const [preference] = await db.select({ values: userPreferences.values }).from(userPreferences)
    .where(eq(userPreferences.userId, userId)).limit(1)
  return (preference?.values as { memoryEnabled?: unknown } | undefined)?.memoryEnabled === true
}

async function assertBuildIsCurrent(generation: Generation): Promise<void> {
  const [row, settings] = await Promise.all([
    db.select({ cancelRequestedAt: episodicMemoryGenerations.cancelRequestedAt }).from(episodicMemoryGenerations)
      .where(eq(episodicMemoryGenerations.id, generation.id)).limit(1).then((rows) => rows[0]),
    readEpisodicMemorySettings(),
  ])
  if (row?.cancelRequestedAt || !settings.enabled || settings.profile !== generation.profile) throw new EpisodicIndexCancelledError()
}

async function assertUserCanIndex(userId: string): Promise<void> {
  if (!await userMemoryIsEnabled(userId)) throw new EpisodicUserMemoryDisabledError(userId)
}

async function embedChatRows(generation: Generation, client: OllamaClient, chatId: string, userId: string): Promise<void> {
  const profile = EPISODIC_MEMORY_PROFILES[generation.profile as EpisodicMemoryProfile]
  const pending = await db.select({ id: chatTurnEmbeddings.id, text: chatTurnEmbeddings.chunkText })
    .from(chatTurnEmbeddings).where(and(
      eq(chatTurnEmbeddings.generationId, generation.id),
      eq(chatTurnEmbeddings.chatId, chatId),
      ne(chatTurnEmbeddings.status, 'ready'),
    ))
  for (let offset = 0; offset < pending.length; offset += EMBEDDING_BATCH_SIZE) {
    await assertBuildIsCurrent(generation)
    await assertUserCanIndex(userId)
    const batch = pending.slice(offset, offset + EMBEDDING_BATCH_SIZE)
    try {
      const vectors = await client.embed(profile, batch.map((row) => row.text))
      await assertUserCanIndex(userId)
      await db.transaction(async (tx) => {
        for (let index = 0; index < batch.length; index += 1) {
          await tx.update(chatTurnEmbeddings).set({
            embedding: vectors[index]!, status: 'ready', error: null, indexedAt: new Date(), updatedAt: new Date(),
          }).where(eq(chatTurnEmbeddings.id, batch[index]!.id))
        }
      })
    } catch (error) {
      await db.update(chatTurnEmbeddings).set({
        status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date(),
      }).where(inArray(chatTurnEmbeddings.id, batch.map((row) => row.id)))
      throw error
    }
  }
}

export async function reconcileChatGeneration(
  generation: Generation,
  chatId: string,
  userId: string,
  client = new OllamaClient(),
): Promise<number> {
  const [[chat], memoryEnabled] = await Promise.all([
    db.select().from(chats).where(and(eq(chats.id, chatId), eq(chats.userId, userId), eligibleChatCondition())).limit(1),
    userMemoryIsEnabled(userId),
  ])
  if (!chat || !memoryEnabled) {
    await db.delete(chatTurnEmbeddings).where(and(eq(chatTurnEmbeddings.chatId, chatId), eq(chatTurnEmbeddings.userId, userId)))
    return 0
  }
  const turns = await db.select().from(responses).where(and(
    eq(responses.chatId, chatId),
    eq(responses.userId, userId),
    isNull(responses.deletedAt),
  )).orderBy(asc(responses.createdAt), asc(responses.id))
  const chunks = activeLineageChunks(chat, turns)
  const expectedIds = chunks.map((chunk) => chunk.responseId)
  if (expectedIds.length) {
    await db.delete(chatTurnEmbeddings).where(and(
      eq(chatTurnEmbeddings.generationId, generation.id),
      eq(chatTurnEmbeddings.chatId, chatId),
      notInArray(chatTurnEmbeddings.responseId, expectedIds),
    ))
  } else {
    await db.delete(chatTurnEmbeddings).where(and(
      eq(chatTurnEmbeddings.generationId, generation.id),
      eq(chatTurnEmbeddings.chatId, chatId),
    ))
    return 0
  }

  const existing = await db.select().from(chatTurnEmbeddings).where(and(
    eq(chatTurnEmbeddings.generationId, generation.id),
    eq(chatTurnEmbeddings.chatId, chatId),
  ))
  const byResponse = new Map(existing.map((row) => [row.responseId, row]))
  for (const chunk of chunks) {
    const current = byResponse.get(chunk.responseId)
    if (!current) {
      await db.insert(chatTurnEmbeddings).values({
        id: newId(), generationId: generation.id, userId, chatId, responseId: chunk.responseId,
        contentHash: chunk.contentHash, chunkText: chunk.text,
      })
    } else if (current.contentHash !== chunk.contentHash || current.status !== 'ready') {
      await db.update(chatTurnEmbeddings).set({
        contentHash: chunk.contentHash,
        chunkText: chunk.text,
        embedding: current.contentHash === chunk.contentHash ? current.embedding : null,
        status: current.contentHash === chunk.contentHash && current.embedding ? 'ready' : 'pending',
        error: null,
        updatedAt: new Date(),
      }).where(eq(chatTurnEmbeddings.id, current.id))
    }
  }
  await embedChatRows(generation, client, chatId, userId)
  return chunks.length
}

async function reconcileSavedMemories(generation: Generation, userId: string, client: OllamaClient): Promise<number> {
  const rows = await db.select().from(memories).where(and(eq(memories.userId, userId), eq(memories.enabled, true)))
  const expectedIds = rows.map((memory) => memory.id)
  if (expectedIds.length) {
    await db.delete(savedMemoryEmbeddings).where(and(
      eq(savedMemoryEmbeddings.generationId, generation.id),
      eq(savedMemoryEmbeddings.userId, userId),
      notInArray(savedMemoryEmbeddings.memoryId, expectedIds),
    ))
  } else {
    await db.delete(savedMemoryEmbeddings).where(and(
      eq(savedMemoryEmbeddings.generationId, generation.id),
      eq(savedMemoryEmbeddings.userId, userId),
    ))
    return 0
  }
  const existing = await db.select().from(savedMemoryEmbeddings).where(and(
    eq(savedMemoryEmbeddings.generationId, generation.id),
    eq(savedMemoryEmbeddings.userId, userId),
  ))
  const byMemory = new Map(existing.map((row) => [row.memoryId, row]))
  for (const memory of rows) {
    const hash = contentHash(memory.content)
    const current = byMemory.get(memory.id)
    if (!current) {
      await db.insert(savedMemoryEmbeddings).values({
        id: newId(), generationId: generation.id, userId, memoryId: memory.id,
        contentHash: hash, contentText: memory.content,
      })
    } else if (current.contentHash !== hash || current.status !== 'ready') {
      await db.update(savedMemoryEmbeddings).set({
        contentHash: hash,
        contentText: memory.content,
        embedding: current.contentHash === hash ? current.embedding : null,
        status: current.contentHash === hash && current.embedding ? 'ready' : 'pending',
        error: null,
        updatedAt: new Date(),
      }).where(eq(savedMemoryEmbeddings.id, current.id))
    }
  }

  const profile = EPISODIC_MEMORY_PROFILES[generation.profile as EpisodicMemoryProfile]
  const pending = await db.select({ id: savedMemoryEmbeddings.id, text: savedMemoryEmbeddings.contentText })
    .from(savedMemoryEmbeddings).where(and(
      eq(savedMemoryEmbeddings.generationId, generation.id),
      eq(savedMemoryEmbeddings.userId, userId),
      ne(savedMemoryEmbeddings.status, 'ready'),
    ))
  for (let offset = 0; offset < pending.length; offset += EMBEDDING_BATCH_SIZE) {
    await assertBuildIsCurrent(generation)
    await assertUserCanIndex(userId)
    const batch = pending.slice(offset, offset + EMBEDDING_BATCH_SIZE)
    try {
      const vectors = await client.embed(profile, batch.map((row) => row.text))
      await assertUserCanIndex(userId)
      await db.transaction(async (tx) => {
        for (let index = 0; index < batch.length; index += 1) {
          await tx.update(savedMemoryEmbeddings).set({
            embedding: vectors[index]!, status: 'ready', error: null, indexedAt: new Date(), updatedAt: new Date(),
          }).where(eq(savedMemoryEmbeddings.id, batch[index]!.id))
        }
      })
    } catch (error) {
      await db.update(savedMemoryEmbeddings).set({
        status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date(),
      }).where(inArray(savedMemoryEmbeddings.id, batch.map((row) => row.id)))
      throw error
    }
  }
  return rows.length
}

export async function deleteUserEpisodicMemory(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.userId, userId))
    await tx.delete(savedMemoryEmbeddings).where(eq(savedMemoryEmbeddings.userId, userId))
  })
}

export async function reconcileUserGeneration(
  generation: Generation,
  userId: string,
  client = new OllamaClient(),
): Promise<number> {
  if (!await userMemoryIsEnabled(userId)) {
    await deleteUserEpisodicMemory(userId)
    return 0
  }
  const eligible = await db.select({ id: chats.id }).from(chats).where(and(eq(chats.userId, userId), eligibleChatCondition()))
  const eligibleIds = eligible.map((chat) => chat.id)
  if (eligibleIds.length) {
    await db.delete(chatTurnEmbeddings).where(and(
      eq(chatTurnEmbeddings.generationId, generation.id),
      eq(chatTurnEmbeddings.userId, userId),
      notInArray(chatTurnEmbeddings.chatId, eligibleIds),
    ))
  } else {
    await db.delete(chatTurnEmbeddings).where(and(
      eq(chatTurnEmbeddings.generationId, generation.id),
      eq(chatTurnEmbeddings.userId, userId),
    ))
  }
  let count = 0
  for (const chat of eligible) {
    await assertBuildIsCurrent(generation)
    count += await reconcileChatGeneration(generation, chat.id, userId, client)
  }
  count += await reconcileSavedMemories(generation, userId, client)
  return count
}

async function enabledUserIds(): Promise<string[]> {
  const rows = await db.select({ userId: userPreferences.userId }).from(userPreferences)
    .where(sql`${userPreferences.values}->>'memoryEnabled' = 'true'`)
  return rows.map((row) => row.userId)
}

async function updateProgress(generationId: string): Promise<{ total: number; ready: number; failed: number }> {
  const [chatRows, memoryRows] = await Promise.all([
    db.select({ status: chatTurnEmbeddings.status }).from(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.generationId, generationId)),
    db.select({ status: savedMemoryEmbeddings.status }).from(savedMemoryEmbeddings).where(eq(savedMemoryEmbeddings.generationId, generationId)),
  ])
  const statuses = [...chatRows, ...memoryRows].map((row) => row.status)
  const progress = {
    total: statuses.length,
    ready: statuses.filter((status) => status === 'ready').length,
    failed: statuses.filter((status) => status === 'failed').length,
  }
  await db.update(episodicMemoryGenerations).set({
    totalItems: progress.total,
    completedItems: progress.ready,
    failedItems: progress.failed,
    updatedAt: new Date(),
  }).where(eq(episodicMemoryGenerations.id, generationId))
  return progress
}

async function reconciliationPass(generation: Generation, client: OllamaClient): Promise<void> {
  const userIds = await enabledUserIds()
  if (userIds.length) {
    await db.delete(chatTurnEmbeddings).where(and(
      eq(chatTurnEmbeddings.generationId, generation.id),
      notInArray(chatTurnEmbeddings.userId, userIds),
    ))
    await db.delete(savedMemoryEmbeddings).where(and(
      eq(savedMemoryEmbeddings.generationId, generation.id),
      notInArray(savedMemoryEmbeddings.userId, userIds),
    ))
  } else {
    await db.delete(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.generationId, generation.id))
    await db.delete(savedMemoryEmbeddings).where(eq(savedMemoryEmbeddings.generationId, generation.id))
  }
  for (const userId of userIds) {
    await assertBuildIsCurrent(generation)
    try {
      await reconcileUserGeneration(generation, userId, client)
    } catch (error) {
      if (!(error instanceof EpisodicUserMemoryDisabledError)) throw error
      await deleteUserEpisodicMemory(userId)
    }
    await updateProgress(generation.id)
  }
}

export async function buildAndActivateGeneration(generationId: string, client = new OllamaClient()): Promise<void> {
  const [generation] = await db.select().from(episodicMemoryGenerations)
    .where(eq(episodicMemoryGenerations.id, generationId)).limit(1)
  if (!generation || !generation.modelDigest) throw new Error('Embedding generation is not ready to index')
  await reconciliationPass(generation, client)
  // Re-read every eligible lineage once more before cutover so changes during the backfill are reconciled.
  await reconciliationPass(generation, client)
  const progress = await updateProgress(generation.id)
  if (progress.failed > 0 || progress.ready !== progress.total) {
    throw new Error(`Embedding reconciliation has ${progress.total - progress.ready} incomplete items`)
  }
  const runtime = await client.status()
  const installed = runtime.installedModels.find((model) => model.name === generation.model)
  if (!runtime.healthy || installed?.digest !== generation.modelDigest) {
    throw new Error('The installed Ollama model digest changed during indexing')
  }
  await assertBuildIsCurrent(generation)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1886747745)`)
    await tx.update(episodicMemoryGenerations).set({ active: false, updatedAt: new Date() })
      .where(eq(episodicMemoryGenerations.active, true))
    await tx.update(episodicMemoryGenerations).set({
      active: true, status: 'ready', completedAt: new Date(), error: null, updatedAt: new Date(),
    }).where(eq(episodicMemoryGenerations.id, generation.id))
    await tx.delete(chatTurnEmbeddings).where(ne(chatTurnEmbeddings.generationId, generation.id))
    await tx.delete(savedMemoryEmbeddings).where(ne(savedMemoryEmbeddings.generationId, generation.id))
    await tx.insert(auditEvents).values({
      id: newId(), action: EPISODIC_MEMORY_AUDIT_ACTIONS.modelActivate, targetType: 'episodic_memory_generation', targetId: generation.id,
      metadata: { profile: generation.profile, model: generation.model, digest: generation.modelDigest, items: progress.total },
    })
  })
}

export async function activeGeneration(): Promise<Generation | null> {
  const [generation] = await db.select().from(episodicMemoryGenerations).where(and(
    eq(episodicMemoryGenerations.active, true),
    eq(episodicMemoryGenerations.status, 'ready'),
  )).limit(1)
  return generation ?? null
}
