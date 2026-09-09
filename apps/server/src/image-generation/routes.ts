import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { imageModelSchema, type ImageModel, type PublicImageModel } from '@pulpo/contracts'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { auditEvents, imageModels, providerConnections } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { assertSafeProviderUrl } from '../lib/url-security.js'
import { newId } from '../lib/ids.js'
import { imageProviderEndpoint, ImageGenerationError } from './provider.js'

export function publicImageModel(model: ImageModel): PublicImageModel {
  const { providerConnectionId: _provider, upstreamModelId: _upstream, ...value } = model
  return value
}
const sort = <T extends { sortOrder: number; name: string }>(models: T[]) => models.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

export async function registerImageGenerationRoutes(app: FastifyInstance) {
  app.get('/api/admin/image-models', async request => {
    requireAdmin(request)
    return { data: sort((await db.select().from(imageModels)).map(row => row.config)) }
  })
  app.get('/api/image-models', async request => {
    requireUser(request)
    const rows = await db.select({ config: imageModels.config, enabled: providerConnections.enabled }).from(imageModels)
      .innerJoin(providerConnections, eq(imageModels.providerConnectionId, providerConnections.id))
    return { data: sort(rows.filter(row => row.enabled && row.config.enabled).map(row => publicImageModel(row.config))) }
  })
  const save = async (request: Parameters<typeof requireAdmin>[0], create: boolean) => {
    const admin = requireAdmin(request)
    const model = imageModelSchema.parse(request.body)
    if (!create && (request.params as { id: string }).id !== model.id) throw new AppError(400, 'image_model_id_immutable', 'Model IDs cannot be changed')
    const [provider] = await db.select().from(providerConnections).where(eq(providerConnections.id, model.providerConnectionId)).limit(1)
    if (!provider?.encryptedApiKey) throw new AppError(400, 'image_provider_invalid', 'Choose a provider with an API key')
    await assertSafeProviderUrl(provider.baseUrl)
    try { imageProviderEndpoint(provider.baseUrl, model.adapter, false) }
    catch (error) {
      if (error instanceof ImageGenerationError) throw new AppError(400, 'image_provider_url_invalid', error.message)
      throw error
    }
    await db.transaction(async tx => {
      const values = { providerConnectionId: model.providerConnectionId, config: model, updatedAt: new Date() }
      const rows = create
        ? await tx.insert(imageModels).values({ id: model.id, ...values }).onConflictDoNothing().returning()
        : await tx.update(imageModels).set(values).where(eq(imageModels.id, model.id)).returning()
      if (!rows.length) throw new AppError(create ? 409 : 404, create ? 'image_model_exists' : 'image_model_missing', create ? 'This image model ID already exists' : 'Image model not found')
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: create ? 'image_model.created' : 'image_model.updated', targetType: 'image_model', targetId: model.id })
    })
    return model
  }
  app.post('/api/admin/image-models', async (request, reply) => reply.code(201).send(await save(request, true)))
  app.patch('/api/admin/image-models/:id', request => save(request, false))
  app.delete('/api/admin/image-models/:id', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = request.params as { id: string }
    await db.transaction(async tx => {
      const rows = await tx.delete(imageModels).where(eq(imageModels.id, id)).returning()
      if (!rows.length) throw new AppError(404, 'image_model_missing', 'Image model not found')
      await tx.insert(auditEvents).values({ id: newId(), actorUserId: admin.id, action: 'image_model.deleted', targetType: 'image_model', targetId: id })
    })
    return reply.code(204).send()
  })
}
