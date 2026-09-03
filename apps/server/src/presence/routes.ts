import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { sessions } from '../database/schema.js'

export async function registerPresenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/online-count', async (request) => {
    requireUser(request)
    const [result] = await db.select({
      count: sql<number>`count(distinct ${sessions.userId})::int`,
    }).from(sessions).where(sql`${sessions.lastSeenAt} >= now() - interval '30 minutes'`)

    return { count: Number(result?.count ?? 0) }
  })
}
