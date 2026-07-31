import type { ResponseEvent, ResponseSnapshot } from '@pulpo/contracts'
import { redis } from '../redis.js'
import { getConfig } from '../config.js'

const eventKey = (responseId: string) => `pulpo:response:${responseId}:events`

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
  return entries
    .map(([, fields]: [string, string[]]) => {
      const record = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) => [fields[index * 2], fields[index * 2 + 1]]))
      return JSON.parse(record.event ?? 'null') as ResponseEvent | null
    })
    .filter((event: ResponseEvent | null): event is ResponseEvent => event !== null && event.sequence > afterSequence)
}

export async function publishSnapshot(snapshot: ResponseSnapshot): Promise<void> {
  await redis.publish('pulpo:response-snapshots', JSON.stringify(snapshot))
}

export async function publishStateChange(input: { userId: string; revision: number; chatId?: string }): Promise<void> {
  await redis.publish('pulpo:state-changes', JSON.stringify(input))
}

export async function requestCancellation(responseId: string): Promise<void> {
  await redis.set(`pulpo:response:${responseId}:cancel`, '1', 'EX', 3_600)
}

export async function isCancellationRequested(responseId: string): Promise<boolean> {
  return (await redis.exists(`pulpo:response:${responseId}:cancel`)) === 1
}
