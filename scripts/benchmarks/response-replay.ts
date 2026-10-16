/**
 * Real Redis replay benchmark. Uses only uniquely named, expiring fixture keys
 * on the disposable benchmark endpoint; no application users or generations.
 *
 * REDIS_URL=redis://127.0.0.1:56389 node --import tsx scripts/benchmarks/response-replay.ts
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ResponseEvent } from '@pulpo/contracts'
import type { Server as SocketServer } from 'socket.io'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { Redis } from 'ioredis'

const url = new URL(process.env.REDIS_URL ?? '')
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '56389', 'Use the disposable Redis benchmark endpoint on port 56389')
const { redis } = await import('../../apps/server/src/redis.js')
const { queryClient } = await import('../../apps/server/src/database/client.js')
const { readResponseEvents } = await import('../../apps/server/src/responses/events.js')
const output = resolve(process.env.BENCH_REPLAY_OUTPUT ?? '/tmp/pulpo-response-replay.json')
const repeats = Number(process.env.BENCH_REPEATS ?? 15)
assert(Number.isSafeInteger(repeats) && repeats > 0 && repeats <= 100, 'BENCH_REPEATS must be 1–100')
type Entry = [string, string[]]

// Exact pre-change implementation retained as the benchmark counterfactual.
async function baseline(responseId: string, afterSequence: number): Promise<ResponseEvent[]> {
  const entries = await redis.xrange(`pulpo:response:${responseId}:events`, '-', '+', 'COUNT', 10_000)
  return entries
    .map(([, fields]: Entry) => {
      const record = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) => [fields[index * 2], fields[index * 2 + 1]]))
      return JSON.parse(record.event ?? 'null') as ResponseEvent | null
    })
    .filter((event: ResponseEvent | null): event is ResponseEvent => event !== null && event.sequence > afterSequence)
}

const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!
const rows: unknown[] = []
const keys: string[] = []
const extra: Record<string, unknown> = {}
try {
  for (const retained of [1000, 10_000]) {
    const responseId = `benchmark-replay-${randomUUID()}`
    const key = `pulpo:response:${responseId}:events`
    keys.push(key)
    const pipeline = redis.pipeline()
    for (let sequence = 1; sequence <= retained; sequence += 1) {
      const event: ResponseEvent = {
        responseId, sequence,
        type: sequence % 100 === 0 ? 'response.output_item.done' : 'response.output_text.delta',
        payload: sequence % 100 === 0 ? { item: { type: 'message', content: [{ type: 'output_text', text: 'x'.repeat(65_536) }] } } : { delta: 'x'.repeat(256) },
        emittedAt: '2026-10-16T12:00:00.000Z',
      }
      pipeline.xadd(key, '*', 'sequence', String(sequence), 'event', JSON.stringify(event))
    }
    pipeline.expire(key, 600)
    const seeded = await pipeline.exec()
    assert(seeded && seeded.every(([error]) => !error), 'Fixture seed failed')
    const entries = await redis.xrange(key, '-', '+', 'COUNT', 10_000)
    const fieldBytes = entries.reduce((total, [id, fields]) => total + Buffer.byteLength(id) + fields.reduce((sum, field) => sum + Buffer.byteLength(field), 0), 0)
    for (const afterSequence of [0, retained - 10, retained]) {
      const expected = await baseline(responseId, afterSequence)
      assert.deepEqual(await readResponseEvents(responseId, afterSequence), expected)
      let baselineParses = 0
      let optimizedParses = 0
      const parse = JSON.parse
      try {
        JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { baselineParses += 1; return parse(...args) }) as typeof JSON.parse
        await baseline(responseId, afterSequence)
        JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { optimizedParses += 1; return parse(...args) }) as typeof JSON.parse
        await readResponseEvents(responseId, afterSequence)
      } finally { JSON.parse = parse }
      const timings = { baseline: [] as number[], optimized: [] as number[], baselineCpu: [] as number[], optimizedCpu: [] as number[] }
      for (let sample = -3; sample < repeats; sample += 1) {
        const order = sample % 2 ? ['baseline', 'optimized'] as const : ['optimized', 'baseline'] as const
        for (const implementation of order) {
          const cpu = process.cpuUsage()
          const start = performance.now()
          const result = await (implementation === 'baseline' ? baseline : readResponseEvents)(responseId, afterSequence)
          const elapsed = performance.now() - start
          const consumed = process.cpuUsage(cpu)
          assert.equal(result.length, expected.length)
          if (sample >= 0) {
            timings[implementation].push(elapsed)
            timings[`${implementation}Cpu`].push((consumed.user + consumed.system) / 1000)
          }
        }
      }
      const row = { retained, afterSequence, returned: expected.length, fieldBytes, baselineParses, optimizedParses,
        baselineWallMedianMs: median(timings.baseline), optimizedWallMedianMs: median(timings.optimized),
        baselineCpuMedianMs: median(timings.baselineCpu), optimizedCpuMedianMs: median(timings.optimizedCpu), samples: timings }
      rows.push(row)
      console.log(JSON.stringify({ ...row, samples: undefined }))
    }
  }
  if (process.env.BENCH_OWNER_CACHE === '1') {
    const owners = 50_000
    const measurements: Record<string, number[]> = { baseline: [], optimized: [] }
    for (let sample = 0; sample < 5; sample += 1) {
      for (const name of sample % 2 ? ['optimized', 'baseline'] as const : ['baseline', 'optimized'] as const) {
        const child = await promisify(execFile)(process.execPath, ['--expose-gc', '--import', 'tsx',
          fileURLToPath(new URL('./response-replay-owner.ts', import.meta.url)), name], { timeout: 30_000 })
        measurements[name]!.push((JSON.parse(child.stdout) as { retainedHeapBytes: number }).retainedHeapBytes)
      }
    }
    extra.ownerCache = { owners, optimizedMaxEntries: 4096, samples: measurements,
      baselineRetainedHeapMedianBytes: median(measurements.baseline!), optimizedRetainedHeapMedianBytes: median(measurements.optimized!) }
    console.log(JSON.stringify(extra.ownerCache))
  }
  if (process.env.BENCH_COMPACTION_PROBE === '1') {
    const { trimHistoryToTokenLimit } = await import('../../apps/server/src/compaction/summarize.js')
    const { dropOldestResponsesUnit } = await import('../../apps/server/src/compaction/responses-history.js')
    const { estimateResponsesItemsTokens } = await import('../../apps/server/src/compaction/tokens.js')
    const samples = []
    for (const turns of [100, 1000, 5000, 10_000]) {
      const history = Array.from({ length: turns * 2 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(1024) }))
      const started = performance.now()
      const result = await trimHistoryToTokenLimit({ history, tokens: estimateResponsesItemsTokens, limit: 25_000, dropOldest: dropOldestResponsesUnit })
      samples.push({ turns, elapsedMs: performance.now() - started, dropped: result.dropped, remaining: result.history.length })
    }
    extra.compactionProbe = { method: 'One diagnostic sample per size; real existing Responses trim path; no provider or database calls; 1024-byte user/assistant messages, 25000-token limit', samples }
    console.log(JSON.stringify(extra.compactionProbe))
  }
  if (process.env.BENCH_FANOUT_PROBE === '1') {
    const { Server } = await import('socket.io')
    const { io: connect } = await import('socket.io-client')
    const { createAdapter } = await import('@socket.io/redis-streams-adapter')
    const waitUntil = async (condition: () => boolean | Promise<boolean>) => {
      const deadline = Date.now() + 5000
      while (!await condition()) {
        assert(Date.now() < deadline, 'Timed out waiting for fanout probe')
        await delay(10)
      }
    }
    const observations = []
    // This small harness reproduces the production Pub/Sub -> adapter topology.
    // The local variant is a deliberately rejected counterfactual: it loses
    // missed-packet recovery even though duplication disappears.
    for (const local of [false, true]) {
      const prefix = `benchmark-fanout:${randomUUID()}`
      const streamName = `${prefix}:stream`
      keys.push(streamName)
      const servers: SocketServer[] = []
      const clients: ClientSocket[] = []
      const connections: Redis[] = []
      try {
        for (let index = 0; index < 2; index += 1) {
          const http = createServer()
          const adapterRedis = redis.duplicate()
          const subscriber = redis.duplicate()
          connections.push(adapterRedis, subscriber)
          const server = new Server(http, { connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
            adapter: createAdapter(adapterRedis, { streamName, channelPrefix: `${prefix}:adapter`, sessionKeyPrefix: `${prefix}:session:`, blockTimeInMs: 100 }) })
          server.on('connection', (socket) => { void socket.join('owner'); keys.push(`${prefix}:session:${(socket as unknown as { pid: string }).pid}`) })
          await subscriber.subscribe(`${prefix}:application`)
          subscriber.on('message', (_channel, message) => {
            const room = server.to('owner')
            const broadcast = local ? room.local : room
            broadcast.emit('probe', JSON.parse(message))
          })
          http.listen(0, '127.0.0.1')
          await once(http, 'listening')
          servers.push(server)
          const client = connect(`http://127.0.0.1:${(http.address() as { port: number }).port}`, { transports: ['websocket'], reconnection: false })
          await once(client, 'connect', { signal: AbortSignal.timeout(5000) })
          clients.push(client)
        }
        await waitUntil(async () => await servers[0]!.of('/').adapter.serverCount() === 2)
        const received: unknown[][] = [[], []]
        clients.forEach((client, index) => client.on('probe', (value) => received[index]!.push(value)))
        // Establish a durable recovery offset on both clients.
        servers[0]!.to('owner').emit('probe', { phase: 'prime' })
        await waitUntil(() => received.every(values => values.length === 1))
        const streamBefore = await redis.xlen(streamName)
        const count = 50
        for (let index = 0; index < count; index += 1) await redis.publish(`${prefix}:application`, JSON.stringify({ phase: 'live', index }))
        const expected = local ? count : count * 2
        await waitUntil(() => received.every(values => values.length === expected + 1))
        const streamWrites = await redis.xlen(streamName) - streamBefore
        clients[0]!.io.engine.close()
        await waitUntil(() => servers[0]!.of('/').sockets.size === 0)
        await redis.publish(`${prefix}:application`, JSON.stringify({ phase: 'disconnected' }))
        await waitUntil(() => received[1]!.length === expected + 1 + (local ? 1 : 2))
        const reconnection = once(clients[0]!, 'connect', { signal: AbortSignal.timeout(5000) })
        clients[0]!.connect()
        await reconnection
        await delay(50)
        observations.push({ local, published: count, deliveredToEachConnectedClient: expected, adapterStreamWrites: streamWrites,
          recovered: clients[0]!.recovered, disconnectedEventReplays: received[0]!.length - expected - 1 })
        assert.equal(clients[0]!.recovered, true)
        assert.equal(received[0]!.length - expected - 1, local ? 0 : 2)
      } finally {
        for (const client of clients) client.disconnect()
        await Promise.all(servers.map(server => new Promise<void>((resolve) => server.close(() => resolve()))))
        for (const connection of connections) connection.disconnect()
      }
    }
    extra.fanoutProbe = { method: 'Two real Socket.IO servers and Redis-streams adapters; same application Pub/Sub fanout pattern as realtime/socket.ts; no authentication/database application fixture', observations }
    console.log(JSON.stringify(extra.fanoutProbe))
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, repeats,
    host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem() },
    method: 'Alternating baseline/optimized real Redis XRANGE, three warmups per implementation, identical result assertions. fieldBytes counts UTF-8 IDs/fields and excludes RESP framing. CPU covers this Node process only.', rows, ...extra }, null, 2) + '\n')
  console.log(`Saved ${output}`)
} finally {
  if (keys.length) await redis.del(...keys)
  redis.disconnect()
  await queryClient.end()
}
process.exit(0)
