import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { cellSourceText, orderedCells } from '@pulpo/client-core/office/notebook'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileDocAssets, fileDocs, fileNodes } from '../../database/schema.js'
import { appendDocUpdate, loadYDoc } from '../doc-store.js'
import { convertBlobToDocInTx } from '../conversion.js'
import { mutateFileTree } from '../tree-service.js'
import { exportStoredDoc } from '../live-docs.js'
import { listFileChanges } from './changes.js'
import { redoFileChanges, undoFileChanges } from './history.js'
import { reviewFileChange, reviewReplyChanges } from './review.js'
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
const FIXTURE = fileURLToPath(new URL('../../../../../packages/client-core/src/office/notebook/fixtures/generated-analysis.ipynb', import.meta.url))
let files: FilesFixture

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }
type PullData = { files: Array<{ remote: string; nodeId: string; version: string; kind: string }> }

async function push(items: Array<{ local: string; remote: string; base?: { nodeId: string; version: string } | null; force?: boolean }>) {
  return ((await files.ok('push', { items: items.map((item) => ({ base: null, ...item })) })).data as PushData).results
}

async function pull(path: string, dest: string) {
  return ((await files.ok('pull', { path, dest })).data as PullData).files
}

/** The cells' sources, in order. */
async function sources(nodeId: string): Promise<string[]> {
  return orderedCells(await loadYDoc(nodeId)).map(({ cell }) => cellSourceText(cell))
}

/** An edit from a user's editor: a change to one cell's source, sent as a Yjs update. */
async function userEdit(nodeId: string, cellIndex: number, edit: (text: Y.Text) => void) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  edit(orderedCells(doc)[cellIndex]!.cell.get('source') as Y.Text)
  await appendDocUpdate({ nodeId, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

async function exported(nodeId: string): Promise<Buffer> {
  const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, nodeId))
  return Buffer.from(await exportStoredDoc(node!))
}

/** The fixture with its cells rewritten, as an agent's nbformat script would write it. */
function edited(change: (notebook: { cells: Array<Record<string, unknown> & { source: string[] }> }) => void): Buffer {
  const notebook = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  change(notebook)
  return Buffer.from(`${JSON.stringify(sortKeys(notebook), null, 1)}\n`)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => [key, sortKeys(item)]))
  return value
}

/** An uploaded notebook made a live document, as **Edit** does. */
async function notebookDoc(parentId: string, name = 'analysis.ipynb', bytes = readFileSync(FIXTURE)): Promise<string> {
  const id = await files.blob(name, parentId, bytes, 'application/x-ipynb+json')
  await mutateFileTree(files.userId, async (tx) => {
    const [row] = await tx.select().from(fileNodes).where(eq(fileNodes.id, id))
    return convertBlobToDocInTx(tx, row!)
  })
  return id
}

describe.skipIf(!enabled)('agent edits to notebooks', () => {
  let projects: string

  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    projects = await files.folder('Projects')
  })
  afterAll(async () => { await queryClient.end() })

  it('converts an uploaded notebook into a live document that exports byte for byte', async () => {
    const id = await notebookDoc(projects)
    expect(await files.node(id)).toMatchObject({ kind: 'doc', format: 'notebook', mimeType: 'application/x-ipynb+json' })
    // The plot is an asset of the document, not part of its state.
    const assets = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, id))
    expect(assets.map((asset) => asset.mimeType)).toContain('image/png')
    const [doc] = await db.select().from(fileDocs).where(eq(fileDocs.nodeId, id))
    expect(doc!.markdown).toMatch(/^# Jupyter notebook · Python 3 \(ipykernel\) · 9 cells/)
    expect((await exported(id)).equals(readFileSync(FIXTURE))).toBe(true)
  })

  it('pulls the real file, and cats and greps the readable text', async () => {
    const id = await notebookDoc(projects)
    await files.attach({ [projects]: 'read' })
    const [pulled] = await pull('Projects/analysis.ipynb', '/workspace/files/Projects/analysis.ipynb')
    expect(pulled).toMatchObject({ nodeId: id, kind: 'doc' })
    expect(files.workspace.files.get('/workspace/files/Projects/analysis.ipynb')!.equals(readFileSync(FIXTURE))).toBe(true)
    const cat = (await files.ok('cat', { path: 'Projects/analysis.ipynb' })).output
    expect(cat).toContain('# %% [code] cell 3 · In [2]')
    expect(cat).toContain('# Error: ZeroDivisionError: division by zero')
    expect((await files.ok('grep', { pattern: 'read_csv|DataFrame' })).output).toMatch(/^Projects\/analysis\.ipynb:\d+: df = pd\.DataFrame/)
  })

  it('applies a pushed notebook as a cell-level diff that keeps a concurrent user edit', async () => {
    const id = await notebookDoc(projects)
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/analysis.ipynb', '/workspace/a.ipynb')
    // A user's editor holds an edit to the first cell it has not sent yet while the agent pushes.
    const editor = await loadYDoc(id)
    const vector = Y.encodeStateVector(editor)
    const first = orderedCells(editor)[0]!.cell.get('source') as Y.Text
    first.insert(first.length, '\n\nReviewed.')
    files.put('/workspace/a.ipynb', edited((notebook) => {
      notebook.cells[2]!.source = ["df = pd.read_csv('sales.csv')\n", 'df']
      notebook.cells.splice(3, 0, { cell_type: 'code', execution_count: null, id: 'new-cell', metadata: {}, outputs: [], source: ['df.describe()'] })
    }))
    const [result] = await push([{ local: '/workspace/a.ipynb', remote: 'Projects/analysis.ipynb', base: { nodeId: id, version: pulled!.version } }])
    expect(result).toMatchObject({ status: 'updated' })
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(await loadYDoc(id)))
    await appendDocUpdate({ nodeId: id, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(editor, vector), origin: 'client' })
    const now = await sources(id)
    expect(now[0]).toMatch(/Reviewed\.$/)
    expect(now[2]).toBe("df = pd.read_csv('sales.csv')\ndf")
    expect(now[3]).toBe('df.describe()')
    expect(now).toHaveLength(10)
    const written = JSON.parse((await exported(id)).toString())
    expect(written.cells[3].id).toBe('new-cell')
    // Undo takes back the agent's change once the user's edit is gone again; redo puts it back.
    await userEdit(id, 0, (text) => text.delete(text.length - '\n\nReviewed.'.length, '\n\nReviewed.'.length))
    await undoFileChanges(files.userId, files.responseId)
    expect((await sources(id))[2]).toContain("'month'")
    await redoFileChanges(files.userId, files.responseId)
    expect((await sources(id))[2]).toBe("df = pd.read_csv('sales.csv')\ndf")
  })

  it('suggests a new version, and merges it with later user edits when accepted', async () => {
    const id = await notebookDoc(projects)
    await files.attach({ [projects]: 'suggest' })
    const [pulled] = await pull('Projects/analysis.ipynb', '/workspace/a.ipynb')
    files.put('/workspace/a.ipynb', edited((notebook) => {
      notebook.cells[5]!.source = ["ratio = df['sales'].mean() / 1e3\n", 'ratio']
      notebook.cells.splice(8, 1)
    }))
    const [suggested] = await push([{ local: '/workspace/a.ipynb', remote: 'Projects/analysis.ipynb', base: { nodeId: id, version: pulled!.version } }])
    expect(suggested).toMatchObject({ status: 'suggested' })
    expect(await sources(id)).toHaveLength(9)
    // The agent sees its proposal.
    expect((await files.ok('cat', { path: 'Projects/analysis.ipynb' })).output).toContain('/ 1e3')
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    expect(row).toMatchObject({ mode: 'suggest', status: 'pending', before: { format: 'notebook' }, after: { format: 'notebook', forkKey: expect.any(String) } })
    expect((await listFileChanges(files.userId, files.responseId)).changes[0]).toMatchObject({ format: 'notebook', contentDiff: true })
    await userEdit(id, 1, (text) => text.insert(0, '# setup\n'))
    await reviewFileChange(files.userId, row!.id, 'accept')
    const merged = await sources(id)
    expect(merged).toHaveLength(8)
    expect(merged[1]).toMatch(/^# setup\n%matplotlib inline/)
    expect(merged[5]).toBe("ratio = df['sales'].mean() / 1e3\nratio")
  })

  it('rejects a suggestion cleanly', async () => {
    const id = await notebookDoc(projects)
    await files.attach({ [projects]: 'suggest' })
    files.put('/workspace/a.ipynb', edited((notebook) => { notebook.cells = notebook.cells.slice(0, 2) }))
    await push([{ local: '/workspace/a.ipynb', remote: 'Projects/analysis.ipynb', force: true }])
    await reviewReplyChanges(files.userId, files.responseId, 'reject')
    expect(await sources(id)).toHaveLength(9)
    expect((await exported(id)).equals(readFileSync(FIXTURE))).toBe(true)
  })

  it('creates a live notebook from a new file, and keeps a broken one as an uploaded file', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/new.ipynb', readFileSync(FIXTURE))
    files.put('/workspace/broken.ipynb', Buffer.from('{"cells": "nope"}'))
    const [created, broken] = await push([
      { local: '/workspace/new.ipynb', remote: 'Projects/new.ipynb' },
      { local: '/workspace/broken.ipynb', remote: 'Projects/broken.ipynb' },
    ])
    expect(created).toMatchObject({ status: 'created' })
    expect(await files.node(created!.nodeId!)).toMatchObject({ kind: 'doc', format: 'notebook' })
    expect((await exported(created!.nodeId!)).equals(readFileSync(FIXTURE))).toBe(true)
    expect(broken).toMatchObject({ status: 'created' })
    expect(await files.node(broken!.nodeId!)).toMatchObject({ kind: 'blob', format: null })
  })
})
