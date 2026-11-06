import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { closeAbandonedReservation } from '../accounting/service.js'
import { advanceMessageQueue } from '../chats/message-queue.js'
import { isTerminalResponseStatus } from '../chats/message-queue-policy.js'
import { db } from '../database/client.js'
import { safeErrorMessage } from '../database/errors.js'
import { budgetReservations, requestLogs, responses } from '../database/schema.js'
import { publishSnapshot } from './events.js'
import { toSnapshot } from './service.js'

/** How long a reservation may stay pending before the sweep checks whether anything still owns it. */
export const ABANDONED_RESERVATION_GRACE_MS = 15 * 60_000
const SWEEP_BATCH_SIZE = 200
const ABANDONED_GENERATION_MESSAGE = 'Generation stopped unexpectedly'

/**
 * Reclaims budget held by responses that no generation job owns any more. Holds are
 * normally settled or released by the job that generates the response, so a pending
 * reservation without a live job (cancelled before it started, a crashed worker, a lost
 * job) would otherwise count against the funders' balances forever. Responses that
 * were still marked running are failed first.
 */
export async function sweepAbandonedReservations(input: {
  generationIsLive: (responseId: string) => Promise<boolean>
  now?: Date
}): Promise<{ closed: number; failedResponses: number }> {
  const cutoff = new Date((input.now ?? new Date()).getTime() - ABANDONED_RESERVATION_GRACE_MS)
  const candidates = await db.select({ responseId: budgetReservations.responseId, status: responses.status })
    .from(budgetReservations).innerJoin(responses, eq(responses.id, budgetReservations.responseId))
    .where(and(eq(budgetReservations.status, 'pending'), lt(budgetReservations.createdAt, cutoff)))
    .orderBy(asc(budgetReservations.createdAt))
    .limit(SWEEP_BATCH_SIZE)
  let closed = 0, failedResponses = 0
  for (const candidate of candidates) {
    try {
      if (await input.generationIsLive(candidate.responseId)) continue
      if (!isTerminalResponseStatus(candidate.status) && await failAbandonedResponse(candidate.responseId)) failedResponses += 1
      const outcome = await closeAbandonedReservation(candidate.responseId)
      if (!outcome) continue
      closed += 1
      console.warn(JSON.stringify({
        level: 'warn', service: 'pulpo-worker', event: 'reservation.abandoned_closed',
        responseId: candidate.responseId, responseStatus: candidate.status, outcome,
      }))
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error', service: 'pulpo-worker', event: 'reservation.abandoned_close_failed',
        responseId: candidate.responseId, error: safeErrorMessage(error),
      }))
    }
  }
  return { closed, failedResponses }
}

async function failAbandonedResponse(responseId: string): Promise<boolean> {
  const now = new Date()
  const failed = await db.transaction(async (tx) => {
    const [response] = await tx.update(responses)
      .set({ status: 'failed', error: { message: ABANDONED_GENERATION_MESSAGE, category: 'worker' }, completedAt: now, updatedAt: now })
      .where(and(eq(responses.id, responseId), inArray(responses.status, ['queued', 'in_progress'])))
      .returning()
    if (!response) return undefined
    await tx.update(requestLogs)
      .set({ status: 'failed', errorCategory: 'worker', errorMessage: ABANDONED_GENERATION_MESSAGE, completedAt: now, updatedAt: now })
      .where(and(eq(requestLogs.responseId, responseId), inArray(requestLogs.status, ['queued', 'in_progress'])))
    return response
  })
  if (!failed) return false
  await publishSnapshot(toSnapshot(failed))
  await advanceMessageQueue(failed.chatId)
  return true
}
