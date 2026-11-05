import { eq } from 'drizzle-orm'
import { BODY_FRAGMENT, docxCodec, docxSchema, readDocxModel, writeFragment } from '@pulpo/client-core/office/docx'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileDocAssets, fileNodes } from '../../database/schema.js'
import { appendDocUpdate, createDoc, loadYDoc } from '../doc-store.js'
import { exportStoredDoc } from '../live-docs.js'
import { listFileChanges } from './changes.js'
import { reviewFileChange } from './review.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'

/**
 * Agents and Word documents: agents pull and push real .docx files, read them as text, and their
 * pushes merge with what people are typing in the same document at the same time.
 */

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
let files: FilesFixture
const schema = docxSchema()

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }
type PullData = { files: Array<{ remote: string; local: string; nodeId: string; version: string; kind: string; sizeBytes: number }> }

async function push(items: Array<{ local: string; remote: string; base?: { nodeId: string; version: string } | null; force?: boolean }>) {
  return ((await files.ok('push', { items: items.map((item) => ({ base: null, ...item })) })).data as PushData).results
}

async function pull(path: string, dest: string) {
  return ((await files.ok('pull', { path, dest })).data as PullData).files
}

const paragraph = (text: string, style?: string) => schema.node('paragraph', style ? { pStyle: style } : null, text ? schema.text(text) : undefined)

/** Rewrites a document's body as `edit` returns it, as an editor would. */
function editBody(doc: Y.Doc, edit: (paragraphs: ProseMirrorNode[]) => ProseMirrorNode[]): void {
  const body = readDocxModel(doc).body
  const children: ProseMirrorNode[] = []
  body.forEach((child) => { children.push(child) })
  doc.transact(() => writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, edit(children))))
}

/** A user edit, saved like an editor's update. */
async function userEdit(nodeId: string, edit: (paragraphs: ProseMirrorNode[]) => ProseMirrorNode[]) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  editBody(doc, edit)
  await appendDocUpdate({ nodeId, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

async function wordDoc(name: string, parentId: string, lines: [string, string?][]): Promise<string> {
  const node = await createDoc(files.userId, { parentId, name })
  await userEdit(node.id, () => lines.map(([text, style]) => paragraph(text, style)))
  return node.id
}

async function texts(nodeId: string): Promise<string[]> {
  const lines: string[] = []
  readDocxModel(await loadYDoc(nodeId)).body.forEach((child) => { lines.push(child.textContent) })
  return lines
}

/** The agent's edit of pulled bytes: what python-docx would do, made with the codec. */
async function agentEdit(bytes: Buffer, edit: (paragraphs: ProseMirrorNode[]) => ProseMirrorNode[]): Promise<Buffer> {
  const assets = new MemoryLiveAssetStore()
  const doc = new Y.Doc()
  await docxCodec.importFile(doc, new Uint8Array(bytes), { name: 'a.docx', assets })
  editBody(doc, edit)
  return Buffer.from(await docxCodec.exportFile(doc, { name: 'a.docx', assets }))
}

const replace = (index: number, text: string) => (paragraphs: ProseMirrorNode[]) => paragraphs.map((child, at) => at === index ? child.type.create(child.attrs, schema.text(text)) : child)

describe.skipIf(!enabled)('agent edits to Word documents', () => {
  let projects: string

  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    projects = await files.folder('Projects')
    published.length = 0
  })
  afterAll(async () => { await queryClient.end() })
  afterEach(() => { vi.useRealTimers() })

  it('creates documents, pulls real .docx bytes, and cats and greps their text', async () => {
    const id = await wordDoc('Plan.docx', projects, [['Quarterly plan', 'Heading1'], ['Ship the editor.'], ['Write the docs.']])
    const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
    expect(node).toMatchObject({ kind: 'doc', format: 'document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    await files.attach({ [projects]: 'read' })
    const [pulled] = await pull('Projects/Plan.docx', '/workspace/files/Projects/Plan.docx')
    expect(pulled).toMatchObject({ nodeId: id, kind: 'doc' })
    const bytes = files.workspace.files.get('/workspace/files/Projects/Plan.docx')!
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
    const reread = new Y.Doc()
    await docxCodec.importFile(reread, new Uint8Array(bytes), { name: 'Plan.docx', assets: new MemoryLiveAssetStore() })
    expect(docxCodec.toText(reread)).toBe('# Quarterly plan\nShip the editor.\nWrite the docs.\n')
    expect((await files.ok('cat', { path: 'Projects/Plan.docx' })).output).toBe('# Quarterly plan\nShip the editor.\nWrite the docs.\n')
    expect((await files.ok('grep', { pattern: 'editor' })).output).toBe('Projects/Plan.docx:2: Ship the editor.')
    expect(Buffer.from(await exportStoredDoc(node!)).subarray(0, 2).toString()).toBe('PK')
  })

  it('merges a pushed version with a user edit the server has not seen yet', async () => {
    const id = await wordDoc('Plan.docx', projects, [['One'], ['Two'], ['Three']])
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/Plan.docx', '/workspace/files/Projects/Plan.docx')
    // A minute passes before the push: the export the version is checked against must not change with the clock.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    // A user's editor holds an edit it has not sent yet while the agent pushes.
    const editor = await loadYDoc(id)
    const vector = Y.encodeStateVector(editor)
    editBody(editor, replace(0, 'One, from the user'))
    files.put('/workspace/files/Projects/Plan.docx', await agentEdit(files.workspace.files.get('/workspace/files/Projects/Plan.docx')!, replace(2, 'Three, from the agent')))
    const [result] = await push([{ local: '/workspace/files/Projects/Plan.docx', remote: 'Projects/Plan.docx', base: { nodeId: id, version: pulled!.version } }])
    expect(result).toMatchObject({ status: 'updated' })
    // Open editors got a small update, not the whole document again.
    expect(published).toHaveLength(1)
    expect(published[0]!.update.byteLength).toBeLessThan(2_000)
    Y.applyUpdate(editor, published[0]!.update)
    await appendDocUpdate({ nodeId: id, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(editor, vector), origin: 'client' })
    expect(await texts(id)).toEqual(['One, from the user', 'Two', 'Three, from the agent'])
    // Pushing what is already there changes nothing.
    const [again] = await pull('Projects/Plan.docx', '/workspace/files/Projects/Plan.docx')
    expect((await push([{ local: '/workspace/files/Projects/Plan.docx', remote: 'Projects/Plan.docx', base: { nodeId: id, version: again!.version } }]))[0]).toMatchObject({ status: 'unchanged' })
  })

  it('suggests a new version for review and merges it with later user edits when accepted', async () => {
    const id = await wordDoc('Plan.docx', projects, [['Intro'], ['Body'], ['Outro']])
    await files.attach({ [projects]: 'suggest' })
    const [pulled] = await pull('Projects/Plan.docx', '/workspace/files/Projects/Plan.docx')
    files.put('/workspace/files/Projects/Plan.docx', await agentEdit(files.workspace.files.get('/workspace/files/Projects/Plan.docx')!, (paragraphs) => [...replace(1, 'Body, rewritten by the agent')(paragraphs), paragraph('A closing line.')]))
    const [suggested] = await push([{ local: '/workspace/files/Projects/Plan.docx', remote: 'Projects/Plan.docx', base: { nodeId: id, version: pulled!.version } }])
    expect(suggested).toMatchObject({ status: 'suggested' })
    expect(await texts(id)).toEqual(['Intro', 'Body', 'Outro'])
    // The agent reads its own proposal.
    expect((await files.ok('cat', { path: 'Projects/Plan.docx' })).output).toContain('Body, rewritten by the agent')
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    expect(row).toMatchObject({ mode: 'suggest', status: 'pending', before: { format: 'document' }, after: { format: 'document' } })
    expect((await listFileChanges(files.userId, files.responseId)).changes[0]).toMatchObject({ contentDiff: true, status: 'pending' })
    // The user edits another paragraph before accepting: both stay.
    await userEdit(id, replace(0, 'Intro, by the user'))
    await reviewFileChange(files.userId, row!.id, 'accept')
    expect(await texts(id)).toEqual(['Intro, by the user', 'Body, rewritten by the agent', 'Outro', 'A closing line.'])
  })

  it('keeps pictures an agent adds as document assets', async () => {
    const id = await wordDoc('Report.docx', projects, [['Report']])
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/Report.docx', '/workspace/files/Projects/Report.docx')
    // A 1×1 PNG, inserted the way the editor and python-docx do.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, new Uint8Array(files.workspace.files.get('/workspace/files/Projects/Report.docx')!), { name: 'a.docx', assets })
    const ref = await assets.put(new Uint8Array(png), 'image/png')
    const { newInlinePicture, packJml } = await import('@pulpo/client-core/office/docx')
    editBody(doc, (paragraphs) => [...paragraphs, schema.node('paragraph', null, schema.node('drawing', { v: packJml(newInlinePicture(36, 36, 'Logo')), src: ref.hash }))])
    files.put('/workspace/files/Projects/Report.docx', Buffer.from(await docxCodec.exportFile(doc, { name: 'a.docx', assets })))
    expect((await push([{ local: '/workspace/files/Projects/Report.docx', remote: 'Projects/Report.docx', base: { nodeId: id, version: pulled!.version } }]))[0]).toMatchObject({ status: 'updated' })
    const stored = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, id))
    expect(stored.map((asset) => asset.hash)).toContain(ref.hash)
    const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
    const exported = Buffer.from(await exportStoredDoc(node!))
    const reread = new Y.Doc()
    const store = new MemoryLiveAssetStore()
    await docxCodec.importFile(reread, new Uint8Array(exported), { name: 'a.docx', assets: store })
    expect(docxCodec.referencedAssets!(reread)).toContain(ref.hash)
  })
})
