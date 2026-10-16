import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { chats, fileNodes, models, providerConnections, userPreferences, users } from '../database/schema.js'

const queued = vi.hoisted(() => vi.fn())
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('../files/doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../jobs.js', () => ({ queueTrashPurge: queued, maintenanceQueue: { add: vi.fn() } }))
vi.mock('../episodic-memory/queue.js', () => ({ scheduleChatIndex: vi.fn() }))
vi.mock('../agent/controller.js', () => ({ releaseWorkspaceForChat: vi.fn() }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ delete: async () => undefined }) }))

const { cleanupFiles, createFolder, trashFileNodes } = await import('../files/tree-service.js')
const { deleteTrashItems, emptyAccountTrash, listAccountTrash, restoreTrashItems } = await import('./service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
const DAY = 86_400_000
let userId: string
let modelId: string

async function insertBlob(name: string) {
  const id = randomUUID()
  await db.insert(fileNodes).values({ id, ownerUserId: userId, kind: 'blob', name, sizeBytes: 1, objectKey: `users/${userId}/files/${id}` })
  return id
}

async function trashedChat(title: string, deletedAt = new Date()) {
  const id = randomUUID()
  await db.insert(chats).values({ id, userId, modelId, title, deletedAt })
  return id
}

async function trashedAt(id: string, ageMs: number) {
  await db.update(fileNodes).set({ trashedAt: new Date(Date.now() - ageMs), trashRootId: id }).where(eq(fileNodes.id, id))
}

const setRetention = (trashRetention: string) => db.insert(userPreferences).values({ userId, values: { trashRetention } })
const nodeIds = async () => (await db.select({ id: fileNodes.id }).from(fileNodes).where(eq(fileNodes.ownerUserId, userId))).map((row) => row.id)

describe.skipIf(!enabled)('account trash', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    const providerId = randomUUID()
    modelId = `m-${randomUUID()}`
    await db.insert(users).values({ id: userId, name: 'Trash', email: `${userId}@example.test`, username: `t${userId.replaceAll('-', '')}`, role: 'user' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 128_000, maxOutputTokens: 16_000 })
    queued.mockClear()
  })
  afterAll(async () => { await queryClient.end() })

  it('lists trashed chats and Files items together, newest first, under one retention setting', async () => {
    await setRetention('7d')
    const chatId = await trashedChat('Old chat', new Date(Date.now() - 2 * DAY))
    await db.insert(chats).values({ id: randomUUID(), userId, modelId, title: 'Live chat' })
    const fileId = await insertBlob('notes.txt')
    await trashFileNodes(userId, [fileId])

    const listing = await listAccountTrash(userId, { files: true })
    expect(listing.retention).toBe('7d')
    expect(listing.items.map((item) => [item.id, item.kind, item.name])).toEqual([[fileId, 'blob', 'notes.txt'], [chatId, 'chat', 'Old chat']])
    const chat = listing.items[1]!
    expect(Date.parse(chat.purgeAt!) - Date.parse(chat.trashedAt)).toBe(7 * DAY)
  })

  it('keeps Files items at least a day when chats are deleted instantly, and indefinitely when asked', async () => {
    await setRetention('instant')
    const fileId = await insertBlob('kept.txt')
    await trashFileNodes(userId, [fileId])
    const [item] = (await listAccountTrash(userId, { files: true })).items
    expect(Date.parse(item!.purgeAt!) - Date.parse(item!.trashedAt)).toBe(DAY)

    await db.update(userPreferences).set({ values: { trashRetention: 'indefinite' } }).where(eq(userPreferences.userId, userId))
    expect((await listAccountTrash(userId, { files: true })).items[0]!.purgeAt).toBeNull()
  })

  it('without Files, covers chats and folders but not files', async () => {
    const folder = await createFolder(userId, { parentId: null, name: 'Projects' })
    const fileId = await insertBlob('hidden.txt')
    await trashFileNodes(userId, [folder.id, fileId])
    const chatId = await trashedChat('Chat')

    const listing = await listAccountTrash(userId, { files: false })
    expect(listing.items.map((item) => item.id).sort()).toEqual([folder.id, chatId].sort())
    await expect(restoreTrashItems(userId, [fileId], { files: false })).rejects.toMatchObject({ statusCode: 404 })
    await emptyAccountTrash(userId, { files: false })
    expect(await nodeIds()).toEqual([fileId])
  })

  it('restores and permanently deletes mixed selections', async () => {
    const restoreChat = await trashedChat('Back')
    const deleteChat = await trashedChat('Gone')
    const restoreFile = await insertBlob('back.txt')
    const deleteFile = await insertBlob('gone.txt')
    await trashFileNodes(userId, [restoreFile, deleteFile])

    const restored = await restoreTrashItems(userId, [restoreChat, restoreFile], { files: true })
    expect(restored.map((node) => node.id).sort()).toEqual([restoreChat, restoreFile].sort())
    const [chatRow] = await db.select().from(chats).where(eq(chats.id, restoreChat))
    expect(chatRow?.deletedAt).toBeNull()

    await deleteTrashItems(userId, [deleteChat, deleteFile], { files: true })
    expect(await nodeIds()).toEqual([restoreFile])
    const [purging] = await db.select().from(chats).where(eq(chats.id, deleteChat))
    expect(purging?.purgeStartedAt).not.toBeNull()
    expect(queued).toHaveBeenCalledWith(userId, 'trash-delete')
    expect((await listAccountTrash(userId, { files: true })).items).toEqual([])
  })

  it('empties chats and Files items together', async () => {
    await trashedChat('Chat')
    const fileId = await insertBlob('file.txt')
    await trashFileNodes(userId, [fileId])
    await emptyAccountTrash(userId, { files: true })
    expect(await nodeIds()).toEqual([])
    expect((await listAccountTrash(userId, { files: true })).items).toEqual([])
    expect(queued).toHaveBeenCalledWith(userId, 'trash-empty')
  })

  it('purges Files trash by each account\'s retention setting', async () => {
    await setRetention('7d')
    const expired = await insertBlob('expired.txt')
    const recent = await insertBlob('recent.txt')
    await trashedAt(expired, 8 * DAY)
    await trashedAt(recent, 6 * DAY)
    await cleanupFiles(new Date(), userId)
    expect(await nodeIds()).toEqual([recent])

    await db.update(userPreferences).set({ values: { trashRetention: 'instant' } }).where(eq(userPreferences.userId, userId))
    const hourOld = await insertBlob('hour.txt')
    await trashedAt(hourOld, 60 * 60 * 1_000)
    await cleanupFiles(new Date(), userId)
    expect(await nodeIds()).toEqual([hourOld])

    await db.update(userPreferences).set({ values: { trashRetention: 'indefinite' } }).where(eq(userPreferences.userId, userId))
    await trashedAt(hourOld, 365 * DAY)
    await cleanupFiles(new Date(), userId)
    expect(await nodeIds()).toEqual([hourOld])
  })
})
