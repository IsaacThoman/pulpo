import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, banners, exportJobs } from '../database/schema.js'
import { maintenanceQueue } from '../jobs.js'
import { notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { authSettingsSchema } from '../settings/application-settings.js'

export async function registerAdminSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/banners', async () => {
    const now = new Date()
    return { data: await db.select().from(banners).where(and(
      or(isNull(banners.startsAt), lt(banners.startsAt, now)),
      or(isNull(banners.endsAt), gt(banners.endsAt, now)),
    )).orderBy(desc(banners.createdAt)) }
  })
  app.get('/api/admin/settings', async (request) => {
    requireAdmin(request)
    const rows = await db.select().from(applicationSettings)
    return { values: Object.fromEntries(rows.map((row) => [row.key, row.value])) }
  })

  app.patch('/api/admin/settings', async (request) => {
    const admin = requireAdmin(request)
    const values = z.record(z.string().min(1).max(120), z.unknown()).parse(request.body)
    if (values.auth !== undefined) values.auth = authSettingsSchema.parse(values.auth)
    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(values)) {
        await tx.insert(applicationSettings).values({ key, value, updatedBy: admin.id })
          .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: admin.id, updatedAt: new Date() } })
      }
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'settings.update', targetType: 'application', metadata: { keys: Object.keys(values) } })
    })
    return { values }
  })

  app.get('/api/admin/banners', async (request) => {
    requireAdmin(request)
    return { data: await db.select().from(banners).orderBy(desc(banners.createdAt)) }
  })

  app.post('/api/admin/banners', async (request, reply) => {
    requireAdmin(request)
    const input = z.object({
      type: z.enum(['info', 'warning', 'error']).default('info'), content: z.string().trim().min(1).max(2_000),
      dismissible: z.boolean().default(true), startsAt: z.iso.datetime().nullable().default(null), endsAt: z.iso.datetime().nullable().default(null),
    }).parse(request.body)
    const [created] = await db.insert(banners).values({ id: newId(), ...input, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null }).returning()
    reply.code(201)
    return created
  })

  app.delete('/api/admin/banners/:id', async (request, reply) => {
    requireAdmin(request)
    const { id } = request.params as { id: string }
    const deleted = await db.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id })
    if (!deleted.length) throw notFound('Banner')
    reply.code(204).send()
  })

  app.post('/api/admin/exports', async (request, reply) => {
    const admin = requireAdmin(request)
    const input = z.object({ type: z.enum(['config', 'chats', 'users', 'usage']) }).parse(request.body)
    const id = newId()
    await db.insert(exportJobs).values({ id, userId: admin.id, type: input.type })
    await maintenanceQueue.add('export', { type: 'export', payload: { exportId: id } }, { jobId: `export-${id}` })
    reply.code(202)
    return { id, status: 'queued' }
  })

  app.get('/api/admin/exports', async (request) => {
    const admin = requireAdmin(request)
    return { data: await db.select().from(exportJobs).where(eq(exportJobs.userId, admin.id)).orderBy(desc(exportJobs.createdAt)).limit(100) }
  })

  app.get('/api/admin/exports/:id/download', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, id)).limit(1)
    if (!job || job.userId !== admin.id || job.status !== 'completed' || !job.objectKey) throw notFound('Export')
    const body = await getBlobStore().get(job.objectKey)
    const extension = job.type === 'config' || job.type === 'chats' ? 'json' : 'csv'
    return reply.type(extension === 'json' ? 'application/json' : 'text/csv')
      .header('content-disposition', `attachment; filename="pulpo-${job.type}.${extension}"`).send(Buffer.from(body))
  })
}
