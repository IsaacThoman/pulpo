/** Fresh-process heap sample, invoked by response-replay.ts. */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createResponseOwnerResolver } from '../../apps/server/src/realtime/socket.js'

assert(global.gc, 'Run with --expose-gc')
const implementation = process.argv[2]
assert(implementation === 'baseline' || implementation === 'optimized')
type Owner = { userId: string; chatId: string }
const load = async (id: string) => ({ userId: `user:${id}`, chatId: `chat:${id}` })
// Let module initialization and transient import allocations settle first.
await delay(25)
global.gc()
await delay(0)
global.gc()
const before = process.memoryUsage().heapUsed
const makeBaseline = () => {
  const cache = new Map<string, Promise<Owner | undefined>>()
  return (id: string) => {
    const pending = cache.get(id) ?? load(id)
    cache.set(id, pending)
    return pending
  }
}
const resolver = implementation === 'baseline' ? makeBaseline() : createResponseOwnerResolver(load)
// A global root prevents the optimizer dropping the whole cache before GC.
Object.assign(globalThis, { benchmarkOwnerResolver: resolver })
const owners = 50_000
for (let index = 0; index < owners; index += 1) await resolver(`response:${index}`)
await delay(0)
global.gc()
await delay(0)
global.gc()
const retainedHeapBytes = process.memoryUsage().heapUsed - before
assert.equal((await resolver(`response:${owners - 1}`))?.chatId, `chat:response:${owners - 1}`)
console.log(JSON.stringify({ implementation, owners, retainedHeapBytes }))
// Importing the production socket module also initializes app queue clients.
// Each sample owns a fresh process; terminate it after reporting the result.
process.exit(0)
