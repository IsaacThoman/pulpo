import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { chats, fileNodes, models, providerConnections, users } from '../database/schema.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../jobs.js', () => ({ maintenanceQueue: { add: vi.fn() } }))
vi.mock('../episodic-memory/queue.js', () => ({ scheduleChatIndex: vi.fn() }))
vi.mock('../agent/controller.js', () => ({ releaseWorkspaceForChat: vi.fn() }))

const { createFolder, listFolder, moveFileNodes, restoreFileNodes, trashFileNodes, updateFileNode } = await import('./tree-service.js')
const { ensureSystemFolders } = await import('./system-folders.js')
const { chatFolderId } = await import('./chat-items.js')
const { createShortcut } = await import('./shortcuts.js')
const { copyFileNodes } = await import('./copy-service.js')
const {
  archiveItems, createSidebarFolder, legacyFolderList, moveSidebarItems, orderPinnedItems, orderSidebarItems, pinSidebarItems,
  sidebarFolderItems, updateSidebarItem, sidebarState,
} = await import('../sidebar/service.js')
const { topChatOrder } = await import('./order.js')
const { createDoc } = await import('./doc-store.js')

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

  it('creates Sidebar and Archive once, adopting a folder that already has the name, with nothing in Sidebar', async () => {
    const existing = await createFolder(userId, { parentId: null, name: 'archive' })
    const first = await ensureSystemFolders(userId)
    const second = await ensureSystemFolders(userId)
    expect(second).toEqual(first)
    expect(first.archiveFolderId).toBe(existing.id)
    const root = await listFolder(userId, null)
    expect(root.children.map((node) => [node.name, node.systemRole])).toEqual([['archive', 'archive'], ['Sidebar', 'chats']])
    expect(await sidebarFolderItems(userId, first.chatsFolderId, true)).toEqual([])
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

  it('puts chats at the top of My files, apart from the Chats folder, keeping their pin', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const chat = await insertChat(null, 'Rooted')
    await db.update(chats).set({ pinned: true, sortOrder: 7 }).where(eq(chats.id, chat))
    const [moved] = await moveFileNodes(userId, [{ id: chat, parentId: null }])
    expect(moved).toMatchObject({ id: chat, kind: 'chat', parentId: null, pinned: true })
    expect(await chatRow(chat)).toMatchObject({ folderId: null, inFilesRoot: true, pinned: true, sortOrder: 7 })
    expect((await listFolder(userId, null)).children.map((node) => node.name)).toContain('Rooted')
    expect((await listFolder(userId, chatsFolderId)).children.map((node) => node.name)).not.toContain('Rooted')
    // Placed in the sidebar again, it is back in the Chats folder, out of the pinned list.
    await orderSidebarItems(userId, null, [chat])
    expect(await chatRow(chat)).toMatchObject({ folderId: null, inFilesRoot: false, pinned: false })
    expect((await listFolder(userId, chatsFolderId)).children.map((node) => node.name)).toContain('Rooted')
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

  it('moves chats and items to the top of the Chats folder', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const nested = await createSidebarFolder(userId, { name: 'Nested', parentId: work.id })
    const chat = await insertChat(work.id)
    const moved = await moveSidebarItems(userId, [nested.id, chat], null)
    expect(moved.map((node) => node.parentId)).toEqual([chatsFolderId, chatsFolderId])
    expect((await chatRow(chat)).folderId).toBeNull()
  })

  it('places shortcuts in any folder and resolves what they open', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const projects = await createFolder(userId, { parentId: null, name: 'Projects' })
    const chat = await insertChat(null, 'Trip / plans')
    const toFolder = await createShortcut(userId, { targetKind: 'file', targetId: projects.id })
    const toChat = await createShortcut(userId, { targetKind: 'chat', targetId: chat, parentId: projects.id })
    expect(toFolder).toMatchObject({ kind: 'shortcut', parentId: chatsFolderId, name: 'Projects', target: { kind: 'folder', id: projects.id, available: true } })
    // Names Files cannot hold are made valid.
    expect(toChat).toMatchObject({ parentId: projects.id, name: 'Trip - plans', target: { kind: 'chat', id: chat, available: true } })
    await expect(createShortcut(userId, { targetKind: 'file', targetId: toFolder.id })).rejects.toMatchObject({ code: 'file_shortcut_to_shortcut' })

    // A shortcut to a trashed item stays, marked unavailable; deleting the item removes it.
    await trashFileNodes(userId, [chat])
    expect((await listFolder(userId, projects.id)).children.find((node) => node.id === toChat.id)?.target).toMatchObject({ available: false })
    await db.delete(chats).where(eq(chats.id, chat))
    expect((await listFolder(userId, projects.id)).children.find((node) => node.id === toChat.id)).toBeUndefined()

    // Shortcuts move, copy (still opening the same item), and trash like files.
    const [copy] = await copyFileNodes(userId, [toFolder.id], projects.id)
    const [row] = await db.select().from(fileNodes).where(eq(fileNodes.id, copy!.id))
    expect(row).toMatchObject({ kind: 'shortcut', targetNodeId: projects.id })
  })

  it('keeps chats and Files items in one order, putting new and moved items on top', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const chat = await insertChat(null, 'Older chat')
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const inner = await createSidebarFolder(userId, { name: 'Inner', parentId: work.id })
    const order = async (folderId: string) => (await listFolder(userId, folderId)).children
      .sort((left, right) => left.sortOrder! - right.sortOrder! || right.createdAt.localeCompare(left.createdAt))
      .map((node) => node.name)
    expect(await order(chatsFolderId)).toEqual(['Work', 'Older chat'])

    await moveFileNodes(userId, [{ id: chat, parentId: work.id }])
    expect(await order(work.id)).toEqual(['Older chat', 'Inner'])

    // One order for a folder, moving in what is listed from elsewhere and unpinning chats.
    await db.update(chats).set({ pinned: true }).where(eq(chats.id, chat))
    const notes = await createSidebarFolder(userId, { name: 'Notes' })
    expect(await order(chatsFolderId)).toEqual(['Notes', 'Work'])
    await orderSidebarItems(userId, null, [work.id, chat, notes.id])
    expect(await order(chatsFolderId)).toEqual(['Work', 'Older chat', 'Notes'])
    expect(await chatRow(chat)).toMatchObject({ folderId: null, pinned: false })
    await orderSidebarItems(userId, work.id, [inner.id])
    expect(await order(work.id)).toEqual(['Inner'])

    // A new chat goes above everything at the top level.
    expect(await topChatOrder(db, userId, null)).toBe(-1)
  })

  it('creates sidebar folders idempotently with a client id, suffixing taken names', async () => {
    const id = randomUUID()
    const first = await createSidebarFolder(userId, { id, name: 'Work' })
    const replay = await createSidebarFolder(userId, { id, name: 'Work' })
    const other = await createSidebarFolder(userId, { name: 'work' })
    expect(replay.id).toBe(first.id)
    expect(other.name).toBe('work (2)')
  })

  it('colors files and folders without changing their content, and shortcuts look like their targets', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const shortcut = await createShortcut(userId, { targetKind: 'file', targetId: work.id })
    const styled = await updateSidebarItem(userId, work.id, { color: 'teal', icon: 'rocket' })
    expect(styled).toMatchObject({ name: 'Work', color: 'teal', icon: 'rocket', revision: work.revision, updatedAt: work.updatedAt })
    expect((await sidebarFolderItems(userId, chatsFolderId, true)).find((item) => item.id === shortcut.id)?.target)
      .toMatchObject({ color: 'teal', icon: 'rocket' })
    expect(await updateSidebarItem(userId, work.id, { icon: null })).toMatchObject({ color: 'teal', icon: null })
    const [copy] = await copyFileNodes(userId, [work.id], chatsFolderId)
    expect(copy).toMatchObject({ color: 'teal', icon: null })
    // Built-in folders take a color, but keep their own icon.
    expect(await updateSidebarItem(userId, chatsFolderId, { color: 'red' })).toMatchObject({ systemRole: 'chats', color: 'red', name: 'Sidebar' })
    await expect(updateSidebarItem(userId, chatsFolderId, { icon: 'rocket' })).rejects.toMatchObject({ code: 'file_system_folder' })
    await expect(updateSidebarItem(userId, await insertChat(), { color: 'red' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('suffixes a taken name when renaming from the sidebar, but lets an item change its own case', async () => {
    await createSidebarFolder(userId, { name: 'Work' })
    await createSidebarFolder(userId, { name: 'Work (2)' })
    const fresh = await createSidebarFolder(userId, { name: 'Untitled folder' })
    expect((await updateSidebarItem(userId, fresh.id, { name: 'work' })).name).toBe('work (3)')
    expect((await updateSidebarItem(userId, fresh.id, { name: 'WORK (3)' })).name).toBe('WORK (3)')
    await expect(updateFileNode(userId, fresh.id, { name: 'Work' })).rejects.toMatchObject({ code: 'file_name_conflict' })
  })

  it('pins folders, files, and shortcuts with the chats, listing them under Pinned instead of in their folder', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const projects = await createFolder(userId, { parentId: null, name: 'Projects' })
    const shortcut = await createShortcut(userId, { targetKind: 'file', targetId: projects.id })
    const chat = await insertChat(null, 'Pinned chat')
    await db.update(chats).set({ pinned: true, sortOrder: 0 }).where(eq(chats.id, chat))

    // Pinned after what is already pinned, in the order given, wherever they are in Files.
    await pinSidebarItems(userId, [projects.id, work.id, shortcut.id], true)
    const pinned = (await sidebarState(userId)).pinnedItems!
    expect(pinned.map((node) => [node.name, node.pinned]).sort()).toEqual([['Projects', true], ['Projects', true], ['Work', true]])
    const order = new Map(pinned.map((node) => [node.id, node.sortOrder]))
    expect([order.get(projects.id), order.get(work.id), order.get(shortcut.id)]).toEqual([1, 2, 3])
    // The sidebar no longer lists them in their folder; Files still does, marked.
    expect(await sidebarFolderItems(userId, chatsFolderId, true)).toEqual([])
    expect((await listFolder(userId, chatsFolderId)).children.find((node) => node.id === work.id)).toMatchObject({ pinned: true })
    // Pinning again leaves them in place.
    await pinSidebarItems(userId, [work.id], true)
    expect((await sidebarState(userId)).pinnedItems!.find((node) => node.id === work.id)?.sortOrder).toBe(2)
    // A pinned folder's subfolders are known to the sidebar, so nothing is dragged into itself.
    const inner = await createFolder(userId, { parentId: projects.id, name: 'Inner' })
    expect((await sidebarState(userId)).folders.find((folder) => folder.id === inner.id)?.parentId).toBe(projects.id)

    // One order for the pinned list, chats included; unpinned items rejoin the top of their folder.
    await orderPinnedItems(userId, [work.id, chat, shortcut.id, projects.id])
    expect((await chatRow(chat)).sortOrder).toBe(1)
    await pinSidebarItems(userId, [work.id, chat], false)
    expect(await chatRow(chat)).toMatchObject({ pinned: false, folderId: null })
    expect((await sidebarFolderItems(userId, chatsFolderId, true)).map((node) => node.id)).toEqual([work.id])
    const chatsOrder = (await listFolder(userId, chatsFolderId)).children.filter((node) => !node.pinned)
      .sort((left, right) => left.sortOrder! - right.sortOrder!).map((node) => node.id)
    expect(chatsOrder).toEqual([work.id, chat])
    // Ordering the pinned list pins what it lists.
    await orderPinnedItems(userId, [chat, shortcut.id])
    expect(await chatRow(chat)).toMatchObject({ pinned: true, sortOrder: 0 })
  })

  it('keeps items pinned when they move, unless placed in the sidebar outside the pinned list', async () => {
    const { chatsFolderId } = await ensureSystemFolders(userId)
    const work = await createSidebarFolder(userId, { name: 'Work' })
    const notes = await createSidebarFolder(userId, { name: 'Notes' })
    const other = await createFolder(userId, { parentId: null, name: 'Other' })
    const chat = await insertChat(null, 'Chat')
    const row = async (id: string) => (await db.select().from(fileNodes).where(eq(fileNodes.id, id)))[0]!
    await pinSidebarItems(userId, [work.id, notes.id, other.id, chat], true)
    const place = (await row(work.id)).sortOrder

    // Moving in Files, or with the sidebar's move menu, keeps the item's place in the pinned list.
    await moveFileNodes(userId, [{ id: work.id, parentId: other.id }])
    expect(await row(work.id)).toMatchObject({ parentId: other.id, pinned: true, sortOrder: place })
    await moveSidebarItems(userId, [work.id, chat], notes.id)
    expect(await row(work.id)).toMatchObject({ parentId: notes.id, pinned: true, sortOrder: place })
    expect(await chatRow(chat)).toMatchObject({ folderId: notes.id, pinned: true })
    // Dragged out of the pinned list, even into the folder it is already in, it is unpinned.
    await moveSidebarItems(userId, [work.id, chat], notes.id, { unpin: true })
    expect(await row(work.id)).toMatchObject({ parentId: notes.id, pinned: false })
    expect(await chatRow(chat)).toMatchObject({ folderId: notes.id, pinned: false })
    await pinSidebarItems(userId, [notes.id], true)
    await orderSidebarItems(userId, null, [notes.id])
    expect(await row(notes.id)).toMatchObject({ pinned: false })
    await archiveItems(userId, { chatIds: [], fileIds: [other.id] })
    expect(await row(other.id)).toMatchObject({ pinned: false })
    // Renaming or recoloring leaves the pin alone.
    await pinSidebarItems(userId, [notes.id], true)
    await updateSidebarItem(userId, notes.id, { name: 'Notes 2', color: 'red' })
    expect(await row(notes.id)).toMatchObject({ pinned: true })
    // Copies are not pinned.
    const [copy] = await copyFileNodes(userId, [notes.id], chatsFolderId)
    expect(copy).toMatchObject({ pinned: false })
  })

  it('pins Archive but not the Sidebar folder, and lists only folders without Files', async () => {
    const { chatsFolderId, archiveFolderId } = await ensureSystemFolders(userId)
    await expect(pinSidebarItems(userId, [chatsFolderId], true)).rejects.toMatchObject({ code: 'file_system_folder' })
    await expect(orderPinnedItems(userId, [chatsFolderId])).rejects.toMatchObject({ code: 'file_system_folder' })
    const folder = await createFolder(userId, { parentId: null, name: 'Folder' })
    const doc = await createDoc(userId, { parentId: null, name: 'Notes.md' })
    await pinSidebarItems(userId, [archiveFolderId, folder.id, doc.id], true)
    expect((await sidebarState(userId)).pinnedItems!.map((node) => node.id).sort()).toEqual([archiveFolderId, folder.id, doc.id].sort())
    expect((await sidebarState(userId, false)).pinnedItems!.map((node) => node.id).sort()).toEqual([archiveFolderId, folder.id].sort())
    // Trashed items leave the list, and return with their pin when restored.
    await trashFileNodes(userId, [folder.id])
    expect((await sidebarState(userId)).pinnedItems!.map((node) => node.id)).not.toContain(folder.id)
    await restoreFileNodes(userId, [folder.id])
    expect((await sidebarState(userId)).pinnedItems!.map((node) => node.id)).toContain(folder.id)
    await expect(pinSidebarItems(userId, [randomUUID()], true)).rejects.toMatchObject({ code: 'not_found' })
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
