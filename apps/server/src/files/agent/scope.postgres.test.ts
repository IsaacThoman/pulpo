import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../../database/client.js'
import { chats, fileChanges, fileNodes, fileVersions } from '../../database/schema.js'
import { mergedFileAccessSql } from '../../chats/file-scope.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../doc-events.js', () => ({ publishDocsClosed: vi.fn(), publishDocUpdate: vi.fn() }))
vi.mock('../../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let files: FilesFixture

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function access() {
  const [chat] = await db.select({ access: chats.fileScopeAccess }).from(chats).where(eq(chats.id, files.chatId))
  return chat!.access
}

describe.skipIf(!enabled)('chat Files scope', () => {
  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
  })
  afterAll(async () => { await queryClient.end() })

  it('merges two close changes to access modes without losing either', async () => {
    const a = await files.folder('A')
    const b = await files.folder('B')
    await files.attach({ [a]: undefined, [b]: undefined })
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const first = db.transaction(async (tx) => {
      await tx.update(chats).set({ fileScopeAccess: mergedFileAccessSql(undefined, { [a]: 'write' }) }).where(eq(chats.id, files.chatId))
      await held
    })
    await pause(50)
    const second = db.update(chats).set({ fileScopeAccess: mergedFileAccessSql(undefined, { [b]: 'read' }) }).where(eq(chats.id, files.chatId))
    await pause(50)
    release()
    await Promise.all([first, second])
    expect(await access()).toEqual({ [a]: 'write', [b]: 'read' })
    // Entries leaving the scope take their modes with them.
    await db.update(chats).set({ fileScopeIds: [b], fileScopeAccess: mergedFileAccessSql([b], {}) }).where(eq(chats.id, files.chatId))
    expect(await access()).toEqual({ [b]: 'read' })
  })

  it('refuses a change when the access changes while it is being made', async () => {
    const projects = await files.folder('Projects')
    const data = await files.blob('data.txt', projects, 'v1')
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/data.txt', 'v2')
    // The owner makes the folder read only; the agent's push started from the old access.
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const owner = db.transaction(async (tx) => {
      await tx.update(chats).set({ fileScopeAccess: { [projects]: 'read' } }).where(eq(chats.id, files.chatId))
      await held
    })
    await pause(50)
    const push = files.ok('push', { items: [{ local: '/workspace/data.txt', remote: 'Projects/data.txt', base: null, force: true }] })
    await pause(300)
    release()
    await owner
    const [result] = ((await push).data as { results: Array<{ status: string; message: string }> }).results
    expect(result).toMatchObject({ status: 'error', message: expect.stringMatching(/just changed; run the command again/) })
    expect(await files.content(data)).toBe('v1')
  })

  it('shows the chat\'s own proposal only while the agent may only suggest', async () => {
    const projects = await files.folder('Projects')
    const data = await files.blob('data.txt', projects, 'v1')
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/data.txt', 'p1')
    await files.ok('push', { items: [{ local: '/workspace/data.txt', remote: 'Projects/data.txt', base: null, force: true }] })
    expect((await files.ok('cat', { path: 'Projects/data.txt' })).output).toBe('p1')
    // Allowed to change it directly from the next reply on, the agent works from the file itself.
    await files.attach({ [projects]: 'write' })
    await files.newReply()
    const pulled = ((await files.ok('pull', { path: 'Projects/data.txt', dest: '/workspace/data.txt' })).data as { files: Array<{ version: string }> }).files[0]!
    expect(files.workspace.files.get('/workspace/data.txt')?.toString()).toBe('v1')
    files.put('/workspace/data.txt', 'v2')
    const pushed = await files.ok('push', { items: [{ local: '/workspace/data.txt', remote: 'Projects/data.txt', base: { nodeId: data, version: pulled.version } }] })
    expect((pushed.data as { results: Array<{ status: string }> }).results[0]).toMatchObject({ status: 'updated' })
    expect(await files.content(data)).toBe('v2')
    // The superseded proposal is gone with its stored content.
    expect((await db.select().from(fileChanges).where(eq(fileChanges.nodeId, data))).map((row) => [row.mode, row.status]).sort()).toEqual([['suggest', 'rejected'], ['write', 'applied']])
    expect((await db.select().from(fileVersions).where(eq(fileVersions.nodeId, data))).map((row) => objects.get(row.objectKey)?.toString())).toEqual(['v1'])
  })

  it('trashes another chat\'s suggested item instead of withdrawing it', async () => {
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'suggest' })
    await files.ok('mkdir', { path: 'Projects/New' })
    const [suggested] = await db.select().from(fileNodes).where(eq(fileNodes.parentId, projects))
    await files.newChat()
    await files.attach({ [projects]: 'write' })
    expect((await files.ok('rm', { path: 'Projects/New', recursive: true })).output).toMatch(/to the trash/)
    expect(await db.select().from(fileNodes).where(eq(fileNodes.id, suggested!.id))).toEqual([
      expect.objectContaining({ suggestionChangeId: suggested!.suggestionChangeId, trashRootId: suggested!.id }),
    ])
    expect((await db.select().from(fileChanges).where(eq(fileChanges.nodeId, suggested!.id))).map((row) => [row.kind, row.status]).sort()).toEqual([['create', 'pending'], ['trash', 'applied']])
  })

  it('finds names the way the database compares them', async () => {
    const notes = await files.folder('Notes')
    await files.doc('İstanbul.md', notes, 'trip')
    await files.attach({ [notes]: 'read' })
    expect((await files.ok('cat', { path: 'Notes/İstanbul.md' })).output).toBe('trip')
    expect((await files.ok('cat', { path: 'notes/İSTANBUL.md' })).output).toBe('trip')
  })
})
