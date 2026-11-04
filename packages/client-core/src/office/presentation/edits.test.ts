import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from './blank.js'
import { presentationCodec } from './codec.js'
import {
  addImagePart,
  addSection,
  addSlide,
  deleteShapes,
  deleteSlides,
  deleteTableColumns,
  duplicateSlides,
  setNotesText,
  groupShapes,
  insertShapes,
  insertTableColumn,
  insertTableRow,
  mapOutOfGroup,
  moveSlides,
  pictureShape,
  presetShape,
  readXfrm,
  reorderShapes,
  setShapeProperty,
  setShapeText,
  setSlideHidden,
  setSlideLayout,
  setXfrm,
  slideKeys,
  tableShape,
  textBox,
  ungroupShape,
} from './commands.js'
import type { PresentationSnapshot } from './model.js'
import { DeckResources } from './render/deck.js'
import { plainToText, textToPlain } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { fidelityAvailable, fixture, runPython, runTool, scratchDir, writeScratch } from './testing/fixtures.js'
import { readSnapshot } from './ydoc.js'

const LOCAL = { local: true }

async function open(bytes: Uint8Array, name = 'deck.pptx') {
  const assets = memoryAssets()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, { name, assets })
  return { doc, assets, context: { name, assets } }
}

function deck(doc: Y.Doc): DeckResources {
  const snapshot = readSnapshot(doc)
  return new DeckResources(snapshot.parts, snapshot.mainPart)
}

function slideText(snapshot: PresentationSnapshot, index: number): string[] {
  return snapshot.slides[index]!.shapes.map((shape) => (shape.text ? textToPlain(shape.text) : ''))
}

function layoutNamed(doc: Y.Doc, name: string): string {
  const resources = deck(doc)
  for (const master of resources.masterPaths()) {
    for (const layout of resources.master(master)!.layouts) if (resources.layout(layout)?.name === name) return layout
  }
  throw new Error(`No layout ${name}`)
}

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
)

describe('editing a presentation', () => {
  it('writes edits made through commands and reads them back', async () => {
    const { doc, assets, context } = await open(blankPresentation())
    const [first] = slideKeys(doc)
    const titleKey = readSnapshot(doc).slides[0]!.shapes[0]!.key
    setShapeText(doc, first!, titleKey, plainToText('Quarterly review'), LOCAL)

    const content = addSlide(doc, deck(doc), layoutNamed(doc, 'Title and Content'), 1, LOCAL)
    const [title, body] = readSnapshot(doc).slides[1]!.shapes
    setShapeText(doc, content, title!.key, plainToText('Agenda'), LOCAL)
    setShapeText(doc, content, body!.key, plainToText('Results\nPlans'), LOCAL)

    const [rectangle] = insertShapes(doc, content, [presetShape('rightArrow', { x: 914400, y: 914400, cx: 1828800, cy: 914400 }, 'Arrow 3')], LOCAL)
    setShapeProperty(doc, content, [rectangle!], 'fill', '<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="FF0000"/></a:solidFill>', LOCAL)
    setXfrm(doc, content, rectangle!, { x: 1000000, rot: 5400000 }, LOCAL)
    insertShapes(doc, content, [textBox({ x: 0, y: 6000000, cx: 3000000, cy: 400000 }, 'TextBox 4', 'Footnote')], LOCAL)
    const asset = await assets.put(PNG, 'image/png')
    const media = addImagePart(doc, asset, LOCAL)
    insertShapes(doc, content, [pictureShape(media, { x: 6000000, y: 2000000, cx: 914400, cy: 914400 }, 'Picture 5', 'Tiny')], LOCAL)
    const [table] = insertShapes(doc, content, [tableShape(2, 3, { x: 6000000, y: 4000000, cx: 3000000, cy: 800000 }, 'Table 6')], LOCAL)
    insertTableRow(doc, content, table!, 2, LOCAL)
    insertTableColumn(doc, content, table!, 0, LOCAL)
    setNotesText(doc, content, plainToText('Remember the demo'), LOCAL)

    const out = await presentationCodec.exportFile(doc, context)
    const reread = await open(out)
    const snapshot = readSnapshot(reread.doc)
    expect(snapshot.slides.length).toBe(2)
    expect(slideText(snapshot, 0)[0]).toBe('Quarterly review')
    expect(slideText(snapshot, 1).slice(0, 2)).toEqual(['Agenda', 'Results\nPlans'])
    const arrow = snapshot.slides[1]!.shapes[2]!
    expect(arrow.geom).toContain('rightArrow')
    expect(arrow.fill).toContain('FF0000')
    expect(arrow.xfrm).toMatchObject({ x: 1000000, y: 914400, rot: 5400000 })
    expect(textToPlain(snapshot.slides[1]!.shapes[3]!.text!)).toBe('Footnote')
    const picture = snapshot.slides[1]!.shapes[4]!
    expect(Object.values(picture.rels)[0]!.target).toBe(media)
    expect(await reread.assets.get(snapshot.parts[media]!.asset!.hash)).toEqual(PNG)
    const tableShapeSnapshot = snapshot.slides[1]!.shapes[5]!
    expect(tableShapeSnapshot.table!.rows.length).toBe(3)
    expect(tableShapeSnapshot.table!.columns.length).toBe(4)
    expect(textToPlain(snapshot.slides[1]!.notes!.text)).toBe('Remember the demo')
    // Ids stay unique per slide.
    const ids = snapshot.slides[1]!.shapes.map((shape) => shape.nvId)
    expect(new Set(ids).size).toBe(ids.length)

    if (fidelityAvailable()) {
      const directory = scratchDir()
      const file = writeScratch(directory, 'edited.pptx', out)
      const report = JSON.parse(
        runPython(
          `import sys, json
from pptx import Presentation
p = Presentation(sys.argv[1])
out = []
for s in p.slides:
    out.append({"layout": s.slide_layout.name, "shapes": [{"name": sh.name, "text": sh.text_frame.text if sh.has_text_frame else None, "left": sh.left, "rot": sh.rotation, "table": [len(sh.table.rows), len(sh.table.columns)] if sh.has_table else None} for sh in s.shapes], "notes": s.has_notes_slide})
print(json.dumps(out))`,
          file,
        ),
      )
      expect(report[1].layout).toBe('Title and Content')
      expect(report[1].shapes[0].text).toBe('Agenda')
      expect(report[1].shapes[1].text).toBe('Results\nPlans')
      expect(report[1].shapes[2]).toMatchObject({ left: 1000000, rot: 90 })
      expect(report[1].shapes[5].table).toEqual([3, 4])
      expect(report[1].notes).toBe(true)
      runTool('lo_open_check.sh', [file])
    }
  }, 120_000)

  it('leaves untouched slides byte for byte when another slide changes', async () => {
    const original = fixture('generated/layouts-notes-sections.pptx')
    const { doc, context } = await open(original)
    const keys = slideKeys(doc)
    const title = readSnapshot(doc).slides[1]!.shapes.find((shape) => shape.text)!
    setShapeText(doc, keys[1]!, title.key, plainToText('Changed'), LOCAL)
    const before = unzipSync(original)
    const after = unzipSync(await presentationCodec.exportFile(doc, context))
    const changed = Object.keys(before).filter((name) => !Buffer.from(after[name] ?? []).equals(Buffer.from(before[name]!)))
    expect(changed).toEqual(['ppt/slides/slide2.xml'])
  })

  it('reorders, duplicates, hides, deletes slides, and keeps sections in order', async () => {
    const { doc, context } = await open(fixture('generated/layouts-notes-sections.pptx'))
    const keys = slideKeys(doc)
    const texts = (snapshot: PresentationSnapshot) => snapshot.slides.map((slide) => slide.shapes.map((shape) => (shape.text ? textToPlain(shape.text) : '')).join('|'))
    const originalTexts = texts(readSnapshot(doc))
    moveSlides(doc, [keys[0]!], 3, LOCAL)
    const [copy] = duplicateSlides(doc, [keys[2]!], LOCAL)
    setSlideHidden(doc, [copy!], true, LOCAL)
    deleteSlides(doc, [keys[5]!], LOCAL)
    const out = await presentationCodec.exportFile(doc, context)
    const snapshot = readSnapshot((await open(out)).doc)
    const expected = [...originalTexts]
    const [moved] = expected.splice(0, 1)
    expected.splice(3, 0, moved!)
    expected.splice(expected.indexOf(originalTexts[2]!) + 1, 0, originalTexts[2]!)
    expected.splice(expected.indexOf(originalTexts[5]!), 1)
    expect(texts(snapshot)).toEqual(expected)
    expect(snapshot.slides.filter((slide) => slide.hidden).length).toBe(2)
    // Every slide is in exactly one section, and sections are contiguous runs.
    const runs = snapshot.slides.map((slide) => slide.section)
    expect(runs.every(Boolean)).toBe(true)
    // Duplicated notes got their own part.
    const notesParts = snapshot.slides.flatMap((slide) => (slide.notes?.part ? [slide.notes.part] : []))
    expect(new Set(notesParts).size).toBe(notesParts.length)
  })

  it('groups and ungroups without moving anything', async () => {
    const { doc } = await open(blankPresentation())
    const [slide] = slideKeys(doc)
    const keys = insertShapes(
      doc,
      slide!,
      [presetShape('rect', { x: 100, y: 200, cx: 1000, cy: 500 }, 'A'), presetShape('ellipse', { x: 2000, y: 1000, cx: 500, cy: 500, rot: 1800000 }, 'B')],
      LOCAL,
    )
    const xfrms = new Map(keys.map((key) => [key, readXfrm(doc, slide!, key)!]))
    const group = groupShapes(doc, slide!, keys, xfrms, 'Group 1', LOCAL)!
    expect(readXfrm(doc, slide!, group)).toMatchObject({ x: 100, y: 200, cx: 2400, cy: 1300, chX: 100, chY: 200 })
    expect(readSnapshot(doc).slides[0]!.shapes.at(-1)!.children!.map((shape) => shape.key)).toEqual(keys)
    // Move and scale the group, then ungroup: members follow.
    setXfrm(doc, slide!, group, { x: 1100, cx: 4800 }, LOCAL)
    const members = ungroupShape(doc, slide!, group, LOCAL)
    expect(members).toEqual(keys)
    expect(readXfrm(doc, slide!, keys[0]!)).toMatchObject({ x: 1100, y: 200, cx: 2000, cy: 500 })
    expect(readXfrm(doc, slide!, keys[1]!)).toMatchObject({ x: 1100 + 1900 * 2, cx: 1000, rot: 1800000 })
    reorderShapes(doc, slide!, [keys[1]!], 'back', LOCAL)
    expect(readSnapshot(doc).slides[0]!.shapes.at(0)!.key).toBe(keys[1])
  })

  it('maps members out of rotated and flipped groups', () => {
    const group = { x: 0, y: 0, cx: 200, cy: 100, chX: 0, chY: 0, chCx: 200, chCy: 100, rot: 5400000 }
    const mapped = mapOutOfGroup({ x: 0, y: 0, cx: 100, cy: 100 }, group)
    // The left half of a 200×100 group turned 90° about its center ends up in the top half.
    expect(Math.round(mapped.x)).toBe(50)
    expect(Math.round(mapped.y)).toBe(-50)
    expect(mapped.rot).toBe(5400000)
    const flipped = mapOutOfGroup({ x: 0, y: 0, cx: 50, cy: 100, rot: 600000 }, { ...group, rot: 0, flipH: true })
    expect(flipped).toMatchObject({ x: 150, flipH: true, rot: 21_000_000 })
  })

  it('changes a slide layout and keeps orphaned placeholders in place', async () => {
    const { doc, context } = await open(blankPresentation())
    const key = addSlide(doc, deck(doc), layoutNamed(doc, 'Two Content'), 1, LOCAL)
    setSlideLayout(doc, deck(doc), key, layoutNamed(doc, 'Title Only'), LOCAL)
    const slide = readSnapshot(doc).slides[1]!
    expect(slide.shapes[0]!.xfrm).toBeUndefined()
    expect(slide.shapes[2]!.xfrm).toMatchObject({ x: 6172200, y: 1825625 })
    const snapshot = readSnapshot((await open(await presentationCodec.exportFile(doc, context))).doc)
    expect(snapshot.slides[1]!.layout).toBe(layoutNamed(doc, 'Title Only'))
  })

  it('deletes table columns and shapes', async () => {
    const { doc } = await open(blankPresentation())
    const [slide] = slideKeys(doc)
    const [table] = insertShapes(doc, slide!, [tableShape(2, 3, { x: 0, y: 0, cx: 3000000, cy: 800000 }, 'Table')], LOCAL)
    const columns = readSnapshot(doc).slides[0]!.shapes.at(-1)!.table!.columns
    deleteTableColumns(doc, slide!, table!, [columns[1]!.key], LOCAL)
    expect(readSnapshot(doc).slides[0]!.shapes.at(-1)!.table!.columns.length).toBe(2)
    expect(readXfrm(doc, slide!, table!)!.cx).toBe(2000000)
    deleteShapes(doc, slide!, [table!], LOCAL)
    expect(readSnapshot(doc).slides[0]!.shapes.length).toBe(2)
  })

  it('creates sections that cover the slides after them', async () => {
    const { doc, context } = await open(fixture('generated/text-formatting.pptx'))
    const keys = slideKeys(doc)
    addSection(doc, 'Second half', keys[3]!, LOCAL)
    const snapshot = readSnapshot((await open(await presentationCodec.exportFile(doc, context))).doc)
    expect(snapshot.sections.map((section) => section.name)).toEqual(['Default Section', 'Second half'])
    expect(snapshot.slides.map((slide) => snapshot.sections.findIndex((section) => section.key === slide.section))).toEqual([0, 0, 0, 1, 1, 1])
  })
})

/** An "agent edit": rewrites a package's XML the way python-pptx would (text change and a new slide copy). */
function agentEdit(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(bytes)
  edit(files)
  return zipSync(files)
}

describe('applyFile', () => {
  it('merges an agent edit with a concurrent user edit', async () => {
    const { doc: server, context } = await open(fixture('generated/layouts-notes-sections.pptx'))
    const user = new Y.Doc()
    Y.applyUpdate(user, Y.encodeStateAsUpdate(server))

    // The user edits slide 3 while the agent works on its own copy of the file.
    const userSlide = slideKeys(user)[2]!
    const userShape = readSnapshot(user).slides[2]!.shapes.find((shape) => shape.text)!
    setShapeText(user, userSlide, userShape.key, plainToText('User wrote this'), LOCAL)

    const pulled = await presentationCodec.exportFile(server, context)
    const pushed = agentEdit(pulled, (files) => {
      files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace(/<a:t>[^<]*<\/a:t>/, '<a:t>Agent title</a:t>'))
    })
    const result = await presentationCodec.applyFile(server, pushed, context, 'agent')
    expect(result.changed).toBe(true)

    Y.applyUpdate(user, Y.encodeStateAsUpdate(server))
    Y.applyUpdate(server, Y.encodeStateAsUpdate(user))
    const merged = readSnapshot(server)
    expect(slideText(merged, 0).join('|')).toContain('Agent title')
    expect(slideText(merged, 2).join('|')).toContain('User wrote this')
    expect(presentationCodec.toText(user)).toBe(presentationCodec.toText(server))
  })

  it('is a no-op for the file the document would export', async () => {
    const { doc, context } = await open(fixture('poi/shapes.pptx'))
    const bytes = await presentationCodec.exportFile(doc, context)
    const before = Y.encodeStateVector(doc)
    expect((await presentationCodec.applyFile(doc, bytes, context)).changed).toBe(false)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it('keeps keys of slides and shapes the document created when the file comes back', async () => {
    const { doc, context } = await open(blankPresentation())
    const key = addSlide(doc, deck(doc), layoutNamed(doc, 'Title and Content'), 1, LOCAL)
    const [shape] = insertShapes(doc, key, [presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'Box')], LOCAL)
    const bytes = await presentationCodec.exportFile(doc, context)
    const edited = agentEdit(bytes, (files) => {
      files['ppt/slides/slide2.xml'] = strToU8(strFromU8(files['ppt/slides/slide2.xml']!).replace('name="Box"', 'name="Renamed box"'))
    })
    await presentationCodec.applyFile(doc, edited, context)
    expect(slideKeys(doc)[1]).toBe(key)
    const shapes = readSnapshot(doc).slides[1]!.shapes
    expect(shapes.find((entry) => entry.key === shape)?.name).toBe('Renamed box')
  })

  it.runIf(fidelityAvailable())('merges a python-pptx edit', async () => {
    const { doc, context } = await open(fixture('generated/text-formatting.pptx'))
    const directory = scratchDir()
    const file = writeScratch(directory, 'pulled.pptx', await presentationCodec.exportFile(doc, context))
    runPython(
      `import sys
from pptx import Presentation
from pptx.util import Inches
p = Presentation(sys.argv[1])
p.slides[0].shapes.title.text = "Edited by python-pptx"
s = p.slides.add_slide(p.slide_layouts[1])
s.shapes.title.text = "New agent slide"
s.shapes.add_textbox(Inches(1), Inches(5), Inches(3), Inches(1)).text_frame.text = "box"
p.save(sys.argv[1])`,
      file,
    )
    const { readFileSync } = await import('node:fs')
    await presentationCodec.applyFile(doc, new Uint8Array(readFileSync(file)), context)
    const snapshot = readSnapshot(doc)
    expect(slideText(snapshot, 0)[0]).toBe('Edited by python-pptx')
    expect(slideText(snapshot, snapshot.slides.length - 1)).toContain('New agent slide')
    runTool('lo_open_check.sh', [writeScratch(directory, 'roundtrip.pptx', await presentationCodec.exportFile(doc, context))])
  }, 120_000)
})
