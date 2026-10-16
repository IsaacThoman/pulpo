import { eq, sql } from 'drizzle-orm'
import { eventHasAssistantReplyText, hasAssistantReplyText, type ChatStartedEvent, type ResponseEvent, type ResponseSnapshot, type StateInvalidationScope } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { responses } from '../database/schema.js'
import { redis } from '../redis.js'
import { getConfig } from '../config.js'

const eventKey = (responseId: string) => `pulpo:response:${responseId}:events`

/** Persist once per generation; COALESCE also protects against worker recovery races. */
async function recordFirstReplyTextAt(responseId: string, emittedAt: string): Promise<string> {
  const [row] = await db.update(responses).set({
    firstReplyTextAt: sql`coalesce(${responses.firstReplyTextAt}, ${emittedAt}::timestamptz)`,
  }).where(eq(responses.id, responseId)).returning({ firstReplyTextAt: responses.firstReplyTextAt })
  return row?.firstReplyTextAt?.toISOString() ?? emittedAt
}

export function createResponseEventPublisher(response: {
  id: string
  requestReceivedAt?: Date | null
  firstReplyTextAt?: Date | null
}) {
  const requestReceivedAt = response.requestReceivedAt?.toISOString()
  let firstReplyTextAt = response.firstReplyTextAt?.toISOString()
  return async (event: ResponseEvent): Promise<void> => {
    if (requestReceivedAt && !firstReplyTextAt && eventHasAssistantReplyText(event.type, event.payload)) {
      firstReplyTextAt = await recordFirstReplyTextAt(response.id, event.emittedAt)
    }
    await publishResponseEvent({ ...event, requestReceivedAt, firstReplyTextAt })
  }
}

export async function publishResponseEvent(event: ResponseEvent): Promise<void> {
  const pipeline = redis.pipeline()
  pipeline.xadd(
    eventKey(event.responseId),
    'MAXLEN',
    '~',
    '10000',
    '*',
    'sequence',
    String(event.sequence),
    'event',
    JSON.stringify(event),
  )
  pipeline.expire(eventKey(event.responseId), getConfig().RESPONSE_EVENT_RETENTION_SECONDS)
  pipeline.publish('pulpo:response-events', JSON.stringify(event))
  await pipeline.exec()
}

export async function readResponseEvents(responseId: string, afterSequence: number): Promise<ResponseEvent[]> {
  const entries = await redis.xrange(eventKey(responseId), '-', '+', 'COUNT', 10_000)
  const events: ResponseEvent[] = []
  for (const [, fields] of entries) {
    let storedSequence: string | undefined
    let serialized: string | undefined
    for (let index = 0; index < fields.length; index += 2) {
      if (fields[index] === 'sequence') storedSequence = fields[index + 1]
      if (fields[index] === 'event') serialized = fields[index + 1]
    }
    // Streams use timestamp IDs, so XRANGE still reads retained history. Avoid
    // decoding acknowledged payloads; legacy entries without a valid sequence
    // field continue through the original payload-based filter.
    if (storedSequence !== undefined && /^(0|[1-9]\d*)$/.test(storedSequence)) {
      const sequence = Number(storedSequence)
      if (Number.isSafeInteger(sequence) && sequence <= afterSequence) continue
    }
    const event = JSON.parse(serialized ?? 'null') as ResponseEvent | null
    if (event !== null && event.sequence > afterSequence) events.push(event)
  }
  return events
}

export async function publishSnapshot(snapshot: ResponseSnapshot): Promise<void> {
  if (snapshot.requestReceivedAt && !snapshot.firstReplyTextAt && hasAssistantReplyText(snapshot.output)) {
    snapshot = { ...snapshot, firstReplyTextAt: await recordFirstReplyTextAt(snapshot.responseId, new Date().toISOString()) }
  }
  await redis.publish('pulpo:response-snapshots', JSON.stringify(snapshot))
}

export async function publishStateChange(input: {
  userId: string
  revision: number
  chatId?: string
  scopes?: StateInvalidationScope[]
}): Promise<void> {
  await redis.publish('pulpo:state-changes', JSON.stringify(input))
}

export async function publishChatStarted(userId: string, event: ChatStartedEvent): Promise<void> {
  await redis.publish('pulpo:chat-started', JSON.stringify({ userId, ...event }))
}

export async function publishSessionRevocation(userId: string): Promise<void> {
  await redis.publish('pulpo:session-revocations', JSON.stringify({ userId }))
}

export async function requestCancellation(responseId: string): Promise<void> {
  await redis.set(`pulpo:response:${responseId}:cancel`, '1', 'EX', 3_600)
}

export async function isCancellationRequested(responseId: string): Promise<boolean> {
  return (await redis.exists(`pulpo:response:${responseId}:cancel`)) === 1
}
