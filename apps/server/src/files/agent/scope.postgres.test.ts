import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../../database/client.js'
import { chats } from '../../database/schema.js'
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

  it('finds names the way the database compares them', async () => {
    const notes = await files.folder('Notes')
    await files.doc('İstanbul.md', notes, 'trip')
    await files.attach({ [notes]: 'read' })
    expect((await files.ok('cat', { path: 'Notes/İstanbul.md' })).output).toBe('trip')
    expect((await files.ok('cat', { path: 'notes/İSTANBUL.md' })).output).toBe('trip')
  })
})
