import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileNodes, fileVersions, responses } from '../../database/schema.js'
import { storageUsedBytes } from '../../attachments/storage-quota.js'
import { emptyTrash, moveFileNodes, restoreFileNode, trashFileNode, updateFileNode } from '../tree-service.js'
import { cleanupFileChanges, FILE_CHANGE_RETENTION_MS, listFileChanges } from './changes.js'
import { FileChangesConflictError, redoFileChanges, undoFileChanges } from './history.js'
import { reviewFileChange, reviewNodeSuggestion, reviewReplyChanges } from './review.js'
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

async function pushFile(local: string, remote: string, content: string) {
  files.put(local, content)
  const result = await files.ok('push', { items: [{ local, remote, base: null, force: true }] })
  return (result.data as { results: Array<{ status: string; nodeId: string }> }).results[0]!
}

async function conflictsOf(action: Promise<unknown>) {
  const error = await action.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(FileChangesConflictError)
  return (error as FileChangesConflictError).conflicts
}

async function versionContents(nodeId: string) {
  const rows = await db.select().from(fileVersions).where(eq(fileVersions.nodeId, nodeId))
  return rows.map((row) => objects.get(row.objectKey)?.toString()).sort()
}

describe.skipIf(!enabled)('agent file changes', () => {
  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
  })
  afterAll(async () => { await queryClient.end() })

  describe('undo and redo', () => {
    it('swaps uploaded file contents and their kept versions', async () => {
      const projects = await files.folder('Projects')
      const data = await files.blob('data.txt', projects, 'v1')
      await files.attach({ [projects]: 'write' })
      await pushFile('/workspace/data.txt', 'Projects/data.txt', 'v22')
      const used = await storageUsedBytes(db, files.userId)
      expect(await listFileChanges(files.userId, files.responseId)).toMatchObject({
        canUndo: true, canRedo: false,
        changes: [{ nodeId: data, kind: 'update', mode: 'write', status: 'applied', fromSizeBytes: 2, toSizeBytes: 3, available: true }],
      })
      expect(await undoFileChanges(files.userId, files.responseId)).toMatchObject({ canUndo: false, canRedo: true, changes: [{ status: 'undone' }] })
      expect(await files.content(data)).toBe('v1')
      expect(await versionContents(data)).toEqual(['v22'])
      expect(await storageUsedBytes(db, files.userId)).toBe(used)
      await redoFileChanges(files.userId, files.responseId)
      expect(await files.content(data)).toBe('v22')
      expect(await versionContents(data)).toEqual(['v1'])
      await expect(redoFileChanges(files.userId, files.responseId)).rejects.toMatchObject({ code: 'file_changes_state' })
    })

    it('trashes and restores created items, moves back, and restores trashed ones', async () => {
      const projects = await files.folder('Projects')
      const archive = await files.folder('Archive', projects)
      const old = await files.blob('old.txt', projects, 'old')
      const kept = await files.blob('kept.txt', projects, 'kept')
      await files.attach({ [projects]: 'write' })
      await files.ok('mkdir', { path: 'Projects/New' })
      const created = await pushFile('/workspace/a.txt', 'Projects/New/a.txt', 'a')
      await files.ok('mv', { from: 'Projects/kept.txt', to: 'Projects/Archive/renamed.txt' })
      await files.ok('rm', { path: 'Projects/old.txt' })
      const folder = (await db.select().from(fileNodes).where(eq(fileNodes.name, 'New')).then((rows) => rows.find((row) => row.ownerUserId === files.userId)))!

      await undoFileChanges(files.userId, files.responseId)
      expect((await files.node(folder.id))!.trashedAt).not.toBeNull()
      expect((await files.node(created.nodeId))!.trashedAt).not.toBeNull()
      expect(await files.node(kept)).toMatchObject({ parentId: projects, name: 'kept.txt' })
      expect(await files.node(old)).toMatchObject({ trashedAt: null, parentId: projects })

      await redoFileChanges(files.userId, files.responseId)
      expect(await files.node(folder.id)).toMatchObject({ trashedAt: null })
      expect(await files.node(created.nodeId)).toMatchObject({ trashedAt: null, parentId: folder.id })
      expect(await files.node(kept)).toMatchObject({ parentId: archive, name: 'renamed.txt' })
      expect((await files.node(old))!.trashedAt).not.toBeNull()
    })

    it('replays an item created and trashed in the same reply', async () => {
      const projects = await files.folder('Projects')
      await files.attach({ [projects]: 'write' })
      const created = await pushFile('/workspace/a.txt', 'Projects/a.txt', 'a')
      await files.ok('rm', { path: 'Projects/a.txt' })
      await undoFileChanges(files.userId, files.responseId)
      expect(await files.node(created.nodeId)).toMatchObject({ trashRootId: created.nodeId })
      await redoFileChanges(files.userId, files.responseId)
      expect(await files.node(created.nodeId)).toMatchObject({ trashRootId: created.nodeId })
      await undoFileChanges(files.userId, files.responseId)
    })

    it('refuses with every conflict when items changed since', async () => {
      const projects = await files.folder('Projects')
      const data = await files.blob('data.txt', projects, 'v1')
      const moved = await files.blob('moved.txt', projects, 'm')
      await files.attach({ [projects]: 'write' })
      await pushFile('/workspace/data.txt', 'Projects/data.txt', 'v2')
      await files.ok('mv', { from: 'Projects/moved.txt', to: 'Projects/moved-by-agent.txt' })
      const created = await pushFile('/workspace/new.txt', 'Projects/new.txt', 'n')
      const reply = files.responseId

      // Another reply replaces the file again; the owner renames and trashes things.
      await files.newReply()
      await pushFile('/workspace/data.txt', 'Projects/data.txt', 'v3')
      await updateFileNode(files.userId, moved, { name: 'moved-by-owner.txt' })
      await trashFileNode(files.userId, created.nodeId)

      const conflicts = await conflictsOf(undoFileChanges(files.userId, reply))
      expect(conflicts.map((conflict) => [conflict.nodeId, conflict.reason]).sort()).toEqual([
        [created.nodeId, 'trashed'], [data, 'replaced'], [moved, 'moved'],
      ].sort())
      // Nothing changed: the refusal is all or nothing.
      expect(await files.content(data)).toBe('v3')
      expect(await files.node(moved)).toMatchObject({ name: 'moved-by-owner.txt' })
      expect((await listFileChanges(files.userId, reply)).canUndo).toBe(true)

      await restoreFileNode(files.userId, created.nodeId)
      await updateFileNode(files.userId, moved, { name: 'moved-by-agent.txt' })
      await undoFileChanges(files.userId, files.responseId)
      await undoFileChanges(files.userId, reply)
      expect(await files.content(data)).toBe('v1')
      expect(await files.node(moved)).toMatchObject({ name: 'moved.txt' })
      // After undo, redo refuses an item the owner restored meanwhile.
      await restoreFileNode(files.userId, created.nodeId)
      expect((await conflictsOf(redoFileChanges(files.userId, reply))).map((conflict) => conflict.reason)).toEqual(['restored'])
    })

    it('keeps items the reply created once others put their work in them', async () => {
      const projects = await files.folder('Projects')
      await files.attach({ [projects]: 'write' })
      await files.ok('mkdir', { path: 'Projects/New' })
      const created = await pushFile('/workspace/a.txt', 'Projects/New/a.txt', 'a')
      const folder = (await files.node(created.nodeId))!.parentId!
      const reply = files.responseId
      // The owner adds a file of their own, and another reply replaces the agent's file.
      const mine = await files.blob('mine.txt', folder, 'mine')
      await files.newReply()
      await pushFile('/workspace/a.txt', 'Projects/New/a.txt', 'b')
      const conflicts = await conflictsOf(undoFileChanges(files.userId, reply))
      expect(conflicts.map((conflict) => [conflict.nodeId, conflict.reason]).sort()).toEqual([[created.nodeId, 'replaced'], [folder, 'edited']].sort())
      expect(await files.node(folder)).toMatchObject({ trashedAt: null })
      expect(await files.node(mine)).toMatchObject({ trashedAt: null })
      // Without others' work in them, they go.
      await undoFileChanges(files.userId, files.responseId)
      await trashFileNode(files.userId, mine)
      await undoFileChanges(files.userId, reply)
      expect((await files.node(folder))!.trashedAt).not.toBeNull()
    })

    it('waits for the reply to finish', async () => {
      const projects = await files.folder('Projects')
      await files.attach({ [projects]: 'write' })
      await files.newReply('in_progress')
      await files.ok('mkdir', { path: 'Projects/New' })
      await expect(undoFileChanges(files.userId, files.responseId)).rejects.toMatchObject({ code: 'response_in_progress' })
      await db.update(responses).set({ status: 'completed' }).where(eq(responses.id, files.responseId))
      await undoFileChanges(files.userId, files.responseId)
    })
  })

  describe('review', () => {
    it('accepts and rejects proposed contents of uploaded files', async () => {
      const projects = await files.folder('Projects')
      const accepted = await files.blob('accepted.txt', projects, 'old')
      const rejected = await files.blob('rejected.txt', projects, 'old')
      await files.attach({ [projects]: 'suggest' })
      await pushFile('/workspace/a.txt', 'Projects/accepted.txt', 'new!')
      await pushFile('/workspace/b.txt', 'Projects/rejected.txt', 'new!')
      expect(await storageUsedBytes(db, files.userId)).toBe(3 + 3 + 4 + 4)
      const rows = await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))
      const changeFor = (nodeId: string) => rows.find((row) => row.nodeId === nodeId)!.id
      const oldKey = (await files.node(accepted))!.objectKey!

      expect(await reviewFileChange(files.userId, changeFor(accepted), 'accept')).toMatchObject({
        changes: expect.arrayContaining([expect.objectContaining({ nodeId: accepted, status: 'accepted' })]),
      })
      expect(await files.content(accepted)).toBe('new!')
      expect(objects.has(oldKey)).toBe(false)
      await reviewFileChange(files.userId, changeFor(rejected), 'reject')
      expect(await files.content(rejected)).toBe('old')
      expect(await db.select().from(fileVersions).where(eq(fileVersions.userId, files.userId))).toEqual([])
      expect(await storageUsedBytes(db, files.userId)).toBe(4 + 3)
      // Reviewed suggestions stay reviewed.
      await reviewFileChange(files.userId, changeFor(rejected), 'accept')
      expect(await files.content(rejected)).toBe('old')
    })

    it('keeps a proposal the owner accepted while the reply runs when the agent proposes again', async () => {
      const projects = await files.folder('Projects')
      const data = await files.blob('data.txt', projects, 'v0')
      await files.attach({ [projects]: 'suggest' })
      await files.newReply('in_progress')
      await pushFile('/workspace/data.txt', 'Projects/data.txt', 'p1')
      const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, data))
      await reviewFileChange(files.userId, row!.id, 'accept')
      expect(await files.content(data)).toBe('p1')
      // The same reply proposes again: a new suggestion that starts from the accepted content.
      const pulled = (await files.ok('pull', { path: 'Projects/data.txt', dest: '/workspace/data.txt' })).data as { files: Array<{ version: string }> }
      files.put('/workspace/data.txt', 'p2')
      const pushed = await files.ok('push', { items: [{ local: '/workspace/data.txt', remote: 'Projects/data.txt', base: { nodeId: data, version: pulled.files[0]!.version } }] })
      expect((pushed.data as { results: Array<{ status: string }> }).results[0]).toMatchObject({ status: 'suggested' })
      expect(await files.content(data)).toBe('p1')
      const [reopened] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, data))
      expect(reopened).toMatchObject({ status: 'pending', before: { objectKey: (await files.node(data))!.objectKey } })
      await reviewFileChange(files.userId, row!.id, 'reject')
      expect(await files.content(data)).toBe('p1')
      expect(await versionContents(data)).toEqual([])
    })

    it('accepts a reply in the order the agent worked, and rejects new items last', async () => {
      const projects = await files.folder('Projects')
      const plan = await files.blob('plan.txt', projects, 'plan')
      const old = await files.blob('old.txt', projects, 'old')
      await files.attach({ [projects]: 'suggest' })
      await files.ok('mkdir', { path: 'Projects/New' })
      await files.ok('mv', { from: 'Projects/plan.txt', to: 'Projects/New' })
      await files.ok('rm', { path: 'Projects/old.txt' })
      const reply = files.responseId
      const accepted = await reviewReplyChanges(files.userId, reply, 'accept')
      expect(accepted.changes.map((change) => [change.kind, change.status])).toEqual([['create', 'accepted'], ['move', 'accepted'], ['trash', 'accepted']])
      const folder = await files.node((await files.node(plan))!.parentId!)
      expect(folder).toMatchObject({ name: 'New', suggestionChangeId: null })
      expect((await files.node(old))!.trashedAt).not.toBeNull()

      await files.newReply()
      await files.ok('mkdir', { path: 'Projects/New/Other' })
      await files.ok('mv', { from: 'Projects/New/plan.txt', to: 'Projects/New/Other' })
      const rejected = await reviewReplyChanges(files.userId, files.responseId, 'reject')
      // The rejected folder is deleted, and its change row with it.
      expect(rejected.changes.map((change) => [change.kind, change.status])).toEqual([['move', 'rejected']])
      expect(await files.node(plan)).toMatchObject({ parentId: folder!.id, trashedAt: null })
      expect(await db.select().from(fileNodes).where(eq(fileNodes.name, 'Other')).then((rows) => rows.filter((row) => row.ownerUserId === files.userId))).toEqual([])
    })

    it('leaves items in place when their suggested move and deletion are rejected', async () => {
      const projects = await files.folder('Projects')
      const plan = await files.blob('plan.txt', projects, 'plan')
      await files.attach({ [projects]: 'suggest' })
      await files.ok('mv', { from: 'Projects/plan.txt', to: 'Projects/renamed.txt' })
      await files.ok('rm', { path: 'Projects/plan.txt' })
      const rejected = await reviewReplyChanges(files.userId, files.responseId, 'reject')
      expect(rejected.changes.map((change) => [change.kind, change.status, change.fromPath, change.toPath])).toEqual([
        ['move', 'rejected', 'Projects/plan.txt', 'Projects/renamed.txt'], ['trash', 'rejected', undefined, undefined],
      ])
      expect(await files.node(plan)).toMatchObject({ name: 'plan.txt', trashedAt: null })
      expect((await files.ok('ls', { path: 'Projects' })).output).not.toMatch(/suggested/)
    })

    it('keeps the owner\'s items when a suggested folder is rejected', async () => {
      const projects = await files.folder('Projects')
      const mine = await files.blob('mine.txt', projects, 'mine')
      await files.attach({ [projects]: 'suggest' })
      await files.ok('mkdir', { path: 'Projects/New' })
      const [suggested] = await db.select().from(fileNodes).where(eq(fileNodes.parentId, projects)).then((rows) => rows.filter((row) => row.name === 'New'))
      const added = await pushFile('/workspace/added.txt', 'Projects/New/added.txt', 'added')
      const addedKey = (await files.node(added.nodeId))!.objectKey!
      // The owner files something of their own inside the suggested folder.
      await moveFileNodes(files.userId, [{ id: mine, parentId: suggested!.id }])
      expect(await reviewNodeSuggestion(files.userId, suggested!.id, 'reject')).toEqual({ node: null })
      expect(await files.node(suggested!.id)).toBeUndefined()
      expect(await files.node(added.nodeId)).toBeUndefined()
      expect(objects.has(addedKey)).toBe(false)
      expect(await files.node(mine)).toMatchObject({ parentId: projects, trashedAt: null })
      expect(await files.content(mine)).toBe('mine')
    })

    it('keeps the owner\'s trashed and uploading items when a suggested folder is deleted', async () => {
      const projects = await files.folder('Projects')
      const trashed = await files.blob('trashed.txt', projects, 'trashed')
      await files.attach({ [projects]: 'suggest' })
      await files.ok('mkdir', { path: 'Projects/New' })
      const [suggested] = await db.select().from(fileNodes).where(eq(fileNodes.parentId, projects)).then((rows) => rows.filter((row) => row.name === 'New'))
      await moveFileNodes(files.userId, [{ id: trashed, parentId: suggested!.id }])
      await trashFileNode(files.userId, trashed)
      const uploading = randomUUID()
      await db.insert(fileNodes).values({ id: uploading, ownerUserId: files.userId, parentId: suggested!.id, kind: 'blob', name: 'upload.bin', status: 'pending', objectKey: `users/${files.userId}/files/${uploading}` })
      // The agent withdraws its own suggestion.
      expect((await files.ok('rm', { path: 'Projects/New', recursive: true })).output).toMatch(/which you had suggested adding/)
      expect(await files.node(suggested!.id)).toBeUndefined()
      expect(await files.node(uploading)).toMatchObject({ parentId: projects, status: 'pending' })
      expect(await files.node(trashed)).toMatchObject({ parentId: projects, trashRootId: trashed })
      expect((await restoreFileNode(files.userId, trashed)).parentId).toBe(projects)
    })

    it('keeps the owner\'s items in a suggested folder the owner trashed', async () => {
      const projects = await files.folder('Projects')
      const mine = await files.blob('mine.txt', projects, 'mine')
      await files.attach({ [projects]: 'suggest' })
      await files.ok('mkdir', { path: 'Projects/New' })
      const [suggested] = await db.select().from(fileNodes).where(eq(fileNodes.parentId, projects)).then((rows) => rows.filter((row) => row.name === 'New'))
      await moveFileNodes(files.userId, [{ id: mine, parentId: suggested!.id }])
      await trashFileNode(files.userId, suggested!.id)
      await reviewNodeSuggestion(files.userId, suggested!.id, 'reject')
      expect(await files.node(mine)).toMatchObject({ parentId: projects, trashRootId: mine })
      expect((await files.node(mine))!.trashedAt).not.toBeNull()
      expect(await restoreFileNode(files.userId, mine)).toMatchObject({ parentId: projects, trashedAt: null })
      expect(await files.content(mine)).toBe('mine')
    })

    it('reviews suggested items without a change row', async () => {
      const projects = await files.folder('Projects')
      await files.attach({ [projects]: 'suggest' })
      await files.ok('mkdir', { path: 'Projects/New' })
      // Backups restore suggested items but not change history.
      await db.delete(fileChanges).where(eq(fileChanges.userId, files.userId))
      const [suggested] = await db.select().from(fileNodes).where(eq(fileNodes.parentId, projects))
      const { node } = await reviewNodeSuggestion(files.userId, suggested!.id, 'accept')
      expect(node).toMatchObject({ id: suggested!.id, suggestion: null })
      await expect(reviewNodeSuggestion(files.userId, suggested!.id, 'accept')).rejects.toMatchObject({ code: 'file_not_suggestion' })
    })
  })

  describe('retention and purges', () => {
    it('forgets old undo history and the contents only it needed', async () => {
      const projects = await files.folder('Projects')
      const data = await files.blob('data.txt', projects, 'v1')
      const proposed = await files.blob('proposed.txt', projects, 'p1')
      await files.attach({ [projects]: 'write' })
      await pushFile('/workspace/data.txt', 'Projects/data.txt', 'v2')
      const old = files.responseId
      await files.attach({ [projects]: 'suggest' })
      await files.newReply()
      await pushFile('/workspace/proposed.txt', 'Projects/proposed.txt', 'p2')
      const [kept] = await db.select().from(fileVersions).where(eq(fileVersions.nodeId, data))
      const longAgo = new Date(Date.now() - FILE_CHANGE_RETENTION_MS - 60_000)
      await db.update(fileChanges).set({ createdAt: longAgo }).where(eq(fileChanges.userId, files.userId))

      await cleanupFileChanges()
      // Pending suggestions wait for the owner however old they are.
      expect((await db.select().from(fileChanges).where(eq(fileChanges.userId, files.userId))).map((row) => row.status)).toEqual(['pending'])
      expect(await listFileChanges(files.userId, old)).toEqual({ changes: [], canUndo: false, canRedo: false })
      expect(objects.has(kept!.objectKey)).toBe(false)
      expect(await versionContents(data)).toEqual([])
      expect(await versionContents(proposed)).toEqual(['p2'])
    })

    it('deletes kept contents with their files', async () => {
      const projects = await files.folder('Projects')
      const data = await files.blob('data.txt', projects, 'v1')
      await files.attach({ [projects]: 'write' })
      await pushFile('/workspace/data.txt', 'Projects/data.txt', 'v2')
      const [kept] = await db.select().from(fileVersions).where(eq(fileVersions.nodeId, data))
      await trashFileNode(files.userId, projects)
      await emptyTrash(files.userId)
      expect(objects.has(kept!.objectKey)).toBe(false)
      expect(await db.select().from(fileVersions).where(eq(fileVersions.userId, files.userId))).toEqual([])
      expect(await storageUsedBytes(db, files.userId)).toBe(0)
    })
  })
})
