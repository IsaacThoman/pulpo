import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { speechDefaultsSchema } from '@pulpo/contracts'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents, providerConnections, speechModels } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'

export async function readSpeechDefaults() {
  const [row] = await db.select().from(applicationSettings).where(eq(applicationSettings.key, 'speech')).limit(1)
  return speechDefaultsSchema.parse(row?.value ?? {})
}

export function registerSpeechDefaultsRoutes(app: FastifyInstance) {
  app.get('/api/admin/settings/speech', async request => {
    requireAdmin(request)
    return readSpeechDefaults()
  })
  app.patch('/api/admin/settings/speech', async request => {
    const admin = requireAdmin(request)
    const value = speechDefaultsSchema.strict().parse(request.body)
    if (value.modelId) {
      const [row] = await db.select({ config: speechModels.config, enabled: providerConnections.enabled })
        .from(speechModels).innerJoin(providerConnections, eq(providerConnections.id, speechModels.providerConnectionId))
        .where(eq(speechModels.id, value.modelId)).limit(1)
      if (!row?.config.enabled || !row.enabled) throw new AppError(400, 'speech_default_unavailable', 'Choose an enabled speech model with an enabled provider')
    }
    await db.transaction(async tx => {
      await tx.insert(applicationSettings).values({ key: 'speech', value, updatedBy: admin.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: admin.id, updatedAt: new Date() } })
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'settings.speech.update', targetType: 'application', metadata: value })
    })
    return value
  })
}
