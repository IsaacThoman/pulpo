import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from '../blank.js'
import { copyContent } from '../clipboard.js'
import { presentationCodec } from '../codec.js'
import { cellFragment, groupShapes, insertShapes, presetShape, readSlide, readXfrm, tableShape } from '../commands.js'
import { EMU_PER_PX } from '../render/env.js'
import { textToPlain } from '../text.js'
import { memoryAssets } from '../testing/assets.js'
import { fidelityAvailable, fixture, runPython, scratchDir, writeScratch } from '../testing/fixtures.js'
import { readSnapshot } from '../ydoc.js'
import { LOCAL_ORIGIN, PresentationController } from './controller.js'

const controllers: PresentationController[] = []
afterEach(() => { for (const controller of controllers.splice(0)) { controller.destroy(); controller.doc.destroy() } })

async function open(bytes = blankPresentation()) {
  const assets = memoryAssets()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, { name: 'deck.pptx', assets })
  const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'Editor', color: '#123456' } })
  controllers.push(controller)
  return { doc, assets, controller }
}

/** A second collaborator on a copy of `doc`, kept apart until `sync`. */
function collaborator(doc: Y.Doc, assets: ReturnType<typeof memoryAssets>) {
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
  const controller = new PresentationController({ doc: other, assets, readOnly: false, user: { name: 'Other', color: '#654321' } })
  controllers.push(controller)
  return controller
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
}

/** Edits the given cell of the controller's selected table, as a double click would. */
function editCell(controller: PresentationController, tableKey: string, row: number, column: number): void {
  const table = controller.shape(controller.state.slide!, tableKey)!.table!
  controller.setState({ shapes: [tableKey], editing: { slide: controller.state.slide!, shape: tableKey, row: table.rows[row]!.key, column: table.columns[column]!.key } })
}

function grid(controller: PresentationController, tableKey: string): string[][] {
  const table = controller.shape(controller.state.slide!, tableKey)!.table!
  return table.rows.map((row) => table.columns.map((column) => (row.cells[column.key] ? textToPlain(row.cells[column.key]!.text) : '-')))
}

describe('presentation interaction regressions', () => {
  it('names new shapes by the slide contents after duplication allocates random file IDs', async () => {
    const { controller, doc } = await open()
    controller.insertShape('rect')
    controller.duplicateSelection()
    const before = readSnapshot(doc).slides[0]!.shapes
    controller.insertShape('ellipse')
    expect(readSnapshot(doc).slides[0]!.shapes.at(-1)!.name).toBe(`Shape ${before.length + 1}`)
  })

  it('blocks every controller editing command at the read-only boundary', async () => {
    const { controller, doc } = await open()
    controller.insertShape('rect')
    const shape = controller.state.shapes[0]!
    const layout = controller.layouts()[1]!.path
    controller.setReadOnly(true)
    let updates = 0
    doc.on('update', () => { updates++ })
    controller.insertTextBox()
    controller.insertShape('ellipse')
    controller.insertTable(2, 2)
    controller.addSlide()
    controller.duplicateSlides()
    controller.deleteSlides()
    controller.moveSlides(controller.state.slides, 0)
    controller.setSlidesHidden(true)
    controller.setLayout(layout)
    controller.setBackground('<a:noFill/>')
    controller.deleteSelection()
    controller.duplicateSelection()
    controller.setXfrm(shape, { cx: 123 })
    controller.nudge(12, 34)
    controller.setShapeProperty('name', 'Forbidden')
    controller.reorder('back')
    controller.group()
    controller.ungroup()
    controller.align('left')
    controller.distribute('horizontal')
    controller.setMark('b', true)
    controller.editParagraphs(() => {})
    controller.toggleMark('i')
    controller.setAlign('r')
    controller.setBullets('char')
    controller.changeLevel(1)
    controller.setLineSpacing(2)
    controller.insertTableRow('below')
    controller.insertTableColumn('right')
    controller.deleteTableRows()
    controller.deleteTableColumns()
    controller.deleteTable()
    controller.undo()
    controller.redo()
    await controller.insertImage(new Uint8Array([1]), 'image/png')
    expect(await controller.paste('{}')).toBe(false)
    expect(updates).toBe(0)
  })

  it('blocks undo and redo after access becomes read-only without discarding history', async () => {
    const { controller, doc } = await open()
    controller.insertShape('rect')
    const edited = readSnapshot(doc)
    controller.setReadOnly(true)
    controller.undo()
    expect(readSnapshot(doc)).toEqual(edited)
    expect(controller.canUndo()).toBe(false)
    controller.setReadOnly(false)
    expect(controller.canUndo()).toBe(true)
    controller.undo()
    const undone = readSnapshot(doc)
    controller.setReadOnly(true)
    controller.redo()
    expect(readSnapshot(doc)).toEqual(undone)
    expect(controller.canRedo()).toBe(false)
    controller.setReadOnly(false)
    controller.redo()
    expect(readSnapshot(doc)).toEqual(edited)
  })

  it.each(['image', 'shapes', 'slides'].flatMap((kind) => ['read-only', 'destroyed'].map((access) => ({ kind, access }))))('does not finish an asynchronous $kind insertion after the controller becomes $access', async ({ kind, access }) => {
    const { doc, assets, controller } = await open()
    const source = await open(fixture('generated/pictures.pptx'))
    const slide = readSnapshot(source.doc).slides[0]!
    const picture = slide.shapes.find((shape) => shape.kind === 'pic')!
    const copied = await copyContent(source.doc, source.assets, kind === 'slides' ? { slides: [slide] } : { shapes: [picture] }, '')
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const put = assets.put.bind(assets)
    assets.put = async (bytes, mime) => { started(); await gate; return put(bytes, mime) }
    const before = Y.encodeStateAsUpdate(doc)
    const pending = kind === 'image' ? controller.insertImage(new Uint8Array([1, 2, 3]), 'image/png') : controller.paste(JSON.stringify(copied))
    await entered
    if (access === 'destroyed') controller.destroy()
    else controller.setReadOnly(true)
    release()
    await pending
    expect(Buffer.from(Y.encodeStateAsUpdate(doc)).equals(Buffer.from(before))).toBe(true)
  })

  it('resizes table rows and columns proportionally in one undoable transaction', async () => {
    const { controller, doc, assets } = await open()
    const slide = controller.state.slide!
    const shape = tableShape(2, 3, { x: 10, y: 20, cx: 600_000, cy: 300_000 }, 'Table')
    shape.table!.columns.forEach((column, index) => { column.w = (index + 1) * 100_000 })
    shape.table!.rows[0]!.h = 100_000
    shape.table!.rows[1]!.h = 200_000
    insertShapes(doc, slide, [shape])
    const before = readSlide(doc, slide)!.shapes.at(-1)!
    let updates = 0
    doc.on('update', () => { updates++ })
    controller.setXfrm(shape.key, { cx: 1_200_001, cy: 150_001 })
    const resized = readSlide(doc, slide)!.shapes.at(-1)!
    expect(updates).toBe(1)
    expect(resized.table!.columns.map((column) => column.w)).toEqual([200_000, 400_001, 600_000])
    expect(resized.table!.rows.map((row) => row.h)).toEqual([50_000, 100_001])
    expect(resized.xfrm).toMatchObject({ cx: 1_200_001, cy: 150_001 })
    const bytes = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    if (fidelityAvailable()) {
      const file = writeScratch(scratchDir(), 'resized-table.pptx', bytes)
      const actual = JSON.parse(runPython('import sys, json\nfrom pptx import Presentation\ns=Presentation(sys.argv[1]).slides[0].shapes[-1]\nprint(json.dumps([s.width, s.height, [c.width for c in s.table.columns], [r.height for r in s.table.rows]]))', file))
      expect(actual).toEqual([1_200_001, 150_001, [200_000, 400_001, 600_000], [50_000, 100_001]])
    }
    const reopened = new Y.Doc()
    await presentationCodec.importFile(reopened, bytes, { name: 'deck.pptx', assets })
    const exported = readSnapshot(reopened).slides[0]!.shapes.at(-1)!
    expect(exported.table!.columns.map((column) => column.w)).toEqual(resized.table!.columns.map((column) => column.w))
    expect(exported.table!.rows.map((row) => row.h)).toEqual(resized.table!.rows.map((row) => row.h))
    reopened.destroy()
    controller.undo()
    expect(readSlide(doc, slide)!.shapes.at(-1)).toEqual(before)
    controller.redo()
    expect(readSlide(doc, slide)!.shapes.at(-1)).toEqual(resized)
  })

  it('keeps a scaled table at the same size when its group is ungrouped', async () => {
    const { controller, doc } = await open()
    const slide = controller.state.slide!
    const box = { x: 100_000, y: 200_000, cx: 1_000_000, cy: 1_000_000 }
    const table = tableShape(2, 2, box, 'Grouped table')
    const keys = insertShapes(doc, slide, [table, presetShape('line', box, 'Connector')])
    const group = groupShapes(doc, slide, keys, new Map(keys.map((key) => [key, box])), 'Group')!
    controller.setXfrm(group, { x: 400_000, cx: 2_000_000, cy: 3_000_000 })
    expect(readXfrm(doc, slide, group)).toMatchObject({ chX: box.x, chY: box.y, chCx: box.cx, chCy: box.cy })
    controller.selectShapes([group])
    controller.ungroup()
    const after = readSlide(doc, slide)!
    const resized = after.shapes.find((shape) => shape.key === table.key)!
    expect(resized.table!.columns.reduce((sum, column) => sum + column.w, 0)).toBe(2_000_000)
    expect(resized.table!.rows.reduce((sum, row) => sum + row.h, 0)).toBe(3_000_000)
    expect(resized.xfrm).toMatchObject({ x: 400_000, y: box.y, cx: 2_000_000, cy: 3_000_000 })
    expect(readXfrm(doc, slide, keys[1]!)).toMatchObject({ x: 400_000, y: box.y, cx: 2_000_000, cy: 3_000_000 })
    controller.undoManager.stopCapturing()
  })

  it('inserts and deletes table rows and columns around the edited cell, each one undo step', async () => {
    const { controller, doc, assets } = await open()
    const table = controller.insertTable(2, 2)!
    editCell(controller, table, 0, 0)
    const rowKey = controller.insertTableRow('below')!
    const columnKey = controller.insertTableColumn('right')!
    let shape = controller.shape(controller.state.slide!, table)!
    expect(shape.table!.rows.map((row) => row.key).indexOf(rowKey)).toBe(1)
    expect(shape.table!.columns.map((column) => column.key).indexOf(columnKey)).toBe(1)
    expect(grid(controller, table).map((row) => row.length)).toEqual([3, 3, 3])
    // The editor stays in its cell, which the inserts did not move.
    expect(controller.tableSelection()?.cell).toMatchObject({ rowIndex: 0, columnIndex: 0 })
    controller.insertTableRow('above')
    expect(controller.tableSelection()?.cell).toMatchObject({ rowIndex: 1, columnIndex: 0 })
    controller.undo()
    expect(controller.shape(controller.state.slide!, table)!.table!.rows.length).toBe(3)
    // Exported row and column ids stay unique.
    const bytes = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    const xml = new TextDecoder().decode((await import('fflate')).unzipSync(bytes)['ppt/slides/slide1.xml'])
    const rowIds = [...xml.matchAll(/rowId[^>]*val="(\d+)"/g)].map((match) => match[1])
    const columnIds = [...xml.matchAll(/colId[^>]*val="(\d+)"/g)].map((match) => match[1])
    expect(rowIds.length).toBe(3)
    expect(new Set(rowIds).size).toBe(3)
    expect(new Set(columnIds).size).toBe(3)
    // Delete the inserted row and column from one of their cells.
    shape = controller.shape(controller.state.slide!, table)!
    editCell(controller, table, 1, 1)
    controller.deleteTableRows()
    expect(controller.shape(controller.state.slide!, table)!.table!.rows.length).toBe(2)
    expect(controller.state.editing?.row).toBeDefined()
    controller.deleteTableColumns()
    expect(grid(controller, table)).toEqual([['', ''], ['', '']])
    // Deleting every row deletes the table.
    editCell(controller, table, 0, 0)
    controller.deleteTableColumns()
    controller.deleteTableColumns()
    expect(controller.shape(controller.state.slide!, table)).toBeUndefined()
    expect(controller.state.editing).toBeUndefined()
    controller.undo()
    expect(controller.shape(controller.state.slide!, table)!.table!.columns.length).toBe(1)
  })

  it('inserts rows below a merged cell and columns at the edges of a selected table', async () => {
    const { controller, doc } = await open()
    const slide = controller.state.slide!
    const shape = tableShape(3, 2, { x: 0, y: 0, cx: 2_000_000, cy: 1_200_000 }, 'Merged')
    const [first, second] = shape.table!.rows
    first!.cells[shape.table!.columns[0]!.key]!.rowSpan = 2
    second!.cells[shape.table!.columns[0]!.key]!.vMerge = true
    insertShapes(doc, slide, [shape], LOCAL_ORIGIN)
    editCell(controller, shape.key, 0, 0)
    const row = controller.insertTableRow('below')!
    expect(controller.shape(slide, shape.key)!.table!.rows.map((entry) => entry.key).indexOf(row)).toBe(2)
    controller.setState({ editing: undefined, shapes: [shape.key] })
    const left = controller.insertTableColumn('left')!
    const right = controller.insertTableColumn('right')!
    const columns = controller.shape(slide, shape.key)!.table!.columns.map((column) => column.key)
    expect(columns.indexOf(left)).toBe(0)
    expect(columns.indexOf(right)).toBe(columns.length - 1)
    // Row and column deletion need a cell.
    controller.deleteTableRows()
    expect(controller.shape(slide, shape.key)!.table!.rows.length).toBe(4)
  })

  it('merges table rows one collaborator inserts with columns and typing from another', async () => {
    const { controller: a, doc, assets } = await open()
    const table = a.insertTable(2, 2)!
    const b = collaborator(doc, assets)
    b.goToSlide(a.state.slide!)
    editCell(a, table, 0, 0)
    editCell(b, table, 1, 1)
    a.insertTableRow('below')
    b.insertTableColumn('left')
    const cell = b.tableSelection()!.cell!
    const fragment = cellFragment(b.doc, b.state.slide!, table, cell.row, cell.column)!
    b.doc.transact(() => {
      fragment.delete(0, fragment.length)
      const paragraph = new Y.XmlElement('paragraph')
      fragment.insert(0, [paragraph])
      paragraph.insert(0, [new Y.XmlText('typed by B')])
    }, LOCAL_ORIGIN)
    sync(doc, b.doc)
    expect(readSnapshot(doc)).toEqual(readSnapshot(b.doc))
    expect(grid(a, table).map((row) => row.length)).toEqual([3, 3, 3])
    expect(grid(a, table)[2]).toEqual(['', '', 'typed by B'])
    // Undo takes back only each user's own edit.
    a.undo()
    sync(doc, b.doc)
    expect(grid(b, table)).toEqual([['', '', ''], ['', '', 'typed by B']])
  })

  it('inserts pictures at their aspect ratio, centered on a point and kept on the slide', async () => {
    const { controller } = await open()
    const slide = controller.state.slide!
    const width = controller.size().width * EMU_PER_PX
    const height = controller.size().height * EMU_PER_PX
    const bytes = new Uint8Array([1, 2, 3])
    const wide = (await controller.insertImage(bytes, 'image/png', { width: 4000, height: 1000 }))!
    const wideXfrm = controller.shapeXfrm(slide, wide)!
    expect(wideXfrm.cx / wideXfrm.cy).toBeCloseTo(4, 3)
    expect(wideXfrm.cx).toBeLessThanOrEqual(width * 0.6 + 1)
    const placed = (await controller.insertImage(bytes, 'image/png', { width: 100, height: 50 }, 'Logo', { x: 1_000_000, y: 2_000_000 }))!
    const xfrm = controller.shapeXfrm(slide, placed)!
    expect([xfrm.x + xfrm.cx / 2, xfrm.y + xfrm.cy / 2, xfrm.cx / xfrm.cy]).toEqual([1_000_000, 2_000_000, 2])
    expect(controller.shape(slide, placed)!.descr).toBe('Logo')
    const corner = (await controller.insertImage(bytes, 'image/png', { width: 100, height: 50 }, '', { x: width + 5_000_000, y: -10 }))!
    const clamped = controller.shapeXfrm(slide, corner)!
    expect([clamped.x + clamped.cx, clamped.y]).toEqual([width, 0])
    // An unknown size (no decoder) falls back to a 4:3 box in the middle.
    const unknown = (await controller.insertImage(bytes, 'image/png', { width: 0, height: Number.NaN }))!
    const fallback = controller.shapeXfrm(slide, unknown)!
    expect(fallback.cx / fallback.cy).toBeCloseTo(4 / 3, 3)
    expect(Math.round(fallback.y + fallback.cy / 2)).toBe(Math.round(height / 2))
  })
})
