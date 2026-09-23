import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { db, queryClient } from '../../apps/server/src/database/client.js'
import { responses } from '../../apps/server/src/database/schema.js'
import assert from 'node:assert/strict'
import { branchMetadataIndex, metadataForTurn } from '../../apps/server/src/messages/branching.js'
import { eq, asc, and, isNull } from 'drizzle-orm'
import { compactConversation } from '../../apps/server/src/responses/compaction.js'
import { estimateInputTokens } from '../../apps/server/src/accounting/pricing.js'
if (process.env.DATABASE_URL !== 'postgres://postgres:bench@127.0.0.1:55439/pulpo') throw new Error('Expected isolated database')
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-benchmark'
const { token, cases } = JSON.parse(await readFile(`${out}/fixtures.json`, 'utf8'))
const results: any[] = []
for (const c of cases.filter((c: any) => c.kind === 'plain' && [10,1000,5000,20000].includes(c.turns))) {
  const history = await db.select().from(responses).where(and(eq(responses.chatId, c.id), isNull(responses.deletedAt))).orderBy(asc(responses.createdAt), asc(responses.id))
  const metadata = branchMetadataIndex(history)
  const branchExpected = history.map(row => metadata(row))
  const indexStart = performance.now()
  const siblings = new Map<string | null, typeof history>()
  for (const row of history) { const group = siblings.get(row.parentResponseId) ?? []; group.push(row); siblings.set(row.parentResponseId, group) }
  const indexed = history.map(row => metadataForTurn(siblings.get(row.parentResponseId)!, row))
  const indexedBranchMs = performance.now() - indexStart
  assert.deepEqual(indexed, branchExpected)
  const start = performance.now()
  let compactionInputTokens = 0
  const compacted = await compactConversation({ responseId: c.lastResponseId, modelId: c.modelId, enabled: true, thresholdTokens: 100000, retainedTurns: 4, fixedContext: [], currentInput: [{ role: 'user', content: 'continue' }], history, invoke: async older => { compactionInputTokens = estimateInputTokens(older); return 'Synthetic summary; no inference was called.' }, onUpdate: async () => {} })
  results.push({ kind: c.kind, turns: c.turns, preparationMs: performance.now() - start, indexedBranchMs, compacted: Boolean(compacted.item), compactionInputTokens, resultingContextTokens: estimateInputTokens(compacted.conversation) })
}
// Detect cross-request impact of the same-process synchronous work.
const concurrency: any[] = []
for (const n of [10, 5000, 20000]) {
 const c = cases.find((c: any) => c.kind === 'plain' && c.turns === n)
 const probes: number[] = []
 let done = false
 const started = performance.now()
 const detail = fetch(`http://127.0.0.1:3319/api/chats/${c.id}?format=compact&scope=active`, { headers: { cookie: `pulpo_session=${token}`, 'accept-encoding': 'identity' } }).then(async r => { await r.arrayBuffer(); done = true; return performance.now() - started })
 while (!done) { const t = performance.now(); await fetch('http://127.0.0.1:3319/health').then(r => r.text()); probes.push(performance.now() - t); await new Promise(r => setTimeout(r, 20)) }
 concurrency.push({ turns: n, detailMs: await detail, healthMs: probes })
}
await writeFile(`${out}/context.json`, JSON.stringify({ results, concurrency }, null, 2))
console.log(JSON.stringify({ results, concurrency }))
await queryClient.end()
process.exit(0)
