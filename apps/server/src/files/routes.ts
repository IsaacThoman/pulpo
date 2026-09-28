import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { copyFileNodesSchema, createFileDocSchema, createFileFolderSchema, fileNodeIdsSchema, moveFileNodesSchema, updateFileNodeSchema } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { notFound } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import { resolveFileAccess } from './access.js'
import { convertBlobToDocInTx, previewMarkdownConversion } from './conversion.js'
import { copyFileNodes } from './copy-service.js'
import { createDoc, readDocMarkdown } from './doc-store.js'
import { parseFileInput, requireFilesUser } from './request.js'
import {
  createFolder,
  deleteFileNode,
  deleteFileNodes,
  emptyTrash,
  getFileNode,
  listFolder,
  mutateFileTree,
  listTrash,
  moveFileNodes,
  restoreFileNode,
  restoreFileNodes,
  trashFileNode,
  trashFileNodes,
  toFileNode,
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

  // Batch operations are atomic: either every item changes or none does.
  app.post('/api/files/batch/move', async (request) => {
    const user = await requireFilesUser(request)
    return { nodes: await moveFileNodes(user.id, moveFileNodesSchema.parse(request.body).items) }
  })

  app.post('/api/files/batch/copy', async (request) => {
    const user = await requireFilesUser(request)
    const input = copyFileNodesSchema.parse(request.body)
    return { nodes: await copyFileNodes(user.id, input.ids, input.parentId) }
  })

  app.post('/api/files/batch/trash', async (request) => {
    const user = await requireFilesUser(request)
    return { ids: await trashFileNodes(user.id, fileNodeIdsSchema.parse(request.body).ids) }
  })

  app.post('/api/files/batch/restore', async (request) => {
    const user = await requireFilesUser(request)
    return { nodes: await restoreFileNodes(user.id, fileNodeIdsSchema.parse(request.body).ids) }
  })

  app.post('/api/files/batch/delete', async (request, reply) => {
    const user = await requireFilesUser(request)
    await deleteFileNodes(user.id, fileNodeIdsSchema.parse(request.body).ids)
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

  app.post('/api/files/docs', async (request, reply) => {
    const user = await requireFilesUser(request)
    const input = parseFileInput(createFileDocSchema, request.body)
    reply.code(201)
    return createDoc(user.id, input)
  })

  // Uploaded Markdown keeps its bytes until someone edits it. The dry run shows what converting
  // to an editable document would change, so clients can warn before reformatting.
  app.get('/api/files/:id/conversion', async (request) => {
    const user = await requireFilesUser(request)
    const access = await resolveFileAccess(db, user.id, idParams.parse(request.params).id)
    if (!access || access.node.trashedAt) throw notFound('File')
    return previewMarkdownConversion(access.node)
  })

  app.post('/api/files/:id/convert', async (request) => {
    const user = await requireFilesUser(request)
    const id = idParams.parse(request.params).id
    const result = await mutateFileTree(user.id, async (tx) => {
      const access = await resolveFileAccess(tx, user.id, id)
      if (!access || access.node.trashedAt) throw notFound('File')
      if (access.node.kind === 'doc') return { node: toFileNode(access.node), objectKey: null }
      const converted = await convertBlobToDocInTx(tx, access.node)
      return { node: toFileNode(converted.row), objectKey: converted.objectKey }
    })
    // The uploaded object goes only after the document is committed, so a failure keeps the file.
    if (result.objectKey) await getBlobStore().delete(result.objectKey).catch(() => undefined)
    return result.node
  })

  app.get('/api/files/:id/markdown', async (request) => {
    const user = await requireFilesUser(request)
    return readDocMarkdown(user.id, idParams.parse(request.params).id)
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
