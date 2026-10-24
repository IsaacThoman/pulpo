import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { updateFileFolderLayoutSchema, copyFileNodesSchema, createFileDocSchema, createFileFolderSchema, fileNodeIdsSchema, importFileUrlSchema, moveFileNodesSchema, updateFileNodeSchema, type FileChangeConflictBody } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { AppError, notFound } from '../lib/errors.js'
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
  moveFileNodes,
  restoreFileNode,
  restoreFileNodes,
  trashFileNode,
  trashFileNodes,
  toFileNode,
  updateFileNode,
} from './tree-service.js'
import { registerFileUploadRoutes } from './upload-routes.js'
import { importUrlAsDoc } from './url-import.js'
import { listTrashedFiles } from '../trash/service.js'
import { getFolderLayout, normalizeInput, updateFolderLayout } from './layout-service.js'
import { liveChatIds } from './chat-items.js'
import { ensureSystemFolders } from './system-folders.js'
import { listFileChanges } from './agent/changes.js'
import { FileChangesConflictError, redoFileChanges, undoFileChanges } from './agent/history.js'
import { reviewFileChange, reviewNodeSuggestion, reviewReplyChanges } from './agent/review.js'

const idParams = z.object({ id: z.uuid() })
const changeParams = z.object({ changeId: z.uuid() })
const reviewParams = z.object({ id: z.uuid(), action: z.enum(['accept', 'reject']) })

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  // What an agent reply changed in Files: undo and redo its direct changes, review its suggestions.
  app.get('/api/responses/:id/file-changes', async (request) => {
    const user = await requireFilesUser(request)
    return listFileChanges(user.id, idParams.parse(request.params).id)
  })

  for (const direction of ['undo', 'redo'] as const) {
    app.post(`/api/responses/:id/file-changes/${direction}`, async (request, reply) => {
      const user = await requireFilesUser(request)
      const { id } = idParams.parse(request.params)
      try {
        return await (direction === 'undo' ? undoFileChanges : redoFileChanges)(user.id, id)
      } catch (error) {
        if (!(error instanceof FileChangesConflictError)) throw error
        const body: FileChangeConflictBody = { error: { code: 'file_changes_conflict', message: error.message, conflicts: error.conflicts } }
        return reply.code(409).send(body)
      }
    })
  }

  app.post('/api/responses/:id/file-changes/:action', async (request) => {
    const user = await requireFilesUser(request)
    const { id, action } = reviewParams.parse(request.params)
    return reviewReplyChanges(user.id, id, action)
  })

  app.post('/api/file-changes/:changeId/:action', async (request) => {
    const user = await requireFilesUser(request)
    const { changeId } = changeParams.parse(request.params)
    const { action } = reviewParams.pick({ action: true }).parse(request.params)
    return reviewFileChange(user.id, changeId, action)
  })

  app.post('/api/files/:id/suggestion/:action', async (request) => {
    const user = await requireFilesUser(request)
    const { id, action } = reviewParams.parse(request.params)
    return reviewNodeSuggestion(user.id, id, action)
  })

  app.get('/api/files', async (request) => {
    const user = await requireFilesUser(request)
    const { parentId } = z.object({ parentId: z.uuid().optional() }).parse(request.query)
    // My files always shows the built-in Chats and Archive folders, even on a new account.
    if (!parentId) await ensureSystemFolders(user.id)
    return listFolder(user.id, parentId ?? null)
  })

  // Grid view arrangement of a folder (omit folderId for My files).
  app.get('/api/files/layout', async (request) => {
    const user = await requireFilesUser(request)
    const { folderId } = z.object({ folderId: z.uuid().optional() }).parse(request.query)
    return getFolderLayout(user.id, folderId ?? null)
  })

  app.patch('/api/files/layout', async (request) => {
    const user = await requireFilesUser(request)
    return updateFolderLayout(user.id, normalizeInput(updateFileFolderLayoutSchema.parse(request.body)))
  })

  // Files items only; /api/trash lists them together with trashed chats.
  app.get('/api/files/trash', async (request) => {
    const user = await requireFilesUser(request)
    return { items: await listTrashedFiles(user.id, { files: true }) }
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
    if ((await liveChatIds(db, user.id, input.ids)).size) throw new AppError(400, 'file_chat_copy', 'Chats cannot be copied here; duplicate them from the chat menu')
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

  // A web page becomes a document, fetched by the providers the agent's web_fetch uses.
  app.post('/api/files/import-url', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await requireFilesUser(request)
    const input = importFileUrlSchema.parse(request.body)
    const node = await importUrlAsDoc(user.id, input, request.log)
    reply.code(201)
    return node
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

  // A name already taken in the folder gets a " (n)" suffix, as renames in the sidebar do.
  app.patch('/api/files/:id', async (request) => {
    const user = await requireFilesUser(request)
    return updateFileNode(user.id, idParams.parse(request.params).id, { ...parseFileInput(updateFileNodeSchema, request.body), onConflict: 'rename' })
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
