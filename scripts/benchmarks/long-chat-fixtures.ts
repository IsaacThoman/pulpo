import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { db, queryClient } from '../../apps/server/src/database/client.js'
import { users, sessions, providerConnections, models, chats, responses } from '../../apps/server/src/database/schema.js'

// Run only against disposable benchmark infrastructure. Never a real account/database.
if (process.env.DATABASE_URL !== 'postgres://postgres:bench@127.0.0.1:55439/pulpo') throw new Error('Expected isolated benchmark database')
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-benchmark'
await mkdir(out, { recursive: true })
const userId = randomUUID(), providerId = randomUUID(), token = randomUUID() + randomUUID()
await db.insert(users).values({ id: userId, email: `${userId}@benchmark.invalid`, username: `bench${userId.slice(0, 8)}`, name: 'Synthetic benchmark', role: 'admin' })
await db.insert(sessions).values({ id: randomUUID(), userId, tokenHash: createHash('sha256').update(token).digest('base64url'), expiresAt: new Date(Date.now() + 86400000) })
await db.insert(providerConnections).values({ id: providerId, name: 'Synthetic only', baseUrl: 'http://127.0.0.1:9/v1', encryptedApiKey: 'not-a-real-key' })
const modelId = `bench-${userId}`
await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'synthetic', name: 'Benchmark model', contextWindow: 128000, maxOutputTokens: 8192 })
const cases: any[] = []
const prose = 'The conversation records a practical investigation of application performance. We compare loading, interaction, memory usage, and reliability with a stable synthetic workload. Results should be interpreted in the context of the local machine. '
const markdown = `## Investigation\n\n${prose}\n\n- **Observation:** a repeatable measurement\n- **Next step:** inspect the slow path\n\n\`\`\`typescript\nfunction total(values: number[]) {\n  return values.reduce((sum, value) => sum + value, 0)\n}\n\`\`\`\n\n| Metric | Value |\n| --- | --- |\n| Samples | 20 |\n| Status | complete |\n\nThe equation is $E = mc^2$.\n\n`
for (const [kind, count] of [['plain',10],['plain',100],['plain',500],['plain',1000],['plain',2500],['plain',5000],['plain',10000],['plain',20000],['rich',1000],['large',100]] as const) {
  const id = randomUUID(), ids = Array.from({ length: count }, () => randomUUID())
  await db.insert(chats).values({ id, userId, modelId, title: `Bench ${kind} ${count}`, activeBranchLeafId: ids.at(-1) })
  for (let offset = 0; offset < count; offset += 100) {
    await db.insert(responses).values(ids.slice(offset, offset + 100).map((responseId, j) => {
      const i = offset + j, time = new Date(Date.UTC(2026, 8, 1) + i * 1000)
      const body = kind === 'rich' ? markdown.repeat(2) : kind === 'large' ? prose.repeat(1250) : prose.repeat(3)
      return { id: responseId, chatId: id, userId, modelId, parentResponseId: ids[i - 1] ?? null, previousResponseId: ids[i - 1] ?? null, userMessageId: randomUUID(), status: 'completed' as const, input: [{ role: 'user', content: `Question ${i + 1}. ${prose}` }], output: [{ id: `msg-${responseId}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `Answer ${i + 1}. ${body} END-${i + 1}`, annotations: [] }] }], lastSequence: 1, createdAt: time, updatedAt: time, completedAt: time }
    }))
  }
  cases.push({ id, kind, turns: count, messages: count * 2, lastResponseId: ids.at(-1), firstResponseId: ids[0], modelId })
  console.log(`Seeded ${kind} ${count} turns`)
}
await queryClient`analyze responses`
await writeFile(`${out}/fixtures.json`, JSON.stringify({ userId, token, cases }, null, 2))
await queryClient.end()
