import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { imageDefaultsSchema } from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, providerConnections, imageModels } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'

export async function readImageDefaults() {
  const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'image')).limit(1)
  return imageDefaultsSchema.parse(row?.value ?? {})
}

export function registerImageDefaultsRoutes(app: FastifyInstance) {
  app.get('/api/admin/settings/image', async request => {
    requireAdmin(request)
    return readImageDefaults()
  })
  app.patch('/api/admin/settings/image', async request => {
    const admin = requireAdmin(request)
    const value = imageDefaultsSchema.strict().parse(request.body)
    if (value.modelId) {
      const [row] = await db.select({ config: imageModels.config, enabled: providerConnections.enabled })
        .from(imageModels).innerJoin(providerConnections, eq(providerConnections.id, imageModels.providerConnectionId))
        .where(eq(imageModels.id, value.modelId)).limit(1)
      if (!row?.config.enabled || !row.enabled) throw new AppError(400, 'image_default_unavailable', 'Choose an enabled image model with an enabled provider')
    }
    await db.transaction(async tx => {
      await tx.insert(applicationSettings).values({ key: 'image', value, updatedBy: admin.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: admin.id, updatedAt: new Date() } })
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'settings.image.update', targetType: 'application', metadata: value })
    })
    return value
  })
}
