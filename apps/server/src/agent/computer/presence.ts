import { COMPUTER_PRESENCE_TTL_SECONDS } from '@pulpo/contracts'
import type { Redis } from 'ioredis'
import { redis as sharedRedis } from '../../redis.js'

export const computerPresenceKey = (computerId: string): string => `pulpo:computer:${computerId}:online`

interface PresenceRecord { socketId: string; connectedAt: string }

export async function markComputerOnline(computerId: string, socketId: string, client: Redis = sharedRedis): Promise<void> {
  const record: PresenceRecord = { socketId, connectedAt: new Date().toISOString() }
  await client.set(computerPresenceKey(computerId), JSON.stringify(record), 'EX', COMPUTER_PRESENCE_TTL_SECONDS)
}

/** Extend the presence TTL, but only while this socket is still the recorded owner. */
export async function refreshComputerPresence(computerId: string, socketId: string, client: Redis = sharedRedis): Promise<boolean> {
  return Number(await client.eval(`local raw = redis.call('GET', KEYS[1]); if raw and cjson.decode(raw).socketId == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end; return 0`, 1, computerPresenceKey(computerId), socketId, COMPUTER_PRESENCE_TTL_SECONDS)) === 1
}

/** Remove presence when the recorded socket disconnects. A newer socket's record is left alone. */
export async function clearComputerPresence(computerId: string, socketId?: string, client: Redis = sharedRedis): Promise<void> {
  if (!socketId) { await client.del(computerPresenceKey(computerId)); return }
  await client.eval(`local raw = redis.call('GET', KEYS[1]); if raw and cjson.decode(raw).socketId == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`, 1, computerPresenceKey(computerId), socketId)
}

export async function readPresence(computerId: string, client: Redis = sharedRedis): Promise<PresenceRecord | null> {
  const raw = await client.get(computerPresenceKey(computerId))
  if (!raw) return null
  try { return JSON.parse(raw) as PresenceRecord } catch { return null }
}

export async function computerIsOnline(computerId: string, client: Redis = sharedRedis): Promise<boolean> {
  return (await client.exists(computerPresenceKey(computerId))) === 1
}

export async function onlineComputerIds(computerIds: string[], client: Redis = sharedRedis): Promise<Set<string>> {
  if (!computerIds.length) return new Set()
  const values = await client.mget(computerIds.map(computerPresenceKey))
  return new Set(computerIds.filter((_, index) => values[index] !== null))
}
