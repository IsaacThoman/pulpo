import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '../database/client.js'
import { autoTopUpAttempts, autoTopUpSettings, budgetReservationFunders, budgetReservations } from '../database/schema.js'
import { getConfig } from '../config.js'
import { autoTopUpQueue } from '../jobs.js'
import { ACTIVE_TOP_UP_STATUSES } from './auto-top-up-policy.js'

export async function enqueueAutoTopUps(userIds: string[]) {
  if (!getConfig().PULPO_BILLING_ENABLED || !userIds.length) return
  try {
    for (const userId of new Set(userIds)) await autoTopUpQueue.add('check', { userId }, { deduplication: { id: userId } })
  } catch (error) {
    // Usage has already committed. The sweep repairs a missing queue submission.
    console.error('Could not enqueue automatic top-up check', error)
  }
}
export async function enqueueReservationTopUps(responseId: string) {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  try {
    const funders = await db.select({ userId: budgetReservationFunders.userId }).from(budgetReservationFunders)
      .innerJoin(budgetReservations, eq(budgetReservations.id, budgetReservationFunders.reservationId))
      .where(eq(budgetReservations.responseId, responseId))
    await enqueueAutoTopUps(funders.map(f => f.userId))
  } catch (error) { console.error('Could not schedule reservation top-ups', error) }
}
export async function sweepAutoTopUps() {
  if (!getConfig().PULPO_BILLING_ENABLED) return
  // Keyset pagination bounds memory while including incomplete disabled accounts.
  let cursor = ''
  for (;;) {
    const rows = await db.select({ userId: autoTopUpSettings.userId }).from(autoTopUpSettings).where(and(
      sql`${autoTopUpSettings.userId}::text > ${cursor}`,
      or(eq(autoTopUpSettings.enabled, true), isNotNull(autoTopUpSettings.setupSessionId), sql`exists (select 1 from ${autoTopUpAttempts} where ${autoTopUpAttempts.userId} = ${autoTopUpSettings.userId} and ${inArray(autoTopUpAttempts.status, ACTIVE_TOP_UP_STATUSES)})`),
    )).orderBy(autoTopUpSettings.userId).limit(100)
    if (!rows.length) return
    await enqueueAutoTopUps(rows.map(r => r.userId))
    cursor = rows.at(-1)!.userId
  }
}
