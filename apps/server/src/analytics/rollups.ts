import { sql } from 'drizzle-orm'
import { db } from '../database/client.js'

/** Hours refreshed by the frequent job; rows finalize within minutes, so two days is ample. */
export const RECENT_ROLLUP_HOURS = 48

/**
 * Rebuilds hourly rollups from request analytics, either entirely or from
 * `since` onward. Runs in one transaction so readers never see a gap.
 */
export async function refreshAnalyticsRollups(since: Date | null): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize refreshes; the recent and full jobs may overlap after a restart.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pulpo:analytics-rollups'))`)
    const start = since ? sql`date_trunc('hour', ${since.toISOString()}::timestamptz)` : null
    await tx.execute(start
      ? sql`delete from analytics_hourly_rollups where hour >= ${start}`
      : sql`delete from analytics_hourly_rollups`)
    await tx.execute(sql`
      insert into analytics_hourly_rollups (
        hour, model_id, client_platform, origin, plan, agent_mode,
        requests, failures, input_tokens, output_tokens, cost_micros
      )
      select date_trunc('hour', created_at), requested_model_id, client_platform, origin, coalesce(plan, ''), agent_mode,
        count(*)::integer, (count(*) filter (where status in ('failed', 'incomplete')))::integer,
        coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0), coalesce(sum(cost_micros), 0)
      from request_analytics
      ${start ? sql`where created_at >= ${start}` : sql``}
      group by 1, 2, 3, 4, 5, 6
    `)
  })
}
