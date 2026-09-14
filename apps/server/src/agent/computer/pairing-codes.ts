import { createHash, randomInt } from 'node:crypto'
import type { Redis } from 'ioredis'
import { redis } from '../../redis.js'
import { AppError } from '../../lib/errors.js'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PAIRING_CODE_TTL_SECONDS = 300
const codeKey = (computerId: string) => `pulpo:computer:${computerId}:pairing-code`
const digest = (code: string) => createHash('sha256').update(code).digest('hex')

async function limit(key: string, max: number, client: Redis): Promise<void> {
  const count = Number(await client.eval(`local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 300) end; return n`, 1, key))
  if (count > max) throw new AppError(429, 'pairing_rate_limited', 'Too many pairing attempts. Wait five minutes and try again.')
}

export async function issuePairingCode(computerId: string, client: Redis = redis): Promise<{ code: string; expiresAt: string }> {
  await limit(`${codeKey(computerId)}:issued`, 10, client)
  const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  await client.set(codeKey(computerId), digest(code), 'EX', PAIRING_CODE_TTL_SECONDS)
  return { code, expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_SECONDS * 1000).toISOString() }
}

export async function consumePairingCode(computerId: string, userId: string, input: string, client: Redis = redis): Promise<void> {
  await limit(`${codeKey(computerId)}:attempts`, 10, client)
  await limit(`pulpo:pairing-attempts:${userId}`, 30, client)
  const code = input.trim().toUpperCase()
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new AppError(400, 'pairing_code_invalid', 'Enter the six-character code shown on the computer.')
  const consumed = await client.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0`, 1, codeKey(computerId), digest(code))
  if (Number(consumed) !== 1) throw new AppError(400, 'pairing_code_invalid', 'That code is incorrect, expired, or already used. Generate a new code on the computer.')
}

export async function clearPairingCode(computerId: string): Promise<void> { await redis.del(codeKey(computerId)) }
