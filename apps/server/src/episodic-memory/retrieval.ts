import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { EpisodicMemoryProfile, EpisodicMemoryRecallMode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { chats, chatTurnEmbeddings, episodicMemoryGenerations } from '../database/schema.js'
import { CHAT_INDEX_VERSION } from './chunks.js'
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
  titleRank?: number
  titleCoverage?: number
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
  purpose: 'automatic' | 'explicit' = 'automatic',
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
    const explicitMatch = purpose === 'explicit' && (semanticModerate || lexicalSupporting || candidate.titleRank !== undefined)
    if (!explicitMatch && !semanticStrong && !lexicalStrong && !(semanticModerate && lexicalSupporting)) return []
    const semantic = semanticModerate ? 1 / (RRF_K + candidate.semanticRank!) : 0
    const lexical = lexicalSupporting ? 1 / (RRF_K + candidate.lexicalRank!) : 0
    const ageDays = Math.max(0, now.getTime() - candidate.updatedAt.getTime()) / 86_400_000
    const recency = 0.0005 * Math.exp(-ageDays / 365)
    const title = purpose === 'explicit' && candidate.titleRank !== undefined
      ? 1.25 * (0.5 + 0.5 * (candidate.titleCoverage ?? 0)) / (RRF_K + candidate.titleRank) : 0
    const score = semantic + lexical + title + recency
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

const SEARCH_FILLER_TERMS = new Set(['find', 'search', 'chat', 'chats', 'conversation', 'conversations', 'previous', 'past', 'earlier', 'discussed'])

export function explicitSearchTerms(query: string): string[] {
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms.filter((term) =>
    !LOW_INFORMATION_QUERY_TERMS.has(term) && !SEARCH_FILLER_TERMS.has(term),
  ))].slice(0, 32)
}

export interface EpisodicSearchDiagnostics {
  availability: 'available' | 'disabled'
  index: 'ready' | 'incomplete' | 'unavailable'
  semantic: 'available' | 'unavailable'
}

export async function searchEpisodicChats(input: {
  userId: string
  query: string
  currentChatId?: string
  limit?: number
  mode?: EpisodicMemoryRecallMode
  purpose?: 'automatic' | 'explicit'
  signal?: AbortSignal
  onDiagnostics?: (diagnostics: EpisodicSearchDiagnostics) => void
}, client = new OllamaClient()): Promise<EpisodicChatResult[]> {
  input.signal?.throwIfAborted()
  const query = input.query.replace(/\s+/g, ' ').trim().slice(0, 4_000)
  const diagnostics: EpisodicSearchDiagnostics = { availability: 'available', index: 'unavailable', semantic: 'unavailable' }
  const finish = (results: EpisodicChatResult[]) => {
    input.signal?.throwIfAborted()
    input.onDiagnostics?.(diagnostics)
    return results
  }
  if (!query) return finish([])
  if (!await userMemoryIsEnabled(input.userId)) {
    diagnostics.availability = 'disabled'
    return finish([])
  }
  if (input.purpose === 'automatic' && !automaticRecallQueryHasSignal(query)) return finish([])
  const [settings, active] = await Promise.all([readEpisodicMemorySettings(), activeGeneration()])
  if (!settings.enabled) {
    diagnostics.availability = 'disabled'
    return finish([])
  }
  const explicit = input.purpose === 'explicit'
  const terms = explicitSearchTerms(query)
  if (explicit && !terms.length) return finish([])
  // Failed builds can still contain useful text. Text retrieval never requires a vector.
  const [generation] = active ? [active] : await db.select().from(episodicMemoryGenerations).where(and(
    eq(episodicMemoryGenerations.profile, settings.profile),
    or(eq(episodicMemoryGenerations.status, 'indexing'), eq(episodicMemoryGenerations.status, 'failed')),
  )).orderBy(desc(episodicMemoryGenerations.createdAt)).limit(1)
  const retrievalStarted = performance.now()
  let embeddingDurationMs = 0
  // The automatic-recall preference controls unsolicited context, not the
  // candidate list requested by the user. Explicit callers may still override it.
  const mode = input.mode ?? (explicit ? 'balanced' : settings.recallMode)
  const limit = Math.max(1, Math.min(11, Math.floor(input.limit ?? 5)))
  const eligibleChat = and(
    eq(chats.userId, input.userId),
    input.currentChatId ? ne(chats.id, input.currentChatId) : undefined,
    eq(chats.temporary, false),
    isNull(chats.deletedAt),
    isNull(chats.purgeStartedAt),
    or(isNull(chats.expiresAt), gt(chats.expiresAt, new Date())),
  )
  const common = and(
    generation ? eq(chatTurnEmbeddings.generationId, generation.id) : sql`false`,
    eq(chatTurnEmbeddings.userId, input.userId),
    eligibleChat,
  )
  // Tokenize as data rather than passing agent-generated operators through. OR
  // gathers partial matches; matched-term counts rank coverage above repetition.
  const textQuery = explicit
    ? sql`to_tsquery('simple', ${terms.map((term) => `'${term}'`).join(' | ')})`
    : sql`websearch_to_tsquery('simple', ${query})`
  const coverage = (vector: ReturnType<typeof sql>) => sql<number>`(${sql.join(
    terms.map((term) => sql`case when ${vector} @@ plainto_tsquery('simple', ${term}) then 1 else 0 end`),
    sql` + `,
  )})`
  const bodyVector = sql`${chatTurnEmbeddings.searchVector}`
  const bodyCoverage = explicit ? coverage(bodyVector) : sql<number>`0::integer`
  const lexicalRankExpression = sql<number>`ts_rank_cd(${bodyVector}, ${textQuery})`
  const titleVector = sql`to_tsvector('simple', ${chats.title})`
  const leafId = sql<string>`coalesce(${chats.activeBranchLeafId}, ${chats.activeResponseId})`
  type Row = {
    key: string; responseId: string; chatId: string; title: string; updatedAt: Date; text: string
    lexicalScore: number; semanticSimilarity?: number; titleCoverage?: number
  }
  let lexicalRows: Row[] = []
  let titleRows: Row[] = []
  try {
    if (generation) {
      diagnostics.index = !active || generation.indexVersion !== CHAT_INDEX_VERSION ? 'incomplete' : 'ready'
      if (input.onDiagnostics) {
        const [[pending], [unindexed]] = await Promise.all([
          db.select({ id: chatTurnEmbeddings.id }).from(chatTurnEmbeddings)
            .innerJoin(chats, eq(chats.id, chatTurnEmbeddings.chatId))
            .where(and(common, or(ne(chatTurnEmbeddings.status, 'ready'), isNull(chatTurnEmbeddings.embedding)))).limit(1),
          db.select({ id: chats.id }).from(chats).where(and(
            eligibleChat, isNotNull(leafId),
            sql`not exists (select 1 from ${chatTurnEmbeddings} where ${chatTurnEmbeddings.chatId} = ${chats.id}
              and ${chatTurnEmbeddings.generationId} = ${generation.id} and ${chatTurnEmbeddings.userId} = ${input.userId})`,
          )).limit(1),
        ])
        if (pending || unindexed) diagnostics.index = 'incomplete'
      }
      // Select a best passage per chat BEFORE the global cap, so one long chat
      // cannot consume all candidate slots. Fusion also combines evidence by chat.
      const matches = db.selectDistinctOn([chatTurnEmbeddings.chatId], {
        key: sql<string>`${chatTurnEmbeddings.chatId}`.as('candidate_key'),
        responseId: chatTurnEmbeddings.responseId,
        chatId: chatTurnEmbeddings.chatId,
        title: chats.title,
        updatedAt: chats.updatedAt,
        text: chatTurnEmbeddings.chunkText,
        lexicalScore: lexicalRankExpression.as('lexical_score'),
        coverage: bodyCoverage.as('coverage'),
      }).from(chatTurnEmbeddings).innerJoin(chats, eq(chats.id, chatTurnEmbeddings.chatId)).where(and(
        common,
        sql`${bodyVector} @@ ${textQuery}`,
        explicit ? sql`${bodyCoverage} >= ${Math.min(2, terms.length)}` : undefined,
      )).orderBy(chatTurnEmbeddings.chatId, desc(bodyCoverage), desc(lexicalRankExpression), chatTurnEmbeddings.id).as('lexical_matches')
      lexicalRows = await db.select().from(matches).orderBy(desc(matches.coverage), desc(matches.lexicalScore), desc(matches.updatedAt)).limit(CHAT_CANDIDATE_LIMIT)
    }
    if (explicit) {
      titleRows = await db.select({
        key: chats.id, chatId: chats.id, responseId: leafId, title: chats.title,
        updatedAt: chats.updatedAt, text: chats.title, lexicalScore: sql<number>`0`,
        titleCoverage: sql<number>`${coverage(titleVector)}::float / ${terms.length}`,
      }).from(chats).where(and(eligibleChat, isNotNull(leafId), sql`${titleVector} @@ ${textQuery}`))
        .orderBy(desc(coverage(titleVector)), desc(chats.updatedAt), chats.id).limit(CHAT_CANDIDATE_LIMIT)
    }
  } catch (error) {
    const durationMs = performance.now() - retrievalStarted
    recordEpisodicMemoryMetric({ metric: 'retrieval', durationMs, error: true })
    recordEpisodicMemoryMetric({ metric: 'database_search', durationMs, error: true })
    throw error
  }

  let semanticRows: Row[] = []
  try {
    if (!active || !generation) throw new Error('Semantic retrieval waits for an active generation')
    input.signal?.throwIfAborted()
    const profile = EPISODIC_MEMORY_PROFILES[generation.profile as EpisodicMemoryProfile]
    const embeddingStarted = performance.now()
    const timeout = AbortSignal.timeout(10_000)
    const embeddingSignal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    const [vector] = await measureEpisodicMemoryOperation(
      'embedding',
      () => client.embed(profile, query, embeddingSignal),
      1,
    ).finally(() => { embeddingDurationMs += performance.now() - embeddingStarted })
    const value = `[${vector!.join(',')}]`
    const distance = sql<number>`${chatTurnEmbeddings.embedding} <=> ${value}::halfvec`
    const matches = db.selectDistinctOn([chatTurnEmbeddings.chatId], {
      key: sql<string>`${chatTurnEmbeddings.chatId}`.as('candidate_key'),
      responseId: chatTurnEmbeddings.responseId,
      chatId: chatTurnEmbeddings.chatId,
      title: chats.title,
      updatedAt: chats.updatedAt,
      text: chatTurnEmbeddings.chunkText,
      lexicalScore: sql<number>`0`.as('lexical_score'),
      semanticSimilarity: sql<number>`1 - (${distance})`.as('semantic_similarity'),
    }).from(chatTurnEmbeddings).innerJoin(chats, eq(chats.id, chatTurnEmbeddings.chatId))
      .where(and(common, eq(chatTurnEmbeddings.status, 'ready'), isNotNull(chatTurnEmbeddings.embedding)))
      .orderBy(chatTurnEmbeddings.chatId, distance, chatTurnEmbeddings.id).as('semantic_matches')
    semanticRows = await db.select().from(matches).orderBy(desc(matches.semanticSimilarity), matches.chatId).limit(CHAT_CANDIDATE_LIMIT)
    diagnostics.semantic = 'available'
  } catch {
    input.signal?.throwIfAborted()
    // Report degraded search to the caller without losing usable text matches.
  }

  const rowsByKey = new Map<string, Row>()
  const ranks = new Map<string, RankedCandidate>()
  titleRows.forEach((row, index) => {
    rowsByKey.set(row.key, row)
    ranks.set(row.key, { key: row.key, titleRank: index + 1, titleCoverage: Number(row.titleCoverage), updatedAt: row.updatedAt })
  })
  lexicalRows.forEach((row, index) => {
    rowsByKey.set(row.key, row)
    ranks.set(row.key, { ...ranks.get(row.key), key: row.key, lexicalRank: index + 1, lexicalScore: Number(row.lexicalScore), updatedAt: row.updatedAt })
  })
  semanticRows.forEach((row, index) => {
    const current = ranks.get(row.key)
    // Prefer the keyword passage when available; title-only matches benefit from
    // a semantic passage only when it clears the same relevance floor.
    if ((current?.lexicalScore ?? 0) < LEXICAL_THRESHOLDS[mode].supporting && Number(row.semanticSimilarity) >= SEMANTIC_THRESHOLDS[generation!.profile as EpisodicMemoryProfile][mode].moderate) rowsByKey.set(row.key, row)
    if (!rowsByKey.has(row.key)) rowsByKey.set(row.key, row)
    ranks.set(row.key, { ...current, key: row.key, semanticRank: index + 1, semanticSimilarity: Number(row.semanticSimilarity), updatedAt: row.updatedAt })
  })
  const results: EpisodicChatResult[] = []
  for (const ranked of fuseRankedCandidates([...ranks.values()], (generation?.profile ?? settings.profile) as EpisodicMemoryProfile, mode, new Date(), explicit ? 'explicit' : 'automatic')) {
    if (results.length >= limit) break
    const row = rowsByKey.get(ranked.key)
    if (!row) continue
    results.push({
      chatId: row.chatId,
      responseId: row.responseId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      excerpt: excerpt(row.text, explicit ? terms.join(' ') : query),
      score: ranked.score,
    })
  }
  const durationMs = performance.now() - retrievalStarted
  recordEpisodicMemoryMetric({ metric: 'retrieval', durationMs, fallback: diagnostics.semantic === 'unavailable', items: results.length })
  recordEpisodicMemoryMetric({ metric: 'database_search', durationMs: Math.max(0, durationMs - embeddingDurationMs), items: results.length })
  return finish(results)
}
