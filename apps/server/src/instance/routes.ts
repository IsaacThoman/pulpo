import { countDistinct, gte } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { sessions } from '../database/schema.js'

const ONLINE_WINDOW_MS = 30 * 60 * 1_000

export async function registerInstanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/instance/online-count', async (request, reply) => {
    requireUser(request)
    reply.header('cache-control', 'no-store')
    const [result] = await db.select({ count: countDistinct(sessions.userId) })
      .from(sessions)
      .where(gte(sessions.lastSeenAt, new Date(Date.now() - ONLINE_WINDOW_MS)))
    return { count: result?.count ?? 0 }
  })
}
