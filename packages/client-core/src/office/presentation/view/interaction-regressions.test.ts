import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from '../blank.js'
import { copyContent } from '../clipboard.js'
import { presentationCodec } from '../codec.js'
import { cellFragment, groupShapes, insertShapes, presetShape, readSlide, readXfrm, setShapeProperty, setShapeText, tableShape } from '../commands.js'
import { lineEdits } from '../formatting.js'
import { EMU_PER_PX } from '../render/env.js'
import { plainToText, textToPlain } from '../text.js'
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

function firstRuns(controller: PresentationController, slide: string, shape: string) {
  return controller.shape(slide, shape)!.text!.content![0]!.content ?? []
}

async function exportedSlide(doc: Y.Doc, assets: ReturnType<typeof memoryAssets>) {
  const bytes = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
  const { strFromU8, unzipSync } = await import('fflate')
  const files = unzipSync(bytes)
  return { bytes, xml: strFromU8(files['ppt/slides/slide1.xml']!), rels: strFromU8(files['ppt/slides/_rels/slide1.xml.rels']!) }
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
    controller.resetSlides()
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
    controller.setFontSize(30)
    controller.stepFontSize(1)
    controller.clearFormatting()
    controller.setHighlight('<a:srgbClr val="FFFF00"/>')
    controller.toggleBaseline('sup')
    expect(controller.setLink('https://example.com')).toBe(false)
    expect(controller.insertField('slideNumber')).toBe(false)
    expect(controller.insertText('§')).toBe(false)
    expect(controller.addSection('Forbidden')).toBeUndefined()
    controller.renameSection('section', 'Forbidden')
    controller.removeSection('section')
    expect(await controller.cutToClipboard()).toBe(false)
    expect(await controller.pasteFromClipboard()).toBe(false)
    controller.flip('horizontal')
    controller.rotateBy(90)
    controller.changeShape('ellipse')
    controller.editLine(lineEdits.width(12_700))
    controller.setTextAnchor('b')
    controller.setAutofit('shape')
    controller.setTextInsets({ l: 0 })
    controller.setTextWrap(false)
    controller.distribute('horizontal', 'slide')
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
  it('formats whole selected shapes: highlight, superscript, size steps, links, and clear formatting', async () => {
    const { controller, assets } = await open()
    const slide = controller.state.slide!
    const [title, subtitle] = controller.slide(slide)!.shapes.map((shape) => shape.key) as [string, string]
    setShapeText(controller.doc, slide, title, plainToText('Quarterly results'), LOCAL_ORIGIN)
    setShapeText(controller.doc, slide, subtitle, plainToText('Second'), LOCAL_ORIGIN)
    controller.selectShapes([title, subtitle])
    // An untouched centered title reports its inherited alignment and font.
    expect(controller.formatState()).toMatchObject({ align: 'ctr', fontSize: 60, resolvedFontFamily: controller.themeFonts().major, baseline: 'none', notes: false })
    controller.setHighlight('<a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill>')
    controller.toggleBaseline('sup')
    controller.stepFontSize(1)
    expect(controller.formatState()).toMatchObject({ baseline: 'sup', fontSize: 66 })
    expect(controller.formatState().highlight).toContain('FFFF00')
    // Each shape steps from its own inherited size (the subtitle is 24 pt).
    expect(firstRuns(controller, slide, subtitle)[0]!.marks).toContainEqual({ type: 'sz', attrs: { value: 2800 } })
    expect(controller.setLink('example.com')).toBe(true)
    expect(controller.formatState().link).toBe('https://example.com')
    const formatted = await exportedSlide(controller.doc, assets)
    expect(formatted.xml).toMatch(/<a:rPr[^>]*baseline="30000"[^>]*sz="6600"|<a:rPr[^>]*sz="6600"[^>]*baseline="30000"/)
    expect(formatted.xml).toMatch(/<a:highlight><a:srgbClr val="FFFF00"\/><\/a:highlight>/)
    const relId = /<a:hlinkClick[^>]*r:id="(rId\d+)"/.exec(formatted.xml)?.[1]
    expect(relId).toBeDefined()
    expect(formatted.rels).toMatch(new RegExp(`Id="${relId}"[^>]*Target="https://example.com"[^>]*TargetMode="External"`))
    if (fidelityAvailable()) {
      const file = writeScratch(scratchDir(), 'text-commands.pptx', formatted.bytes)
      const read = JSON.parse(runPython('import sys, json\nfrom pptx import Presentation\nr=Presentation(sys.argv[1]).slides[0].shapes[0].text_frame.paragraphs[0].runs[0]\nprint(json.dumps([r.font.size.pt, r.hyperlink.address, r.font._rPr.get("baseline")]))', file))
      expect(read).toEqual([66, 'https://example.com', '30000'])
    }
    // Clear formatting keeps the link and drops the rest.
    controller.clearFormatting()
    const cleared = firstRuns(controller, slide, title)[0]!.marks!.map((mark) => mark.type)
    expect(cleared).toEqual(['link'])
    expect(controller.formatState()).toMatchObject({ fontSize: 60, baseline: 'none' })
    controller.setLink(undefined)
    expect(firstRuns(controller, slide, title)[0]!.marks ?? []).toEqual([])
    // Unsafe schemes are refused.
    expect(controller.setLink('javascript:alert(1)')).toBe(false)
  })

  it('adds, renames, and removes sections through the controller, each one undo step', async () => {
    const { controller, doc, assets } = await open()
    controller.addSlide()
    controller.addSlide()
    const [, second] = controller.slideKeys()
    const key = controller.addSection('Appendix', second)!
    expect(controller.sections().map((section) => [section.name, section.firstSlide])).toEqual([['Default Section', controller.slideKeys()[0]], ['Appendix', second]])
    controller.renameSection(key, 'Backup')
    const bytes = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    const { strFromU8, unzipSync } = await import('fflate')
    expect(strFromU8(unzipSync(bytes)['ppt/presentation.xml']!)).toMatch(/<p14:section name="Backup"/)
    controller.removeSection(key)
    expect(controller.sections().map((section) => section.name)).toEqual(['Default Section'])
    controller.undo()
    expect(controller.sections().map((section) => section.name)).toEqual(['Default Section', 'Backup'])
    // Every slide selected at once.
    controller.selectAllSlides()
    expect(controller.state.slides).toEqual(controller.slideKeys())
  })

  it('flips, rotates, aligns and distributes to the slide, and changes shapes', async () => {
    const { controller, doc, assets } = await open()
    const slide = controller.state.slide!
    const width = controller.size().width * EMU_PER_PX
    const a = controller.insertShape('rect', { x: 100_000, y: 100_000, cx: 1_000_000, cy: 500_000, rot: 1_800_000 })!
    controller.flip('horizontal')
    expect(controller.shapeXfrm(slide, a)).toMatchObject({ flipH: true, rot: 19_800_000 })
    controller.flip('horizontal')
    expect(controller.shapeXfrm(slide, a)).toMatchObject({ rot: 1_800_000 })
    expect(controller.shapeXfrm(slide, a)!.flipH).toBeFalsy()
    controller.flip('vertical')
    expect(controller.shapeXfrm(slide, a)).toMatchObject({ flipV: true, rot: 19_800_000 })
    for (let turn = 0; turn < 4; turn++) controller.rotateBy(90)
    expect(controller.shapeXfrm(slide, a)!.rot).toBe(19_800_000)
    controller.rotateBy(30)
    expect(controller.shapeXfrm(slide, a)!.rot).toBeUndefined()
    const b = controller.insertShape('ellipse', { x: 3_000_000, y: 2_000_000, cx: 2_000_000, cy: 500_000 })!
    controller.selectShapes([a, b])
    controller.align('center', 'slide')
    for (const key of [a, b]) {
      const xfrm = controller.shapeXfrm(slide, key)!
      expect(Math.round(xfrm.x + xfrm.cx / 2)).toBe(Math.round(width / 2))
    }
    // Centered, the wider ellipse starts further left: it goes to the left edge.
    controller.distribute('horizontal', 'slide')
    expect(controller.shapeXfrm(slide, b)!.x).toBe(0)
    expect(Math.round(controller.shapeXfrm(slide, a)!.x + 1_000_000)).toBe(Math.round(width))
    // A table stays upright.
    const table = controller.insertTable(2, 2)!
    controller.selectShapes([table])
    controller.rotateBy(90)
    controller.flip('horizontal')
    expect(controller.shapeXfrm(slide, table)).not.toHaveProperty('rot')
    // Change Shape keeps the text.
    controller.selectShapes([a])
    setShapeText(doc, slide, a, plainToText('Kept'), LOCAL_ORIGIN)
    controller.changeShape('ellipse')
    const { xml } = await exportedSlide(doc, assets)
    expect(xml).toMatch(/<p:sp>(?:(?!<\/p:sp>).)*prst="ellipse"(?:(?!<\/p:sp>).)*Kept/s)
  })

  it('draws arrows and edits outlines without losing their arrowheads', async () => {
    const { controller, doc, assets } = await open()
    const slide = controller.state.slide!
    const arrow = controller.insertShape('straightConnector1', undefined, { tail: 'triangle' })!
    expect(controller.shape(slide, arrow)!.line).toMatch(/<a:tailEnd type="triangle"\/>/)
    expect(controller.shape(slide, arrow)!.line).not.toMatch(/headEnd/)
    controller.editLine(lineEdits.width(38_100), lineEdits.dash('dash'))
    controller.editLine(lineEdits.fill('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'), lineEdits.headEnd('oval', { w: 'lg', len: 'lg' }))
    const line = controller.shape(slide, arrow)!.line!
    expect(line).toMatch(/^<a:ln [^>]*w="38100"/)
    expect(line.indexOf('solidFill')).toBeLessThan(line.indexOf('prstDash'))
    expect(line.indexOf('prstDash')).toBeLessThan(line.indexOf('headEnd'))
    expect(line.indexOf('headEnd')).toBeLessThan(line.indexOf('tailEnd'))
    controller.editLine(lineEdits.dash('solid'), lineEdits.headEnd(undefined))
    expect(controller.shape(slide, arrow)!.line).toMatch(/^<a:ln[^>]*><a:solidFill><a:srgbClr val="FF0000"\/><\/a:solidFill><a:tailEnd type="triangle"\/><\/a:ln>$/)
    const both = controller.insertShape('straightConnector1', undefined, { head: 'triangle', tail: 'triangle' })!
    expect(controller.shape(slide, both)!.line).toMatch(/headEnd type="triangle"[\s\S]*tailEnd type="triangle"/)
    const { bytes, xml } = await exportedSlide(doc, assets)
    expect(xml).toMatch(/<a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"\/><\/a:solidFill><a:tailEnd type="triangle"\/><\/a:ln>/)
    if (fidelityAvailable()) {
      const file = writeScratch(scratchDir(), 'arrows.pptx', bytes)
      const read = JSON.parse(runPython('import sys, json\nfrom pptx import Presentation\nshapes=Presentation(sys.argv[1]).slides[0].shapes\nprint(json.dumps([shapes[-2].line.width, str(shapes[-2].line.color.rgb)]))', file))
      expect(read).toEqual([38_100, 'FF0000'])
    }
  })

  it('sets text box options and keeps the rest of the body properties', async () => {
    const { controller, doc, assets } = await open()
    const slide = controller.state.slide!
    const title = controller.slide(slide)!.shapes[0]!.key
    controller.selectShapes([title])
    controller.setTextAnchor('b')
    controller.setTextInsets({ l: 0, t: 91_440 })
    controller.setTextWrap(false)
    controller.setAutofit('shape')
    expect(controller.formatState().textBox).toEqual({ anchor: 'b', autofit: 'shape', wrap: false, insets: { l: 0, t: 91_440, r: 91_440, b: 45_720 } })
    const { xml } = await exportedSlide(doc, assets)
    expect(xml).toMatch(/<a:bodyPr[^>]*anchor="b"[^>]*>.*<a:spAutoFit\/>/s)
    // A warp the file had stays, and autofit goes after it in schema order.
    setShapeProperty(doc, slide, [title], 'bodyPr', '<a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" anchor="ctr"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp><a:normAutofit fontScale="62500"/></a:bodyPr>', LOCAL_ORIGIN)
    controller.setAutofit('none')
    expect(controller.shape(slide, title)!.bodyPr).toMatch(/anchor="ctr"><a:prstTxWarp prst="textArchUp"><a:avLst\/><\/a:prstTxWarp><a:noAutofit\/><\/a:bodyPr>$/)
    expect(controller.formatState().textBox?.autofit).toBe('none')
  })
})
