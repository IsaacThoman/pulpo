import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, chats, chatTurnEmbeddings, episodicMemoryGenerations, models, providerConnections, responses, userPreferences, users } from '../database/schema.js'
import { searchEpisodicChats, type EpisodicSearchDiagnostics } from './retrieval.js'
import { CHAT_INDEX_VERSION, contentHash } from './chunks.js'
import { reconcileChatGeneration } from './indexer.js'
import { OllamaClient } from './ollama.js'
import { processEmbeddingJob } from './processor.js'

vi.mock('../jobs.js', () => ({ embeddingQueue: { add: vi.fn() } }))
vi.mock('./metrics.js', () => ({
  recordEpisodicMemoryMetric: vi.fn(),
  measureEpisodicMemoryOperation: (_metric: string, operation: () => Promise<unknown>) => operation(),
}))

// Run against a migrated, disposable database; never reset an application database.
const enabled = process.env.PULPO_SEARCH_POSTGRES_TEST === '1'
if (enabled && new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !== '/pulpo_search_test') {
  throw new Error('PostgreSQL search regressions require a disposable database named pulpo_search_test')
}
const owner = randomUUID()
const otherOwner = randomUUID()
const provider = randomUUID()
const model = `search-test-${randomUUID()}`
let generationId: string
let sourceId: string
let currentId: string
const vector = (similarity = 1) => [similarity, Math.sqrt(1 - similarity ** 2), ...Array<number>(766).fill(0)]
const unavailable = { embed: vi.fn(async () => { throw new Error('Ollama offline') }) } as unknown as OllamaClient
const semantic = { embed: vi.fn(async () => [vector()]) } as unknown as OllamaClient

async function seedChat(title: string, text: string, options: {
  owner?: string; status?: 'pending' | 'failed' | 'ready'; similarity?: number
  excluded?: 'temporary' | 'deleted' | 'purging' | 'expired'
} = {}) {
  const id = randomUUID()
  const responseId = randomUUID()
  const userId = options.owner ?? owner
  await db.insert(chats).values({
    id, userId, modelId: model, title, activeBranchLeafId: responseId, activeResponseId: responseId,
    temporary: options.excluded === 'temporary',
    deletedAt: options.excluded === 'deleted' ? new Date() : null,
    purgeStartedAt: options.excluded === 'purging' ? new Date() : null,
    expiresAt: options.excluded === 'expired' ? new Date('2020-01-01') : null,
  })
  await db.insert(responses).values({ id: responseId, chatId: id, userId, modelId: model, actualModelId: model, userMessageId: randomUUID(), status: 'completed', input: [{ role: 'user', content: text }], output: [] })
  await db.insert(chatTurnEmbeddings).values({
    id: randomUUID(), generationId, userId, chatId: id, responseId,
    chunkIndex: 0, chunkText: text, contentHash: contentHash(text),
    status: options.status ?? 'ready', embedding: options.status && options.status !== 'ready' ? null : vector(options.similarity),
  })
  return { id, responseId }
}

async function search(query: string, client = unavailable, purpose: 'explicit' | 'automatic' = 'explicit') {
  let diagnostics: EpisodicSearchDiagnostics | undefined
  const results = await searchEpisodicChats({ userId: owner, currentChatId: currentId, query, purpose, onDiagnostics: (value) => { diagnostics = value } }, client)
  return { results, diagnostics }
}

describe.skipIf(!enabled)('PostgreSQL chat retrieval', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await db.delete(users).where(eq(users.id, owner))
    await db.delete(users).where(eq(users.id, otherOwner))
    await db.delete(models).where(eq(models.id, model))
    await db.delete(providerConnections).where(eq(providerConnections.id, provider))
    await db.delete(episodicMemoryGenerations)
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'episodicMemory'))
    await db.insert(users).values([
      { id: owner, email: `${owner}@pulpo.invalid`, name: 'Search owner', username: `search-${owner.slice(0, 8)}` },
      { id: otherOwner, email: `${otherOwner}@pulpo.invalid`, name: 'Other owner', username: `search-${otherOwner.slice(0, 8)}` },
    ])
    await db.insert(userPreferences).values({ userId: owner, values: { memoryEnabled: true } })
    await db.insert(providerConnections).values({ id: provider, name: 'Search test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: model, providerConnectionId: provider, upstreamModelId: model, name: 'Search test', contextWindow: 16384, maxOutputTokens: 2048 })
    await db.insert(applicationSettings).values({ key: 'episodicMemory', value: { enabled: true, profile: 'embeddinggemma', recallMode: 'balanced' } })
    generationId = randomUUID()
    await db.insert(episodicMemoryGenerations).values({ id: generationId, indexVersion: CHAT_INDEX_VERSION, profile: 'embeddinggemma', model: 'embeddinggemma:300m-qat-q4_0', dimension: 768, modelDigest: 'test-digest', status: 'ready', active: true })
    sourceId = (await seedChat('Pulpo Performance Audit', 'Static performance audit of the web app. Measure API latency and payload size across 100, 500, and 2000-turn chats.')).id
    currentId = (await seedChat('Current chat', 'A current conversation')).id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, owner))
    await db.delete(users).where(eq(users.id, otherOwner))
    await db.delete(models).where(eq(models.id, model))
    await db.delete(providerConnections).where(eq(providerConnections.id, provider))
    await queryClient.end()
  })

  it.each([
    'performance testing my web app load testing benchmark latency throughput stress test',
    'web app performance testing',
    'Can you find a previous chat about performance testing my web app?',
    'pulpo',
  ])('finds the performance audit without semantic search: %s', async (query) => {
    const result = await search(query)
    expect(result.results[0]?.chatId).toBe(sourceId)
    expect(result.diagnostics).toEqual({ availability: 'available', index: 'ready', semantic: 'unavailable' })
  })

  it('keeps unrelated searches empty', async () => {
    expect((await search('hibiscus ceramic gardening')).results).toEqual([])
  })

  it('ranks broader term coverage above repeated incidental matches', async () => {
    await seedChat('Repeated words', 'quartz deployment '.repeat(30))
    const relevant = await seedChat('Decision notes', 'Quartz otter deployment decision')
    expect((await search('quartz otter deployment decision')).results[0]?.chatId).toBe(relevant.id)
  })

  it('searches live titles before an embedding generation exists, including renames', async () => {
    await db.delete(episodicMemoryGenerations)
    await db.update(chats).set({ title: 'Quartz Otter capacity plan' }).where(eq(chats.id, sourceId))
    const result = await search('quartz otter')
    expect(result.results[0]?.chatId).toBe(sourceId)
    expect(result.diagnostics?.index).toBe('unavailable')
  })

  it('reports chats awaiting initial text indexing as incomplete', async () => {
    await db.delete(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.chatId, sourceId))
    const result = await search('pulpo')
    expect(result.results[0]?.chatId).toBe(sourceId)
    expect(result.diagnostics?.index).toBe('incomplete')
  })

  it.each(['pending', 'failed'] as const)('searches text with %s embeddings and reports partial coverage', async (status) => {
    const source = await seedChat('Notes', 'Quartz otter deployment decision', { status })
    const result = await search('quartz deployment')
    expect(result.results[0]?.chatId).toBe(source.id)
    expect(result.diagnostics?.index).toBe('incomplete')
    await db.update(episodicMemoryGenerations).set({ active: false, status: 'failed' }).where(eq(episodicMemoryGenerations.id, generationId))
    expect((await search('quartz deployment')).results[0]?.chatId).toBe(source.id)
  })

  it('applies ownership, current-chat, expiry and deletion exclusions to both titles and passages', async () => {
    for (const excluded of ['temporary', 'deleted', 'purging', 'expired'] as const) {
      await seedChat('Pulpo Performance Audit', 'pulpo performance audit web app', { excluded })
    }
    await seedChat('Pulpo Performance Audit', 'pulpo performance audit web app', { owner: otherOwner })
    await db.update(chats).set({ title: 'Pulpo Performance Audit' }).where(eq(chats.id, currentId))
    expect((await search('pulpo performance')).results.map((row) => row.chatId)).toEqual([sourceId])
    expect((await search('pulpo performance', semantic)).results.map((row) => row.chatId)).toEqual([sourceId])
    await db.update(userPreferences).set({ values: { memoryEnabled: false } }).where(eq(userPreferences.userId, owner))
    expect(await search('pulpo performance')).toEqual({ results: [], diagnostics: { availability: 'disabled', index: 'unavailable', semantic: 'unavailable' } })
  })

  it('admits moderate semantic matches only on explicit search and rejects weak neighbors', async () => {
    await db.update(applicationSettings).set({ value: { enabled: true, profile: 'embeddinggemma', recallMode: 'conservative' } }).where(eq(applicationSettings.key, 'episodicMemory'))
    await db.update(chatTurnEmbeddings).set({ embedding: vector(0.2) })
    const match = await seedChat('Notes', 'Alternative phrasing', { similarity: 0.59 })
    expect((await search('scalability investigation', semantic)).results.map((row) => row.chatId)).toEqual([match.id])
    expect((await search('scalability investigation', semantic, 'automatic')).results).toEqual([])
  })

  it('reserves candidate slots for distinct chats even when one has over fifty matching passages', async () => {
    const crowded = await seedChat('Many measurements', 'quartz deployment')
    await db.insert(chatTurnEmbeddings).values(Array.from({ length: 60 }, (_, index) => ({
      id: randomUUID(), generationId, userId: owner, chatId: crowded.id, responseId: crowded.responseId,
      chunkIndex: index + 1, chunkText: 'quartz deployment '.repeat(10), contentHash: 'test', embedding: vector(), status: 'ready',
    })))
    const second = await seedChat('Other notes', 'quartz deployment', { similarity: 0.7 })
    const results = (await search('quartz deployment', semantic)).results
    expect(results.map((row) => row.chatId)).toContain(second.id)
    expect(results.filter((row) => row.chatId === crowded.id)).toHaveLength(1)
  })

  it('indexes long-answer tails and removes obsolete passages after an edit, despite an embedding outage', async () => {
    const source = await seedChat('Long notes', 'short text')
    const [generation] = await db.select().from(episodicMemoryGenerations).where(eq(episodicMemoryGenerations.id, generationId))
    await db.update(responses).set({ output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'SECRET_REASONING' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `${'Ordinary measurements. '.repeat(600)}Quartz otter final recommendation.` }] },
    ] }).where(eq(responses.id, source.responseId))
    await expect(reconcileChatGeneration(generation!, source.id, owner, unavailable)).rejects.toThrow('offline')
    expect((await search('quartz otter')).results[0]?.chatId).toBe(source.id)
    const passages = await db.select().from(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.chatId, source.id))
    expect(passages.length).toBeGreaterThan(3)
    expect(passages.map((row) => row.chunkText).join(' ')).not.toContain('SECRET_REASONING')
    await db.update(responses).set({ output: [] }).where(eq(responses.id, source.responseId))
    await expect(reconcileChatGeneration(generation!, source.id, owner, unavailable)).rejects.toThrow('offline')
    expect((await db.select().from(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.chatId, source.id))).length).toBe(1)
    expect((await search('quartz otter')).results).toEqual([])
  })

  it('upgrades legacy indexes during normal reconciliation and leaves current ones alone', async () => {
    await db.update(episodicMemoryGenerations).set({ indexVersion: 1 }).where(eq(episodicMemoryGenerations.id, generationId))
    vi.spyOn(OllamaClient.prototype, 'status').mockResolvedValue({ healthy: true, version: 'test', error: null, installedModels: [{ name: 'embeddinggemma:300m-qat-q4_0', digest: 'test-digest', size: 1 }] })
    const embed = vi.spyOn(OllamaClient.prototype, 'embed').mockImplementation(async (_profile, input) => (Array.isArray(input) ? input : [input]).map(() => vector()))
    await processEmbeddingJob({ type: 'reconcile' })
    const [active] = await db.select().from(episodicMemoryGenerations).where(eq(episodicMemoryGenerations.active, true))
    expect(active?.id).not.toBe(generationId)
    expect(active?.indexVersion).toBe(CHAT_INDEX_VERSION)
    embed.mockClear()
    await processEmbeddingJob({ type: 'reconcile' })
    expect(embed).not.toHaveBeenCalled()
  })

  it('keeps the previous active generation searchable if the upgrade fails', async () => {
    await db.update(episodicMemoryGenerations).set({ indexVersion: 1 }).where(eq(episodicMemoryGenerations.id, generationId))
    vi.spyOn(OllamaClient.prototype, 'status').mockResolvedValue({ healthy: false, version: null, error: 'offline', installedModels: [] })
    await expect(processEmbeddingJob({ type: 'reconcile' })).rejects.toThrow('offline')
    const [active] = await db.select().from(episodicMemoryGenerations).where(eq(episodicMemoryGenerations.active, true))
    expect(active?.id).toBe(generationId)
    expect((await search('web performance')).results[0]?.chatId).toBe(sourceId)
  })

  it('propagates cancellation rather than returning a misleading empty result', async () => {
    const controller = new AbortController()
    const client = { embed: async () => { controller.abort(new Error('cancelled')); throw new Error('cancelled') } } as unknown as OllamaClient
    await expect(searchEpisodicChats({ userId: owner, query: 'performance', purpose: 'explicit', signal: controller.signal }, client)).rejects.toThrow('cancelled')
  })
})
