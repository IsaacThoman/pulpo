import { z } from 'zod'
import { COMPUTER_HOST_TTL_MS, computerRequestSchema, computerResponseSchema, type ComputerRequest, type ComputerResponse } from '@pulpo/contracts'
import { redis } from '../redis.js'
import { COMPUTER_REQUESTS_CHANNEL, COMPUTER_RESPONSES_CHANNEL, computerHostKey } from '../redis-keys.js'

/**
 * The API side of "This computer": which sockets host which sessions, and the Redis messages that
 * carry requests to them and answers back to the worker.
 */

/** Keyed by the authenticated user, so only that user's own desktop app hears a request or may answer it. */
export const computerRoom = (userId: string, sessionId: string) => `computer:${userId}:${sessionId}`

export const computerRequestMessageSchema = z.object({ userId: z.string().min(1), request: computerRequestSchema })
export const computerResponseMessageSchema = z.object({ userId: z.string().min(1), response: computerResponseSchema })

export function publishComputerRequest(userId: string, request: ComputerRequest): Promise<number> {
  return redis.publish(COMPUTER_REQUESTS_CHANNEL, JSON.stringify({ userId, request }))
}

export function publishComputerResponse(userId: string, response: ComputerResponse): Promise<number> {
  return redis.publish(COMPUTER_RESPONSES_CHANNEL, JSON.stringify({ userId, response }))
}

/** Records that this socket serves `sessionIds` (and no longer serves `removed`) for another TTL. */
export async function refreshComputerHost(userId: string, socketId: string, sessionIds: string[], removed: string[], now = Date.now()): Promise<void> {
  if (!sessionIds.length && !removed.length) return
  const pipeline = redis.pipeline()
  for (const sessionId of sessionIds) {
    const key = computerHostKey(userId, sessionId)
    pipeline.zadd(key, now + COMPUTER_HOST_TTL_MS, socketId)
    pipeline.zremrangebyscore(key, '-inf', now)
    pipeline.pexpire(key, COMPUTER_HOST_TTL_MS)
  }
  for (const sessionId of removed) pipeline.zrem(computerHostKey(userId, sessionId), socketId)
  await pipeline.exec()
}

/** Forgets only this socket's claim: another socket (or API instance) may host the same session. */
export async function releaseComputerHost(userId: string, socketId: string, sessionIds: string[]): Promise<void> {
  if (!sessionIds.length) return
  const pipeline = redis.pipeline()
  for (const sessionId of sessionIds) pipeline.zrem(computerHostKey(userId, sessionId), socketId)
  await pipeline.exec()
}

export async function computerHostConnected(userId: string, sessionId: string, now = Date.now()): Promise<boolean> {
  return await redis.zcount(computerHostKey(userId, sessionId), `(${now}`, '+inf') > 0
}
