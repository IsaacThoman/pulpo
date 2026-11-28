export type EvalBucket =
  | 'navigational'
  | 'factual'
  | 'technical'
  | 'academic'
  | 'news'
  | 'local'
  | 'instant'
  | 'adversarial_slop'

export type ExpectedInstantType =
  | 'calculator'
  | 'unit_conversion'
  | 'currency'
  | 'time'
  | 'coin_flip'
  | 'developer'
  | 'dictionary'

export interface GoldenQuery {
  id: string
  query: string
  bucket: EvalBucket
  category?: 'web' | 'news' | 'images' | 'videos' | 'podcasts'
  /** Authoritative domains expected at top-1/top-3 for navigational or high-signal buckets. */
  expectedDomains?: string[]
  /** High-signal primary/authoritative domains that should rank well. */
  preferredDomains?: string[]
  /** Known SEO-farm, scraper-clone, or AI-slop domains that should be demoted. */
  slopDomains?: string[]
  /** For instant-answer queries: expected widget/answer type. */
  expectedInstantType?: ExpectedInstantType
  /** Optional regex string expected to match the instant answer value (`result`). */
  expectedInstantPattern?: string
  /** Optional regex string expected to match the instant answer label/expression (e.g. resolved city for world clock). */
  expectedInstantExpressionPattern?: string
  /** For local queries: whether the local places intent detector should fire. */
  expectLocalIntent?: boolean
  /** For news queries: whether recent results (< 30d) are expected. */
  freshnessSensitive?: boolean
  /** Concise note describing what a 3/3 perfect result looks like for judges. */
  intentNote: string
}

export interface EvalSerpResult {
  url: string
  title: string
  snippet: string
  publishedAt?: string
  provider?: string
}

export interface EvalSerpSnapshot {
  queryId: string
  query: string
  bucket: EvalBucket
  provider: string
  latencyMs: number
  /** Actual billed cost in micro-dollars, or null when provider pricing was unavailable. */
  costMicros: number | null
  cache?: 'hit' | 'stale' | 'miss'
  results: EvalSerpResult[]
}

export interface CitationEvalCase {
  id: string
  query: string
  claim: string
  citationUrl: string
  sourceTitle: string
  sourceSnippet: string
  /** Ground-truth label when available (for judge calibration). */
  expectedSupported?: boolean
}

export interface RelevanceJudgment {
  /** Graded relevance: 0 = irrelevant/spam, 1 = marginally relevant, 2 = relevant, 3 = highly relevant/authoritative. */
  relevance: 0 | 1 | 2 | 3
  /** Calibrated probability that the result is SEO spam, scraper clone, or AI slop (0..1). */
  slopProb: number
  isSlop: boolean
  /** Optional probability distribution over grades [0, 1, 2, 3]. */
  relevanceProbs?: [number, number, number, number]
  /** Optional short rationale (populated by generative judges). */
  reason?: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export interface CitationJudgment {
  supported: boolean
  supportProb: number
  reason?: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export interface SearchJudge {
  readonly name: string
  judgeResult(input: {
    query: string
    bucket: EvalBucket
    intentNote: string
    result: EvalSerpResult
  }): Promise<RelevanceJudgment>
  judgeCitation(input: {
    query: string
    claim: string
    citationUrl: string
    sourceTitle: string
    sourceSnippet: string
  }): Promise<CitationJudgment>
}

export interface LatencyStats {
  count: number
  meanMs: number
  p50Ms: number
  p90Ms: number
  p95Ms: number
  maxMs: number
}

export interface EvalScorecard {
  generatedAt: string
  mode: 'fixtures' | 'live' | 'compare-judges'
  judgeName: string
  queryCount: number
  deterministic: {
    navigationalTop1Rate: number
    navigationalTop3Rate: number
    instantAnswerAccuracy: number
    instantAnswerPassed: number
    instantAnswerTotal: number
    localIntentRecall: number
    localIntentMatched: number
    localIntentTotal: number
    zeroResultRate: number
    canonicalDuplicateRate: number
    knownSlopAt10Rate: number
    latency: LatencyStats
    /** Average cost per 1,000 queries in USD, or null when live pricing was unavailable. */
    costPer1000QueriesUsd: number | null
  }
  quality?: {
    ndcgAt10: number
    mrr: number
    judgedSlopRate: number
    citationFaithfulness: number
    judgeLatency: LatencyStats
    estimatedCostPer1000JudgmentsUsd: number
    byBucket: Record<string, { queries: number; ndcgAt10: number; mrr: number; slopRate: number }>
  }
}

export interface JudgeComparisonReport {
  generatedAt: string
  baselineJudge: string
  candidateJudge: string
  resultPairs: number
  citationPairs: number
  relevance: {
    exactAgreement: number
    withinOneAgreement: number
    spearmanRho: number
    weightedKappa: number
    mae: number
    slopAgreement: number
    baselineMeanGrade: number
    candidateMeanGrade: number
  }
  citations: {
    agreement: number
    baselineAccuracy?: number
    candidateAccuracy?: number
  }
  performance: {
    baselineLatency: LatencyStats
    candidateLatency: LatencyStats
    baselineCostPer1000Usd: number
    candidateCostPer1000Usd: number
  }
}
