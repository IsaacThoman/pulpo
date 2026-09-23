import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { db, queryClient } from '../../apps/server/src/database/client.js'
import { responses } from '../../apps/server/src/database/schema.js'
import { eq, asc, and, isNull } from 'drizzle-orm'
import { toPublicChatResponses } from '../../apps/server/src/chats/public.js'
import { branchMetadataIndex } from '../../apps/server/src/messages/branching.js'
if (process.env.DATABASE_URL !== 'postgres://postgres:bench@127.0.0.1:55439/pulpo') throw new Error('Expected isolated database')
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-benchmark'
const { token, cases } = JSON.parse(await readFile(`${out}/fixtures.json`, 'utf8'))
const results: any[] = []
for (const c of cases) {
  const runs: any[] = []
  for (let repeat = 0; repeat < 4; repeat++) {
    let t = performance.now()
    const rows = await db.select().from(responses).where(and(eq(responses.chatId, c.id), isNull(responses.deletedAt))).orderBy(asc(responses.createdAt), asc(responses.id))
    const dbMs = performance.now() - t
    t = performance.now()
    const dto = toPublicChatResponses(rows, c.lastResponseId, { compact: true, activeOnly: true })
    const dtoMs = performance.now() - t
    t = performance.now()
    const metadata = branchMetadataIndex(rows)
    rows.forEach(row => metadata(row))
    const branchMs = performance.now() - t
    t = performance.now()
    const serialized = JSON.stringify(dto)
    const stringifyMs = performance.now() - t
    t = performance.now()
    const r = await fetch(`http://127.0.0.1:3319/api/chats/${c.id}?format=compact&scope=active`, { headers: { cookie: `pulpo_session=${token}`, 'accept-encoding': 'identity' } })
    const ttfbMs = performance.now() - t
    const body = await r.text()
    const httpMs = performance.now() - t
    if (!r.ok) throw new Error(`${r.status}: ${body.slice(0, 300)}`)
    if (JSON.parse(body).responses.length !== c.turns) throw new Error('Missing turns')
    t = performance.now()
    const pagedResponse = await fetch(`http://127.0.0.1:3319/api/chats/${c.id}?format=compact&scope=active&historyLimit=500`, { headers: { cookie: `pulpo_session=${token}`, 'accept-encoding': 'identity' } })
    const pagedBody = await pagedResponse.text()
    const pagedMs = performance.now() - t
    const page = JSON.parse(pagedBody)
    if (!pagedResponse.ok || page.responses.length !== Math.min(500, c.turns) || page.responses.at(-1)?.id !== c.lastResponseId) throw new Error('Invalid history page')
    runs.push({ dbMs, dtoMs, branchMs, stringifyMs, ttfbMs, httpMs, bytes: Buffer.byteLength(body), responseBytes: Buffer.byteLength(serialized), pagedMs, pagedBytes: Buffer.byteLength(pagedBody) })
  }
  const result = { ...c, warmup: runs[0], runs: runs.slice(1) }
  results.push(result)
  console.log(JSON.stringify({ kind: c.kind, turns: c.turns, runs: result.runs }))
  await writeFile(`${out}/api.json`, JSON.stringify(results, null, 2))
}
await queryClient.end()
process.exit(0)
