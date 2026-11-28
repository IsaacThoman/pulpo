import { extractDomain, isKnownSlopUrl, matchesDomainList } from './metrics.ts'
import type { CitationJudgment, EvalBucket, EvalSerpResult, RelevanceJudgment, SearchJudge } from './types.ts'

const RELEVANCE_RUBRIC_LEVELS = [
  '0 - Irrelevant, off-topic, dead/boilerplate, or SEO/AI-slop spam that wastes the user\'s time.',
  '1 - Marginally related or shallow aggregator/listicle with little original value.',
  '2 - Relevant and useful answer or resource that addresses the user\'s query.',
  '3 - Highly relevant, authoritative, primary source or best-in-class answer for this exact query.',
]

const SLOP_INSTRUCTIONS =
  'Is this search result low-quality SEO spam, an AI-generated content farm/listicle, a scraped mirror/clone, or affiliate filler with minimal original value?'

function clampGrade(value: unknown): 0 | 1 | 2 | 3 {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(3, Math.max(0, Math.round(num))) as 0 | 1 | 2 | 3
}

function clampProb(value: unknown, fallback = 0): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(1, Math.max(0, num))
}

function formatResultState(query: string, bucket: EvalBucket, intentNote: string, result: EvalSerpResult): string {
  return [
    `Search Query: ${query}`,
    `Query Category: ${bucket}`,
    `Ideal Result Intent: ${intentNote}`,
    `Result URL: ${result.url}`,
    `Result Domain: ${extractDomain(result.url)}`,
    `Result Title: ${result.title}`,
    `Result Snippet: ${result.snippet}`,
    ...(result.publishedAt ? [`Published At: ${result.publishedAt}`] : []),
  ].join('\n')
}

function formatCitationState(input: {
  query: string
  claim: string
  citationUrl: string
  sourceTitle: string
  sourceSnippet: string
}): string {
  return [
    `User Query: ${input.query}`,
    `Claim Being Cited: ${input.claim}`,
    `Cited Source URL: ${input.citationUrl}`,
    `Cited Source Title: ${input.sourceTitle}`,
    `Cited Source Excerpt: ${input.sourceSnippet}`,
  ].join('\n')
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]!.trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Judge response did not contain JSON: ${trimmed.slice(0, 200)}`)
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
}

export interface OpenAICompatibleJudgeOptions {
  baseUrl: string
  apiKey: string
  model: string
  name?: string
  /** Input token price in USD per 1M tokens (used for cost reporting). */
  inputPricePerMillionUsd?: number
  /** Output token price in USD per 1M tokens (used for cost reporting). */
  outputPricePerMillionUsd?: number
  timeoutMs?: number
}

/**
 * LLM-as-judge adapter for any OpenAI-compatible `/chat/completions` endpoint
 * (e.g. `https://pulpo.baby/v1` with `claude-haiku-5.5`).
 */
export class OpenAICompatibleJudge implements SearchJudge {
  readonly name: string
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly model: string
  private readonly inputPricePerMillionUsd: number
  private readonly outputPricePerMillionUsd: number
  private readonly timeoutMs: number

  constructor(options: OpenAICompatibleJudgeOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`
    this.apiKey = options.apiKey
    this.model = options.model
    this.name = options.name ?? `openai:${options.model}`
    // Default rough Haiku-tier pricing if not overridden.
    this.inputPricePerMillionUsd = options.inputPricePerMillionUsd ?? 1.0
    this.outputPricePerMillionUsd = options.outputPricePerMillionUsd ?? 5.0
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  private async callJson(systemPrompt: string, userPrompt: string) {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now()
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      const latencyMs = performance.now() - started
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        lastError = new Error(`Judge HTTP ${response.status}: ${body.slice(0, 300)}`)
        if (response.status >= 500 || response.status === 429) continue
        throw lastError
      }
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = payload.choices?.[0]?.message?.content ?? ''
      try {
        const parsed = extractJsonObject(content)
        const inputTokens = payload.usage?.prompt_tokens ?? 0
        const outputTokens = payload.usage?.completion_tokens ?? 0
        const costUsd = (inputTokens * this.inputPricePerMillionUsd + outputTokens * this.outputPricePerMillionUsd) / 1_000_000
        return { parsed, latencyMs, inputTokens, outputTokens, costUsd }
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Judge failed to produce JSON')
  }

  async judgeResult(input: {
    query: string
    bucket: EvalBucket
    intentNote: string
    result: EvalSerpResult
  }): Promise<RelevanceJudgment> {
    const systemPrompt = [
      'You are a strict search quality evaluator grading web search results.',
      'Return ONLY a compact JSON object with keys:',
      '{"relevance": 0|1|2|3, "is_slop": boolean, "slop_prob": number (0..1), "reason": "short <= 15 words"}',
      'Relevance scale:',
      ...RELEVANCE_RUBRIC_LEVELS,
      'Set is_slop=true for SEO content mills, AI-generated listicles, scraper clones, or affiliate filler.',
    ].join('\n')
    const userPrompt = formatResultState(input.query, input.bucket, input.intentNote, input.result)
    const { parsed, latencyMs, inputTokens, outputTokens, costUsd } = await this.callJson(systemPrompt, userPrompt)
    const relevance = clampGrade(parsed.relevance)
    const isSlop = Boolean(parsed.is_slop)
    const slopProb = clampProb(parsed.slop_prob, isSlop ? 0.9 : 0.1)
    return {
      relevance,
      isSlop,
      slopProb,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd,
    }
  }

  async judgeCitation(input: {
    query: string
    claim: string
    citationUrl: string
    sourceTitle: string
    sourceSnippet: string
  }): Promise<CitationJudgment> {
    const systemPrompt = [
      'You are a strict citation-faithfulness verifier for AI search answers.',
      'Return ONLY a compact JSON object: {"supported": boolean, "support_prob": number (0..1), "reason": "short <= 15 words"}',
      'Mark supported=true ONLY if the cited source excerpt directly supports the specific claim without distortion or unsupported numbers/facts.',
    ].join('\n')
    const { parsed, latencyMs, inputTokens, outputTokens, costUsd } = await this.callJson(systemPrompt, formatCitationState(input))
    const supported = Boolean(parsed.supported)
    return {
      supported,
      supportProb: clampProb(parsed.support_prob, supported ? 0.95 : 0.05),
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd,
    }
  }
}

export interface BasetenDecisionJudgeOptions {
  /** Base URL of local baseten-server.py (e.g. http://127.0.0.1:8787) or hosted Baseten Decision API. */
  baseUrl: string
  apiKey?: string
  model?: string
  name?: string
  /** Optional reference price per 1M input tokens ($0.01 for hosted joey-1, $0 when self-hosted). */
  inputPricePerMillionUsd?: number
  timeoutMs?: number
}

interface BasetenDecideResponse {
  model?: string
  latency_ms?: number
  input_tokens?: number
  answers: Record<string, {
    type: 'noul' | 'choice' | 'score'
    noul?: number
    choice?: string
    score?: number
    probabilities?: number[] | Record<string, number>
  }>
}

/**
 * Single-pass calibrated decision-model judge built for Baseten's open-weight
 * decision models (`baselabs/joey-1`, `baselabs/elephant-1`, `baselabs/groundhog-1`, `baselabs/mammoth-1`).
 * Evaluates BOTH graded relevance (0..3 `score`) and SEO/AI-slop (`noul`) in ONE shared-prefix prefill!
 */
export class BasetenDecisionJudge implements SearchJudge {
  readonly name: string
  private readonly endpoint: string
  private readonly apiKey?: string
  private readonly model?: string
  private readonly inputPricePerMillionUsd: number
  private readonly timeoutMs: number

  constructor(options: BasetenDecisionJudgeOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/decide`
    this.apiKey = options.apiKey
    this.model = options.model
    this.name = options.name ?? `baseten:${options.model ?? 'joey-1'}`
    this.inputPricePerMillionUsd = options.inputPricePerMillionUsd ?? 0
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  private async decide(state: string, questions: Record<string, unknown>): Promise<{ data: BasetenDecideResponse; latencyMs: number }> {
    const started = performance.now()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(this.model ? { model: this.model } : {}),
        state,
        questions,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const latencyMs = performance.now() - started
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Baseten decision judge HTTP ${response.status}: ${body.slice(0, 300)}`)
    }
    const data = await response.json() as BasetenDecideResponse
    return { data, latencyMs: data.latency_ms ?? latencyMs }
  }

  async judgeResult(input: {
    query: string
    bucket: EvalBucket
    intentNote: string
    result: EvalSerpResult
  }): Promise<RelevanceJudgment> {
    const state = formatResultState(input.query, input.bucket, input.intentNote, input.result)
    const { data, latencyMs } = await this.decide(state, {
      relevance: {
        type: 'score',
        instructions: 'Rate how relevant, authoritative, and useful this search result is for the user query.',
        criteria: RELEVANCE_RUBRIC_LEVELS,
      },
      is_slop: {
        type: 'noul',
        instructions: SLOP_INSTRUCTIONS,
      },
    })
    const rel = data.answers.relevance
    const slop = data.answers.is_slop
    let probs: [number, number, number, number] | undefined
    if (Array.isArray(rel?.probabilities) && rel.probabilities.length === 4) {
      probs = rel.probabilities.map(v => clampProb(v)) as [number, number, number, number]
    } else if (rel?.probabilities && typeof rel.probabilities === 'object') {
      const obj = rel.probabilities as Record<string, unknown>
      if ('0' in obj && '1' in obj && '2' in obj && '3' in obj) {
        probs = [clampProb(obj['0']), clampProb(obj['1']), clampProb(obj['2']), clampProb(obj['3'])]
      }
    }
    // Use the highest-probability grade (argmax) when calibrated class probabilities exist;
    // expected value shrinks boundary classes (0 and 3) toward the interior (1 and 2).
    let grade: 0 | 1 | 2 | 3
    if (probs) {
      let bestIdx = 0
      for (let i = 1; i < probs.length; i += 1) {
        if (probs[i]! > probs[bestIdx]!) bestIdx = i
      }
      grade = bestIdx as 0 | 1 | 2 | 3
    } else {
      grade = clampGrade(rel?.score ?? 0)
    }
    const slopProb = clampProb(slop?.noul ?? 0)
    const inputTokens = data.input_tokens ?? Math.ceil(state.length / 4)
    return {
      relevance: grade,
      isSlop: slopProb >= 0.5,
      slopProb,
      relevanceProbs: probs,
      latencyMs,
      inputTokens,
      outputTokens: 0,
      costUsd: (inputTokens * this.inputPricePerMillionUsd) / 1_000_000,
    }
  }

  async judgeCitation(input: {
    query: string
    claim: string
    citationUrl: string
    sourceTitle: string
    sourceSnippet: string
  }): Promise<CitationJudgment> {
    const state = formatCitationState(input)
    const { data, latencyMs } = await this.decide(state, {
      supported: {
        type: 'noul',
        instructions: 'Does the cited source excerpt directly support the specific claim accurately without distortion or unsupported facts?',
      },
    })
    const supportProb = clampProb(data.answers.supported?.noul ?? 0)
    const inputTokens = data.input_tokens ?? Math.ceil(state.length / 4)
    return {
      supported: supportProb >= 0.5,
      supportProb,
      latencyMs,
      inputTokens,
      outputTokens: 0,
      costUsd: (inputTokens * this.inputPricePerMillionUsd) / 1_000_000,
    }
  }
}

/**
 * Zero-network deterministic heuristic judge for offline CI sanity checks.
 * Uses lexical overlap + domain signals; never a substitute for real neural/LLM judges.
 */
export class HeuristicJudge implements SearchJudge {
  readonly name = 'heuristic-offline'

  async judgeResult(input: {
    query: string
    bucket: EvalBucket
    intentNote: string
    result: EvalSerpResult
  }): Promise<RelevanceJudgment> {
    const started = performance.now()
    const isSlop = isKnownSlopUrl(input.result.url)
    const tokens = input.query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3)
    const haystack = `${input.result.title} ${input.result.snippet} ${input.result.url}`.toLowerCase()
    const matched = tokens.length ? tokens.filter(token => haystack.includes(token)).length / tokens.length : 0
    let relevance: 0 | 1 | 2 | 3 = 0
    if (isSlop) {
      relevance = matched > 0.6 ? 1 : 0
    } else if (matched >= 0.75) {
      relevance = 3
    } else if (matched >= 0.45) {
      relevance = 2
    } else if (matched >= 0.2) {
      relevance = 1
    }
    return {
      relevance,
      isSlop,
      slopProb: isSlop ? 0.92 : 0.08,
      latencyMs: performance.now() - started,
      costUsd: 0,
    }
  }

  async judgeCitation(input: {
    query: string
    claim: string
    citationUrl: string
    sourceTitle: string
    sourceSnippet: string
  }): Promise<CitationJudgment> {
    const started = performance.now()
    const claimTokens = input.claim.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4)
    const sourceText = `${input.sourceTitle} ${input.sourceSnippet}`.toLowerCase()
    const overlap = claimTokens.length
      ? claimTokens.filter(token => sourceText.includes(token)).length / claimTokens.length
      : 0
    return {
      supported: overlap >= 0.45,
      supportProb: Number(Math.min(0.99, Math.max(0.01, overlap)).toFixed(3)),
      latencyMs: performance.now() - started,
      costUsd: 0,
    }
  }
}

export function isDomainPreferred(url: string, preferred?: readonly string[]): boolean {
  return Boolean(preferred?.length && matchesDomainList(url, preferred))
}
