import type { CitationEvalCase, EvalSerpSnapshot } from './types.ts'

/**
 * Representative SERP snapshots spanning clean primary sources, borderline results,
 * canonical URL duplicates, and SEO/AI-slop content farms.
 * Used for:
 *   1. Deterministic metric regression testing (NDCG@10, MRR, canonical dedup, slop ratio)
 *   2. Judge calibration (head-to-head agreement between Baseten local decision models and Claude Haiku)
 */
export const BENCHMARK_SERP_FIXTURES: readonly EvalSerpSnapshot[] = [
  {
    queryId: 'nav-03',
    query: 'mdn fetch api',
    bucket: 'navigational',
    provider: 'kagi',
    latencyMs: 620,
    costMicros: 12_000,
    results: [
      {
        url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
        title: 'Fetch API - Web APIs | MDN',
        snippet: 'The Fetch API provides a JavaScript interface for making HTTP requests and processing the responses.',
      },
      {
        url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch?utm_source=twitter&ref=dev',
        title: 'Using the Fetch API - Web APIs | MDN',
        snippet: 'Learn how to fetch resources asynchronously across the network using fetch(), Request, Response, and Headers.',
      },
      {
        url: 'https://www.w3schools.com/js/js_api_fetch.asp',
        title: 'JavaScript Fetch API - W3Schools',
        snippet: 'The Fetch API interface allows web browser to make HTTP requests to web servers. Simple example code.',
      },
      {
        url: 'https://ai-listicle-farm.example/top-10-fetch-api-tricks-2026',
        title: '10 Mind-Blowing Fetch API Tricks Every Developer Must Know in 2026!',
        snippet: 'In today fast-paced web landscape, mastering Fetch API is essential. Let us delve into ten ultimate tips.',
      },
    ],
  },
  {
    queryId: 'tech-01',
    query: 'postgresql create index concurrently locks',
    bucket: 'technical',
    provider: 'kagi',
    latencyMs: 840,
    costMicros: 12_000,
    results: [
      {
        url: 'https://www.postgresql.org/docs/current/sql-createindex.html',
        title: 'PostgreSQL: Documentation: CREATE INDEX',
        snippet: 'Building Indexes Concurrently: acquires SHARE UPDATE EXCLUSIVE lock instead of SHARE, allowing normal reads and writes during index build.',
      },
      {
        url: 'https://pganalyze.com/blog/postgres-create-index-concurrently',
        title: 'Understanding CREATE INDEX CONCURRENTLY and Lock Queues in Postgres',
        snippet: 'Detailed trace of the two-phase table scan, wait-for-older-transactions behavior, and INVALID index cleanup.',
      },
      {
        url: 'https://copyprogramming.com/howto/postgresql-create-index-concurrently-lock-question',
        title: 'Postgresql create index concurrently lock question - CopyProgramming',
        snippet: 'Answer 1: Use concurrently. Answer 2: Index locks table in postgres. Scraped Q&A compilation.',
      },
      {
        url: 'https://seo-scraper-hub.example/postgres-index-guide-ultimate',
        title: 'Ultimate Guide to Database Indexes for Beginners',
        snippet: 'Databases store data in tables. Indexes make queries faster. Sign up for our cloud course today.',
      },
    ],
  },
  {
    queryId: 'acad-02',
    query: 'reciprocal rank fusion outperforms condorcet cormack',
    bucket: 'academic',
    provider: 'kagi',
    latencyMs: 710,
    costMicros: 12_000,
    results: [
      {
        url: 'https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf',
        title: 'Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods',
        snippet: 'Gordon V. Cormack, Charles L. A. Clarke, Stefan Buettcher (SIGIR 2009). RRF score = sum(1 / (k + r(d))) with k=60.',
      },
      {
        url: 'https://dl.acm.org/doi/10.1145/1571941.1572114',
        title: 'Reciprocal rank fusion outperforms condorcet and individual rank learning methods | ACM SIGIR',
        snippet: 'Official ACM Digital Library record with citations, abstract, and BibTeX for Cormack et al. (2009).',
      },
      {
        url: 'https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion',
        title: 'Reciprocal rank fusion (RRF) | Elasticsearch Reference',
        snippet: 'Practical explanation of combining lexical BM25 and dense vector retrievers using reciprocal rank fusion.',
      },
      {
        url: 'https://content-mill-daily.example/what-is-search-ranking-seo',
        title: 'How to Rank #1 on Search Engines Using Fusion SEO Hacks',
        snippet: 'Boost your website traffic overnight with our proven backlink strategy and keyword density checklist.',
      },
    ],
  },
  {
    queryId: 'slop-01',
    query: 'best mechanical keyboard 2026 reddit',
    bucket: 'adversarial_slop',
    provider: 'firecrawl',
    latencyMs: 2150,
    costMicros: 12_000,
    results: [
      {
        url: 'https://best-top10-reviews.example/best-mechanical-keyboards-2026',
        title: '15 BEST Mechanical Keyboards of 2026 [Reviewed & Ranked!]',
        snippet: 'Looking for the best mechanical keyboard? We checked Amazon listings so you do not have to. Click our affiliate links for deals!',
      },
      {
        url: 'https://www.reddit.com/r/MechanicalKeyboards/comments/example/best_boards_under_150/',
        title: 'Best tactile / hot-swap mechanical keyboards under $150 — r/MechanicalKeyboards',
        snippet: 'Community recommendations comparing Keychron Q1, Neo65, Rainy75, and MonsGeek M1 with sound tests and build quality notes.',
      },
      {
        url: 'https://www.rtings.com/keyboard/reviews/best/mechanical',
        title: 'The 6 Best Mechanical Keyboards - RTINGS.com',
        snippet: 'Independent lab-tested latency, actuation force curves, typing noise measurements, and build quality scores.',
      },
      {
        url: 'https://m.reddit.com/r/MechanicalKeyboards/comments/example/best_boards_under_150/?utm_medium=android',
        title: 'Best tactile / hot-swap mechanical keyboards under $150 — r/MechanicalKeyboards',
        snippet: 'Mobile duplicate of the same Reddit thread with UTM tracking parameters.',
      },
    ],
  },
  {
    queryId: 'slop-02',
    query: 'best free screen recorder mac open source',
    bucket: 'adversarial_slop',
    provider: 'firecrawl',
    latencyMs: 1890,
    costMicros: 12_000,
    results: [
      {
        url: 'https://affiliate-buying-guide.example/top-12-free-mac-screen-recorders',
        title: 'Top 12 Free Screen Recorders for Mac (2026 Free Download)',
        snippet: '1. WonderRec Pro (Sponsored, 5-minute watermarked trial). Download our free installer now for effortless recording!',
      },
      {
        url: 'https://obsproject.com/',
        title: 'Open Broadcaster Software | OBS',
        snippet: 'Free and open source software for video recording and live streaming on macOS, Windows, and Linux.',
      },
      {
        url: 'https://github.com/wulkano/Kap',
        title: 'wulkano/Kap: An open-source screen recorder built with web technology',
        snippet: 'MIT-licensed macOS screen recorder supporting MP4, GIF, WebM, and plugins.',
      },
      {
        url: 'https://support.apple.com/en-us/102618',
        title: 'How to record the screen on your Mac - Apple Support',
        snippet: 'Use Screenshot toolbar (Command-Shift-5) or QuickTime Player built into macOS to record your screen.',
      },
    ],
  },
  {
    queryId: 'fact-05',
    query: 'speed of light in vacuum exact value',
    bucket: 'factual',
    provider: 'kagi',
    latencyMs: 490,
    costMicros: 12_000,
    results: [
      {
        url: 'https://physics.nist.gov/cgi-bin/cuu/Value?c',
        title: 'CODATA Value: speed of light in vacuum — NIST',
        snippet: 'Exact value: 299 792 458 m s^-1. Standard uncertainty: (exact) by definition of the metre.',
      },
      {
        url: 'https://en.wikipedia.org/wiki/Speed_of_light',
        title: 'Speed of light - Wikipedia',
        snippet: 'The speed of light in vacuum, commonly denoted c, is a universal physical constant equal to exactly 299,792,458 metres per second.',
      },
      {
        url: 'https://www.quora.com/How-fast-does-light-travel-approximately',
        title: 'How fast does light travel approximately? - Quora',
        snippet: 'Roughly 186,000 miles per second or 300,000 km/s depending on who you ask.',
      },
      {
        url: 'https://content-mill-daily.example/fun-facts-about-space-light',
        title: '25 Crazy Space Facts That Will Blow Your Mind',
        snippet: 'Space is really big and light is super fast! Check out these 25 amazing trivia facts.',
      },
    ],
  },
  {
    queryId: 'tech-40',
    query: 'hedged requests tail at scale jeff dean',
    bucket: 'technical',
    provider: 'kagi',
    latencyMs: 530,
    costMicros: 12_000,
    results: [
      {
        url: 'https://research.google/pubs/the-tail-at-scale/',
        title: 'The Tail at Scale — Google Research (Jeffrey Dean, Luiz André Barroso)',
        snippet: 'Communications of the ACM 2013. Deferring a secondary hedged request until the first has been outstanding for >95th-percentile latency cuts 99.9th latency dramatically for ~5% extra load.',
      },
      {
        url: 'https://cacm.acm.org/research/the-tail-at-scale/',
        title: 'The Tail at Scale | Communications of the ACM',
        snippet: 'Full CACM article analyzing tail-tolerant techniques: hedged requests, tied requests, micro-partitions, and canary requests.',
      },
      {
        url: 'https://seo-scraper-hub.example/what-is-latency-in-cloud',
        title: 'What Is Latency? Complete Cloud Computing Glossary',
        snippet: 'Latency is the delay before a transfer of data begins following an instruction. Lower latency is better for users.',
      },
    ],
  },
  {
    queryId: 'slop-08',
    query: 'postgres vacuum vs analyze explained',
    bucket: 'adversarial_slop',
    provider: 'kagi',
    latencyMs: 680,
    costMicros: 12_000,
    results: [
      {
        url: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
        title: 'PostgreSQL Documentation: Routine Vacuuming',
        snippet: 'VACUUM reclaims dead tuple storage and prevents transaction ID wraparound; ANALYZE updates planner statistics in pg_statistic.',
      },
      {
        url: 'https://www.cybertec-postgresql.com/en/vacuum-vs-analyze-in-postgresql/',
        title: 'VACUUM vs ANALYZE in PostgreSQL — CYBERTEC',
        snippet: 'Clear operational guide explaining MVCC dead tuples, visibility maps, autovacuum thresholds, and statistics targets.',
      },
      {
        url: 'https://www.geeksforgeeks.org/postgresql-vacuum/',
        title: 'PostgreSQL - VACUUM - GeeksforGeeks',
        snippet: 'Generic syntax overview of VACUUM command with boilerplate examples and pop-up ads.',
      },
      {
        url: 'https://ai-listicle-farm.example/postgres-vacuum-complete-guide-2026',
        title: 'Mastering Postgres Vacuum in 2026: Everything You Need to Know',
        snippet: 'In the world of modern databases, keeping Postgres clean is crucial. Vacuum cleans your database automatically.',
      },
    ],
  },
]

/**
 * Quick Answer citation-faithfulness evaluation cases (both faithful & hallucinated/unsupported).
 */
export const CITATION_EVAL_CASES: readonly CitationEvalCase[] = [
  {
    id: 'cit-01',
    query: 'speed of light in vacuum exact value',
    claim: 'The speed of light in vacuum is defined as exactly 299,792,458 meters per second.',
    citationUrl: 'https://physics.nist.gov/cgi-bin/cuu/Value?c',
    sourceTitle: 'CODATA Value: speed of light in vacuum — NIST',
    sourceSnippet: 'Exact value: 299 792 458 m s^-1. Standard uncertainty: (exact) by definition of the metre.',
    expectedSupported: true,
  },
  {
    id: 'cit-02',
    query: 'postgresql create index concurrently locks',
    claim: 'CREATE INDEX CONCURRENTLY acquires an ACCESS EXCLUSIVE lock that blocks all SELECT queries.',
    citationUrl: 'https://www.postgresql.org/docs/current/sql-createindex.html',
    sourceTitle: 'PostgreSQL: Documentation: CREATE INDEX',
    sourceSnippet: 'Building Indexes Concurrently: acquires SHARE UPDATE EXCLUSIVE lock instead of SHARE, allowing normal reads and writes during index build.',
    expectedSupported: false,
  },
  {
    id: 'cit-03',
    query: 'reciprocal rank fusion formula',
    claim: 'Reciprocal Rank Fusion scores documents as the sum of 1 / (k + rank) across rankings, commonly with k = 60.',
    citationUrl: 'https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf',
    sourceTitle: 'Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods',
    sourceSnippet: 'Gordon V. Cormack, Charles L. A. Clarke, Stefan Buettcher (SIGIR 2009). RRF score = sum(1 / (k + r(d))) with k=60.',
    expectedSupported: true,
  },
  {
    id: 'cit-04',
    query: 'hedged requests tail at scale',
    claim: 'Deferring a hedged secondary request until after the 95th-percentile latency can sharply cut 99.9th-percentile latency for roughly 5% additional load.',
    citationUrl: 'https://research.google/pubs/the-tail-at-scale/',
    sourceTitle: 'The Tail at Scale — Google Research',
    sourceSnippet: 'Deferring a secondary hedged request until the first has been outstanding for >95th-percentile latency cuts 99.9th latency dramatically for ~5% extra load.',
    expectedSupported: true,
  },
  {
    id: 'cit-05',
    query: 'obs studio license and platforms',
    claim: 'OBS Studio costs $29 per month and only runs on macOS.',
    citationUrl: 'https://obsproject.com/',
    sourceTitle: 'Open Broadcaster Software | OBS',
    sourceSnippet: 'Free and open source software for video recording and live streaming on macOS, Windows, and Linux.',
    expectedSupported: false,
  },
  {
    id: 'cit-06',
    query: 'postgres vacuum vs analyze',
    claim: 'VACUUM reclaims dead tuple storage and prevents transaction ID wraparound, while ANALYZE updates query planner statistics.',
    citationUrl: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
    sourceTitle: 'PostgreSQL Documentation: Routine Vacuuming',
    sourceSnippet: 'VACUUM reclaims dead tuple storage and prevents transaction ID wraparound; ANALYZE updates planner statistics in pg_statistic.',
    expectedSupported: true,
  },
  {
    id: 'cit-07',
    query: 'kap mac screen recorder',
    claim: 'Kap is an MIT-licensed open-source macOS screen recorder that exports MP4, GIF, and WebM.',
    citationUrl: 'https://github.com/wulkano/Kap',
    sourceTitle: 'wulkano/Kap: An open-source screen recorder built with web technology',
    sourceSnippet: 'MIT-licensed macOS screen recorder supporting MP4, GIF, WebM, and plugins.',
    expectedSupported: true,
  },
  {
    id: 'cit-08',
    query: 'fetch api synchronous mode',
    claim: 'The Fetch API defaults to synchronous blocking requests in browsers unless async: true is passed.',
    citationUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
    sourceTitle: 'Using the Fetch API - Web APIs | MDN',
    sourceSnippet: 'Learn how to fetch resources asynchronously across the network using fetch(), Request, Response, and Headers.',
    expectedSupported: false,
  },
]
