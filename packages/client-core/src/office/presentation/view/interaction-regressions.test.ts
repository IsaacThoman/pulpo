import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from '../blank.js'
import { copyContent } from '../clipboard.js'
import { presentationCodec } from '../codec.js'
import { groupShapes, insertShapes, presetShape, readSlide, readXfrm, tableShape } from '../commands.js'
import { memoryAssets } from '../testing/assets.js'
import { fidelityAvailable, fixture, runPython, scratchDir, writeScratch } from '../testing/fixtures.js'
import { readSnapshot } from '../ydoc.js'
import { PresentationController } from './controller.js'

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

describe('presentation interaction regressions', () => {
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
})
