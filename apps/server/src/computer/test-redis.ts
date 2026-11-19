import { EventEmitter } from 'node:events'

/**
 * Just enough of ioredis, in memory, for the computer tunnel and transfer tests: strings with
 * expiry, sorted sets, pipelines/multi, and publish/subscribe between connections.
 */
export function createFakeRedis(now: () => number = Date.now) {
  const strings = new Map<string, { value: string; expiresAt: number | null }>()
  const sorted = new Map<string, Map<string, number>>()
  const subscribers = new Set<FakeSubscriber>()
  const published: Array<{ channel: string; message: string }> = []

  const live = (key: string) => {
    const entry = strings.get(key)
    if (entry?.expiresAt != null && entry.expiresAt <= now()) { strings.delete(key); return undefined }
    return entry
  }
  const score = (value: string | number, inclusive = true) => {
    if (value === '-inf') return { value: -Infinity, inclusive }
    if (value === '+inf') return { value: Infinity, inclusive }
    const text = String(value)
    return text.startsWith('(') ? { value: Number(text.slice(1)), inclusive: false } : { value: Number(text), inclusive }
  }
  const inRange = (value: number, min: string | number, max: string | number) => {
    const low = score(min)
    const high = score(max)
    return (low.inclusive ? value >= low.value : value > low.value) && (high.inclusive ? value <= high.value : value < high.value)
  }

  const commands = {
    async get(key: string) { return live(key)?.value ?? null },
    async set(key: string, value: string, ...args: Array<string | number>) {
      let expiresAt: number | null = null
      let mode: 'NX' | 'XX' | null = null
      for (let index = 0; index < args.length; index++) {
        if (args[index] === 'PX') expiresAt = now() + Number(args[++index])
        else if (args[index] === 'NX' || args[index] === 'XX') mode = args[index] as 'NX' | 'XX'
      }
      const exists = live(key) !== undefined
      if ((mode === 'NX' && exists) || (mode === 'XX' && !exists)) return null
      strings.set(key, { value, expiresAt })
      return 'OK'
    },
    async del(...keys: string[]) {
      let removed = 0
      for (const key of keys) if (strings.delete(key) || sorted.delete(key)) removed += 1
      return removed
    },
    async pexpire(key: string, ms: number) {
      // Sorted sets here never expire on their own; the members carry their own expiry.
      const entry = live(key)
      if (entry) entry.expiresAt = now() + ms
      return entry || sorted.has(key) ? 1 : 0
    },
    async zadd(key: string, value: number, member: string) {
      const set = sorted.get(key) ?? new Map<string, number>()
      sorted.set(key, set)
      const added = set.has(member) ? 0 : 1
      set.set(member, value)
      return added
    },
    async zrem(key: string, member: string) { return sorted.get(key)?.delete(member) ? 1 : 0 },
    async zremrangebyscore(key: string, min: string | number, max: string | number) {
      const set = sorted.get(key)
      let removed = 0
      for (const [member, value] of set ?? []) if (inRange(value, min, max)) { set!.delete(member); removed += 1 }
      return removed
    },
    async zcount(key: string, min: string | number, max: string | number) {
      return [...sorted.get(key)?.values() ?? []].filter((value) => inRange(value, min, max)).length
    },
    async zrangebyscore(key: string, min: string | number, max: string | number, ...args: Array<string | number>) {
      const limit = args[0] === 'LIMIT' ? Number(args[2]) : Infinity
      return [...sorted.get(key) ?? []].filter(([, value]) => inRange(value, min, max))
        .sort((left, right) => left[1] - right[1]).slice(0, limit).map(([member]) => member)
    },
    async publish(channel: string, message: string) {
      published.push({ channel, message })
      let receivers = 0
      for (const subscriber of subscribers) {
        if (subscriber.channels.has(channel)) { receivers += 1; queueMicrotask(() => subscriber.emit('message', channel, message)) }
      }
      return receivers
    },
  }

  type Commands = typeof commands
  const batch = () => {
    const queued: Array<() => Promise<unknown>> = []
    const chain = new Proxy({} as Record<string, unknown>, {
      get(_target, name: string) {
        if (name === 'exec') return async () => { const results: Array<[null, unknown]> = []; for (const run of queued) results.push([null, await run()]); return results }
        return (...args: unknown[]) => { queued.push(() => (commands[name as keyof Commands] as (...values: unknown[]) => Promise<unknown>)(...args)); return chain }
      },
    })
    return chain
  }

  class FakeSubscriber extends EventEmitter {
    readonly channels = new Set<string>()
    async subscribe(...channels: string[]) { for (const channel of channels) this.channels.add(channel); subscribers.add(this); return channels.length }
    disconnect() { subscribers.delete(this) }
    async quit() { subscribers.delete(this); return 'OK' }
  }

  return {
    redis: { ...commands, pipeline: batch, multi: batch },
    createRedis: () => new FakeSubscriber(),
    published,
    strings,
    sorted,
  }
}
