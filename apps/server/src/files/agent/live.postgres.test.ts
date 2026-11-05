import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileDocUpdates, fileNodes, fileVersions, users } from '../../database/schema.js'
import { storageUsedBytes } from '../../attachments/storage-quota.js'
import { appendDocUpdate, createDoc, loadYDoc } from '../doc-store.js'
import { convertBlobToDocInTx } from '../conversion.js'
import { mutateFileTree, updateFileNode } from '../tree-service.js'
import { exportStoredDoc } from '../live-docs.js'
import { listFileChanges } from './changes.js'
import { FileChangesConflictError, redoFileChanges, undoFileChanges } from './history.js'
import { reviewFileChange, reviewReplyChanges } from './review.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'
import { contentChecksum, deleteUnusedVersions } from './versions.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const published = vi.hoisted(() => [] as Array<{ docId: string; update: Uint8Array }>)
vi.mock('../../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
const publishStateChange = vi.hoisted(() => vi.fn())
vi.mock('../../responses/events.js', () => ({ publishStateChange }))
vi.mock('../doc-events.js', () => ({
  publishDocsClosed: vi.fn(),
  publishDocUpdate: vi.fn(async (docId: string, update: Uint8Array) => { published.push({ docId, update }) }),
}))
vi.mock('../../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let files: FilesFixture

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }
type PullData = { files: Array<{ remote: string; local: string; nodeId: string; version: string; kind: string; sizeBytes: number }> }

async function push(items: Array<{ local: string; remote: string; base?: { nodeId: string; version: string } | null; force?: boolean }>) {
  return ((await files.ok('push', { items: items.map((item) => ({ base: null, ...item })) })).data as PushData).results
}

async function pull(path: string, dest: string) {
  return ((await files.ok('pull', { path, dest })).data as PullData).files
}

/** A text document holding `content` (CRLF line breaks, to check they survive). */
async function textDoc(name: string, parentId: string, content: string): Promise<string> {
  const node = await createDoc(files.userId, { parentId, name })
  await clientEdit(node.id, (text) => text.insert(0, content))
  return node.id
}

async function clientEdit(nodeId: string, edit: (text: Y.Text) => void) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  edit(doc.getText('text'))
  await appendDocUpdate({ nodeId, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

async function text(nodeId: string): Promise<string> {
  return (await loadYDoc(nodeId)).getText('text').toString()
}

async function exported(nodeId: string): Promise<string> {
  const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, nodeId))
  return Buffer.from(await exportStoredDoc(node!)).toString()
}

async function conflictsOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof FileChangesConflictError) return error.conflicts
    throw error
  }
  throw new Error('Expected a conflict')
}

describe.skipIf(!enabled)('agent edits to live documents', () => {
  let projects: string

  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    projects = await files.folder('Projects')
    published.length = 0
  })
  afterAll(async () => { await queryClient.end() })

  it('pulls the real file, and cats and greps its text', async () => {
    const id = await textDoc('main.py', projects, 'import os\nprint(os.getcwd())\n')
    await files.attach({ [projects]: 'read' })
    const [pulled] = await pull('Projects/main.py', '/workspace/files/Projects/main.py')
    expect(pulled).toMatchObject({ nodeId: id, kind: 'doc', sizeBytes: 29 })
    expect(files.workspace.files.get('/workspace/files/Projects/main.py')!.toString()).toBe('import os\nprint(os.getcwd())\n')
    expect(pulled!.version).toBe(contentChecksum(Buffer.from('import os\nprint(os.getcwd())\n')))
    expect((await files.ok('cat', { path: 'Projects/main.py' })).output).toBe('import os\nprint(os.getcwd())\n')
    expect((await files.ok('grep', { pattern: 'getcwd' })).output).toBe('Projects/main.py:2: print(os.getcwd())')
    expect((await files.ok('ls', { path: 'Projects' })).output).toMatch(/main\.py {2}\(live text document \(text\/x-python\)/)
  })

  it('applies a pushed version as a minimal diff that merges with a concurrent user edit', async () => {
    const id = await textDoc('app.js', projects, 'const a = 1\nconst b = 2\nconst c = 3\n')
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/app.js', '/workspace/files/Projects/app.js')
    // A user's editor holds an edit it has not sent yet while the agent pushes.
    const editor = await loadYDoc(id)
    const vector = Y.encodeStateVector(editor)
    editor.getText('text').insert(0, '// header\n')
    files.put('/workspace/files/Projects/app.js', 'const a = 1\nconst b = 20\nconst c = 3\n')
    const [result] = await push([{ local: '/workspace/files/Projects/app.js', remote: 'Projects/app.js', base: { nodeId: id, version: pulled!.version } }])
    expect(result).toMatchObject({ status: 'updated', message: 'Saved "Projects/app.js"' })
    // The agent's change reached open editors as a small update, logged with the agent origin.
    expect(published).toHaveLength(1)
    expect(published[0]!.update.byteLength).toBeLessThan(100)
    const [logged] = await db.select().from(fileDocUpdates).where(and(eq(fileDocUpdates.nodeId, id), eq(fileDocUpdates.origin, 'agent')))
    expect(logged).toBeDefined()
    Y.applyUpdate(editor, published[0]!.update)
    await appendDocUpdate({ nodeId: id, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(editor, vector), origin: 'client' })
    expect(await text(id)).toBe('// header\nconst a = 1\nconst b = 20\nconst c = 3\n')
    expect(editor.getText('text').toString()).toBe(await text(id))
  })

  it('refuses a push against a version the user has changed since', async () => {
    const id = await textDoc('a.txt', projects, 'one\n')
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/a.txt', '/workspace/files/Projects/a.txt')
    await clientEdit(id, (content) => content.insert(0, 'zero\n'))
    files.put('/workspace/files/Projects/a.txt', 'uno\n')
    const [result] = await push([{ local: '/workspace/files/Projects/a.txt', remote: 'Projects/a.txt', base: { nodeId: id, version: pulled!.version } }])
    expect(result).toMatchObject({ status: 'conflict', version: contentChecksum(Buffer.from('zero\none\n')) })
    expect(await text(id)).toBe('zero\none\n')
    // Pushing the same content again is unchanged.
    files.put('/workspace/files/Projects/a.txt', 'zero\none\n')
    expect((await push([{ local: '/workspace/files/Projects/a.txt', remote: 'Projects/a.txt', base: { nodeId: id, version: result!.version! } }]))[0]).toMatchObject({ status: 'unchanged' })
  })

  it('undoes and redoes a reply, refusing when the user edited since', async () => {
    const id = await textDoc('notes.txt', projects, 'first\n')
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/n.txt', 'first\nsecond\n')
    await push([{ local: '/workspace/n.txt', remote: 'Projects/notes.txt', force: true }])
    // A second push in the same reply keeps one row whose `before` is where the reply started.
    files.put('/workspace/n.txt', 'first\nsecond\nthird\n')
    await push([{ local: '/workspace/n.txt', remote: 'Projects/notes.txt', force: true }])
    const rows = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mode: 'write', kind: 'update', status: 'applied', before: { format: 'text' }, after: { format: 'text' } })
    // The replaced intermediate version is no longer kept.
    expect(await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))).toHaveLength(2)
    expect((await listFileChanges(files.userId, files.responseId)).changes[0]).toMatchObject({ format: 'text', contentDiff: true, available: true })
    await undoFileChanges(files.userId, files.responseId)
    expect(await text(id)).toBe('first\n')
    await redoFileChanges(files.userId, files.responseId)
    expect(await text(id)).toBe('first\nsecond\nthird\n')
    await clientEdit(id, (content) => content.insert(content.length, 'mine\n'))
    const [conflict] = await conflictsOf(undoFileChanges(files.userId, files.responseId))
    expect(conflict).toMatchObject({ nodeId: id, reason: 'edited', expected: 'first\nsecond\nthird\n', current: 'first\nsecond\nthird\nmine\n' })
    expect(await text(id)).toBe('first\nsecond\nthird\nmine\n')
  })

  it('creates live documents from new files and undoes their creation', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/files/Projects/tool.py', 'print(1)\r\n')
    const [created] = await push([{ local: '/workspace/files/Projects/tool.py', remote: 'Projects/tool.py' }])
    expect(created).toMatchObject({ status: 'created', version: contentChecksum(Buffer.from('print(1)\r\n')) })
    expect(await files.node(created!.nodeId!)).toMatchObject({ kind: 'doc', format: 'text', mimeType: 'text/x-python' })
    expect(await exported(created!.nodeId!)).toBe('print(1)\r\n')
    // Later pushes in the same reply fold into the creation.
    files.put('/workspace/files/Projects/tool.py', 'print(2)\r\n')
    expect((await push([{ local: '/workspace/files/Projects/tool.py', remote: 'Projects/tool.py', base: { nodeId: created!.nodeId!, version: created!.version! } }]))[0]).toMatchObject({ status: 'updated' })
    expect(await db.select().from(fileChanges).where(eq(fileChanges.nodeId, created!.nodeId!))).toHaveLength(1)
    await clientEdit(created!.nodeId!, (content) => content.insert(0, '#'))
    expect((await conflictsOf(undoFileChanges(files.userId, files.responseId)))[0]).toMatchObject({ reason: 'edited' })
    await clientEdit(created!.nodeId!, (content) => content.delete(0, 1))
    await undoFileChanges(files.userId, files.responseId)
    expect((await files.node(created!.nodeId!))!.trashedAt).not.toBeNull()
  })

  it('suggests a new version, shows it to the agent, and merges it with later user edits when accepted', async () => {
    const id = await textDoc('config.yaml', projects, 'name: demo\nport: 80\n')
    await files.attach({ [projects]: 'suggest' })
    const [pulled] = await pull('Projects/config.yaml', '/workspace/files/Projects/config.yaml')
    files.put('/workspace/files/Projects/config.yaml', 'name: demo\nport: 8080\n')
    const [suggested] = await push([{ local: '/workspace/files/Projects/config.yaml', remote: 'Projects/config.yaml', base: { nodeId: id, version: pulled!.version } }])
    expect(suggested).toMatchObject({ status: 'suggested', message: expect.stringMatching(/Suggested new content/) })
    expect(await text(id)).toBe('name: demo\nport: 80\n')
    expect(published).toHaveLength(0)
    // The agent sees its proposal, so it can keep working on it.
    expect((await files.ok('cat', { path: 'Projects/config.yaml' })).output).toBe('name: demo\nport: 8080\n')
    const [again] = await pull('Projects/config.yaml', '/workspace/files/Projects/config.yaml')
    expect(again!.version).toBe(suggested!.version)
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    expect(row).toMatchObject({ mode: 'suggest', status: 'pending', before: { format: 'text' }, after: { format: 'text', forkKey: expect.any(String) } })
    expect((await listFileChanges(files.userId, files.responseId)).changes[0]).toMatchObject({ contentDiff: true, available: true, status: 'pending' })
    // Maintenance keeps everything a pending proposal needs.
    await deleteUnusedVersions()
    expect(await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))).toHaveLength(3)
    // The user edits another line before accepting: both changes stay.
    await clientEdit(id, (content) => content.insert(0, '# settings\n'))
    await reviewFileChange(files.userId, row!.id, 'accept')
    expect(await text(id)).toBe('# settings\nname: demo\nport: 8080\n')
    expect((await listFileChanges(files.userId, files.responseId)).changes[0]).toMatchObject({ status: 'accepted' })
    // Settled, the proposal's versions are released.
    expect(await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))).toHaveLength(0)
    expect([...objects.keys()].filter((key) => key.startsWith(`users/${files.userId}/files/`))).toHaveLength(0)
  })

  it('applies an accepted proposal exactly when nothing changed meanwhile, and rejects cleanly', async () => {
    const id = await textDoc('a.md.txt', projects, 'keep\nchange\n')
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/a', 'keep\nchanged\n')
    await push([{ local: '/workspace/a', remote: 'Projects/a.md.txt', force: true }])
    // A second push of the same reply replaces its proposal.
    files.put('/workspace/a', 'keep\nchanged twice\n')
    await push([{ local: '/workspace/a', remote: 'Projects/a.md.txt', force: true }])
    expect(await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))).toHaveLength(1)
    await reviewReplyChanges(files.userId, files.responseId, 'accept')
    expect(await text(id)).toBe('keep\nchanged twice\n')

    await files.newReply()
    files.put('/workspace/a', 'rejected\n')
    await push([{ local: '/workspace/a', remote: 'Projects/a.md.txt', force: true }])
    await reviewReplyChanges(files.userId, files.responseId, 'reject')
    expect(await text(id)).toBe('keep\nchanged twice\n')
    expect(await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))).toHaveLength(0)
  })

  it('suggests new live documents as items to review', async () => {
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/files/Projects/new.sql', 'select 1;\n')
    const [created] = await push([{ local: '/workspace/files/Projects/new.sql', remote: 'Projects/new.sql' }])
    expect(created).toMatchObject({ status: 'suggested' })
    expect(await files.node(created!.nodeId!)).toMatchObject({ kind: 'doc', format: 'text', suggestionChangeId: expect.any(String) })
    // Edits to it before review change the suggestion itself.
    files.put('/workspace/files/Projects/new.sql', 'select 2;\n')
    expect((await push([{ local: '/workspace/files/Projects/new.sql', remote: 'Projects/new.sql', force: true }]))[0]).toMatchObject({ status: 'suggested' })
    expect(await text(created!.nodeId!)).toBe('select 2;\n')
    await reviewReplyChanges(files.userId, files.responseId, 'reject')
    expect(await files.node(created!.nodeId!)).toBeUndefined()
  })

  it('refuses binary content for a text document and keeps documents in their format when moved', async () => {
    const id = await textDoc('a.txt', projects, 'text\n')
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/bin', Buffer.from([0, 1, 2, 3]))
    const [result] = await push([{ local: '/workspace/bin', remote: 'Projects/a.txt', force: true }])
    expect(result).toMatchObject({ status: 'error', message: expect.stringMatching(/not text/) })
    expect(await text(id)).toBe('text\n')
    expect(await files.error('mv', { from: 'Projects/a.txt', to: 'Projects/a.md' })).toMatch(/such as \.txt/)
    expect((await files.ok('mv', { from: 'Projects/a.txt', to: 'Projects/a.log' })).output).toMatch(/Renamed|Moved/)
    expect(await files.node(id)).toMatchObject({ kind: 'doc', name: 'a.log' })
  })

  it('keeps user edits made between two proposals of the same chat', async () => {
    const id = await textDoc('plan.txt', projects, 'one\ntwo\nthree\n')
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/plan.txt', 'one\nTWO\nthree\n')
    await push([{ local: '/workspace/plan.txt', remote: 'Projects/plan.txt', force: true }])
    // The owner adds a note; then a later reply revises the proposal it pulled.
    await clientEdit(id, (content) => content.insert(0, '# owner note\n'))
    await files.newReply()
    const [pulled] = await pull('Projects/plan.txt', '/workspace/plan.txt')
    expect(files.workspace.files.get('/workspace/plan.txt')!.toString()).toBe('one\nTWO\nthree\n')
    files.put('/workspace/plan.txt', 'one\nTWO\nTHREE\n')
    expect((await push([{ local: '/workspace/plan.txt', remote: 'Projects/plan.txt', base: { nodeId: id, version: pulled!.version } }]))[0]).toMatchObject({ status: 'suggested' })
    // The first reply's proposal was superseded; the new one keeps the chain's base.
    const rows = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    expect(rows.map((row) => row.status).sort()).toEqual(['pending', 'rejected'])
    await reviewReplyChanges(files.userId, files.responseId, 'accept')
    expect(await text(id)).toBe('# owner note\none\nTWO\nTHREE\n')
  })

  it('merges a proposal that changes much of a large file with a later user edit on a line it left', async () => {
    const lines = Array.from({ length: 6_000 }, (_, index) => `line ${index}`)
    const id = await textDoc('big.txt', projects, `${lines.join('\n')}\n`)
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/big.txt', `${lines.map((line, index) => index % 2 ? `${line} // agent` : line).join('\n')}\n`)
    await push([{ local: '/workspace/big.txt', remote: 'Projects/big.txt', force: true }])
    await clientEdit(id, (content) => {
      const at = content.toString().indexOf('line 3000\n') + 'line 3000'.length
      content.insert(at, ' fixed')
    })
    await reviewReplyChanges(files.userId, files.responseId, 'accept')
    const merged = (await text(id)).split('\n')
    expect(merged[3000]).toBe('line 3000 fixed')
    expect(merged[3001]).toBe('line 3001 // agent')
    expect(merged[0]).toBe('line 0')
    expect(merged).toHaveLength(6_001)
  })

  it('refuses a small push whose kept versions would exceed the storage allowance', async () => {
    const big = `${'x'.repeat(4_000)}\n`
    const id = await textDoc('notes.txt', projects, big)
    // Room for the incoming bytes, but not for keeping the current 4 KB version beside them.
    await db.update(users).set({ storageLimitBytes: await storageUsedBytes(db, files.userId) + 100 }).where(eq(users.id, files.userId))
    for (const mode of ['suggest', 'write'] as const) {
      await files.attach({ [projects]: mode })
      files.put('/workspace/notes.txt', 'small\n')
      const [refused] = await push([{ local: '/workspace/notes.txt', remote: 'Projects/notes.txt', force: true }])
      expect(refused).toMatchObject({ status: 'error', message: expect.stringMatching(/storage allowance/) })
      expect(await text(id)).toBe(big)
      expect(await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))).toEqual([])
      expect(await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))).toEqual([])
      expect([...objects.keys()].filter((key) => key.startsWith(`users/${files.userId}/files/`))).toEqual([])
    }
  })

  it('keeps new files that are too large or not really text as uploaded files', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/big.json', Buffer.alloc(4_100_000, 0x20))
    files.put('/workspace/Info.plist', Buffer.from([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30, 0, 1, 2, 3]))
    const results = await push([
      { local: '/workspace/big.json', remote: 'Projects/big.json' },
      { local: '/workspace/Info.plist', remote: 'Projects/Info.plist' },
    ])
    expect(results.map((result) => result.status)).toEqual(['created', 'created'])
    for (const result of results) expect(await files.node(result.nodeId!)).toMatchObject({ kind: 'blob', format: null })
  })

  it('keeps a committed change when telling clients about it fails', async () => {
    const id = await textDoc('a.txt', projects, 'a\n')
    await files.attach({ [projects]: 'write' })
    publishStateChange.mockRejectedValueOnce(new Error('redis down'))
    files.put('/workspace/a.txt', 'b\n')
    expect((await push([{ local: '/workspace/a.txt', remote: 'Projects/a.txt', force: true }]))[0]).toMatchObject({ status: 'updated' })
    expect(await text(id)).toBe('b\n')
    const kept = await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))
    expect(kept).toHaveLength(2)
    for (const version of kept) expect(objects.has(version.objectKey)).toBe(true)
    await undoFileChanges(files.userId, files.responseId)
    expect(await text(id)).toBe('a\n')
  })

  it('settles proposals when the document becomes a file, and never merges them into the next document', async () => {
    const id = await textDoc('a.txt', projects, 'one\ntwo\n')
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/a.txt', 'one\nTWO\n')
    await push([{ local: '/workspace/a.txt', remote: 'Projects/a.txt', force: true }])
    // Out of the format and back, then Edit again: a new document under the same id.
    await updateFileNode(files.userId, id, { name: 'a.bin' })
    await updateFileNode(files.userId, id, { name: 'a.txt' })
    await mutateFileTree(files.userId, async (tx) => {
      const [row] = await tx.select().from(fileNodes).where(eq(fileNodes.id, id))
      return convertBlobToDocInTx(tx, row!)
    })
    await clientEdit(id, (content) => content.insert(0, 'zero\n'))
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    // Becoming a file rejected it, so accepting it now changes nothing.
    expect(row).toMatchObject({ status: 'rejected' })
    await reviewFileChange(files.userId, row!.id, 'accept')
    expect(await text(id)).toBe('zero\none\ntwo\n')
    // Its kept versions are no longer needed, and maintenance deletes them.
    await deleteUnusedVersions()
    expect(await db.select().from(fileVersions).where(eq(fileVersions.nodeId, id))).toHaveLength(0)
    // A new proposal is built on the document as it is, not on the old fork.
    await files.newReply()
    files.put('/workspace/a.txt', 'zero\none\nTWO\n')
    await push([{ local: '/workspace/a.txt', remote: 'Projects/a.txt', force: true }])
    await reviewReplyChanges(files.userId, files.responseId, 'accept')
    expect(await text(id)).toBe('zero\none\nTWO\n')
  })
})
