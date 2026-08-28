import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { EpisodicMemoryProfile, EpisodicMemoryRecallMode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, chatTurnEmbeddings, episodicMemoryGenerations, memories, savedMemoryEmbeddings } from '../database/schema.js'
import { activeGeneration, userMemoryIsEnabled } from './indexer.js'
import { OllamaClient } from './ollama.js'
import { EPISODIC_MEMORY_PROFILES } from './profiles.js'
import { readEpisodicMemorySettings } from './settings.js'
import { measureEpisodicMemoryOperation, recordEpisodicMemoryMetric } from './metrics.js'

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

interface SemanticThresholds {
  moderate: number
  strong: number
}

const SEMANTIC_THRESHOLDS: Record<EpisodicMemoryProfile, Record<EpisodicMemoryRecallMode, SemanticThresholds>> = {
  embeddinggemma: {
    conservative: { moderate: 0.60, strong: 0.68 },
    balanced: { moderate: 0.50, strong: 0.60 },
    eager: { moderate: 0.38, strong: 0.50 },
  },
  'qwen3-embedding': {
    conservative: { moderate: 0.62, strong: 0.70 },
    balanced: { moderate: 0.52, strong: 0.62 },
    eager: { moderate: 0.40, strong: 0.52 },
  },
}

interface LexicalThresholds {
  supporting: number
  strong: number
}

const LEXICAL_THRESHOLDS: Record<EpisodicMemoryRecallMode, LexicalThresholds> = {
  conservative: { supporting: 0.05, strong: 0.10 },
  balanced: { supporting: 0.03, strong: 0.07 },
  eager: { supporting: 0.01, strong: 0.04 },
}

const LOW_INFORMATION_QUERY_TERMS = new Set([
  'a', 'about', 'am', 'an', 'and', 'are', 'at', 'be', 'been', 'being', 'can', 'could',
  'did', 'do', 'does', 'for', 'had', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'know',
  'me', 'mine', 'my', 'myself', 'of', 'on', 'or', 'our', 'please', 'remember', 'should',
  'tell', 'that', 'the', 'these', 'this', 'those', 'to', 'was', 'we', 'were', 'what',
  'when', 'where', 'who', 'why', 'would', 'you', 'your',
  'al', 'algo', 'como', 'cómo', 'con', 'cuando', 'cuándo', 'de', 'del', 'dime',
  'donde', 'dónde', 'el', 'en', 'eres', 'es', 'eso', 'esto', 'la', 'las', 'los', 'me',
  'mi', 'mío', 'o', 'para', 'por', 'que', 'qué', 'quien', 'quién', 'recuerda', 'recuerdas',
  'saber', 'sabes', 'sobre', 'soy', 'somos', 'tu', 'tú', 'un', 'una', 'usted', 'ustedes',
  'y', 'yo',
])

export function automaticRecallQueryHasSignal(query: string): boolean {
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const informative = terms.filter((term) => term.length > 1 && !LOW_INFORMATION_QUERY_TERMS.has(term))
  if (informative.length >= 2) return true
  return informative.length === 1 && (/\d/u.test(informative[0]!) || informative[0]!.length >= 5)
}

export function fuseRankedCandidates(
  candidates: RankedCandidate[],
  profile: EpisodicMemoryProfile,
  mode: EpisodicMemoryRecallMode,
  now = new Date(),
): FusedCandidate[] {
  const semanticThresholds = SEMANTIC_THRESHOLDS[profile][mode]
  const lexicalThresholds = LEXICAL_THRESHOLDS[mode]
  return candidates.flatMap((candidate) => {
    // RRF is useful for ordering evidence, but rank is not a relevance probability. Gate on
    // absolute semantic/lexical evidence first so rank and recency can never admit noise alone.
    const semanticSimilarity = candidate.semanticSimilarity ?? -1
    const lexicalScore = candidate.lexicalScore ?? 0
    const semanticStrong = candidate.semanticRank !== undefined && semanticSimilarity >= semanticThresholds.strong
    const semanticModerate = candidate.semanticRank !== undefined && semanticSimilarity >= semanticThresholds.moderate
    const lexicalStrong = candidate.lexicalRank !== undefined && lexicalScore >= lexicalThresholds.strong
    const lexicalSupporting = candidate.lexicalRank !== undefined && lexicalScore >= lexicalThresholds.supporting
    if (!semanticStrong && !lexicalStrong && !(semanticModerate && lexicalSupporting)) return []
    const semantic = semanticModerate ? 1 / (RRF_K + candidate.semanticRank!) : 0
    const lexical = lexicalSupporting ? 1 / (RRF_K + candidate.lexicalRank!) : 0
    const ageDays = Math.max(0, now.getTime() - candidate.updatedAt.getTime()) / 86_400_000
    const recency = 0.0005 * Math.exp(-ageDays / 365)
    const score = semantic + lexical + recency
    return [{ ...candidate, score }]
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
  purpose?: 'automatic' | 'explicit'
  signal?: AbortSignal
}, client = new OllamaClient()): Promise<EpisodicChatResult[]> {
  const query = input.query.replace(/\s+/g, ' ').trim().slice(0, 4_000)
  if (!query || !await userMemoryIsEnabled(input.userId)) return []
  if (input.purpose === 'automatic' && !automaticRecallQueryHasSignal(query)) return []
  const [settings, active] = await Promise.all([readEpisodicMemorySettings(), activeGeneration()])
  if (!settings.enabled) return []
  const [generation] = active ? [active] : await db.select().from(episodicMemoryGenerations).where(and(
    eq(episodicMemoryGenerations.profile, settings.profile),
    eq(episodicMemoryGenerations.status, 'indexing'),
  )).orderBy(desc(episodicMemoryGenerations.createdAt)).limit(1)
  if (!generation) return []
  const retrievalStarted = performance.now()
  let embeddingDurationMs = 0
  let semanticFallback = false
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
  const lexicalRows = await (async () => {
    try {
      return await db.select({
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
    } catch (error) {
      const durationMs = performance.now() - retrievalStarted
      recordEpisodicMemoryMetric({ metric: 'retrieval', durationMs, error: true })
      recordEpisodicMemoryMetric({ metric: 'database_search', durationMs, error: true })
      throw error
    }
  })()

  type Row = (typeof lexicalRows)[number]
  let semanticRows: Array<Row & { semanticSimilarity: number }> = []
  try {
    if (!active) throw new Error('Semantic retrieval waits for an active generation')
    const profile = EPISODIC_MEMORY_PROFILES[generation.profile as EpisodicMemoryProfile]
    const embeddingStarted = performance.now()
    const [vector] = await measureEpisodicMemoryOperation(
      'embedding',
      () => client.embed(profile, query, input.signal),
      1,
    ).finally(() => { embeddingDurationMs += performance.now() - embeddingStarted })
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
    semanticFallback = true
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
  const durationMs = performance.now() - retrievalStarted
  recordEpisodicMemoryMetric({ metric: 'retrieval', durationMs, fallback: semanticFallback, items: results.length })
  recordEpisodicMemoryMetric({
    metric: 'database_search',
    durationMs: Math.max(0, durationMs - embeddingDurationMs),
    items: results.length,
  })
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
    const [vector] = await measureEpisodicMemoryOperation(
      'embedding',
      () => client.embed(profile, query.slice(0, 4_000), AbortSignal.timeout(10_000)),
      1,
    )
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
