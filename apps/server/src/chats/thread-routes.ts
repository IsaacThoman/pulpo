import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createSideChatSchema, forkChatSchema, updateFileProjectSchema, updateThreadSchema } from '@pulpo/contracts'
import { requireUser } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { requireFilesUser } from '../files/request.js'
import { scheduleChatIndex } from '../episodic-memory/queue.js'
import { toPublicChat } from './public.js'
import { createSideChat, forkChat, listRelatedChats, setThreadResolved } from './threads.js'
import { deleteFolderProject, readFolderProject, upsertFolderProject } from './projects.js'

const idParams = z.object({ id: z.uuid() })

/** Side chats, forks, threads, and project folders. */
export async function registerThreadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/chats/:id/related', async (request) => {
    const user = requireUser(request)
    return listRelatedChats(user.id, idParams.parse(request.params).id)
  })

  app.post('/api/chats/:id/side-chats', async (request, reply) => {
    const user = requireUser(request)
    if (request.adminChatAccess) throw new AppError(403, 'forbidden', 'Side chats cannot be opened through admin chat access')
    const input = createSideChatSchema.parse(request.body ?? {})
    const chat = await createSideChat({ userId: user.id, chatId: idParams.parse(request.params).id, responseId: input.responseId, clientId: input.clientId })
    reply.code(201)
    return { ...toPublicChat(chat), inFlightResponseIds: [] }
  })

  app.post('/api/messages/:id/fork', async (request, reply) => {
    const user = requireUser(request)
    if (request.adminChatAccess) throw new AppError(403, 'forbidden', 'Chats cannot be forked through admin chat access')
    const input = forkChatSchema.parse(request.body ?? {})
    const chat = await forkChat({ userId: user.id, responseId: idParams.parse(request.params).id, clientId: input.clientId })
    await scheduleChatIndex(chat.id, user.id, 'chat-fork')
    reply.code(201)
    return { ...toPublicChat(chat), inFlightResponseIds: [] }
  })

  app.patch('/api/chats/:id/thread', async (request) => {
    const user = requireUser(request)
    if (request.adminChatAccess) throw new AppError(403, 'forbidden', 'Threads cannot be resolved through admin chat access')
    const input = updateThreadSchema.parse(request.body)
    const chat = await setThreadResolved({ userId: user.id, threadId: idParams.parse(request.params).id, resolved: input.resolved })
    return { ...toPublicChat(chat), inFlightResponseIds: [] }
  })

  app.get('/api/files/:id/project', async (request) => {
    const user = await requireFilesUser(request)
    return { project: await readFolderProject(user.id, idParams.parse(request.params).id) }
  })

  app.put('/api/files/:id/project', async (request) => {
    const user = await requireFilesUser(request)
    const input = updateFileProjectSchema.parse(request.body ?? {})
    return { project: await upsertFolderProject(user.id, idParams.parse(request.params).id, input) }
  })

  app.delete('/api/files/:id/project', async (request, reply) => {
    const user = await requireFilesUser(request)
    await deleteFolderProject(user.id, idParams.parse(request.params).id)
    reply.code(204).send()
  })
}
