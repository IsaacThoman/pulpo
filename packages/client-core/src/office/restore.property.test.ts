import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from './assets.js'
import type { LiveFormatCodec, LiveFormatContext } from './live-format.js'
import { newInlinePicture } from './docx/drawing.js'
import { docxCodec } from './docx/codec.js'
import { packJml } from './docx/jsonml.js'
import { readDocxModel, writeDocxModel } from './docx/model.js'
import { docxSchema } from './docx/schema.js'
import { notebookCodec } from './notebook/codec.js'
import { seededRandom } from './notebook/edit.js'
import { presentationCodec } from './presentation/codec.js'
import { addImagePart, deleteSlides, duplicateSlides, insertShapes, moveSlides, pictureShape, setShapeText, setSlideHidden } from './presentation/commands.js'
import { plainToText } from './presentation/text.js'
import { readSnapshot } from './presentation/ydoc.js'
import { SheetCodec } from './sheets/codec/codec.js'
import { toIdForm } from './sheets/model/formula-ids.js'
import { WorkbookModel } from './sheets/model/workbook.js'
import { trackEdits } from './sheets/model/edits.js'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64'))
type Edit = (doc: Y.Doc, context: LiveFormatContext, random: () => number, step: number) => Promise<void>
const sheetCodec = new SheetCodec()
const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/${path}`, import.meta.url)))

const editSheet: Edit = async (doc, context, random, step) => {
  const model = new WorkbookModel(doc)
  const sheet = model.sheets()[0]!
  const row = Math.floor(random() * 6)
  const col = Math.floor(random() * 4)
  sheet.setCell(row, col, { v: random() * 100 })
  sheet.setCell((row + 1) % 6, col, undefined)
  sheet.setStyle({ top: row, bottom: row, left: col, right: col }, { bold: random() > 0.5, italic: true, numFmt: `0.000"seed${step}"` })
  sheet.setAxisStyle('col', [col], { fontSize: 12 + step, numFmt: `0.00"col${step}"` })
  sheet.setColProp([col], 'size', 12 + random() * 20)
  sheet.setViewProp('zoom', 80 + step * 10)
  sheet.setViewProp('frozenRows', step % 3)
  sheet.notes.clear()
  sheet.notes.set(sheet.keyAt(row, col), { text: 'same text', author: 'Seed', runs: [{ text: 'same text', rPr: `<rPr><b val="${step % 2}"/></rPr>` }] })
  sheet.cf.clear()
  sheet.dv.clear()
  for (let rule = 0; rule < 3; rule++) {
    const ranges = [sheet.rangeIds({ top: 0, bottom: 5, left: 0, right: 3 })]
    sheet.cf.set(`rule${rule}`, { ranges, rules: [{ type: 'cellIs', priority: rule + 1, operator: 'greaterThan', formulas: [String(random())] }], edited: true })
    sheet.dv.set(`validation${rule}`, { ranges, type: 'whole', operator: 'greaterThan', formula1: String(rule + step) })
  }
  sheet.map.set('tabColor', { rgb: 'FF123456' })
  sheet.merges.clear()
  sheet.merges.set('range', { range: sheet.rangeIds({ top: 8, bottom: 9, left: col, right: col + 1 }) })
  for (const key of [...model.names.keys()]) model.names.delete(key)
  model.names.set('seed', { name: `Value${step}`, formula: toIdForm('A1', sheet), scope: sheet.id })
  if (model.sheets().length > 1) model.deleteSheet(model.sheets().at(-1)!.id)
  const added = model.addSheet(`Added${step}`)
  added.setCell(0, 0, { v: `step ${step}` })
  model.moveSheet(added.id, Math.floor(random() * 2))
  model.setMeta('activeSheet', added.id)
  model.setMeta('date1904', step % 2 === 0)
  const asset = await context.assets.put(png, 'image/png')
  sheet.drawings.clear()
  sheet.drawings.set(`picture${step}`, { kind: 'image', anchor: 'oneCell', from: { row: sheet.rows.idAt(row), col: sheet.cols.idAt(col), rowOff: 0, colOff: 0 }, ext: { cx: 914400, cy: 914400 }, xml: '', image: { hash: asset.hash, mimeType: 'image/png' }, z: 0 })
}

const editDocx: Edit = async (doc, context, random, step) => {
  const schema = docxSchema()
  const model = readDocxModel(doc)
  const paragraphs = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => schema.node('paragraph', { pStyle: index % 2 ? 'Heading1' : null }, [
    schema.text(`Paragraph ${step}/${index}/${random()}`, [schema.mark('b', { v: packJml(['w:b', {}]) }), schema.mark('i', { v: packJml(['w:i', {}]) })]),
  ]))
  const asset = await context.assets.put(png, 'image/png')
  paragraphs.push(schema.node('paragraph', null, schema.node('drawing', { src: asset.hash, v: packJml(newInlinePicture(20 + step, 20, `Seed ${step}`)) })))
  // Add/remove an opaque binary part as well as the image relationships above.
  model.maps.parts.set(`custom/seed${step}.png`, JSON.stringify({ hash: asset.hash, sizeBytes: asset.sizeBytes, contentType: 'image/png' }))
  for (const key of model.maps.parts.keys()) if (key.startsWith('custom/') && key !== `custom/seed${step}.png`) model.maps.parts.delete(key)
  for (const key of model.maps.styles.keys()) if (key.startsWith('style:Seed')) model.maps.styles.delete(key)
  model.maps.styles.set(`style:Seed${step}`, packJml(['w:style', { 'w:type': 'paragraph', 'w:styleId': `Seed${step}` }, ['w:name', { 'w:val': `Seed ${random()}` }], ['w:rPr', {}, ['w:b', {}]]]))
  model.maps.numbering.set('abstract:99', packJml(['w:abstractNum', { 'w:abstractNumId': '99' }, ['w:lvl', { 'w:ilvl': '0' }, ['w:start', { 'w:val': String(step + 1) }], ['w:numFmt', { 'w:val': 'decimal' }], ['w:lvlText', { 'w:val': '%1.' }]]]))
  model.maps.numbering.set('num:99', packJml(['w:num', { 'w:numId': '99' }, ['w:abstractNumId', { 'w:val': '99' }]]))
  doc.transact(() => writeDocxModel(doc, { ...model, body: schema.node('doc', null, paragraphs) }))
}

const editPresentation: Edit = async (doc, context, random, step) => {
  let snapshot = readSnapshot(doc)
  if (snapshot.slides.length > 2) deleteSlides(doc, [snapshot.slides.at(-1)!.key])
  duplicateSlides(doc, [snapshot.slides[0]!.key])
  snapshot = readSnapshot(doc)
  const slide = snapshot.slides[Math.floor(random() * snapshot.slides.length)]!
  const textShape = slide.shapes.find((shape) => shape.text)
  if (textShape) setShapeText(doc, slide.key, textShape.key, plainToText(`Slide ${step} / ${random()}`))
  setSlideHidden(doc, [slide.key], step % 2 === 0)
  moveSlides(doc, [slide.key], Math.floor(random() * snapshot.slides.length))
  const asset = await context.assets.put(png, 'image/png')
  const path = addImagePart(doc, asset)
  insertShapes(doc, slide.key, [pictureShape(path, { x: step * 1000, y: 0, cx: 914400, cy: 914400 }, `Picture ${step}`, 'Seeded image')])
}

const editNotebook: Edit = async (doc, context, random, step) => {
  const data = JSON.parse(strFromU8(await notebookCodec.exportFile(doc, context)))
  data.metadata = { seed: random(), kernelspec: { name: 'python3', display_name: `Python ${step}` } }
  data.cells = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => index % 2 ? {
    cell_type: 'markdown', id: `markdown-${step}-${index}`, source: [`# Heading ${random()}\n`, '![image](attachment:seed.png)'], metadata: {}, attachments: { 'seed.png': { 'image/png': Buffer.from(png).toString('base64') } },
  } : {
    cell_type: 'code', id: `code-${step}-${index}`, source: `print(${random()})`, metadata: { collapsed: step % 2 === 0 }, execution_count: step,
    outputs: [{ output_type: 'display_data', data: { 'image/png': Buffer.from(png).toString('base64'), 'text/plain': [`Result ${step}`] }, metadata: {} }],
  })
  await notebookCodec.applyFile(doc, strToU8(`${JSON.stringify(data, null, step % 2 ? 1 : 2)}\n`), context, 'agent')
}

const formats: { extension: string; codec: LiveFormatCodec; source?: string; edit: Edit }[] = [
  ...['gen-styles.xlsx', 'gen-multisheet.xlsx', 'gen-conditional-formatting.xlsx', 'gen-tables.xlsx'].map((name) => ({ extension: 'xlsx', codec: sheetCodec, source: `../test-fixtures/sheets/generated/${name}`, edit: editSheet })),
  { extension: 'docx', codec: docxCodec, source: 'docx/basic-formatting.docx', edit: editDocx },
  { extension: 'pptx', codec: presentationCodec, source: 'presentation/generated/text-formatting.pptx', edit: editPresentation },
  { extension: 'ipynb', codec: notebookCodec, edit: editNotebook },
]

/** Diff package parts first so a failing seed points at the lost state, then compare the whole ZIP. */
function identical(actual: Uint8Array, expected: Uint8Array, extension: string): void {
  if (extension !== 'ipynb') {
    const own = unzipSync(actual)
    const saved = unzipSync(expected)
    expect(Object.keys(own).sort()).toEqual(Object.keys(saved).sort())
    for (const path of Object.keys(saved)) expect(Buffer.from(own[path]!).equals(Buffer.from(saved[path]!)), path).toBe(true)
  }
  expect(Buffer.from(actual).equals(Buffer.from(expected)), 'complete export bytes').toBe(true)
}

describe.each(formats)('$extension ($source) snapshot restoration properties', ({ extension, codec, source, edit }) => {
  it.each([7, 42, 0xc0ffee])('restores before and redo bytes across varied edits (seed %s)', async (seed) => {
    const random = seededRandom(seed)
    const context = { name: `Seed.${extension}`, assets: new MemoryLiveAssetStore() }
    const doc = new Y.Doc()
    const replica = new Y.Doc()
    const stop = extension === 'xlsx' ? trackEdits(doc) : () => {}
    try {
      if (source) await codec.importFile(doc, fixture(source), context)
      else await codec.createEmpty(doc, context)
      Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
      for (let step = 0; step < 5; step++) {
        const before = await codec.exportFile(doc, context)
        const agent = new Y.Doc()
        let pushed: Uint8Array
        try {
          await codec.importFile(agent, before, context)
          await edit(agent, context, random, step)
          pushed = await codec.exportFile(agent, context)
          if (extension !== 'ipynb') {
            // Change unmodeled parts too: imported orphan parts must disappear again on undo.
            const parts = unzipSync(pushed)
            for (const path of Object.keys(parts)) if (path.startsWith('custom/seed')) delete parts[path]
            parts[`custom/seed${step}.xml`] = strToU8(`<seed value="${random()}"/>`)
            pushed = zipSync(parts)
          }
        } finally { agent.destroy() }
        expect((await codec.applyFile(doc, pushed, context, 'agent')).changed).toBe(true)
        const after = await codec.exportFile(doc, context)
        expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false)
        for (const snapshot of [before, after, before, after]) {
          await codec.applyFile(doc, snapshot, context, 'restore')
          identical(await codec.exportFile(doc, context), snapshot, extension)
          expect((await codec.applyFile(doc, snapshot, context, 'restore')).changed).toBe(false)
          Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
          identical(await codec.exportFile(replica, context), snapshot, extension)
        }
      }
    } finally {
      stop()
      doc.destroy()
      replica.destroy()
    }
  }, 60_000)
})

it('restores DOCX regenerated part bytes even when the modeled content is identical', async () => {
  const context = { name: 'Raw.docx', assets: new MemoryLiveAssetStore() }
  const doc = new Y.Doc()
  const source = new Y.Doc()
  try {
    await docxCodec.createEmpty(doc, context)
    const before = await docxCodec.exportFile(doc, context)
    const parts = unzipSync(before)
    parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']!).replace('<w:document', '<!-- saved by another writer --><w:document'))
    await docxCodec.importFile(source, zipSync(parts), context)
    const after = await docxCodec.exportFile(source, context)
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false)
    for (const snapshot of [after, before, after]) {
      expect((await docxCodec.applyFile(doc, snapshot, context, 'restore')).changed).toBe(true)
      identical(await docxCodec.exportFile(doc, context), snapshot, 'docx')
      expect((await docxCodec.applyFile(doc, snapshot, context, 'restore')).changed).toBe(false)
    }
  } finally {
    doc.destroy()
    source.destroy()
  }
})
