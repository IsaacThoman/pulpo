import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createFileFolderSchema, updateFileNodeSchema } from '@pulpo/contracts'
import { parseFileInput, requireFilesUser } from './request.js'
import {
  createFolder,
  deleteFileNode,
  emptyTrash,
  getFileNode,
  listFolder,
  listTrash,
  restoreFileNode,
  trashFileNode,
  updateFileNode,
} from './tree-service.js'
import { registerFileUploadRoutes } from './upload-routes.js'

const idParams = z.object({ id: z.uuid() })

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (request) => {
    const user = await requireFilesUser(request)
    const { parentId } = z.object({ parentId: z.uuid().optional() }).parse(request.query)
    return listFolder(user.id, parentId ?? null)
  })

  app.get('/api/files/trash', async (request) => {
    const user = await requireFilesUser(request)
    return { items: await listTrash(user.id) }
  })

  app.delete('/api/files/trash', async (request, reply) => {
    const user = await requireFilesUser(request)
    await emptyTrash(user.id)
    reply.code(204).send()
  })

  app.get('/api/files/:id', async (request) => {
    const user = await requireFilesUser(request)
    return getFileNode(user.id, idParams.parse(request.params).id)
  })

  app.post('/api/files/folders', async (request, reply) => {
    const user = await requireFilesUser(request)
    const input = parseFileInput(createFileFolderSchema, request.body)
    reply.code(201)
    return createFolder(user.id, input)
  })

  app.patch('/api/files/:id', async (request) => {
    const user = await requireFilesUser(request)
    return updateFileNode(user.id, idParams.parse(request.params).id, parseFileInput(updateFileNodeSchema, request.body))
  })

  app.post('/api/files/:id/trash', async (request, reply) => {
    const user = await requireFilesUser(request)
    await trashFileNode(user.id, idParams.parse(request.params).id)
    reply.code(204).send()
  })

  app.post('/api/files/:id/restore', async (request) => {
    const user = await requireFilesUser(request)
    return restoreFileNode(user.id, idParams.parse(request.params).id)
  })

  app.delete('/api/files/:id', async (request, reply) => {
    const user = await requireFilesUser(request)
    await deleteFileNode(user.id, idParams.parse(request.params).id)
    reply.code(204).send()
  })

  await registerFileUploadRoutes(app)
}
