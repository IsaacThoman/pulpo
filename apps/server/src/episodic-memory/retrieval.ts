import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { EpisodicMemoryProfile, EpisodicMemoryRecallMode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, chatTurnEmbeddings, episodicMemoryGenerations, memories, savedMemoryEmbeddings } from '../database/schema.js'
import { activeGeneration, userMemoryIsEnabled } from './indexer.js'
import { OllamaClient } from './ollama.js'
import { EPISODIC_MEMORY_PROFILES } from './profiles.js'
import { readEpisodicMemorySettings } from './settings.js'

const RRF_K = 60
const CHAT_CANDIDATE_LIMIT = 50

interface RankedCandidate {
  key: string
  semanticRank?: number
  semanticSimilarity?: number
  lexicalRank?: number
  lexicalScore?: number
  updatedAt: Date
}

export interface FusedCandidate extends RankedCandidate {
  score: number
}

const SEMANTIC_THRESHOLDS: Record<EpisodicMemoryProfile, Record<EpisodicMemoryRecallMode, number>> = {
  embeddinggemma: { conservative: 0.58, balanced: 0.44, eager: 0.32 },
  'qwen3-embedding': { conservative: 0.60, balanced: 0.46, eager: 0.34 },
}

const FUSION_THRESHOLDS: Record<EpisodicMemoryRecallMode, number> = {
  conservative: 0.016,
  balanced: 0.0145,
  eager: 0.012,
}

export function fuseRankedCandidates(
  candidates: RankedCandidate[],
  profile: EpisodicMemoryProfile,
  mode: EpisodicMemoryRecallMode,
  now = new Date(),
): FusedCandidate[] {
  const semanticMinimum = SEMANTIC_THRESHOLDS[profile][mode]
  return candidates.flatMap((candidate) => {
    const semanticAccepted = candidate.semanticRank !== undefined
      && (candidate.semanticSimilarity ?? -1) >= semanticMinimum
    const semantic = semanticAccepted ? 1 / (RRF_K + candidate.semanticRank!) : 0
    const lexical = candidate.lexicalRank !== undefined ? 1 / (RRF_K + candidate.lexicalRank) : 0
    const ageDays = Math.max(0, now.getTime() - candidate.updatedAt.getTime()) / 86_400_000
    const recency = 0.0005 * Math.exp(-ageDays / 365)
    const score = semantic + lexical + recency
    return score >= FUSION_THRESHOLDS[mode] ? [{ ...candidate, score }] : []
  }).sort((left, right) => right.score - left.score || right.updatedAt.getTime() - left.updatedAt.getTime())
}

export interface EpisodicChatResult {
  chatId: string
  responseId: string
  title: string
  updatedAt: string
  excerpt: string
  score: number
}

function excerpt(text: string, query: string, maxCharacters = 360): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxCharacters) return normalized
  const terms = query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length > 2)
  const lower = normalized.toLocaleLowerCase()
  const match = terms.map((term) => lower.indexOf(term)).find((index) => index >= 0) ?? 0
  const start = Math.max(0, Math.min(match - Math.floor(maxCharacters / 3), normalized.length - maxCharacters))
  return `${start ? '…' : ''}${normalized.slice(start, start + maxCharacters).trim()}${start + maxCharacters < normalized.length ? '…' : ''}`
}

export async function searchEpisodicChats(input: {
  userId: string
  query: string
  currentChatId?: string
  limit?: number
  mode?: EpisodicMemoryRecallMode
  signal?: AbortSignal
}, client = new OllamaClient()): Promise<EpisodicChatResult[]> {
  const query = input.query.replace(/\s+/g, ' ').trim().slice(0, 4_000)
  if (!query || !await userMemoryIsEnabled(input.userId)) return []
  const [settings, active] = await Promise.all([readEpisodicMemorySettings(), activeGeneration()])
  if (!settings.enabled) return []
  const [generation] = active ? [active] : await db.select().from(episodicMemoryGenerations).where(and(
    eq(episodicMemoryGenerations.profile, settings.profile),
    eq(episodicMemoryGenerations.status, 'indexing'),
  )).orderBy(desc(episodicMemoryGenerations.createdAt)).limit(1)
  if (!generation) return []
  const mode = input.mode ?? settings.recallMode
  const limit = Math.max(1, Math.min(11, Math.floor(input.limit ?? 5)))
  const common = and(
    eq(chatTurnEmbeddings.generationId, generation.id),
    eq(chatTurnEmbeddings.userId, input.userId),
    eq(chatTurnEmbeddings.status, 'ready'),
    isNotNull(chatTurnEmbeddings.embedding),
    input.currentChatId ? ne(chatTurnEmbeddings.chatId, input.currentChatId) : undefined,
    eq(chats.temporary, false),
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
    or(isNull(chats.expiresAt), gt(chats.expiresAt, new Date())),
  )
  const lexicalRankExpression = sql<number>`ts_rank_cd(${chatTurnEmbeddings.searchVector}, websearch_to_tsquery('simple', ${query}))`
  const lexicalRows = await db.select({
    key: chatTurnEmbeddings.responseId,
    responseId: chatTurnEmbeddings.responseId,
    chatId: chatTurnEmbeddings.chatId,
    title: chats.title,
    updatedAt: chats.updatedAt,
    text: chatTurnEmbeddings.chunkText,
    lexicalScore: lexicalRankExpression,
  }).from(chatTurnEmbeddings).innerJoin(chats, eq(chats.id, chatTurnEmbeddings.chatId)).where(and(
    common,
    sql`${chatTurnEmbeddings.searchVector} @@ websearch_to_tsquery('simple', ${query})`,
  )).orderBy(desc(lexicalRankExpression), desc(chats.updatedAt)).limit(CHAT_CANDIDATE_LIMIT)

  type Row = (typeof lexicalRows)[number]
  let semanticRows: Array<Row & { semanticSimilarity: number }> = []
  try {
    if (!active) throw new Error('Semantic retrieval waits for an active generation')
    const profile = EPISODIC_MEMORY_PROFILES[generation.profile as EpisodicMemoryProfile]
    const [vector] = await client.embed(profile, query, input.signal)
    const value = `[${vector!.join(',')}]`
    const distance = sql<number>`${chatTurnEmbeddings.embedding} <=> ${value}::halfvec`
    semanticRows = await db.select({
      key: chatTurnEmbeddings.responseId,
      responseId: chatTurnEmbeddings.responseId,
      chatId: chatTurnEmbeddings.chatId,
      title: chats.title,
      updatedAt: chats.updatedAt,
      text: chatTurnEmbeddings.chunkText,
      lexicalScore: sql<number>`0`,
      semanticSimilarity: sql<number>`1 - (${distance})`,
    }).from(chatTurnEmbeddings).innerJoin(chats, eq(chats.id, chatTurnEmbeddings.chatId))
      .where(common).orderBy(distance).limit(CHAT_CANDIDATE_LIMIT)
  } catch {
    // Lexical retrieval is the bounded, non-fatal fallback when Ollama is unavailable.
  }

  const rowsByKey = new Map<string, Row & { semanticSimilarity?: number }>()
  const ranks = new Map<string, RankedCandidate>()
  lexicalRows.forEach((row, index) => {
    rowsByKey.set(row.key, row)
    ranks.set(row.key, { key: row.key, lexicalRank: index + 1, lexicalScore: Number(row.lexicalScore), updatedAt: row.updatedAt })
  })
  semanticRows.forEach((row, index) => {
    rowsByKey.set(row.key, row)
    const current = ranks.get(row.key)
    ranks.set(row.key, { ...current, key: row.key, semanticRank: index + 1, semanticSimilarity: Number(row.semanticSimilarity), updatedAt: row.updatedAt })
  })
  const results: EpisodicChatResult[] = []
  const seenChats = new Set<string>()
  for (const ranked of fuseRankedCandidates([...ranks.values()], generation.profile as EpisodicMemoryProfile, mode)) {
    if (results.length >= limit) break
    const row = rowsByKey.get(ranked.key)
    if (!row || seenChats.has(row.chatId)) continue
    seenChats.add(row.chatId)
    results.push({
      chatId: row.chatId,
      responseId: row.responseId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      excerpt: excerpt(row.text, query),
      score: ranked.score,
    })
  }
  return results
}

async function newestMemories(userId: string): Promise<string[]> {
  const rows = await db.select({ content: memories.content }).from(memories).where(and(
    eq(memories.userId, userId), eq(memories.enabled, true),
  )).orderBy(desc(memories.createdAt)).limit(16)
  return rows.map((row) => row.content)
}

export function fitMemoryBudget(contents: string[], maxItems = 8, maxTokens = 500): string[] {
  const result: string[] = []
  let remainingCharacters = maxTokens * 4
  for (const content of contents) {
    if (result.length >= maxItems || remainingCharacters <= 0) break
    const normalized = content.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    const value = normalized.length <= remainingCharacters
      ? normalized
      : `${normalized.slice(0, Math.max(0, remainingCharacters - 1)).trimEnd()}…`
    if (value) result.push(value)
    remainingCharacters -= value.length
  }
  return result
}

export async function selectRelevantMemories(userId: string, query: string, client = new OllamaClient()): Promise<string[]> {
  if (!await userMemoryIsEnabled(userId)) return []
  const [settings, generation] = await Promise.all([readEpisodicMemorySettings(), activeGeneration()])
  if (!settings.enabled || !generation || !query.trim()) return fitMemoryBudget(await newestMemories(userId))
  try {
    const profile = EPISODIC_MEMORY_PROFILES[generation.profile as EpisodicMemoryProfile]
    const [vector] = await client.embed(profile, query.slice(0, 4_000))
    const value = `[${vector!.join(',')}]`
    const distance = sql<number>`${savedMemoryEmbeddings.embedding} <=> ${value}::halfvec`
    const rows = await db.select({ content: memories.content }).from(savedMemoryEmbeddings)
      .innerJoin(memories, eq(memories.id, savedMemoryEmbeddings.memoryId))
      .where(and(
        eq(savedMemoryEmbeddings.generationId, generation.id),
        eq(savedMemoryEmbeddings.userId, userId),
        eq(savedMemoryEmbeddings.status, 'ready'),
        isNotNull(savedMemoryEmbeddings.embedding),
        eq(memories.enabled, true),
      )).orderBy(distance, desc(memories.createdAt)).limit(16)
    return fitMemoryBudget(rows.map((row) => row.content))
  } catch {
    return fitMemoryBudget(await newestMemories(userId))
  }
}
