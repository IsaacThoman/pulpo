import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { plainToText, presentationCodec, presentationCommands, readSnapshot, textToPlain } from '@pulpo/client-core/office/presentation'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileDocAssets, fileDocUpdates, fileNodes } from '../../database/schema.js'
import { convertBlobToDocInTx } from '../conversion.js'
import { appendDocUpdate, createDoc, loadYDoc } from '../doc-store.js'
import { exportStoredDoc } from '../live-docs.js'
import { reviewFileChange } from './review.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'

/**
 * PowerPoint decks as live documents on the server: creation, conversion of uploads (media kept
 * as document assets), export, and agent pull, push, and suggestions through the codec.
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
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const fixtures = fileURLToPath(new URL('../../../../../packages/client-core/fixtures/presentation/', import.meta.url))
const fixture = (name: string) => readFileSync(`${fixtures}${name}`)

let files: FilesFixture

type PushData = { results: Array<{ status: string; message: string; nodeId?: string; version?: string }> }
type PullData = { files: Array<{ remote: string; local: string; nodeId: string; version: string; kind: string; sizeBytes: number }> }

async function push(items: Array<{ local: string; remote: string; base?: { nodeId: string; version: string } | null; force?: boolean }>) {
  return ((await files.ok('push', { items: items.map((item) => ({ base: null, ...item })) })).data as PushData).results
}

async function pull(path: string, dest: string) {
  return ((await files.ok('pull', { path, dest })).data as PullData).files
}

/** An uploaded deck turned into a live document, as **Edit** does. */
async function convertedDeck(name: string, parentId: string, bytes: Buffer): Promise<string> {
  const id = await files.blob(name, parentId, bytes, PPTX)
  const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
  await db.transaction((tx) => convertBlobToDocInTx(tx, node!))
  return id
}

/** A collaborator's edit, sent the way an editor sends it. */
async function clientEdit(nodeId: string, edit: (doc: Y.Doc) => void) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  edit(doc)
  await appendDocUpdate({ nodeId, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

/** Sets the text of the first text shape on slide `index` (0-based). */
function setSlideTitle(doc: Y.Doc, index: number, text: string) {
  const slide = readSnapshot(doc).slides[index]!
  const shape = slide.shapes.find((entry) => entry.text)!
  presentationCommands.setShapeText(doc, slide.key, shape.key, plainToText(text))
}

/** Rewrites the first `<a:t>` of a slide part in a deck, as an agent's python-pptx edit would. */
function editSlideText(bytes: Uint8Array, slide: number, text: string): Buffer {
  const parts = unzipSync(bytes)
  const path = `ppt/slides/slide${slide}.xml`
  parts[path] = strToU8(strFromU8(parts[path]!).replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${text}</a:t>`))
  return Buffer.from(zipSync(parts))
}

async function slideTexts(nodeId: string): Promise<string[]> {
  return readSnapshot(await loadYDoc(nodeId)).slides.map((slide) => slide.shapes.map((shape) => (shape.text ? textToPlain(shape.text) : '')).join('|'))
}

describe.skipIf(!enabled)('presentations as live documents', () => {
  let projects: string

  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    projects = await files.folder('Projects')
    published.length = 0
  })
  afterAll(async () => { await queryClient.end() })

  it('creates a new deck that exports as a real .pptx and reads as text', async () => {
    const node = await createDoc(files.userId, { parentId: projects, name: 'Pitch.pptx' })
    expect(node).toMatchObject({ kind: 'doc', format: 'presentation', mimeType: PPTX })
    const [row] = await db.select().from(fileNodes).where(eq(fileNodes.id, node.id))
    const bytes = await exportStoredDoc(row!)
    expect(Object.keys(unzipSync(bytes))).toContain('ppt/slides/slide1.xml')
    await files.attach({ [projects]: 'read' })
    expect((await files.ok('cat', { path: 'Projects/Pitch.pptx' })).output).toContain('--- Slide 1 ---')
  })

  it('converts an uploaded deck, keeping every part byte for byte and its pictures as document assets', async () => {
    const original = fixture('generated/pictures.pptx')
    const id = await convertedDeck('Pictures.pptx', projects, original)
    expect(await files.node(id)).toMatchObject({ kind: 'doc', format: 'presentation' })
    const assets = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, id))
    expect(assets.length).toBeGreaterThan(0)
    const [row] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
    const before = unzipSync(original)
    const after = unzipSync(await exportStoredDoc(row!))
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    for (const [path, data] of Object.entries(before)) expect(Buffer.from(after[path]!).equals(Buffer.from(data)), path).toBe(true)
  })

  it('merges an agent push with a concurrent edit on another slide', async () => {
    const id = await convertedDeck('Formatting.pptx', projects, fixture('generated/text-formatting.pptx'))
    await files.attach({ [projects]: 'write' })
    const [pulled] = await pull('Projects/Formatting.pptx', '/workspace/files/Projects/Formatting.pptx')
    expect(pulled).toMatchObject({ nodeId: id, kind: 'doc' })
    // A person's editor holds an edit to slide 3 it has not sent yet while the agent pushes slide 2.
    const editor = await loadYDoc(id)
    const vector = Y.encodeStateVector(editor)
    setSlideTitle(editor, 2, 'Edited by a person')
    files.put('/workspace/files/Projects/Formatting.pptx', editSlideText(files.workspace.files.get('/workspace/files/Projects/Formatting.pptx')!, 2, 'Edited by the agent'))
    const [result] = await push([{ local: '/workspace/files/Projects/Formatting.pptx', remote: 'Projects/Formatting.pptx', base: { nodeId: id, version: pulled!.version } }])
    expect(result).toMatchObject({ status: 'updated' })
    const [logged] = await db.select().from(fileDocUpdates).where(and(eq(fileDocUpdates.nodeId, id), eq(fileDocUpdates.origin, 'agent')))
    expect(logged).toBeDefined()
    // What open editors receive is a small update, not the whole deck again.
    expect(published).toHaveLength(1)
    expect(published[0]!.update.byteLength).toBeLessThan(20_000)
    Y.applyUpdate(editor, published[0]!.update)
    await appendDocUpdate({ nodeId: id, ownerUserId: files.userId, actorUserId: files.userId, update: Y.encodeStateAsUpdate(editor, vector), origin: 'client' })
    const texts = await slideTexts(id)
    expect(texts[1]).toContain('Edited by the agent')
    expect(texts[2]).toContain('Edited by a person')
    expect(presentationCodec.toText(editor)).toBe(presentationCodec.toText(await loadYDoc(id)))
  })

  it('suggests a new version and merges it with later user edits when accepted', async () => {
    const id = await convertedDeck('Layouts.pptx', projects, fixture('generated/layouts-notes-sections.pptx'))
    await files.attach({ [projects]: 'suggest' })
    const [pulled] = await pull('Projects/Layouts.pptx', '/workspace/files/Projects/Layouts.pptx')
    const before = await slideTexts(id)
    files.put('/workspace/files/Projects/Layouts.pptx', editSlideText(files.workspace.files.get('/workspace/files/Projects/Layouts.pptx')!, 1, 'Proposed title'))
    const [suggested] = await push([{ local: '/workspace/files/Projects/Layouts.pptx', remote: 'Projects/Layouts.pptx', base: { nodeId: id, version: pulled!.version } }])
    expect(suggested).toMatchObject({ status: 'suggested' })
    expect(await slideTexts(id)).toEqual(before)
    // The agent reads its own proposal back.
    expect((await files.ok('cat', { path: 'Projects/Layouts.pptx' })).output).toContain('Proposed title')
    const [change] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, id))
    expect(change).toMatchObject({ mode: 'suggest', status: 'pending', after: { format: 'presentation', forkKey: expect.any(String) } })
    await clientEdit(id, (doc) => setSlideTitle(doc, 4, 'A later person edit'))
    await reviewFileChange(files.userId, change!.id, 'accept')
    const texts = await slideTexts(id)
    expect(texts[0]).toContain('Proposed title')
    expect(texts[4]).toContain('A later person edit')
  })

  it('refuses bytes that are not a deck for a presentation document', async () => {
    const id = await convertedDeck('Deck.pptx', projects, fixture('generated/autoshapes.pptx'))
    await files.attach({ [projects]: 'write' })
    files.put('/workspace/files/Projects/Deck.pptx', 'not a zip')
    const [result] = await push([{ local: '/workspace/files/Projects/Deck.pptx', remote: 'Projects/Deck.pptx', force: true }])
    expect(result!.status).not.toBe('updated')
    expect(await files.node(id)).toMatchObject({ kind: 'doc', format: 'presentation' })
  })
})
