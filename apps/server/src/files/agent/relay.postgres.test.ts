import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../../database/client.js'
import { chats, fileChanges, fileNodes, fileVersions } from '../../database/schema.js'
import { storageUsedBytes } from '../../attachments/storage-quota.js'
import { createShortcut } from '../shortcuts.js'
import { ensureSystemFolders } from '../system-folders.js'
import { loadChatFileScope, modeFor } from './scope.js'
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

async function changeRows(nodeId: string) {
  return db.select().from(fileChanges).where(eq(fileChanges.nodeId, nodeId))
}

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }
type PullData = { files: Array<{ remote: string; local: string; nodeId: string; version: string; kind: string; sizeBytes: number }> }

async function push(items: Array<{ local: string; remote: string; base?: { nodeId: string; version: string } | null; force?: boolean }>) {
  const result = await files.ok('push', { items: items.map((item) => ({ base: null, ...item })) })
  return (result.data as PushData).results
}

async function pull(path: string, dest: string) {
  return ((await files.ok('pull', { path, dest })).data as PullData).files
}

describe.skipIf(!enabled)('pulpo files relay', () => {
  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
  })
  afterAll(async () => { await queryClient.end() })

  it('refuses malformed requests before touching Files', async () => {
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'write' })
    expect(await files.error('chmod', {})).toMatch(/Unknown command/)
    expect(await files.error('ls', { path: 'Projects', extra: true })).toMatch(/Invalid arguments/)
    expect(await files.error('push', { items: [] })).toMatch(/Invalid arguments/)
    expect(await files.error('push', { items: [{ local: '/workspace/a', remote: 'Projects/a', base: { nodeId: 'not-a-uuid', version: 'x' } }] })).toMatch(/Invalid arguments/)
    expect(await files.error('cat', { path: 'Projects/../secret' })).toMatch(/"\." or "\.\."/)
    expect(await files.error('pull', { path: 'Projects', dest: '/etc/passwd' })).toMatch(/inside \/workspace/)
    expect(await files.error('pull', { path: 'Projects', dest: '/workspace/../etc' })).toMatch(/inside \/workspace/)
    files.put('/etc/passwd', 'x')
    const [outside] = await push([{ local: '/workspace/files/../../etc/passwd', remote: 'Projects/p' }])
    expect(outside).toMatchObject({ status: 'error', message: expect.stringMatching(/inside \/workspace/) })
  })

  it('reaches only attached items and hides shortcuts', async () => {
    const projects = await files.folder('Projects')
    const secret = await files.folder('Secret')
    await files.doc('Plan.md', projects, '# Plan')
    await files.blob('hidden.txt', secret, 'top secret')
    await createShortcut(files.userId, { parentId: projects, targetKind: 'file', targetId: secret })
    await files.attach({ [projects]: 'suggest' })
    expect((await files.ok('ls', {})).output).toBe('Projects/  (folder, you can suggest changes)')
    expect((await files.ok('ls', { path: 'projects' })).output).toMatch(/^Projects\/Plan\.md {2}\(Markdown document, /)
    expect((await files.ok('ls', { path: 'Projects' })).output).not.toMatch(/Secret/)
    expect(await files.error('cat', { path: 'Secret/hidden.txt' })).toMatch(/not attached to this chat/)
    expect(await files.error('cat', { path: 'Projects/Secret/hidden.txt' })).toMatch(/does not exist/)
  })

  it('labels attached items uniquely and reaches nested ones through their folder', async () => {
    const work = await files.folder('Work')
    const notesA = await files.folder('Notes', work)
    const notesB = await files.folder('Notes')
    const notesC = await files.folder('Notes (2)', work)
    const plan = await files.doc('Plan.md', notesA, 'a')
    await files.doc('Plan.md', notesB, 'b')
    await files.attach({ [notesA]: 'suggest', [notesB]: 'read', [notesC]: undefined, [plan]: 'write' })
    const scope = (await loadChatFileScope(files.userId, files.chatId))!
    expect(scope.roots.map((root) => root.label)).toEqual(['Notes', 'Notes (2)', 'Notes (2) (2)'])
    expect(scope.attached.map((item) => [item.path, item.location, item.mode])).toEqual([
      ['Notes', 'Work', 'suggest'], ['Notes (2)', null, 'read'], ['Notes (2) (2)', 'Work', 'suggest'], ['Notes/Plan.md', null, 'write'],
    ])
    expect((await files.ok('cat', { path: 'notes (2)/plan.md' })).output).toBe('b')
    expect(await modeFor(scope, plan)).toBe('write')
    expect(await modeFor(scope, notesB)).toBe('read')
    expect(await modeFor(scope, work)).toBeNull()
    // Temporary chats and turned-off Files get no scope at all.
    await db.update(chats).set({ temporary: true }).where(eq(chats.id, files.chatId))
    expect(await loadChatFileScope(files.userId, files.chatId)).toBeNull()
    expect(await files.error('ls', {})).toMatch(/not available in this chat/)
  })

  it('lists and outlines folders with modes of attached items', async () => {
    const projects = await files.folder('Projects')
    const drafts = await files.folder('Drafts', projects)
    const plan = await files.doc('Plan.md', projects, '# Plan')
    await files.doc('Idea.md', drafts, 'idea')
    await files.attach({ [projects]: 'read', [plan]: 'write' })
    const listing = (await files.ok('ls', { path: 'Projects', recursive: true })).output.split('\n')
    expect(listing.map((line) => line.split('  ')[0])).toEqual(['Projects/Drafts/', 'Projects/Drafts/Idea.md', 'Projects/Plan.md'])
    expect(listing[2]).toMatch(/you can edit it directly/)
    expect((await files.ok('tree', { path: 'Projects' })).output).toBe('Projects/\n  Drafts/\n    Idea.md\n  Plan.md')
    expect((await files.ok('tree', { path: 'Projects', depth: 1 })).output).toBe('Projects/\n  Drafts/\n  Plan.md')
  })

  it('prints documents and text files, and searches them', async () => {
    const notes = await files.folder('Notes')
    await files.doc('Plan.md', notes, '# Plan\n\nShip the relay')
    await files.blob('todo.txt', notes, 'buy milk\nship it\n')
    await files.blob('photo.png', notes, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')
    await files.blob('long.txt', notes, `${'a'.repeat(30)}!`)
    await files.attach({ [notes]: 'read' })
    expect((await files.ok('cat', { path: 'Notes/Plan.md' })).output).toBe('# Plan\n\nShip the relay')
    expect((await files.ok('cat', { path: 'Notes/todo.txt' })).output).toBe('buy milk\nship it\n')
    expect(await files.error('cat', { path: 'Notes/photo.png' })).toMatch(/not a text file/)
    expect(await files.error('cat', { path: 'Notes' })).toMatch(/is a folder/)
    expect((await files.ok('grep', { pattern: 'ship' })).output).toBe('Notes/todo.txt:2: ship it')
    expect((await files.ok('grep', { pattern: 'SHIP', ignoreCase: true, path: 'Notes' })).output).toBe('Notes/Plan.md:3: Ship the relay\nNotes/todo.txt:2: ship it')
    expect((await files.ok('grep', { pattern: 'a.b', fixed: true })).output).toBe('No matches')
    expect(await files.error('grep', { pattern: '(' })).toMatch(/Invalid pattern/)
    // A pattern that backtracks forever is stopped instead of stalling the worker.
    const started = Date.now()
    expect(await files.error('grep', { pattern: '(a+)+$', path: 'Notes/long.txt' })).toMatch(/took too long/)
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 20_000)

  it('pulls files with the versions a push must match', async () => {
    const projects = await files.folder('Projects')
    const drafts = await files.folder('Drafts', projects)
    const plan = await files.doc('Plan.md', projects, '# Plan')
    const data = await files.blob('data.csv', drafts, 'a,b\n1,2\n', 'text/csv')
    await files.attach({ [projects]: 'suggest' })
    const pulled = await pull('Projects', '/workspace/files/Projects')
    expect(pulled.map((file) => [file.remote, file.local, file.kind])).toEqual([
      ['Projects/Drafts/data.csv', '/workspace/files/Projects/Drafts/data.csv', 'blob'],
      ['Projects/Plan.md', '/workspace/files/Projects/Plan.md', 'doc'],
    ])
    expect(pulled[0]).toMatchObject({ nodeId: data, version: (await files.node(data))!.checksum, sizeBytes: 8 })
    expect(pulled[1]).toMatchObject({ nodeId: plan, version: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(files.workspace.files.get('/workspace/files/Projects/Plan.md')?.toString()).toBe('# Plan\n')
    expect(files.workspace.files.get('/workspace/files/Projects/Drafts/data.csv')?.toString()).toBe('a,b\n1,2\n')
    const [single] = await pull('Projects/Drafts/data.csv', '/workspace/elsewhere/data.csv')
    expect(single).toMatchObject({ local: '/workspace/elsewhere/data.csv', remote: 'Projects/Drafts/data.csv' })
  })

  it('refuses every change to read only items', async () => {
    const notes = await files.folder('Notes')
    const todo = await files.blob('todo.txt', notes, 'old')
    await files.attach({ [notes]: 'read' })
    files.put('/workspace/files/Notes/todo.txt', 'new')
    files.put('/workspace/files/Notes/new.txt', 'new')
    const results = await push([
      { local: '/workspace/files/Notes/todo.txt', remote: 'Notes/todo.txt', force: true },
      { local: '/workspace/files/Notes/new.txt', remote: 'Notes/new.txt' },
    ])
    expect(results.map((result) => result.status)).toEqual(['denied', 'denied'])
    expect(results[0]!.message).toMatch(/read only/)
    expect(await files.error('mkdir', { path: 'Notes/Sub' })).toMatch(/read only/)
    expect(await files.error('rm', { path: 'Notes/todo.txt' })).toMatch(/read only/)
    expect(await files.error('mv', { from: 'Notes/todo.txt', to: 'Notes/renamed.txt' })).toMatch(/read only/)
    expect(await files.content(todo)).toBe('old')
    expect(await db.select().from(fileChanges).where(eq(fileChanges.chatId, files.chatId))).toEqual([])
    expect(files.changes).toEqual([])
  })

  it('follows the nearest attached item for modes', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.blob('plan.txt', projects, 'v1')
    await files.blob('other.txt', projects, 'v1')
    await files.attach({ [projects]: 'read', [plan]: 'write' })
    files.put('/workspace/plan.txt', 'v2')
    files.put('/workspace/other.txt', 'v2')
    const results = await push([
      { local: '/workspace/plan.txt', remote: 'Projects/plan.txt', force: true },
      { local: '/workspace/other.txt', remote: 'Projects/other.txt', force: true },
    ])
    expect(results.map((result) => result.status)).toEqual(['updated', 'denied'])
    expect(await files.content(plan)).toBe('v2')
    // A move out of a writable item into a read only folder is as restrictive as the folder.
    expect(await files.error('mv', { from: 'Projects/plan.txt', to: 'Projects/moved.txt' })).toMatch(/read only/)
  })

  it('writes uploaded files directly, checking the pulled version', async () => {
    const projects = await files.folder('Projects')
    const data = await files.blob('data.csv', projects, 'v1')
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/data.csv', '/workspace/files/Projects/data.csv')
    const base = { nodeId: data, version: pulled!.version }
    files.put('/workspace/files/Projects/data.csv', 'v1')
    expect((await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv', base }]))[0]).toMatchObject({ status: 'unchanged' })
    files.put('/workspace/files/Projects/data.csv', 'v2')
    expect((await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv' }]))[0]).toMatchObject({ status: 'conflict', message: expect.stringMatching(/already exists/) })
    const [updated] = await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv', base }])
    expect(updated).toMatchObject({ status: 'updated', nodeId: data })
    expect(updated!.version).not.toBe(base.version)
    expect(await files.content(data)).toBe('v2')
    // The pulled version is stale now.
    files.put('/workspace/files/Projects/data.csv', 'v3')
    expect((await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv', base }]))[0]).toMatchObject({ status: 'conflict' })
    expect((await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv', base, force: true }]))[0]).toMatchObject({ status: 'updated' })
    expect(await files.content(data)).toBe('v3')
    // One row per reply keeps the content the reply started from; v2 is not needed any more.
    const [row] = await changeRows(data)
    expect(row).toMatchObject({ mode: 'write', kind: 'update', status: 'applied' })
    expect(row!.before).toMatchObject({ sizeBytes: 2 })
    const versions = await db.select().from(fileVersions).where(eq(fileVersions.nodeId, data))
    expect(versions.map((version) => version.objectKey)).toEqual([(row!.before as { objectKey: string }).objectKey])
    expect(objects.get(versions[0]!.objectKey)?.toString()).toBe('v1')
    expect(files.changes.at(-1)).toBe(1)
  })

  it('creates files and folders, and reports items that moved away', async () => {
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/files/Projects/New/notes.md', '# Notes')
    files.put('/workspace/files/Projects/New/data.bin', Buffer.from([1, 2, 3]))
    expect((await files.ok('mkdir', { path: 'Projects/New' })).output).toBe('Created the folder "Projects/New/"')
    expect(await files.error('mkdir', { path: 'Projects/New' })).toMatch(/already exists/)
    expect((await files.ok('mkdir', { path: 'Projects/New', parents: true })).output).toMatch(/already exists/)
    const results = await push([
      { local: '/workspace/files/Projects/New/notes.md', remote: 'Projects/New/notes.md' },
      { local: '/workspace/files/Projects/New/data.bin', remote: 'Projects/New/data.bin' },
      { local: '/workspace/files/Projects/New/data.bin', remote: 'Projects/Missing/data.bin' },
      { local: '/workspace/files/Projects/New/data.bin', remote: 'Projects/gone.bin', base: { nodeId: projects, version: 'x' } },
    ])
    expect(results.map((result) => result.status)).toEqual(['created', 'created', 'error', 'conflict'])
    expect(results[2]!.message).toMatch(/does not exist; create it first/)
    expect(results[3]!.message).toMatch(/no longer in Files/)
    const doc = await files.node(results[0]!.nodeId!)
    const blob = await files.node(results[1]!.nodeId!)
    expect(doc).toMatchObject({ kind: 'doc', name: 'notes.md', suggestionChangeId: null })
    expect(blob).toMatchObject({ kind: 'blob', mimeType: 'application/octet-stream', sizeBytes: 3 })
    expect(blob!.objectKey).not.toContain(blob!.id)
    expect((await files.ok('cat', { path: 'Projects/New/notes.md' })).output).toBe('# Notes')
    const rows = await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))
    expect(rows.map((row) => [row.kind, row.mode, row.status])).toEqual([['create', 'write', 'applied'], ['create', 'write', 'applied'], ['create', 'write', 'applied']])
    expect(files.changes.at(-1)).toBe(3)
  })

  it('suggests new items, folding what the agent adds inside them', async () => {
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'suggest' })
    expect((await files.ok('mkdir', { path: 'Projects/New/Deeper', parents: true })).output)
      .toBe('Suggested the new folder "Projects/New/"; it waits for the user to accept it\nSuggested the new folder "Projects/New/Deeper/"; it waits for the user to accept it')
    files.put('/workspace/a.txt', 'a')
    const [created] = await push([{ local: '/workspace/a.txt', remote: 'Projects/New/Deeper/a.txt' }])
    expect(created).toMatchObject({ status: 'suggested' })
    const rows = await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'create', mode: 'suggest', status: 'pending' })
    const suggested = await db.select().from(fileNodes).where(eq(fileNodes.suggestionChangeId, rows[0]!.id))
    expect(suggested.map((node) => node.name).sort()).toEqual(['Deeper', 'New', 'a.txt'])
    expect((await files.ok('ls', { path: 'Projects/New' })).output).toMatch(/Deeper\/ {2}\(folder, suggested, not accepted yet\)/)
    // Editing something still awaiting review changes the suggestion itself.
    files.put('/workspace/a.txt', 'b')
    expect((await push([{ local: '/workspace/a.txt', remote: 'Projects/New/Deeper/a.txt', force: true }]))[0]).toMatchObject({ status: 'suggested' })
    expect(await files.content(created!.nodeId!)).toBe('b')
    // Deleting part of it withdraws that part.
    expect((await files.ok('rm', { path: 'Projects/New/Deeper', recursive: true })).output).toMatch(/which you had suggested adding/)
    expect(await files.node(created!.nodeId!)).toBeUndefined()
    expect(await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))).toHaveLength(1)
  })

  it('proposes new content for uploaded files and shows the agent its proposal', async () => {
    const projects = await files.folder('Projects')
    const data = await files.blob('data.txt', projects, 'v1')
    await files.attach({ [projects]: 'suggest' })
    const [pulled] = await pull('Projects/data.txt', '/workspace/data.txt')
    files.put('/workspace/data.txt', 'v2')
    const [proposed] = await push([{ local: '/workspace/data.txt', remote: 'Projects/data.txt', base: { nodeId: data, version: pulled!.version } }])
    expect(proposed).toMatchObject({ status: 'suggested', message: expect.stringMatching(/waits for the user/) })
    expect(await files.content(data)).toBe('v1')
    expect((await files.ok('cat', { path: 'Projects/data.txt' })).output).toBe('v2')
    expect((await files.ok('ls', { path: 'Projects/data.txt' })).output).toMatch(/you suggested new content/)
    const [again] = await pull('Projects/data.txt', '/workspace/data.txt')
    expect(again!.version).toBe(proposed!.version)
    // A second push in the same reply replaces the proposal.
    files.put('/workspace/data.txt', 'v3')
    await push([{ local: '/workspace/data.txt', remote: 'Projects/data.txt', base: { nodeId: data, version: again!.version } }])
    const versions = await db.select().from(fileVersions).where(eq(fileVersions.nodeId, data))
    expect(versions.map((version) => objects.get(version.objectKey)?.toString())).toEqual(['v3'])
    // A later reply in the chat supersedes it.
    const first = files.responseId
    await files.newReply()
    files.put('/workspace/data.txt', 'v4')
    await push([{ local: '/workspace/data.txt', remote: 'Projects/data.txt', force: true }])
    const rows = await changeRows(data)
    expect(rows.map((row) => [row.responseId === first, row.status])).toEqual(expect.arrayContaining([[true, 'rejected'], [false, 'pending']]))
    expect((await db.select().from(fileVersions).where(eq(fileVersions.nodeId, data))).map((version) => objects.get(version.objectKey)?.toString())).toEqual(['v4'])
    expect(await storageUsedBytes(db, files.userId)).toBe(2 + 2)
  })

  it('moves, renames, and trashes items in Write mode', async () => {
    const projects = await files.folder('Projects')
    const archive = await files.folder('Archive', projects)
    const plan = await files.doc('Plan.md', projects, '# Plan')
    const data = await files.blob('data.txt', projects, 'v1')
    await files.attach({ [projects]: 'write' })
    expect((await files.ok('mv', { from: 'Projects/data.txt', to: 'Projects/Archive' })).output).toBe('Moved "Projects/data.txt" to "Projects/Archive/data.txt"')
    expect((await files.ok('mv', { from: 'Projects/Archive/data.txt', to: 'Projects/Archive/Data.TXT' })).output).toMatch(/to "Projects\/Archive\/Data\.TXT"/)
    expect(await files.node(data)).toMatchObject({ parentId: archive, name: 'Data.TXT' })
    expect(await files.error('mv', { from: 'Projects/Plan.md', to: 'Projects/Plan.txt' })).toMatch(/keep a \.md name/)
    expect(await files.error('mv', { from: 'Projects', to: 'Projects/Archive' })).toMatch(/cannot be moved into itself/)
    expect(await files.error('mv', { from: 'Projects/Plan.md', to: 'Projects/Archive/Data.txt' })).toMatch(/already exists/)
    const [move] = await changeRows(data)
    expect(move).toMatchObject({ kind: 'move', before: { parentId: projects, name: 'data.txt' }, after: { parentId: archive, name: 'Data.TXT' } })
    // Moving back where the reply found it leaves nothing to undo.
    await files.ok('mv', { from: 'Projects/Archive/Data.TXT', to: 'Projects/data.txt' })
    expect(await changeRows(data)).toEqual([])
    expect(await files.error('rm', { path: 'Projects/Archive' })).toMatch(/use pulpo files rm -r/)
    expect((await files.ok('rm', { path: 'Projects/Plan.md' })).output).toMatch(/to the trash/)
    expect((await files.node(plan))!.trashedAt).not.toBeNull()
    expect(await changeRows(plan)).toEqual([expect.objectContaining({ kind: 'trash', mode: 'write', status: 'applied' })])
  })

  it('suggests moves and deletions without applying them', async () => {
    const projects = await files.folder('Projects')
    const plan = await files.doc('Plan.md', projects, '# Plan')
    await files.attach({ [projects]: 'suggest' })
    expect((await files.ok('mv', { from: 'Projects/Plan.md', to: 'Projects/Roadmap.md' })).output).toMatch(/^Suggested moving/)
    expect((await files.ok('rm', { path: 'Projects/Plan.md' })).output).toMatch(/^Suggested deleting/)
    expect(await files.node(plan)).toMatchObject({ name: 'Plan.md', trashedAt: null })
    expect((await files.ok('ls', { path: 'Projects' })).output).toMatch(/you suggested moving it to "Projects\/Roadmap\.md", you suggested deleting it/)
    expect((await changeRows(plan)).map((row) => [row.kind, row.status]).sort()).toEqual([['move', 'pending'], ['trash', 'pending']])
  })

  it('works from the top of My files and keeps built-in folders in place', async () => {
    const { chatsFolderId: sidebar } = await ensureSystemFolders(files.userId)
    await files.attach({ root: 'write' })
    expect((await files.ok('ls', {})).output).toMatch(/^Archive\/ {2}\(folder\)\nSidebar\/ {2}\(folder\)$/)
    expect((await files.ok('mkdir', { path: 'Top' })).output).toBe('Created the folder "Top/"')
    expect(await files.error('mv', { from: 'Sidebar', to: 'Top' })).toMatch(/built in/)
    expect(await files.error('rm', { path: 'Sidebar', recursive: true })).toMatch(/built in/)
    expect(await files.node(sidebar)).toMatchObject({ parentId: null, trashedAt: null })
  })

  it('charges new and kept contents to storage', async () => {
    files = await filesFixture({ storageLimitBytes: 10 })
    const projects = await files.folder('Projects')
    const data = await files.blob('data.txt', projects, 'abcd')
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/data.txt', 'efgh')
    expect((await push([{ local: '/workspace/data.txt', remote: 'Projects/data.txt', force: true }]))[0]).toMatchObject({ status: 'updated' })
    // The replaced content is kept for undo and still counts.
    expect(await storageUsedBytes(db, files.userId)).toBe(8)
    files.put('/workspace/big.txt', 'ijklm')
    const [refused] = await push([{ local: '/workspace/big.txt', remote: 'Projects/big.txt' }])
    expect(refused).toMatchObject({ status: 'error', message: expect.stringMatching(/storage allowance/) })
    expect(await db.select().from(fileNodes).where(and(eq(fileNodes.ownerUserId, files.userId), eq(fileNodes.name, 'big.txt')))).toEqual([])
    // Nothing is left behind in the store for the refused file.
    const keys = new Set((await db.select({ key: fileNodes.objectKey }).from(fileNodes).where(eq(fileNodes.ownerUserId, files.userId))).map((row) => row.key))
    const versions = await db.select({ key: fileVersions.objectKey }).from(fileVersions).where(eq(fileVersions.userId, files.userId))
    for (const version of versions) keys.add(version.key)
    expect([...objects.keys()].filter((key) => key.startsWith(`users/${files.userId}/`)).sort()).toEqual([...keys].filter(Boolean).sort())
    expect(await files.content(data)).toBe('efgh')
  })
})
