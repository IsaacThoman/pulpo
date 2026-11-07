import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { OoxmlPackage } from '@pulpo/client-core/office/ooxml'
import { SheetCodec, WorkbookModel, insertAxis, parseCsv } from '@pulpo/client-core/office/sheets'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileNodes } from '../../database/schema.js'
import { appendDocUpdate, loadYDoc } from '../doc-store.js'
import { exportStoredDoc } from '../live-docs.js'
import { updateFileNode } from '../tree-service.js'
import { reviewFileChange } from './review.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const published = vi.hoisted(() => [] as Array<{ docId: string; update: Uint8Array }>)
vi.mock('../../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../doc-events.js', () => ({
  publishDocsClosed: vi.fn(),
  publishDocUpdate: vi.fn(async (docId: string, update: Uint8Array) => { published.push({ docId, update }) }),
}))
vi.mock('../../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const enabled = process.env.PULPO_FILES_TESTS === 'true'
const FIXTURES = new URL('../../../../../packages/client-core/test-fixtures/sheets/', import.meta.url)
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES))
const codec = new SheetCodec()
let files: FilesFixture

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }
type PullData = { files: Array<{ remote: string; local: string; nodeId: string; version: string; kind: string; sizeBytes: number }> }

async function push(items: Array<{ local: string; remote: string; base?: { nodeId: string; version: string } | null; force?: boolean }>) {
  return ((await files.ok('push', { items: items.map((item) => ({ base: null, ...item })) })).data as PushData).results
}

async function pull(path: string, dest: string) {
  return ((await files.ok('pull', { path, dest })).data as PullData).files
}

/** Opens xlsx bytes the way the editor would. */
async function open(bytes: Uint8Array, name = 'Book.xlsx') {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  await codec.importFile(doc, bytes, { name, assets })
  return { doc, assets, model: new WorkbookModel(doc) }
}

/** A user's edit to the stored workbook, sent like an editor sends it. */
async function userEdit(nodeId: string, edit: (model: WorkbookModel) => void) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  edit(new WorkbookModel(doc))
  await appendDocUpdate({ nodeId, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

async function exported(nodeId: string): Promise<Uint8Array> {
  const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, nodeId))
  return exportStoredDoc(node!)
}

describe.skipIf(!enabled)('agent edits to spreadsheets', () => {
  let projects: string

  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    projects = await files.folder('Projects')
    published.length = 0
  })
  afterAll(async () => { await queryClient.end() })

  it('creates a spreadsheet from a pushed workbook, and cats, greps, and pulls it', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/files/Projects/Budget.xlsx', fixture('generated/gen-multisheet.xlsx'))
    const [created] = await push([{ local: '/workspace/files/Projects/Budget.xlsx', remote: 'Projects/Budget.xlsx' }])
    expect(created).toMatchObject({ status: 'created' })
    expect(await files.node(created!.nodeId!)).toMatchObject({ kind: 'doc', format: 'sheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    // cat prints each sheet's values, then its formulas.
    const text = (await files.ok('cat', { path: 'Projects/Budget.xlsx' })).output
    expect(text).toMatch(/^## Summary\n/)
    expect(text).toContain("Formulas in Summary:\nB4: ='Q1 Data'!B1")
    expect((await files.ok('grep', { pattern: 'Ünïcödé' })).output).toMatch(/^Projects\/Budget\.xlsx:\d+: /)
    // The pulled file is the workbook, with every sheet.
    const [pulled] = await pull('Projects/Budget.xlsx', '/workspace/files/Projects/Budget.xlsx')
    const local = await open(files.workspace.files.get('/workspace/files/Projects/Budget.xlsx')!)
    const original = await open(fixture('generated/gen-multisheet.xlsx'))
    expect(local.model.sheets().map((sheet) => sheet.name)).toEqual(original.model.sheets().map((sheet) => sheet.name))
    expect(codec.toText(local.doc)).toBe(codec.toText(original.doc))
    expect(pulled!.kind).toBe('doc')
  })

  it('merges a pushed version that inserts a row with a concurrent user edit', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/b.xlsx', fixture('generated/gen-multisheet.xlsx'))
    const [created] = await push([{ local: '/workspace/b.xlsx', remote: 'Projects/Budget.xlsx' }])
    await files.newReply()
    const id = created!.nodeId!
    const [pulled] = await pull('Projects/Budget.xlsx', '/workspace/files/Projects/Budget.xlsx')
    // The agent inserts a row at the top of Summary and fills it in.
    const agent = await open(files.workspace.files.get('/workspace/files/Projects/Budget.xlsx')!)
    const summary = agent.model.sheetByName('Summary')!
    insertAxis(summary, 'row', 0, 1)
    summary.setCell(0, 0, { v: 'agent' })
    files.put('/workspace/files/Projects/Budget.xlsx', Buffer.from(await codec.exportFile(agent.doc, { name: 'Budget.xlsx', assets: agent.assets })))
    // A user's editor holds an edit further down that it hasn't sent yet.
    const editor = await loadYDoc(id)
    const vector = Y.encodeStateVector(editor)
    new WorkbookModel(editor).sheetByName('Summary')!.setCell(5, 6, { v: 'user' })
    const [result] = await push([{ local: '/workspace/files/Projects/Budget.xlsx', remote: 'Projects/Budget.xlsx', base: { nodeId: id, version: pulled!.version } }])
    expect(result).toMatchObject({ status: 'updated' })
    // Open editors got the agent's change as an update, not a reload.
    expect(published.length).toBeGreaterThan(0)
    for (const { update } of published) Y.applyUpdate(editor, update)
    await appendDocUpdate({ nodeId: id, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(editor, vector), origin: 'client' })
    const merged = new WorkbookModel(await loadYDoc(id)).sheetByName('Summary')!
    expect(merged.cell(0, 0)?.v).toBe('agent')
    // The user's cell moved down with its row.
    expect(merged.cell(6, 6)?.v).toBe('user')
    expect(merged.cell(5, 6)).toBeUndefined()
    // The export is the merged workbook.
    const out = await open(await exported(id))
    expect(out.model.sheetByName('Summary')!.cell(6, 6)?.v).toBe('user')
  })

  it.each(['bin', 'md'])('renames a live workbook to .%s as a plain file containing its export', async (extension) => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/book.xlsx', fixture('generated/gen-multisheet.xlsx'))
    const [created] = await push([{ local: '/workspace/book.xlsx', remote: 'Projects/Book.xlsx' }])
    const id = created!.nodeId!
    await userEdit(id, (model) => model.sheets()[0]!.setCell(0, 0, { v: 'last saved edit' }))
    // The user renames it (agents may not move a document out of its format).
    await updateFileNode(files.userId, id, { name: `Book.${extension}` })
    expect(await files.node(id)).toMatchObject({ kind: 'blob', name: `Book.${extension}` })
    const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
    const bytes = objects.get(node!.objectKey!)!
    expect((await open(bytes)).model.sheets()[0]!.cell(0, 0)?.v).toBe('last saved edit')
  })

  it('keeps a CSV byte for byte, and its delimiter when the agent edits it', async () => {
    await files.attach({ [projects]: 'write' })
    const csv = 'name;amount\r\n"Smith; J.";1,5\r\nDoe;007\r\n'
    files.put('/workspace/files/Projects/data.csv', csv)
    const [created] = await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv' }])
    expect(await files.node(created!.nodeId!)).toMatchObject({ kind: 'doc', format: 'sheet', mimeType: 'text/csv' })
    expect(Buffer.from(await exported(created!.nodeId!)).toString()).toBe(csv)
    expect((await files.ok('cat', { path: 'Projects/data.csv' })).output).toBe('name\tamount\nSmith; J.\t1,5\nDoe\t007')
    // The agent edits one line as text while a user's editor holds an edit to another.
    await files.newReply()
    const id = created!.nodeId!
    const [pulled] = await pull('Projects/data.csv', '/workspace/files/Projects/data.csv')
    const editor = await loadYDoc(id)
    const vector = Y.encodeStateVector(editor)
    new WorkbookModel(editor).sheets()[0]!.setCell(2, 0, { v: 'Roe' })
    files.put('/workspace/files/Projects/data.csv', 'name;amount\r\n"Smith; J.";2,5\r\nDoe;007\r\n')
    const [result] = await push([{ local: '/workspace/files/Projects/data.csv', remote: 'Projects/data.csv', base: { nodeId: id, version: pulled!.version } }])
    expect(result!.status).toBe('updated')
    for (const { update } of published) Y.applyUpdate(editor, update)
    await appendDocUpdate({ nodeId: id, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(editor, vector), origin: 'client' })
    expect(Buffer.from(await exported(created!.nodeId!)).toString()).toBe('name;amount\r\n"Smith; J.";2,5\r\nRoe;007\r\n')
  })

  it('quotes unsafe preserved CSV fields on agent pull and subsequent push', async () => {
    await files.attach({ [projects]: 'write' })
    const path = '/workspace/files/Projects/data.csv'
    files.put(path, 'value,neighbor\noriginal,untouched\n')
    const [created] = await push([{ local: path, remote: 'Projects/data.csv' }])
    const id = created!.nodeId!
    // Old clients, pasted snapshots, or restored state can still contain unsafe raw text.
    await userEdit(id, (model) => {
      const sheet = model.sheets()[0]!
      sheet.setCell(1, 0, { v: 1, raw: '1\n' })
      sheet.setCell(1, 1, { v: 'still,here\r\nnext', raw: 'still,here\r\nnext' })
    })
    await files.newReply()
    const [pulled] = await pull('Projects/data.csv', path)
    const bytes = files.workspace.files.get(path)!
    expect(parseCsv(bytes.toString(), ',').rows.map((row) => row.fields)).toEqual([
      ['value', 'neighbor'], ['1', 'still,here\r\nnext'],
    ])
    files.put(path, bytes.toString().replace('value,neighbor', 'updated,neighbor'))
    expect((await push([{ local: path, remote: 'Projects/data.csv', base: { nodeId: id, version: pulled!.version } }]))[0]!.status).toBe('updated')
    expect(parseCsv(Buffer.from(await exported(id)).toString(), ',').rows.map((row) => row.fields)).toEqual([
      ['updated', 'neighbor'], ['1', 'still,here\r\nnext'],
    ])
  })

  it('suggests a new version and merges it with later user edits when accepted', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/s.xlsx', fixture('generated/gen-multisheet.xlsx'))
    const [created] = await push([{ local: '/workspace/s.xlsx', remote: 'Projects/Plan.xlsx' }])
    const id = created!.nodeId!
    await files.newReply()
    await files.attach({ [projects]: 'suggest' })
    const [pulled] = await pull('Projects/Plan.xlsx', '/workspace/files/Projects/Plan.xlsx')
    const agent = await open(files.workspace.files.get('/workspace/files/Projects/Plan.xlsx')!)
    agent.model.sheetByName('Summary')!.setCell(1, 0, { v: 'suggested' })
    files.put('/workspace/files/Projects/Plan.xlsx', Buffer.from(await codec.exportFile(agent.doc, { name: 'Plan.xlsx', assets: agent.assets })))
    const [suggested] = await push([{ local: '/workspace/files/Projects/Plan.xlsx', remote: 'Projects/Plan.xlsx', base: { nodeId: id, version: pulled!.version } }])
    expect(suggested).toMatchObject({ status: 'suggested' })
    expect(new WorkbookModel(await loadYDoc(id)).sheetByName('Summary')!.cell(1, 0)).toBeUndefined()
    // The agent sees its proposal.
    expect((await files.ok('cat', { path: 'Projects/Plan.xlsx' })).output).toContain('suggested')
    // The user edits another cell, then accepts.
    await userEdit(id, (model) => model.sheetByName('Summary')!.setCell(10, 3, { v: 'mine' }))
    const [row] = await db.select().from(fileChanges).where(and(eq(fileChanges.nodeId, id), eq(fileChanges.mode, 'suggest')))
    expect(row).toMatchObject({ mode: 'suggest', status: 'pending', after: { format: 'sheet' } })
    await reviewFileChange(files.userId, row!.id, 'accept')
    const summary = new WorkbookModel(await loadYDoc(id)).sheetByName('Summary')!
    expect(summary.cell(1, 0)?.v).toBe('suggested')
    expect(summary.cell(10, 3)?.v).toBe('mine')
  })

  it('keeps the macros of an .xlsm the agent edits', async () => {
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/m.xlsm', fixture('poi/SimpleMacro.xlsm'))
    const [created] = await push([{ local: '/workspace/m.xlsm', remote: 'Projects/Macro.xlsm' }])
    expect(await files.node(created!.nodeId!)).toMatchObject({ format: 'sheet', mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12' })
    const vba = (bytes: Uint8Array) => Buffer.from(OoxmlPackage.read(bytes).get('xl/vbaProject.bin')!)
    expect(vba(await exported(created!.nodeId!)).equals(vba(fixture('poi/SimpleMacro.xlsm')))).toBe(true)
  })
})
