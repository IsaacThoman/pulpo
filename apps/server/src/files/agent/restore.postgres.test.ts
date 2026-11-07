import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { SheetCodec, Stylesheet, WorkbookModel } from '@pulpo/client-core/office/sheets'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { db, queryClient } from '../../database/client.js'
import { fileChanges, fileNodes } from '../../database/schema.js'
import { exportStoredDoc } from '../live-docs.js'
import { redoFileChanges, undoFileChanges } from './history.js'
import { parseLiveSnapshot } from './live.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from './test-fixtures.js'
import { contentChecksum } from './versions.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('../doc-events.js', () => ({ publishDocsClosed: vi.fn(), publishDocUpdate: vi.fn() }))
vi.mock('../../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const savedTime = '2024-01-01T01:00:00.000Z'
const editedTime = '2025-02-02T02:00:00.000Z'
const codec = new SheetCodec()
let files: FilesFixture

/** An external writer saves its own modification time, as Office tools do. */
function withModified(bytes: Uint8Array, modified: string): Buffer {
  const parts = unzipSync(bytes)
  parts['docProps/core.xml'] = strToU8(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/"><dcterms:modified>${modified}</dcterms:modified></cp:coreProperties>`)
  return Buffer.from(zipSync(parts))
}

async function workbook(): Promise<Buffer> {
  const doc = new Y.Doc()
  const context = { name: 'Clock.xlsx', assets: new MemoryLiveAssetStore() }
  try {
    await codec.createEmpty(doc, context)
    const model = new WorkbookModel(doc)
    model.setMeta('calcTime', Date.parse(savedTime))
    const sheet = model.sheets()[0]!
    sheet.setCell(0, 0, { v: 'before' })
    sheet.setCell(1, 0, { f: 'NOW()' })
    sheet.setCell(2, 0, { f: 'TODAY()' })
    sheet.setCell(3, 0, { f: 'RAND()' })
    return Buffer.from(await codec.exportFile(doc, context))
  } finally {
    doc.destroy()
  }
}

async function initial(extension: string): Promise<Buffer> {
  if (extension === 'xlsx') return workbook()
  if (extension === 'ipynb') return Buffer.from('{"cells":[{"cell_type":"code","execution_count":7,"id":"clock","metadata":{"saved":"2024"},"outputs":[{"output_type":"stream","name":"stdout","text":["before\\n"]}],"source":["before\\n"]}],"metadata":{"saved":"2024"},"nbformat":4,"nbformat_minor":5}\n')
  const fixture = extension === 'docx' ? 'fixtures/docx/basic-formatting.docx' : 'fixtures/presentation/generated/text-formatting.pptx'
  return withModified(readFileSync(new URL(`../../../../../packages/client-core/${fixture}`, import.meta.url)), savedTime)
}

function agentEdit(bytes: Uint8Array, extension: string): Buffer {
  if (extension === 'ipynb') return Buffer.from(strFromU8(bytes).replaceAll('before', 'after').replaceAll('2024', '2025'))
  const parts = unzipSync(withModified(bytes, editedTime))
  const path = extension === 'docx' ? 'word/document.xml' : extension === 'pptx' ? 'ppt/slides/slide1.xml' : 'xl/sharedStrings.xml'
  const pattern = extension === 'docx' ? /(<w:t[^>]*>)[^<]*/ : extension === 'pptx' ? /(<a:t[^>]*>)[^<]*/ : /(<t[^>]*>)[^<]*/
  const xml = strFromU8(parts[path]!)
  const edited = xml.replace(pattern, '$1after')
  expect(edited).not.toBe(xml)
  parts[path] = strToU8(edited)
  if (extension === 'xlsx') {
    const styles = new Stylesheet(strFromU8(parts['xl/styles.xml']!))
    const index = styles.intern(0, { bold: true, numFmt: '0.000" units"' })
    parts['xl/styles.xml'] = strToU8(styles.toXml())
    const worksheet = strFromU8(parts['xl/worksheets/sheet1.xml']!)
    const styled = worksheet.replace(/<c r="A1"[^>]*>/, `<c r="A1" s="${index}" t="s">`)
    expect(styled).not.toBe(worksheet)
    parts['xl/worksheets/sheet1.xml'] = strToU8(styled)
  }
  return Buffer.from(zipSync(parts))
}

async function exported(id: string): Promise<Uint8Array> {
  const [node] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
  return exportStoredDoc(node!)
}

async function push(bytes: Buffer, name: string, base: { nodeId: string; version: string } | null = null) {
  files.put(`/workspace/${name}`, bytes)
  const result = await files.ok('push', { items: [{ local: `/workspace/${name}`, remote: `Projects/${name}`, base }] })
  return (result.data as { results: Array<{ status: string; nodeId: string }> }).results[0]!
}

describe.skipIf(process.env.PULPO_FILES_TESTS !== 'true')('live snapshot restoration', () => {
  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    const projects = await files.folder('Projects')
    await files.attach({ [projects]: 'write' })
  })
  afterAll(async () => { await queryClient.end() })

  // These cases include imports/exports, object storage, DB writes, and four history replays.
  // On the two-core CI runner DOCX exceeds Vitest's five-second unit-test default.
  it.each(['xlsx', 'docx', 'pptx', 'ipynb'])('restores %s snapshot bytes and permits repeated undo/redo', async (extension) => {
    const name = `Clock.${extension}`
    const created = await push(await initial(extension), name)
    expect(created.status).toBe('created')
    const id = created.nodeId
    await files.newReply()
    const before = await exported(id)
    expect((await push(agentEdit(before, extension), name, { nodeId: id, version: contentChecksum(before) })).status).toBe('updated')
    const after = await exported(id)
    const [row] = await db.select().from(fileChanges).where(eq(fileChanges.responseId, files.responseId))
    const beforeSnapshot = parseLiveSnapshot(row!.before)!
    const afterSnapshot = parseLiveSnapshot(row!.after)!
    expect(Buffer.from(before)).toEqual(objects.get(beforeSnapshot.objectKey))
    expect(Buffer.from(after)).toEqual(objects.get(afterSnapshot.objectKey))
    expect(contentChecksum(before)).toBe(beforeSnapshot.checksum)
    expect(contentChecksum(after)).toBe(afterSnapshot.checksum)
    expect(Buffer.from(before).equals(Buffer.from(after))).toBe(false)
    for (let repeat = 0; repeat < 2; repeat++) {
      await undoFileChanges(files.userId, files.responseId)
      const undone = await exported(id)
      expect(Buffer.from(undone).equals(Buffer.from(before))).toBe(true)
      expect(contentChecksum(undone)).toBe(beforeSnapshot.checksum)
      await redoFileChanges(files.userId, files.responseId)
      const redone = await exported(id)
      expect(Buffer.from(redone).equals(Buffer.from(after))).toBe(true)
      expect(contentChecksum(redone)).toBe(afterSnapshot.checksum)
    }
  }, 30_000)
})
