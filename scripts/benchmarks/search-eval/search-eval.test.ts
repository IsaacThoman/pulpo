import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BUCKET_COUNTS, GOLDEN_QUERIES } from './dataset.ts'
import { BENCHMARK_SERP_FIXTURES, CITATION_EVAL_CASES } from './fixtures.ts'
import { BasetenDecisionJudge, HeuristicJudge, OpenAICompatibleJudge } from './judges.ts'
import {
  canonicalDuplicateRate,
  canonicalizeUrl,
  isKnownSlopUrl,
  ndcgAtK,
  quadraticWeightedKappa,
  reciprocalRank,
  spearmanCorrelation,
  summarizeLatencies,
} from './metrics.ts'
import { compareJudges, deriveLiveQueryCostMicros, evaluateInstantAnswerQuery, evaluateLocalIntentQuery, runScorecard } from './run.ts'

describe('search-eval golden dataset', () => {
  it('contains at least 250 unique queries spanning all 8 buckets', () => {
    assert.ok(GOLDEN_QUERIES.length >= 250, `Expected >=250 queries, got ${GOLDEN_QUERIES.length}`)
    const ids = new Set(GOLDEN_QUERIES.map(q => q.id))
    assert.equal(ids.size, GOLDEN_QUERIES.length, 'Query IDs must be unique')
    const queries = new Set(GOLDEN_QUERIES.map(q => q.query.toLowerCase()))
    assert.equal(queries.size, GOLDEN_QUERIES.length, 'Query texts must be unique')

    const expectedBuckets = [
      'navigational', 'factual', 'technical', 'academic',
      'news', 'local', 'instant', 'adversarial_slop',
    ]
    for (const bucket of expectedBuckets) {
      assert.ok((BUCKET_COUNTS[bucket] ?? 0) >= 30, `Bucket ${bucket} should have >=30 queries`)
    }
  })

  it('tracks real instant-answer and local-intent baselines against apps/search', () => {
    const instantResults = GOLDEN_QUERIES.filter(q => q.bucket === 'instant').map(evaluateInstantAnswerQuery)
    const passed = instantResults.filter(r => r.passed).length
    assert.ok(passed >= 10, `Expected existing widgets to pass >=10 instant queries, got ${passed}`)

    // Value patterns match ans.result directly so anchored results like sin(pi / 2) => "1" pass.
    const sinQuery = GOLDEN_QUERIES.find(q => q.id === 'inst-04')!
    assert.equal(evaluateInstantAnswerQuery(sinQuery).passed, true)

    const localMatched = GOLDEN_QUERIES.filter(q => q.bucket === 'local').filter(evaluateLocalIntentQuery).length
    assert.ok(localMatched >= 10, `Expected existing regex to match >=10 local queries, got ${localMatched}`)
  })
})

describe('search-eval IR metrics', () => {
  it('canonicalizes tracking params, mobile/amp hosts, and trailing slashes', () => {
    assert.equal(
      canonicalizeUrl('https://m.reddit.com/r/MechanicalKeyboards/comments/abc/?utm_medium=android&fbclid=123#top'),
      canonicalizeUrl('https://www.reddit.com/r/MechanicalKeyboards/comments/abc'),
    )
    assert.equal(
      canonicalizeUrl('https://amp.example.com/article/amp/'),
      'example.com/article',
    )
    const dupRate = canonicalDuplicateRate([
      { url: 'https://www.example.com/docs/?utm_source=x', title: 'A', snippet: '' },
      { url: 'https://example.com/docs', title: 'A', snippet: '' },
      { url: 'https://other.org/page', title: 'B', snippet: '' },
    ])
    assert.equal(Number(dupRate.toFixed(4)), 0.3333)
  })

  it('computes NDCG@10, MRR, latency percentiles, Spearman rho, and weighted kappa', () => {
    assert.equal(ndcgAtK([3, 2, 1, 0], 10), 1)
    assert.ok(ndcgAtK([0, 1, 2, 3], 10) < 0.7)
    assert.equal(ndcgAtK([0, 0, 0], 10), 0)
    assert.equal(reciprocalRank([0, 1, 2, 3], 2), 1 / 3)
    assert.equal(reciprocalRank([0, 1, 0], 2), 0)

    const stats = summarizeLatencies([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    assert.equal(stats.p50Ms, 50)
    assert.equal(stats.p90Ms, 90)
    assert.equal(stats.maxMs, 100)

    assert.equal(Number(spearmanCorrelation([0, 1, 2, 3], [0, 1, 2, 3]).toFixed(4)), 1)
    assert.equal(Number(quadraticWeightedKappa([0, 1, 2, 3], [0, 1, 2, 3], 3).toFixed(4)), 1)
    assert.ok(isKnownSlopUrl('https://www.w3schools.com/js/'))
    assert.ok(!isKnownSlopUrl('https://developer.mozilla.org/en-US/'))
  })
})

describe('search-eval judges & scorecard', () => {
  it('runs a full offline fixture scorecard with HeuristicJudge', async () => {
    const scorecard = await runScorecard({
      mode: 'fixtures',
      snapshots: BENCHMARK_SERP_FIXTURES,
      judge: new HeuristicJudge(),
    })
    assert.equal(scorecard.queryCount, BENCHMARK_SERP_FIXTURES.length)
    assert.ok(scorecard.quality)
    assert.ok(scorecard.quality.ndcgAt10 > 0)
    assert.ok(scorecard.quality.mrr > 0)
    assert.equal(scorecard.deterministic.navigationalTop1Rate, 1)
    assert.ok(scorecard.deterministic.canonicalDuplicateRate > 0)
    assert.ok(scorecard.deterministic.knownSlopAt10Rate > 0)
  })

  it('includes empty snapshots as zero in aggregate and per-bucket NDCG/MRR averages', async () => {
    const scorecard = await runScorecard({
      mode: 'fixtures',
      snapshots: [
        {
          queryId: 'nav-03',
          query: 'mdn fetch api',
          bucket: 'navigational',
          provider: 'kagi',
          latencyMs: 100,
          costMicros: 12_000,
          results: [{
            url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
            title: 'MDN Fetch API',
            snippet: 'MDN Fetch API reference',
          }],
        },
        {
          queryId: 'nav-01',
          query: 'github',
          bucket: 'navigational',
          provider: 'kagi',
          latencyMs: 100,
          costMicros: 0,
          results: [],
        },
      ],
      judge: new HeuristicJudge(),
    })
    assert.equal(scorecard.deterministic.zeroResultRate, 0.5)
    assert.equal(scorecard.quality?.ndcgAt10, 0.5)
    assert.equal(scorecard.quality?.mrr, 0.5)
    assert.equal(scorecard.quality?.byBucket.navigational?.queries, 2)
    assert.equal(scorecard.quality?.byBucket.navigational?.ndcgAt10, 0.5)
  })

  it('derives live query cost from provider pricing, cache hits, and empty outcomes', () => {
    const pricing = new Map([
      ['kagi', { priceMicros: 12_000 }],
      ['firecrawl', { priceMicros: 4_000, newsPriceMicros: 8_000 }],
    ])
    assert.equal(deriveLiveQueryCostMicros({ provider: 'kagi', category: 'web', resultCount: 10, pricingByProvider: pricing }), 12_000)
    assert.equal(deriveLiveQueryCostMicros({ provider: 'firecrawl', category: 'news', resultCount: 5, pricingByProvider: pricing }), 8_000)
    assert.equal(deriveLiveQueryCostMicros({ provider: 'kagi', category: 'web', resultCount: 0, pricingByProvider: pricing }), 0)
    assert.equal(deriveLiveQueryCostMicros({ provider: 'kagi', category: 'web', resultCount: 10, cache: 'hit', pricingByProvider: pricing }), 0)
    assert.equal(deriveLiveQueryCostMicros({ provider: 'unknown', category: 'web', resultCount: 10, pricingByProvider: pricing }), null)
  })

  it('parses BasetenDecisionJudge and OpenAICompatibleJudge payloads cleanly', async () => {
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/decide')) {
          return new Response(JSON.stringify({
            model: 'baselabs/joey-1',
            latency_ms: 42.5,
            input_tokens: 180,
            answers: {
              relevance: { type: 'score', score: 3, probabilities: [0.02, 0.03, 0.15, 0.8] },
              is_slop: { type: 'noul', noul: 0.04 },
              supported: { type: 'noul', noul: 0.93 },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '{"relevance": 3, "is_slop": false, "slop_prob": 0.05, "supported": true, "support_prob": 0.96, "reason": "Authoritative primary docs."}',
            },
          }],
          usage: { prompt_tokens: 210, completion_tokens: 28 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch

      const baseten = new BasetenDecisionJudge({ baseUrl: 'http://127.0.0.1:8787', model: 'baselabs/joey-1' })
      const haiku = new OpenAICompatibleJudge({ baseUrl: 'https://pulpo.baby/v1', apiKey: 'test-key', model: 'claude-haiku-5.5' })

      const comparison = await compareJudges({
        baseline: haiku,
        candidate: baseten,
        snapshots: BENCHMARK_SERP_FIXTURES.slice(0, 1),
      })
      assert.equal(comparison.report.resultPairs, BENCHMARK_SERP_FIXTURES[0]!.results.length)
      assert.equal(comparison.report.citationPairs, CITATION_EVAL_CASES.length)
      assert.equal(comparison.report.relevance.exactAgreement, 1)
      assert.equal(comparison.report.relevance.slopAgreement, 1)
      assert.equal(comparison.report.citations.agreement, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
