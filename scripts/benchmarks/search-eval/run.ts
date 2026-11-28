import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseCurrencyQuery } from '../../../apps/search/src/currency.ts'
import { instantAnswer } from '../../../apps/search/src/instant-answer.ts'
import { placeIntent } from '../../../apps/search/src/places.ts'
import { BUCKET_COUNTS, GOLDEN_QUERIES } from './dataset.ts'
import { BENCHMARK_SERP_FIXTURES, CITATION_EVAL_CASES } from './fixtures.ts'
import { BasetenDecisionJudge, HeuristicJudge, OpenAICompatibleJudge } from './judges.ts'
import {
  canonicalDuplicateRate,
  isKnownSlopUrl,
  matchesDomainList,
  ndcgAtK,
  quadraticWeightedKappa,
  reciprocalRank,
  spearmanCorrelation,
  summarizeLatencies,
} from './metrics.ts'
import type {
  EvalScorecard,
  EvalSerpSnapshot,
  GoldenQuery,
  JudgeComparisonReport,
  SearchJudge,
} from './types.ts'

const QUERY_BY_ID = new Map(GOLDEN_QUERIES.map(item => [item.id, item]))

export function evaluateInstantAnswerQuery(query: GoldenQuery): { passed: boolean; actualLabel?: string; actualText?: string } {
  if (!query.expectedInstantType) return { passed: true }
  if (query.expectedInstantType === 'currency') {
    const parsed = parseCurrencyQuery(query.query)
    return {
      passed: Boolean(parsed),
      actualLabel: parsed ? 'Currency' : undefined,
      actualText: parsed ? `${parsed.amount} ${parsed.from} -> ${parsed.to}` : undefined,
    }
  }
  const ans = instantAnswer(query.query)
  if (!ans) return { passed: false }
  const labelMap: Record<string, GoldenQuery['expectedInstantType']> = {
    'Calculator': 'calculator',
    'Unit conversion': 'unit_conversion',
    'Local time': 'time',
    'Time difference': 'time',
    'Time conversion': 'time',
    'Coin flip': 'coin_flip',
    'Number conversion': 'developer',
  }
  const actualType = labelMap[ans.label]
  if (actualType !== query.expectedInstantType) {
    return { passed: false, actualLabel: ans.label, actualText: ans.result }
  }
  if (query.expectedInstantPattern) {
    const regex = new RegExp(query.expectedInstantPattern, 'i')
    if (!regex.test(ans.result)) {
      return { passed: false, actualLabel: ans.label, actualText: ans.result }
    }
  }
  if (query.expectedInstantExpressionPattern) {
    const regex = new RegExp(query.expectedInstantExpressionPattern, 'i')
    if (!regex.test(ans.expression)) {
      return { passed: false, actualLabel: ans.label, actualText: ans.result }
    }
  }
  return { passed: true, actualLabel: ans.label, actualText: ans.result }
}

export function evaluateLocalIntentQuery(query: GoldenQuery): boolean {
  if (!query.expectLocalIntent) return true
  return Boolean(placeIntent(query.query))
}

async function runWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await worker(items[idx]!, idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, lane))
  return results
}

export async function runScorecard(options: {
  mode: 'fixtures' | 'live'
  snapshots: readonly EvalSerpSnapshot[]
  judge?: SearchJudge
  concurrency?: number
}): Promise<EvalScorecard> {
  const concurrency = options.concurrency ?? (options.judge instanceof BasetenDecisionJudge ? 1 : 4)

  // 1. Deterministic checks on the full 260-query dataset (instant answers + local intent)
  const instantQueries = GOLDEN_QUERIES.filter(q => q.bucket === 'instant')
  const instantPassed = instantQueries.filter(q => evaluateInstantAnswerQuery(q).passed).length
  const localQueries = GOLDEN_QUERIES.filter(q => q.bucket === 'local')
  const localMatched = localQueries.filter(q => evaluateLocalIntentQuery(q)).length

  // 2. Deterministic checks on the SERP snapshots
  const navSnapshots = options.snapshots.filter(s => s.bucket === 'navigational')
  let navTop1 = 0
  let navTop3 = 0
  for (const snap of navSnapshots) {
    const meta = QUERY_BY_ID.get(snap.queryId)
    const expected = meta?.expectedDomains ?? []
    if (!expected.length) continue
    if (snap.results[0] && matchesDomainList(snap.results[0].url, expected)) navTop1 += 1
    if (snap.results.slice(0, 3).some(r => matchesDomainList(r.url, expected))) navTop3 += 1
  }

  const zeroResults = options.snapshots.filter(s => s.results.length === 0).length
  const dupRates = options.snapshots.map(s => canonicalDuplicateRate(s.results))
  const avgDupRate = dupRates.length ? dupRates.reduce((a, b) => a + b, 0) / dupRates.length : 0

  let top10Slots = 0
  let knownSlopSlots = 0
  for (const snap of options.snapshots) {
    const meta = QUERY_BY_ID.get(snap.queryId)
    for (const r of snap.results.slice(0, 10)) {
      top10Slots += 1
      if (isKnownSlopUrl(r.url, meta?.slopDomains)) knownSlopSlots += 1
    }
  }

  const latencies = options.snapshots.map(s => s.latencyMs)
  const pricedSnapshots = options.snapshots.filter((s): s is EvalSerpSnapshot & { costMicros: number } => s.costMicros !== null)
  const costPer1000QueriesUsd = options.snapshots.length && pricedSnapshots.length === options.snapshots.length
    ? Number((((pricedSnapshots.reduce((acc, s) => acc + s.costMicros, 0) / pricedSnapshots.length) * 1000) / 1_000_000).toFixed(4))
    : null

  const scorecard: EvalScorecard = {
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    judgeName: options.judge?.name ?? 'none',
    queryCount: options.snapshots.length,
    deterministic: {
      navigationalTop1Rate: navSnapshots.length ? Number((navTop1 / navSnapshots.length).toFixed(4)) : 0,
      navigationalTop3Rate: navSnapshots.length ? Number((navTop3 / navSnapshots.length).toFixed(4)) : 0,
      instantAnswerAccuracy: instantQueries.length ? Number((instantPassed / instantQueries.length).toFixed(4)) : 0,
      instantAnswerPassed: instantPassed,
      instantAnswerTotal: instantQueries.length,
      localIntentRecall: localQueries.length ? Number((localMatched / localQueries.length).toFixed(4)) : 0,
      localIntentMatched: localMatched,
      localIntentTotal: localQueries.length,
      zeroResultRate: options.snapshots.length ? Number((zeroResults / options.snapshots.length).toFixed(4)) : 0,
      canonicalDuplicateRate: Number(avgDupRate.toFixed(4)),
      knownSlopAt10Rate: top10Slots ? Number((knownSlopSlots / top10Slots).toFixed(4)) : 0,
      latency: summarizeLatencies(latencies),
      costPer1000QueriesUsd,
    },
  }

  // 3. Judge relevance, anti-slop & citation faithfulness
  if (options.judge) {
    const judge = options.judge
    const resultTasks = options.snapshots.flatMap(snap => {
      const meta = QUERY_BY_ID.get(snap.queryId)
      return snap.results.slice(0, 10).map((result, rank) => ({
        snap,
        rank,
        result,
        intentNote: meta?.intentNote ?? `Relevant, high-signal result for "${snap.query}"`,
      }))
    })

    const judgments = await runWithConcurrency(resultTasks, concurrency, async task => {
      const judgment = await judge.judgeResult({
        query: task.snap.query,
        bucket: task.snap.bucket,
        intentNote: task.intentNote,
        result: task.result,
      })
      return { task, judgment }
    })

    // Seed every snapshot so empty/zero-result queries contribute 0 to NDCG@10 and MRR instead of being omitted.
    const gradesByQuery = new Map<string, { bucket: string; grades: number[]; slopCount: number }>()
    for (const snap of options.snapshots) {
      gradesByQuery.set(snap.queryId, { bucket: snap.bucket, grades: [], slopCount: 0 })
    }
    const judgeLatencies: number[] = []
    let totalJudgeCostUsd = 0
    let totalJudgedSlop = 0

    for (const { task, judgment } of judgments) {
      judgeLatencies.push(judgment.latencyMs)
      totalJudgeCostUsd += judgment.costUsd ?? 0
      if (judgment.isSlop) totalJudgedSlop += 1
      const entry = gradesByQuery.get(task.snap.queryId)!
      entry.grades[task.rank] = judgment.relevance
      if (judgment.isSlop) entry.slopCount += 1
    }

    const byBucketAcc: Record<string, { ndcgs: number[]; mrrs: number[]; slop: number; total: number }> = {}
    const allNdcg: number[] = []
    const allMrr: number[] = []
    for (const entry of gradesByQuery.values()) {
      const grades = entry.grades.map(g => g ?? 0)
      const qNdcg = ndcgAtK(grades, 10)
      const qMrr = reciprocalRank(grades, 2)
      allNdcg.push(qNdcg)
      allMrr.push(qMrr)
      const bucketEntry = byBucketAcc[entry.bucket] ?? { ndcgs: [], mrrs: [], slop: 0, total: 0 }
      bucketEntry.ndcgs.push(qNdcg)
      bucketEntry.mrrs.push(qMrr)
      bucketEntry.slop += entry.slopCount
      bucketEntry.total += grades.length
      byBucketAcc[entry.bucket] = bucketEntry
    }

    const citationJudgments = await runWithConcurrency(CITATION_EVAL_CASES, concurrency, async item => {
      const judgment = await judge.judgeCitation({
        query: item.query,
        claim: item.claim,
        citationUrl: item.citationUrl,
        sourceTitle: item.sourceTitle,
        sourceSnippet: item.sourceSnippet,
      })
      return { item, judgment }
    })
    for (const { judgment } of citationJudgments) {
      judgeLatencies.push(judgment.latencyMs)
      totalJudgeCostUsd += judgment.costUsd ?? 0
    }
    const citationAccuracy = citationJudgments.length
      ? citationJudgments.filter(({ item, judgment }) =>
        item.expectedSupported === undefined ? judgment.supported : judgment.supported === item.expectedSupported,
      ).length / citationJudgments.length
      : 0

    const totalJudgments = judgments.length + citationJudgments.length
    const byBucket: Record<string, { queries: number; ndcgAt10: number; mrr: number; slopRate: number }> = {}
    for (const [bucket, acc] of Object.entries(byBucketAcc)) {
      byBucket[bucket] = {
        queries: acc.ndcgs.length,
        ndcgAt10: Number((acc.ndcgs.reduce((a, b) => a + b, 0) / acc.ndcgs.length).toFixed(4)),
        mrr: Number((acc.mrrs.reduce((a, b) => a + b, 0) / acc.mrrs.length).toFixed(4)),
        slopRate: acc.total ? Number((acc.slop / acc.total).toFixed(4)) : 0,
      }
    }

    scorecard.quality = {
      ndcgAt10: allNdcg.length ? Number((allNdcg.reduce((a, b) => a + b, 0) / allNdcg.length).toFixed(4)) : 0,
      mrr: allMrr.length ? Number((allMrr.reduce((a, b) => a + b, 0) / allMrr.length).toFixed(4)) : 0,
      judgedSlopRate: judgments.length ? Number((totalJudgedSlop / judgments.length).toFixed(4)) : 0,
      citationFaithfulness: Number(citationAccuracy.toFixed(4)),
      judgeLatency: summarizeLatencies(judgeLatencies),
      estimatedCostPer1000JudgmentsUsd: totalJudgments
        ? Number(((totalJudgeCostUsd / totalJudgments) * 1000).toFixed(4))
        : 0,
      byBucket,
    }
  }

  return scorecard
}

export async function compareJudges(options: {
  baseline: SearchJudge
  candidate: SearchJudge
  snapshots?: readonly EvalSerpSnapshot[]
  concurrency?: number
}): Promise<{
  report: JudgeComparisonReport
  details: Array<{
    queryId: string
    url: string
    baselineGrade: number
    candidateGrade: number
    baselineSlop: boolean
    candidateSlop: boolean
    candidateSlopProb: number
  }>
}> {
  const snapshots = options.snapshots ?? BENCHMARK_SERP_FIXTURES
  const concurrency = options.concurrency ?? 2
  const resultTasks = snapshots.flatMap(snap => {
    const meta = QUERY_BY_ID.get(snap.queryId)
    return snap.results.map(result => ({
      snap,
      result,
      intentNote: meta?.intentNote ?? `Relevant result for "${snap.query}"`,
    }))
  })

  const baselineResults = await runWithConcurrency(resultTasks, concurrency, t =>
    options.baseline.judgeResult({ query: t.snap.query, bucket: t.snap.bucket, intentNote: t.intentNote, result: t.result }),
  )
  const candidateResults = await runWithConcurrency(resultTasks, 1, t =>
    options.candidate.judgeResult({ query: t.snap.query, bucket: t.snap.bucket, intentNote: t.intentNote, result: t.result }),
  )

  const baselineCitations = await runWithConcurrency(CITATION_EVAL_CASES, concurrency, c =>
    options.baseline.judgeCitation(c),
  )
  const candidateCitations = await runWithConcurrency(CITATION_EVAL_CASES, 1, c =>
    options.candidate.judgeCitation(c),
  )

  const baseGrades = baselineResults.map(r => r.relevance)
  const candGrades = candidateResults.map(r => r.relevance)
  const exact = baseGrades.filter((g, i) => g === candGrades[i]).length
  const withinOne = baseGrades.filter((g, i) => Math.abs(g - candGrades[i]!) <= 1).length
  const mae = baseGrades.reduce((acc, g, i) => acc + Math.abs(g - candGrades[i]!), 0) / Math.max(1, baseGrades.length)
  const slopAgree = baselineResults.filter((r, i) => r.isSlop === candidateResults[i]!.isSlop).length

  const citAgree = baselineCitations.filter((c, i) => c.supported === candidateCitations[i]!.supported).length
  const citBaseAcc = baselineCitations.filter((c, i) => c.supported === CITATION_EVAL_CASES[i]!.expectedSupported).length
  const citCandAcc = candidateCitations.filter((c, i) => c.supported === CITATION_EVAL_CASES[i]!.expectedSupported).length

  const baseLat = [...baselineResults.map(r => r.latencyMs), ...baselineCitations.map(c => c.latencyMs)]
  const candLat = [...candidateResults.map(r => r.latencyMs), ...candidateCitations.map(c => c.latencyMs)]
  const baseCost = [...baselineResults, ...baselineCitations].reduce((a, r) => a + (r.costUsd ?? 0), 0)
  const candCost = [...candidateResults, ...candidateCitations].reduce((a, r) => a + (r.costUsd ?? 0), 0)
  const totalCalls = baseLat.length

  const report: JudgeComparisonReport = {
    generatedAt: new Date().toISOString(),
    baselineJudge: options.baseline.name,
    candidateJudge: options.candidate.name,
    resultPairs: resultTasks.length,
    citationPairs: CITATION_EVAL_CASES.length,
    relevance: {
      exactAgreement: Number((exact / Math.max(1, baseGrades.length)).toFixed(4)),
      withinOneAgreement: Number((withinOne / Math.max(1, baseGrades.length)).toFixed(4)),
      spearmanRho: Number(spearmanCorrelation(baseGrades, candGrades).toFixed(4)),
      weightedKappa: Number(quadraticWeightedKappa(baseGrades, candGrades, 3).toFixed(4)),
      mae: Number(mae.toFixed(4)),
      slopAgreement: Number((slopAgree / Math.max(1, baseGrades.length)).toFixed(4)),
      baselineMeanGrade: Number((baseGrades.reduce((a, b) => a + b, 0) / Math.max(1, baseGrades.length)).toFixed(3)),
      candidateMeanGrade: Number((candGrades.reduce((a, b) => a + b, 0) / Math.max(1, candGrades.length)).toFixed(3)),
    },
    citations: {
      agreement: Number((citAgree / Math.max(1, CITATION_EVAL_CASES.length)).toFixed(4)),
      baselineAccuracy: Number((citBaseAcc / Math.max(1, CITATION_EVAL_CASES.length)).toFixed(4)),
      candidateAccuracy: Number((citCandAcc / Math.max(1, CITATION_EVAL_CASES.length)).toFixed(4)),
    },
    performance: {
      baselineLatency: summarizeLatencies(baseLat),
      candidateLatency: summarizeLatencies(candLat),
      baselineCostPer1000Usd: totalCalls ? Number(((baseCost / totalCalls) * 1000).toFixed(4)) : 0,
      candidateCostPer1000Usd: totalCalls ? Number(((candCost / totalCalls) * 1000).toFixed(4)) : 0,
    },
  }

  const details = resultTasks.map((t, i) => ({
    queryId: t.snap.queryId,
    url: t.result.url,
    baselineGrade: baselineResults[i]!.relevance,
    candidateGrade: candidateResults[i]!.relevance,
    baselineSlop: baselineResults[i]!.isSlop,
    candidateSlop: candidateResults[i]!.isSlop,
    candidateSlopProb: Number(candidateResults[i]!.slopProb.toFixed(3)),
  }))

  return { report, details }
}

interface LiveProviderPrice {
  priceMicros: number
  newsPriceMicros?: number
}

export function deriveLiveQueryCostMicros(input: {
  provider?: string
  category: string
  resultCount: number
  cache?: 'hit' | 'stale' | 'miss'
  pricingByProvider: ReadonlyMap<string, LiveProviderPrice>
}): number | null {
  // Cache hits and empty results do not settle metered search billing in apps/server/src/search/routes.ts.
  if (input.cache === 'hit' || input.resultCount === 0) return 0
  if (!input.provider) return null
  const pricing = input.pricingByProvider.get(input.provider)
  if (!pricing) return null
  if (input.category === 'news' && pricing.newsPriceMicros !== undefined) {
    return pricing.newsPriceMicros
  }
  return pricing.priceMicros
}

export async function fetchLiveSnapshots(options: {
  targetUrl: string
  cookie?: string
  origin?: string
  limit: number
  providers?: string[]
}): Promise<EvalSerpSnapshot[]> {
  const baseUrl = options.targetUrl.replace(/\/+$/, '')
  const endpoint = `${baseUrl}/api/search/query`
  const baseHeaders: Record<string, string> = {}
  if (options.cookie) baseHeaders.cookie = options.cookie
  if (options.origin) baseHeaders.origin = options.origin

  const pricingByProvider = new Map<string, LiveProviderPrice>()
  try {
    const configRes = await fetch(`${baseUrl}/api/search/config`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(10_000),
    })
    if (configRes.ok) {
      const cfg = await configRes.json() as {
        providers?: Array<{ id?: string; priceMicros?: number; newsPriceMicros?: number }>
      }
      for (const provider of cfg.providers ?? []) {
        if (typeof provider.id === 'string' && typeof provider.priceMicros === 'number') {
          pricingByProvider.set(provider.id, {
            priceMicros: provider.priceMicros,
            ...(typeof provider.newsPriceMicros === 'number' ? { newsPriceMicros: provider.newsPriceMicros } : {}),
          })
        }
      }
    }
  } catch {
    // Keep pricingByProvider empty so live cost is reported as null rather than fabricated.
  }

  const queries = GOLDEN_QUERIES.filter(q => q.bucket !== 'instant').slice(0, options.limit)
  const snapshots: EvalSerpSnapshot[] = []
  for (const item of queries) {
    const started = performance.now()
    const category = item.category ?? 'web'
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...baseHeaders },
        body: JSON.stringify({
          query: item.query,
          category,
          limit: 10,
          ...(options.providers?.length ? { providers: options.providers } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      snapshots.push({
        queryId: item.id,
        query: item.query,
        bucket: item.bucket,
        provider: 'error',
        latencyMs: performance.now() - started,
        costMicros: 0,
        results: [],
      })
      continue
    }
    const latencyMs = performance.now() - started
    if (!response.ok) {
      snapshots.push({
        queryId: item.id,
        query: item.query,
        bucket: item.bucket,
        provider: 'error',
        latencyMs,
        costMicros: 0,
        results: [],
      })
      continue
    }
    let data: {
      provider?: string
      cache?: 'hit' | 'stale' | 'miss'
      results?: Array<{ url: string; title: string; snippet: string; publishedAt?: string }>
    }
    try {
      data = await response.json() as typeof data
    } catch {
      snapshots.push({
        queryId: item.id,
        query: item.query,
        bucket: item.bucket,
        provider: 'error',
        latencyMs: performance.now() - started,
        costMicros: 0,
        results: [],
      })
      continue
    }
    const results = (data.results ?? []).map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      publishedAt: r.publishedAt,
    }))
    snapshots.push({
      queryId: item.id,
      query: item.query,
      bucket: item.bucket,
      provider: data.provider ?? 'unknown',
      latencyMs,
      costMicros: deriveLiveQueryCostMicros({
        provider: data.provider,
        category,
        resultCount: results.length,
        cache: data.cache,
        pricingByProvider,
      }),
      cache: data.cache,
      results,
    })
  }
  return snapshots
}

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

function buildJudge(kind: string): SearchJudge | undefined {
  if (kind === 'none') return undefined
  if (kind === 'heuristic') return new HeuristicJudge()
  if (kind === 'baseten') {
    const baseUrl = parseArg('--baseten-url') ?? process.env.SEARCH_EVAL_BASETEN_URL ?? 'http://127.0.0.1:8787'
    const model = parseArg('--baseten-model') ?? process.env.SEARCH_EVAL_BASETEN_MODEL ?? 'baselabs/joey-1'
    const apiKey = process.env.SEARCH_EVAL_BASETEN_API_KEY
    const price = Number(process.env.SEARCH_EVAL_BASETEN_INPUT_PRICE ?? (apiKey ? '0.01' : '0'))
    return new BasetenDecisionJudge({ baseUrl, model, apiKey, inputPricePerMillionUsd: price })
  }
  if (kind === 'openai' || kind === 'haiku') {
    const baseUrl = parseArg('--openai-url') ?? process.env.SEARCH_EVAL_OPENAI_URL ?? 'https://pulpo.baby/v1'
    const apiKey = process.env.SEARCH_EVAL_OPENAI_API_KEY
    const model = parseArg('--openai-model') ?? process.env.SEARCH_EVAL_OPENAI_MODEL ?? 'claude-haiku-5.5'
    if (!apiKey) throw new Error('Set SEARCH_EVAL_OPENAI_API_KEY to use the OpenAI-compatible judge.')
    return new OpenAICompatibleJudge({ baseUrl, apiKey, model })
  }
  throw new Error(`Unknown judge "${kind}". Use: heuristic | baseten | haiku | openai | none`)
}

async function main() {
  const mode = (parseArg('--mode') ?? 'fixtures') as 'fixtures' | 'live' | 'compare-judges'
  const outPath = parseArg('--out')

  if (mode === 'compare-judges') {
    const baselineKind = parseArg('--baseline') ?? 'haiku'
    const candidateKind = parseArg('--candidate') ?? 'baseten'
    const baseline = buildJudge(baselineKind)
    const candidate = buildJudge(candidateKind)
    if (!baseline || !candidate) throw new Error('compare-judges requires both --baseline and --candidate judges')
    const { report, details } = await compareJudges({ baseline, candidate })
    const output = { datasetSize: GOLDEN_QUERIES.length, buckets: BUCKET_COUNTS, report, details }
    console.log(JSON.stringify(output, null, 2))
    if (outPath) {
      await mkdir(resolve(outPath, '..'), { recursive: true })
      await writeFile(outPath, JSON.stringify(output, null, 2) + '\n')
    }
    return
  }

  const judgeKind = parseArg('--judge') ?? 'heuristic'
  const judge = buildJudge(judgeKind)
  let snapshots: readonly EvalSerpSnapshot[] = BENCHMARK_SERP_FIXTURES
  if (mode === 'live') {
    const targetUrl = parseArg('--target') ?? process.env.SEARCH_EVAL_TARGET_URL
    if (!targetUrl) throw new Error('Pass --target <url> or set SEARCH_EVAL_TARGET_URL for live mode.')
    const limit = Number(parseArg('--limit') ?? '25')
    const providers = parseArg('--providers')?.split(',').filter(Boolean)
    snapshots = await fetchLiveSnapshots({
      targetUrl,
      cookie: process.env.SEARCH_EVAL_COOKIE,
      origin: process.env.SEARCH_EVAL_ORIGIN,
      limit,
      providers,
    })
  }

  const scorecard = await runScorecard({ mode, snapshots, judge })
  const payload = { datasetSize: GOLDEN_QUERIES.length, buckets: BUCKET_COUNTS, scorecard }
  console.log(JSON.stringify(payload, null, 2))
  if (outPath) {
    await mkdir(resolve(outPath, '..'), { recursive: true })
    await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
