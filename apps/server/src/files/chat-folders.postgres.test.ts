import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { chats, models, providerConnections, sidebarShortcuts, users } from '../database/schema.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() } }))
vi.mock('../episodic-memory/queue.js', () => ({ scheduleChatIndex: vi.fn() }))
vi.mock('../agent/controller.js', () => ({ releaseWorkspaceForChat: vi.fn() }))

const { createFolder, listFolder, moveFileNodes, restoreFileNodes, trashFileNodes, updateFileNode } = await import('./tree-service.js')
const { ensureSystemFolders } = await import('./system-folders.js')
const { chatFolderId } = await import('./chat-items.js')
const { archiveItems, createShortcut, createSidebarFolder, legacyFolderList, sidebarState, updateSidebarFolder } = await import('../sidebar/service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string
let modelId: string

async function insertChat(folderId: string | null = null, title = 'Chat') {
  const id = randomUUID()
  await db.insert(chats).values({ id, userId, modelId, folderId, title })
  return id
}

const chatRow = async (id: string) => (await db.select().from(chats).where(eq(chats.id, id)))[0]!

describe.skipIf(!enabled)('chats filed in Files folders', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    const providerId = randomUUID()
    modelId = `m-${randomUUID()}`
    await db.insert(users).values({ id: userId, name: 'Chat folders', email: `${userId}@example.test`, username: `c${userId.replaceAll('-', '')}`, role: 'user' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 128_000, maxOutputTokens: 16_000 })
  })
  afterAll(async () => { await queryClient.end() })

  it('creates Chats and Archive once, adopting a folder that already has the name, with an Archive shortcut', async () => {
    const existing = await createFolder(userId, { parentId: null, name: 'archive' })
    const first = await ensureSystemFolders(userId)
    const second = await ensureSystemFolders(userId)
    expect(second).toEqual(first)
    expect(first.archiveFolderId).toBe(existing.id)
    const root = await listFolder(userId, null)
    expect(root.children.map((node) => [node.name, node.systemRole])).toEqual([['archive', 'archive'], ['Chats', 'chats']])
    const shortcuts = await db.select().from(sidebarShortcuts).where(eq(sidebarShortcuts.userId, userId))
    expect(shortcuts.map((shortcut) => shortcut.fileNodeId)).toEqual([first.archiveFolderId])
  })

  it('keeps built-in folders from being renamed, moved, or trashed', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const other = await createFolder(userId, { parentId: null, name: 'Other' })
    await expect(updateFileNode(userId, chatsFolderId, { name: 'Renamed' })).rejects.toMatchObject({ code: 'file_system_folder' })
    await expect(moveFileNodes(userId, [{ id: chatsFolderId, parentId: other.id }])).rejects.toMatchObject({ code: 'file_system_folder' })
    await expect(trashFileNodes(userId, [chatsFolderId])).rejects.toMatchObject({ code: 'file_system_folder' })
  })

  it('lists filed chats as items, and unfiled chats in the Chats folder', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const filed = await insertChat(work.id, 'Filed')
    const loose = await insertChat(null, 'Loose')
    expect(work.parentId).toBe(chatsFolderId)
    expect((await listFolder(userId, work.id)).children).toEqual([expect.objectContaining({ id: filed, kind: 'chat', name: 'Filed', parentId: work.id })])
    const chatsListing = await listFolder(userId, chatsFolderId)
    expect(chatsListing.children.map((node) => [node.name, node.kind])).toEqual([['Work', 'folder'], ['Loose', 'chat']])
    expect(chatsListing.children.find((node) => node.id === loose)?.parentId).toBe(chatsFolderId)
  })

  it('moves, renames, trashes, and restores chats through the Files operations', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const chat = await insertChat()
    const [moved] = await moveFileNodes(userId, [{ id: chat, parentId: work.id }])
    expect(moved).toMatchObject({ id: chat, kind: 'chat', parentId: work.id })
    expect((await chatRow(chat)).folderId).toBe(work.id)
    // The Chats folder means unfiled.
    await moveFileNodes(userId, [{ id: chat, parentId: chatsFolderId }])
    expect((await chatRow(chat)).folderId).toBeNull()
    await updateFileNode(userId, chat, { name: 'Retitled' })
    expect((await chatRow(chat)).title).toBe('Retitled')
    const trashed = await trashFileNodes(userId, [chat])
    expect(trashed).toEqual([chat])
    expect((await chatRow(chat)).deletedAt).not.toBeNull()
    await restoreFileNodes(userId, trashed)
    expect((await chatRow(chat)).deletedAt).toBeNull()
  })

  it('returns chats to the unfiled list when their folder is trashed', async () => {
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const nested = await createSidebarFolder(userId, { name: 'Nested', parentId: work.id })
    const chat = await insertChat(nested.id)
    await trashFileNodes(userId, [work.id])
    expect(await chatRow(chat)).toMatchObject({ folderId: null, deletedAt: null })
  })

  it('rejects filing a chat into another account\'s folder', async () => {
    const otherUser = randomUUID()
    await db.insert(users).values({ id: otherUser, name: 'Other', email: `${otherUser}@example.test`, username: `o${otherUser.replaceAll('-', '')}`, role: 'user' })
    const foreign = await createFolder(otherUser, { parentId: null, name: 'Theirs' })
    await expect(chatFolderId(db, userId, foreign.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('archives chats (unpinning them) and folders', async () => {
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const chat = await insertChat()
    await db.update(chats).set({ pinned: true }).where(eq(chats.id, chat))
    const { archiveFolderId } = await archiveItems(userId, { chatIds: [chat], fileIds: [work.id] })
    expect(await chatRow(chat)).toMatchObject({ folderId: archiveFolderId, pinned: false })
    const state = await sidebarState(userId)
    expect(state.folders.find((folder) => folder.id === work.id)?.parentId).toBe(archiveFolderId)
  })

  it('moves sidebar folders back to the top of the Chats folder', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const nested = await createSidebarFolder(userId, { name: 'Nested', parentId: work.id })
    expect((await updateSidebarFolder(userId, nested.id, { parentId: null })).parentId).toBe(chatsFolderId)
  })

  it('resolves shortcuts and includes the folders they reach', async () => {
    await ensureSystemFolders(userId)
    const elsewhere = await createFolder(userId, { parentId: null, name: 'Projects' })
    const inner = await createFolder(userId, { parentId: elsewhere.id, name: 'Inner' })
    const chat = await insertChat(null, 'Starred')
    await createShortcut(userId, 'file', elsewhere.id)
    const shortcuts = await createShortcut(userId, 'chat', chat)
    // Archive's shortcut comes first, created with the account's built-in folders.
    expect(shortcuts.map((shortcut) => [shortcut.name, shortcut.kind])).toEqual([['Archive', 'folder'], ['Projects', 'folder'], ['Starred', 'chat']])
    const state = await sidebarState(userId)
    expect(state.folders.map((folder) => folder.id)).toEqual(expect.arrayContaining([elsewhere.id, inner.id]))
    await trashFileNodes(userId, [elsewhere.id])
    expect((await sidebarState(userId)).shortcuts.map((shortcut) => shortcut.name)).toEqual(['Archive', 'Starred'])
  })

  it('creates sidebar folders idempotently with a client id, suffixing taken names', async () => {
    const id = randomUUID()
    const first = await createSidebarFolder(userId, { id, name: 'Work' })
    const replay = await createSidebarFolder(userId, { id, name: 'Work' })
    const other = await createSidebarFolder(userId, { name: 'work' })
    expect(replay.id).toBe(first.id)
    expect(other.name).toBe('work (2)')
  })

  it('lists folders for older clients by path, including other folders holding chats', async () => {
    const work = await createSidebarFolder(userId, { name: 'Work' })
    await createSidebarFolder(userId, { name: 'Q3', parentId: work.id })
    const projects = await createFolder(userId, { parentId: null, name: 'Projects' })
    await insertChat(projects.id)
    const names = (await legacyFolderList(userId, { create: true })).map((folder) => folder.name)
    expect(names).toEqual(['Archive', 'Projects', 'Work', 'Work / Q3'])
  })
})
