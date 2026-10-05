import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { users } from '../database/schema.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))

const { getFolderLayout, normalizeInput, updateFolderLayout } = await import('./layout-service.js')
const { createFolder, moveFileNodes } = await import('./tree-service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

describe.skipIf(!enabled)('Files grid layouts', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Layout test', email: `${userId}@example.test`, username: `l${userId.replaceAll('-', '')}`, role: 'user' })
  })
  afterAll(async () => { await queryClient.end() })

  it('snaps to the grid with no positions until arranged', async () => {
    expect(await getFolderLayout(userId, null)).toEqual({ folderId: null, snapToGrid: true, positions: {} })
  })

  it('merges positions per folder, forgets nulls, and drops items that left', async () => {
    const a = await createFolder(userId, { parentId: null, name: 'A' })
    const b = await createFolder(userId, { parentId: null, name: 'B' })
    const inner = await createFolder(userId, { parentId: a.id, name: 'Inner' })
    await updateFolderLayout(userId, normalizeInput({ folderId: null, snapToGrid: false, positions: { [a.id]: { x: 10, y: 20 }, [b.id]: { x: 300, y: 20 } } }))
    await updateFolderLayout(userId, normalizeInput({ folderId: null, positions: { [b.id]: { x: 400, y: 50 } } }))
    expect(await getFolderLayout(userId, null)).toEqual({ folderId: null, snapToGrid: false, positions: { [a.id]: { x: 10, y: 20 }, [b.id]: { x: 400, y: 50 } } })
    // Each folder has its own layout.
    await updateFolderLayout(userId, normalizeInput({ folderId: a.id, positions: { [inner.id]: { x: 0, y: 0 } } }))
    expect((await getFolderLayout(userId, a.id)).positions).toEqual({ [inner.id]: { x: 0, y: 0 } })
    // Moving B into A drops its place at the top on the next write; null forgets A's.
    await moveFileNodes(userId, [{ id: b.id, parentId: a.id }])
    await updateFolderLayout(userId, normalizeInput({ folderId: null, positions: { [a.id]: null } }))
    expect(await getFolderLayout(userId, null)).toEqual({ folderId: null, snapToGrid: false, positions: {} })
  })
})
