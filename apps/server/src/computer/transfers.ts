import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { COMPUTER_TRANSFER_PATH } from '@pulpo/contracts'
import { redis } from '../redis.js'
import { COMPUTER_TRANSFERS_KEY, computerTransferClaimKey, computerTransferKey } from '../redis-keys.js'
import { getBlobStore } from '../storage/index.js'

/**
 * One-time transfer URLs for file bytes between the server and a desktop app. The bytes sit in the
 * blob store under a key derived from the id; Redis holds what the URL may do. The token in the URL
 * is the only credential, so only its hash is stored.
 */

export const COMPUTER_TRANSFER_TTL_MS = 15 * 60_000

export type ComputerTransferDirection = 'upload' | 'download'

export interface ComputerTransferRecord {
  /** `upload`: the desktop app PUTs the bytes. `download`: it GETs them. */
  direction: ComputerTransferDirection
  userId: string
  sessionId: string
  tokenHash: string
  maxBytes: number
  /** The stored size; null until the bytes are there. */
  sizeBytes: number | null
  expiresAt: number
}

export const computerTransferObjectKey = (id: string) => `computer-transfers/${id}`

const hashToken = (token: string) => createHash('sha256').update(token).digest()

function parseRecord(raw: string | null): ComputerTransferRecord | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ComputerTransferRecord
  } catch {
    return null
  }
}

export async function createComputerTransfer(
  session: { userId: string; sessionId: string },
  direction: ComputerTransferDirection,
  maxBytes: number,
  now = Date.now(),
  /** At least the usual lifetime; a big file on a slow link is given as long as its request may take. */
  ttlMs = COMPUTER_TRANSFER_TTL_MS,
): Promise<{ id: string; url: string }> {
  const id = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const lifetimeMs = Math.max(COMPUTER_TRANSFER_TTL_MS, ttlMs)
  const record: ComputerTransferRecord = {
    direction, userId: session.userId, sessionId: session.sessionId,
    tokenHash: hashToken(token).toString('hex'), maxBytes, sizeBytes: null, expiresAt: now + lifetimeMs,
  }
  // The sweep entry goes in with the record, before any bytes, so a crash cannot leave an untracked blob.
  await redis.multi()
    .set(computerTransferKey(id), JSON.stringify(record), 'PX', lifetimeMs)
    .zadd(COMPUTER_TRANSFERS_KEY, record.expiresAt, id)
    .exec()
  return { id, url: `${COMPUTER_TRANSFER_PATH}${id}?token=${token}` }
}

export async function readComputerTransfer(id: string, now = Date.now()): Promise<ComputerTransferRecord | null> {
  const record = parseRecord(await redis.get(computerTransferKey(id)))
  return record && record.expiresAt > now ? record : null
}

/**
 * The transfer the URL names, when the token matches and it goes the asked way. Unknown, expired,
 * wrong-token and wrong-direction transfers all look the same to the caller.
 */
export async function findComputerTransfer(id: string, token: string, direction: ComputerTransferDirection, now = Date.now()): Promise<ComputerTransferRecord | null> {
  const record = await readComputerTransfer(id, now)
  if (!record) return null
  const expected = Buffer.from(record.tokenHash, 'hex')
  const actual = hashToken(token)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  if (record.direction !== direction) return null
  if (direction === 'download' && record.sizeBytes === null) return null
  return record
}

/** Marks the URL used. False when it already was. */
export async function claimComputerTransfer(id: string, record: ComputerTransferRecord, now = Date.now()): Promise<boolean> {
  const ttl = Math.max(1, record.expiresAt - now)
  return await redis.set(computerTransferClaimKey(id), '1', 'PX', ttl, 'NX') === 'OK'
}

/** Lets a failed upload be retried with the same URL. */
export async function releaseComputerTransferClaim(id: string): Promise<void> {
  await redis.del(computerTransferClaimKey(id))
}

/** Records that the bytes are stored. False when the transfer was disposed meanwhile; the caller then deletes the bytes. */
export async function completeComputerTransfer(id: string, sizeBytes: number, now = Date.now()): Promise<boolean> {
  const record = await readComputerTransfer(id, now)
  if (!record) return false
  const updated: ComputerTransferRecord = { ...record, sizeBytes }
  return await redis.set(computerTransferKey(id), JSON.stringify(updated), 'PX', Math.max(1, record.expiresAt - now), 'XX') === 'OK'
}

export async function disposeComputerTransfer(id: string): Promise<void> {
  await getBlobStore().delete(computerTransferObjectKey(id))
  await redis.multi()
    .del(computerTransferKey(id), computerTransferClaimKey(id))
    .zrem(COMPUTER_TRANSFERS_KEY, id)
    .exec()
}

/** Deletes the bytes of transfers past their expiry, which a crashed or cancelled run never disposed. */
export async function sweepComputerTransfers(now = Date.now()): Promise<number> {
  let swept = 0
  while (true) {
    const ids = await redis.zrangebyscore(COMPUTER_TRANSFERS_KEY, '-inf', now, 'LIMIT', 0, 200)
    if (!ids.length) return swept
    for (const id of ids) {
      try {
        await disposeComputerTransfer(id)
        swept += 1
      } catch (error) {
        // Leave it for the next sweep rather than looping on it now.
        console.warn(JSON.stringify({ level: 'warn', service: 'pulpo-worker', event: 'computer_transfer.sweep_failed', id, error: error instanceof Error ? error.message : String(error) }))
        await redis.zadd(COMPUTER_TRANSFERS_KEY, now + 60_000, id)
      }
    }
  }
}
