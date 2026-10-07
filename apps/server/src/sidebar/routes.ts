import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  archiveItemsSchema,
  createSidebarFolderSchema,
  createSidebarShortcutSchema,
  fileNameSchema,
  reorderSidebarShortcutsSchema,
  updateSidebarFolderSchema,
} from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { AppError, forbidden, notFound } from '../lib/errors.js'
import { resolveFileAccess } from '../files/access.js'
import { filesFeatureEnabled, parseFileInput } from '../files/request.js'
import { trashFileNodes, updateFileNode } from '../files/tree-service.js'
import {
  archiveItems,
  createShortcut,
  createSidebarFolder,
  deleteShortcut,
  legacyFolderList,
  reorderShortcuts,
  sidebarFolderFiles,
  sidebarState,
  trashSidebarFolder,
  updateSidebarFolder,
} from './service.js'

const idParams = z.object({ id: z.uuid() })

/** Sidebar folders work even when Files is turned off; admin chat access never reaches them. */
function requireSidebarUser(request: FastifyRequest) {
  const user = requireUser(request)
  if (request.adminChatAccess) throw forbidden('The sidebar is unavailable during admin chat access')
  return user
}

export async function registerSidebarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sidebar', async (request) => sidebarState(requireSidebarUser(request).id))

  app.post('/api/sidebar/folders', async (request, reply) => {
    const user = requireSidebarUser(request)
    reply.code(201)
    return createSidebarFolder(user.id, parseFileInput(createSidebarFolderSchema, request.body))
  })

  app.patch('/api/sidebar/folders/:id', async (request) => {
    const user = requireSidebarUser(request)
    return updateSidebarFolder(user.id, idParams.parse(request.params).id, parseFileInput(updateSidebarFolderSchema, request.body))
  })

  app.delete('/api/sidebar/folders/:id', async (request, reply) => {
    const user = requireSidebarUser(request)
    await trashSidebarFolder(user.id, idParams.parse(request.params).id)
    reply.code(204).send()
  })

  app.get('/api/sidebar/folders/:id/files', async (request) => {
    const user = requireSidebarUser(request)
    return { items: await sidebarFolderFiles(user.id, idParams.parse(request.params).id, await filesFeatureEnabled()) }
  })

  app.post('/api/sidebar/archive', async (request) => {
    const user = requireSidebarUser(request)
    return archiveItems(user.id, archiveItemsSchema.parse(request.body))
  })

  app.post('/api/sidebar/shortcuts', async (request, reply) => {
    const user = requireSidebarUser(request)
    const input = createSidebarShortcutSchema.parse(request.body)
    reply.code(201)
    return { shortcuts: await createShortcut(user.id, input.targetKind, input.targetId) }
  })

  app.put('/api/sidebar/shortcuts/order', async (request) => {
    const user = requireSidebarUser(request)
    return { shortcuts: await reorderShortcuts(user.id, reorderSidebarShortcutsSchema.parse(request.body).ids) }
  })

  app.delete('/api/sidebar/shortcuts/:id', async (request, reply) => {
    const user = requireSidebarUser(request)
    await deleteShortcut(user.id, idParams.parse(request.params).id)
    reply.code(204).send()
  })

  // The chat folder API that older mobile builds and the admin chat view still use, backed by
  // the Chats folder in Files. Pinning and manual folder order no longer exist and are ignored.
  const legacyFolder = (folder: { id: string; name: string }) => ({
    id: folder.id,
    name: folder.name,
    pinned: false,
    sortOrder: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  })

  app.get('/api/folders', async (request) => {
    const user = requireUser(request)
    const folders = await legacyFolderList(user.id, { create: !request.adminChatAccess })
    if (request.adminChatAccess) return { data: folders }
    return { data: folders.map((folder, sortOrder) => ({ ...legacyFolder(folder), sortOrder })) }
  })

  app.post('/api/folders', async (request, reply) => {
    const user = requireSidebarUser(request)
    const body = z.object({ clientId: z.uuid().optional(), name: z.string() }).parse(request.body)
    const name = fileNameSchema.safeParse(body.name.replaceAll('/', '-'))
    if (!name.success) throw new AppError(400, 'name_required', 'Folder name is required')
    const created = await createSidebarFolder(user.id, { id: body.clientId, name: name.data })
    reply.code(201)
    return legacyFolder(created)
  })

  app.put('/api/folders/order', async (request) => {
    requireSidebarUser(request)
    const body = z.object({ folderIds: z.array(z.string()).max(1_000) }).parse(request.body)
    return { data: body.folderIds }
  })

  app.patch('/api/folders/:id', async (request) => {
    const user = requireSidebarUser(request)
    const { id } = idParams.parse(request.params)
    const body = z.object({ name: z.string().optional() }).passthrough().parse(request.body)
    if (body.name === undefined) {
      const access = await resolveFileAccess(db, user.id, id)
      if (!access || access.node.kind !== 'folder') throw notFound('Folder')
      return legacyFolder(access.node)
    }
    const name = fileNameSchema.safeParse(body.name.replaceAll('/', '-'))
    if (!name.success) throw new AppError(400, 'name_required', 'Folder name is required')
    return legacyFolder(await updateFileNode(user.id, id, { name: name.data }))
  })

  app.delete('/api/folders/:id', async (request, reply) => {
    const user = requireSidebarUser(request)
    await trashFileNodes(user.id, [idParams.parse(request.params).id])
    reply.code(204).send()
  })
}
