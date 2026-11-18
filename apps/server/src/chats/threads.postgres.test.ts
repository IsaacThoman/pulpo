import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { chats, fileProjects, models, providerConnections, queuedMessages, responses, users } from '../database/schema.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() }, queueTrashPurge: vi.fn() }))
vi.mock('../episodic-memory/queue.js', () => ({ scheduleChatIndex: vi.fn() }))
vi.mock('../agent/controller.js', () => ({ releaseWorkspaceForChat: vi.fn() }))
vi.mock('../files/doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
// Starting a reply needs models, pricing, and a queue; here it records a queued reply as the chat's newest.
const createResponse = vi.fn(async (options: {
  ownerUserId: string; chatId: string; parentResponseId?: string | null; branchReason?: string; input: { input: string; modelId: string; agentMode: boolean }
}) => {
  const [chat] = await db.select().from(chats).where(eq(chats.id, options.chatId))
  const parent = options.parentResponseId === undefined ? chat!.activeBranchLeafId ?? chat!.activeResponseId : options.parentResponseId
  const id = randomUUID()
  const [row] = await db.insert(responses).values({
    id, chatId: options.chatId, userId: options.ownerUserId, modelId: options.input.modelId, status: 'queued',
    parentResponseId: parent, previousResponseId: parent, branchReason: options.branchReason ?? 'message',
    agentMode: options.input.agentMode, input: [{ role: 'user', content: options.input.input }],
  }).returning()
  await db.update(chats).set({ activeResponseId: id, activeBranchLeafId: id }).where(eq(chats.id, options.chatId))
  return row!
})
vi.mock('../responses/service.js', () => ({ createResponse, resolveResponseGeneration: vi.fn() }))
vi.mock('./message-queue.js', () => ({ createQueuedMessage: vi.fn() }))

const threads = await import('./threads.js')
const { trashChats, recoverChats } = await import('./trash-service.js')
const { markChatsForPurge } = await import('./trash.js')
const { listAccountTrash } = await import('../trash/service.js')
const { chatProject, upsertFolderProject } = await import('./projects.js')
const { createFolder } = await import('../files/tree-service.js')
const { loadChatGenerationContext } = await import('./chat-context.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string
let modelId: string

const reply = (text: string) => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]

async function insertChat(values: Partial<typeof chats.$inferInsert> = {}) {
  const [row] = await db.insert(chats).values({ id: randomUUID(), userId, modelId, title: 'Chat', ...values }).returning()
  return row!
}

/** Appends a settled turn to the chat's active branch. */
async function addTurn(chatId: string, text: string, values: Partial<typeof responses.$inferInsert> = {}) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
  const parent = chat!.activeBranchLeafId ?? chat!.activeResponseId
  const id = randomUUID()
  const [row] = await db.insert(responses).values({
    id, chatId, userId, modelId, status: 'completed', parentResponseId: parent, previousResponseId: parent,
    input: [{ role: 'user', content: `Q: ${text}` }], output: reply(`A: ${text}`), ...values,
  }).returning()
  await db.update(chats).set({ activeResponseId: id, activeBranchLeafId: id }).where(eq(chats.id, chatId))
  return row!
}

const chatRow = async (id: string) => (await db.select().from(chats).where(eq(chats.id, id)))[0]!

describe.skipIf(!enabled)('forks, side chats, and threads', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    createResponse.mockClear()
    userId = randomUUID()
    const providerId = randomUUID()
    modelId = `m-${randomUUID()}`
    await db.insert(users).values({ id: userId, name: 'Threads', email: `${userId}@example.test`, username: `t${userId.replaceAll('-', '')}`, role: 'user' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 128_000, maxOutputTokens: 16_000, agentEnabled: true })
  })
  afterAll(async () => { await queryClient.end() })

  it('forks the conversation up to a message into a chat of its own', async () => {
    const source = await insertChat({ title: 'Plans' })
    const first = await addTurn(source.id, 'one')
    const second = await addTurn(source.id, 'two')
    await addTurn(source.id, 'three')
    const fork = await threads.forkChat({ userId, responseId: second.id })
    expect(fork).toMatchObject({ kind: 'chat', originChatId: source.id, originResponseId: second.id, title: 'Plans (fork)' })
    const copied = await db.select().from(responses).where(eq(responses.chatId, fork.id))
    expect(copied).toHaveLength(2)
    const leaf = copied.find((row) => row.id === fork.activeBranchLeafId)!
    expect(leaf.input).toEqual(second.input)
    expect(copied.find((row) => row.id === leaf.parentResponseId)!.input).toEqual(first.input)
    // The source keeps every message.
    expect(await db.select().from(responses).where(eq(responses.chatId, source.id))).toHaveLength(3)
  })

  it('opens side chats that see their chat up to where they started and stay out of listings', async () => {
    const main = await insertChat({ title: 'Trip' })
    await addTurn(main.id, 'where to go')
    const side = await threads.createSideChat({ userId, chatId: main.id })
    await addTurn(main.id, 'after the side chat')
    expect(side).toMatchObject({ kind: 'side', originChatId: main.id, folderId: null })
    const related = await threads.listRelatedChats(userId, main.id)
    expect(related.sideChats.map((chat) => chat.id)).toEqual([side.id])
    expect(related.threads).toEqual([])
    const context = await loadChatGenerationContext({ userId, chatId: side.id, agentMode: false, origin: 'web' })
    expect(context.context).toContain('[Side chat]')
    expect(context.context).toContain('A: where to go')
    expect(context.context).not.toContain('after the side chat')
    expect((await threads.listRelatedChats(userId, side.id)).origin).toMatchObject({ id: main.id, title: 'Trip' })
    await expect(threads.createSideChat({ userId, chatId: side.id })).rejects.toMatchObject({ code: 'side_chat_unsupported' })
  })

  it('starts threads that report back to their idle chat as a thread update', async () => {
    const coordinator = await insertChat({ title: 'Research' })
    await addTurn(coordinator.id, 'plan', { agentMode: true })
    const { thread, responseId } = await threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: 'Compare tools', task: 'Compare A and B' })
    expect(thread).toMatchObject({ kind: 'thread', originChatId: coordinator.id, title: 'Compare tools' })
    expect(createResponse).toHaveBeenLastCalledWith(expect.objectContaining({ chatId: thread.id, parentResponseId: null, input: expect.objectContaining({ input: 'Compare A and B', agentMode: true }) }))
    expect((await threads.listThreadStates(userId, coordinator.id))[0]!.status).toBe('working')

    await db.update(responses).set({ status: 'completed', output: reply('B is cheaper.') }).where(eq(responses.id, responseId))
    await threads.handleSettledResponse(responseId)
    const update = createResponse.mock.calls.at(-1)![0]
    expect(update).toMatchObject({ chatId: coordinator.id, branchReason: 'thread_update', input: expect.objectContaining({ agentMode: true }) })
    expect(update.input.input).toContain('### Thread “Compare tools” finished')
    expect(update.input.input).toContain('B is cheaper.')
    expect((await chatRow(thread.id)).threadReportResponseId).toBeNull()
    const [state] = await threads.listThreadStates(userId, coordinator.id)
    expect(state).toMatchObject({ status: 'done' })

    const context = await loadChatGenerationContext({ userId, chatId: coordinator.id, agentMode: true, origin: 'web' })
    expect(context.canCoordinateThreads).toBe(true)
    expect(context.context).toContain(`Compare tools (thread_id: ${thread.id}) — done: B is cheaper.`)
    const threadContext = await loadChatGenerationContext({ userId, chatId: thread.id, agentMode: true, origin: 'web' })
    expect(threadContext).toMatchObject({ kind: 'thread', canCoordinateThreads: false })
    expect(threadContext.context).toContain('delegated from the user\'s chat “Research”')
  })

  it('holds reports while the chat is busy and delivers them together once it is idle', async () => {
    const coordinator = await insertChat()
    const busy = await addTurn(coordinator.id, 'working', { status: 'in_progress', agentMode: true })
    const first = await threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: 'One', task: 'one' })
    const second = await threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: 'Two', task: 'two' })
    for (const started of [first, second]) {
      await db.update(responses).set({ status: 'completed', output: reply(`done ${started.thread.title}`) }).where(eq(responses.id, started.responseId))
      await threads.handleSettledResponse(started.responseId)
    }
    expect(createResponse.mock.calls.filter(([options]) => options.chatId === coordinator.id)).toHaveLength(0)
    expect((await chatRow(first.thread.id)).threadReportResponseId).toBe(first.responseId)

    await db.update(responses).set({ status: 'completed' }).where(eq(responses.id, busy.id))
    await threads.handleSettledResponse(busy.id)
    const updates = createResponse.mock.calls.filter(([options]) => options.chatId === coordinator.id)
    expect(updates).toHaveLength(1)
    expect(updates[0]![0].input.input).toMatch(/^Thread updates \(2\)/)
  })

  it('waits for queued follow-ups before reporting, and stops waking the chat after enough updates in a row', async () => {
    const coordinator = await insertChat()
    await addTurn(coordinator.id, 'start', { agentMode: true })
    const { thread, responseId } = await threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: 'Loop', task: 'go' })
    await db.update(responses).set({ status: 'completed' }).where(eq(responses.id, responseId))
    const [queued] = await db.insert(queuedMessages).values({
      id: randomUUID(), chatId: thread.id, userId, modelId, position: 0, content: 'more', dispatchResponseId: randomUUID(),
    }).returning()
    await threads.handleSettledResponse(responseId)
    expect((await chatRow(thread.id)).threadReportResponseId).toBeNull()
    await db.delete(queuedMessages).where(eq(queuedMessages.id, queued!.id))

    for (let index = 0; index < threads.MAX_CONSECUTIVE_THREAD_UPDATES; index += 1) {
      await addTurn(coordinator.id, `update ${index}`, { branchReason: 'thread_update' })
    }
    createResponse.mockClear()
    await threads.handleSettledResponse(responseId)
    expect(createResponse).not.toHaveBeenCalled()
    // The report waits for the user's next turn.
    expect((await chatRow(thread.id)).threadReportResponseId).toBe(responseId)
  })

  it('limits how many threads work at once', async () => {
    const coordinator = await insertChat()
    for (let index = 0; index < 6; index += 1) {
      await threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: `T${index}`, task: 'go' })
    }
    await expect(threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: 'Too many', task: 'go' }))
      .rejects.toMatchObject({ code: 'thread_limit' })
  })

  it('resolves and reopens threads, dropping what they had left to report', async () => {
    const coordinator = await insertChat()
    const { thread, responseId } = await threads.startThread({ ownerUserId: userId, coordinatorChatId: coordinator.id, title: 'T', task: 'go' })
    await db.update(chats).set({ threadReportResponseId: responseId }).where(eq(chats.id, thread.id))
    const resolved = await threads.setThreadResolved({ userId, threadId: thread.id, resolved: true })
    expect(resolved.threadResolvedAt).not.toBeNull()
    expect(resolved.threadReportResponseId).toBeNull()
    expect((await threads.listThreadStates(userId, coordinator.id))[0]!.status).toBe('resolved')
    const reopened = await threads.setThreadResolved({ userId, threadId: thread.id, resolved: false })
    expect(reopened.threadResolvedAt).toBeNull()
  })

  it('trashes, restores, and purges side chats and threads with their chat', async () => {
    const main = await insertChat()
    const side = await threads.createSideChat({ userId, chatId: main.id })
    const { thread } = await threads.startThread({ ownerUserId: userId, coordinatorChatId: main.id, title: 'T', task: 'go' })
    expect((await trashChats(userId, [main.id])).sort()).toEqual([main.id, side.id, thread.id].sort())
    expect((await chatRow(thread.id)).deletedAt).not.toBeNull()
    expect((await recoverChats(userId, [main.id])).map((chat) => chat.id)).toEqual([main.id])
    expect((await chatRow(side.id)).deletedAt).toBeNull()
    await trashChats(userId, [main.id])
    expect(await markChatsForPurge([main.id], userId)).toBe(1)
    expect((await chatRow(thread.id)).purgeStartedAt).not.toBeNull()
  })

  it('lists a side chat trashed on its own, and leaves it there when its chat comes back', async () => {
    const main = await insertChat()
    const side = await threads.createSideChat({ userId, chatId: main.id })
    const trashedWith = await threads.createSideChat({ userId, chatId: main.id })
    await trashChats(userId, [side.id])
    const listed = async () => (await listAccountTrash(userId, { files: false })).items.map((item) => item.id)
    expect(await listed()).toEqual([side.id])
    await new Promise((resolve) => setTimeout(resolve, 5))
    await trashChats(userId, [main.id])
    // While its chat is in the trash too, the side chat goes wherever that chat goes.
    expect(await listed()).toEqual([main.id])
    await recoverChats(userId, [main.id])
    expect((await chatRow(trashedWith.id)).deletedAt).toBeNull()
    expect((await chatRow(side.id)).deletedAt).not.toBeNull()
    expect(await listed()).toEqual([side.id])
  })

  it('finds the nearest project above a chat, and side chats and threads share it', async () => {
    const outer = await createFolder(userId, { parentId: null, name: 'Launch' })
    const inner = await createFolder(userId, { parentId: outer.id, name: 'Docs' })
    await upsertFolderProject(userId, outer.id, { instructions: 'Keep it short.', memory: 'Ship on Friday.' })
    const main = await insertChat({ folderId: inner.id })
    const project = await chatProject(userId, main)
    expect(project).toMatchObject({ folderId: outer.id, name: 'Launch', instructions: 'Keep it short.' })
    const side = await threads.createSideChat({ userId, chatId: main.id })
    expect((await chatProject(userId, side))?.folderId).toBe(outer.id)
    const context = await loadChatGenerationContext({ userId, chatId: side.id, agentMode: false, origin: 'web' })
    expect(context.context).toContain('Project “Launch”')
    expect(context.context).toContain('Ship on Friday.')
    expect((await threads.listRelatedChats(userId, main.id)).project).toEqual({ folderId: outer.id, name: 'Launch' })

    await expect(upsertFolderProject(userId, outer.id, { memory: 'Changed', expectedMemoryRevision: 0 })).rejects.toMatchObject({ code: 'project_memory_conflict' })
    const updated = await upsertFolderProject(userId, outer.id, { memory: 'Changed', expectedMemoryRevision: 1 })
    expect(updated.memoryRevision).toBe(2)
    expect(await db.select().from(fileProjects).where(and(eq(fileProjects.folderId, inner.id)))).toEqual([])
  })
})
