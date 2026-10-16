import type { FastifyInstance, FastifyRequest } from 'fastify'
import { fileNodeIdsSchema } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { filesFeatureEnabled } from '../files/request.js'
import { forbidden } from '../lib/errors.js'
import { deleteTrashItems, emptyAccountTrash, listAccountTrash, restoreTrashItems } from './service.js'

/** The trash works with Files turned off (it then holds chats and sidebar folders). */
async function requireTrashUser(request: FastifyRequest) {
  const user = requireUser(request)
  if (request.adminChatAccess) throw forbidden('The trash is unavailable during admin chat access')
  return { userId: user.id, scope: { files: await filesFeatureEnabled() } }
}

export async function registerTrashRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/trash', async (request) => {
    const { userId, scope } = await requireTrashUser(request)
    return listAccountTrash(userId, scope)
  })

  app.post('/api/trash/restore', async (request) => {
    const { userId, scope } = await requireTrashUser(request)
    return { items: await restoreTrashItems(userId, fileNodeIdsSchema.parse(request.body).ids, scope) }
  })

  app.post('/api/trash/delete', async (request, reply) => {
    const { userId, scope } = await requireTrashUser(request)
    await deleteTrashItems(userId, fileNodeIdsSchema.parse(request.body).ids, scope)
    reply.code(204).send()
  })

  app.delete('/api/trash', async (request, reply) => {
    const { userId, scope } = await requireTrashUser(request)
    await emptyAccountTrash(userId, scope)
    reply.code(204).send()
  })
}
