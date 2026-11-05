import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { LiveFormatError } from '../live-format.js'
import { resolveTarget } from '../ooxml/package.js'
import { blankPresentation } from './blank.js'
import { copyContent, documentIdentity, parseClipboard, pasteShapes, pasteSlides } from './clipboard.js'
import { presentationCodec } from './codec.js'
import {
  addImagePart,
  cellFragment,
  insertSlides,
  deleteShapes,
  deleteSlides,
  deleteTableColumns,
  deleteTableRows,
  duplicateSlides,
  groupShapes,
  insertShapes,
  insertTableColumn,
  insertTableRow,
  moveSlides,
  pictureShape,
  presetShape,
  readShapes,
  readSlide,
  readXfrm,
  reorderShapes,
  setNotesText,
  setShapeText,
  setXfrm,
  shapeFragment,
  slideKeys,
  tableShape,
  ungroupShape,
} from './commands.js'
import { diffFiles, diffSnapshots } from './diff.js'
import type { ShapeSnapshot } from './model.js'
import { DEFAULT_PRESENTATION_LIMITS } from './read.js'
import { DeckResources } from './render/deck.js'
import { renderSlide } from './render/slide.js'
import { plainToText, textToPlain } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { fidelityAvailable, fixture, runPython, scratchDir, writeScratch } from './testing/fixtures.js'
import { LOCAL_ORIGIN, PresentationController } from './view/controller.js'
import { NotesEditor } from './view/notes.js'
import { remoteCaret, remoteSelection, validCursorState } from './view/text-editor.js'
import { presentationRoot, readSnapshot, setPart } from './ydoc.js'
import { REL_TYPES } from './xml.js'

/** Regressions from the second review: each case reproduces a reported data-loss, collaboration, or security bug. */

const assets = memoryAssets()
const context = { name: 'deck.pptx', assets }

async function open(bytes: Uint8Array) {
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, context)
  return doc
}

const exportBytes = (doc: Y.Doc) => presentationCodec.exportFile(doc, context)
const exported = async (doc: Y.Doc) => unzipSync(await exportBytes(doc))

function replica(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

function sync(...docs: Y.Doc[]): void {
  for (const from of docs) for (const to of docs) if (from !== to) Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
}

/** Internal relationships whose target part is missing. */
function danglingRelationships(files: Record<string, Uint8Array>): string[] {
  const dangling: string[] = []
  for (const [path, data] of Object.entries(files)) {
    const match = /^(.*?)_rels\/([^/]+)\.rels$/.exec(path)
    if (!match) continue
    const source = `${match[1]}${match[2]}`
    for (const [, attributes] of strFromU8(data).matchAll(/<Relationship ([^>]*)\/>/g)) {
      if (/TargetMode="External"/.test(attributes!)) continue
      const target = /Target="([^"]*)"/.exec(attributes!)?.[1] ?? ''
      if (target.startsWith('#') || target === 'NULL') continue
      if (!files[resolveTarget(source, target)]) dangling.push(`${path} → ${resolveTarget(source, target)}`)
    }
  }
  return dangling
}

function slideXml(files: Record<string, Uint8Array>, index: number): string {
  return strFromU8(files[`ppt/slides/slide${index}.xml`]!)
}

/** Opens the file with python-pptx (when the fidelity tools are on), else just re-imports it. */
async function opensCleanly(bytes: Uint8Array): Promise<void> {
  await open(bytes)
  if (fidelityAvailable()) {
    const file = writeScratch(scratchDir(), 'check.pptx', bytes)
    expect(runPython('import sys\nfrom pptx import Presentation\np = Presentation(sys.argv[1])\nprint(sum(len(s.shapes) for s in p.slides))', file)).toMatch(/^\d+/)
  }
}

function controllerFor(doc: Y.Doc) {
  return new PresentationController({ doc, readOnly: false, assets, user: { name: 'A', color: '#ff0000' } })
}

describe('second review: data loss and corruption', () => {
  it('keeps parts a slide still uses when the document’s own export comes back, so undoing a slide deletion keeps its chart', async () => {
    const doc = await open(fixture('generated/charts.pptx'))
    const controller = controllerFor(doc)
    const slide = slideKeys(doc)[0]!
    controller.deleteSlides([slide])
    const pushed = await exportBytes(doc)
    await presentationCodec.applyFile(doc, pushed, context, 'agent')
    expect((await presentationCodec.applyFile(doc, pushed, context, 'agent')).changed).toBe(false)
    controller.undo()
    expect(slideKeys(doc)[0]).toBe(slide)
    expect(danglingRelationships(await exported(doc))).toEqual([])
    controller.destroy()
  })

  it('renders SmartArt whose drawing includes itself without freezing', async () => {
    const files = unzipSync(fixture('poi/SmartArt.pptx'))
    const frame =
      '<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="9" name="x"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:dm="rIdD" r:lo="rIdD" r:qs="rIdD" r:cs="rIdD"/></a:graphicData></a:graphic></p:graphicFrame>'
    files['ppt/diagrams/drawing1.xml'] = strToU8(strFromU8(files['ppt/diagrams/drawing1.xml']!).replace('<dsp:grpSpPr/>', `<dsp:grpSpPr/>${frame.repeat(4)}`))
    files['ppt/diagrams/_rels/drawing1.xml.rels'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdD" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="data1.xml"/><Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="drawing1.xml"/></Relationships>',
    )
    const doc = await open(zipSync(files))
    const snapshot = readSnapshot(doc)
    const started = Date.now()
    const html = renderSlide(snapshot.slides[0]!, snapshot, { deck: new DeckResources(snapshot.parts, snapshot.mainPart), slideNumber: 1, mode: 'view', assetUrl: () => undefined, idPrefix: 't' })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(html.length).toBeLessThan(5_000_000)
  })

  it('never puts a slide key into SVG ids unescaped', () => {
    const snapshot = { slideWidth: 9_144_000, slideHeight: 6_858_000 }
    const fill = '<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst></a:gradFill>'
    const shape: ShapeSnapshot = { ...presetShape('rect', { x: 0, y: 0, cx: 100_000, cy: 100_000 }, 'R'), fill }
    const slide = { key: 'k"/><img src=x onerror=alert(1)>', layout: '', hidden: false, xml: '', rels: {}, shapes: [shape] }
    const deck = new DeckResources({}, 'ppt/presentation.xml')
    const html = renderSlide(slide, snapshot, { deck, slideNumber: 1, mode: 'view', assetUrl: () => undefined, idPrefix: `thumb-${slide.key}` })
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/ id="[^"]*[<>]/)
    expect(html).toMatch(/url\(#thumb-k[\w-]+\)/)
  })

  it('keeps two people’s pastes from different decks apart, and writes pasted charts with their content type', async () => {
    const sourceA = await open(fixture('generated/pictures.pptx'))
    const sourceB = await open(fixture('generated/charts.pptx'))
    const picture = readSnapshot(sourceA).slides.flatMap((slide) => slide.shapes).find((shape) => shape.kind === 'pic')!
    const chart = readSnapshot(sourceB).slides.flatMap((slide) => slide.shapes).find((shape) => Object.values(shape.rels).some((rel) => rel.type === REL_TYPES.chart))!
    const clipA = parseClipboard(JSON.stringify(await copyContent(sourceA, assets, { shapes: [picture] }, '')))!
    const clipB = parseClipboard(JSON.stringify(await copyContent(sourceB, assets, { shapes: [chart] }, '')))!
    // Make both clipboards hold a part of the same name, as two decks' "image1.png" would.
    const target = await open(blankPresentation())
    const alice = replica(target)
    const bob = replica(target)
    const slide = slideKeys(target)[0]!
    await pasteShapes(alice, assets, clipA, slide, 0, LOCAL_ORIGIN)
    await pasteShapes(bob, assets, clipB, slide, 0, LOCAL_ORIGIN)
    sync(alice, bob)
    const files = await exported(alice)
    expect(danglingRelationships(files)).toEqual([])
    const pictures = readSnapshot(alice).slides[0]!.shapes.filter((shape) => shape.kind === 'pic')
    const media = Object.values(pictures[0]!.rels).find((rel) => rel.type === REL_TYPES.image)!.target
    expect(Buffer.from(files[media]!).equals(Buffer.from(await assets.get(readSnapshot(sourceA).parts[Object.values(picture.rels).find((rel) => rel.type === REL_TYPES.image)!.target]!.asset!.hash)))).toBe(true)
    const types = strFromU8(files['[Content_Types].xml']!)
    const chartPart = Object.keys(files).find((path) => /^ppt\/charts\/[^/]+\.xml$/.test(path))!
    expect(types).toContain(`PartName="/${chartPart}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"`)
    await opensCleanly(await exportBytes(alice))
  })

  it('agrees on the document identity across replicas, so pasting into the same deck reuses its parts', async () => {
    const doc = await open(fixture('generated/pictures.pptx'))
    const other = replica(doc)
    expect(documentIdentity(other)).toBe(documentIdentity(doc))
    const picture = readSnapshot(doc).slides[0]!.shapes.find((shape) => shape.kind === 'pic')!
    const clipboard = parseClipboard(JSON.stringify(await copyContent(doc, assets, { shapes: [picture] }, '')))!
    const before = presentationRoot(other).get('parts') as Y.Map<unknown>
    const count = before.size
    await pasteShapes(other, assets, clipboard, slideKeys(other)[0]!, 100, LOCAL_ORIGIN)
    expect((presentationRoot(other).get('parts') as Y.Map<unknown>).size).toBe(count)
  })

  it('never gives a new slide the part name of a deleted slide other slides still link to', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    // Slide 1 links to slide 3 in the fixture's custom show and links; delete slide 3, then add one.
    const keys = slideKeys(doc)
    const third = readSlide(doc, keys[2]!)!
    deleteSlides(doc, [keys[2]!])
    duplicateSlides(doc, [keys[0]!])
    const snapshot = readSnapshot(doc)
    const files = await exported(doc)
    const partNames = Object.keys(files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    expect(partNames).not.toContain(third.part)
    expect(snapshot.slides.length).toBe(keys.length)
  })

  it('removes a slide’s timing when its last animated shape is deleted', async () => {
    const doc = await open(fixture('generated/layouts-notes-sections.pptx'))
    const index = readSnapshot(doc).slides.findIndex((slide) => slide.xml.includes('mainSeq'))
    expect(index).toBeGreaterThanOrEqual(0)
    const slide = readSnapshot(doc).slides[index]!
    const targets = new Set([...slide.xml.matchAll(/spid="(\d+)"/g)].map((match) => Number(match[1])))
    deleteShapes(doc, slide.key, slide.shapes.filter((shape) => targets.has(shape.nvId ?? -1)).map((shape) => shape.key))
    const out = await exported(doc)
    const part = readSnapshot(await open(await exportBytes(doc))).slides[index]!.part!
    const xml = strFromU8(out[part]!)
    expect(xml).not.toMatch(/<p:childTnLst\/>|<p:childTnLst><\/p:childTnLst>|<p:bldLst\/>|<p:bldLst><\/p:bldLst>/)
    expect(xml).not.toMatch(/spid="/)
  })

  it('replaces the font PowerPoint wrote (with panose) instead of adding a second a:latin', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const [shape] = insertShapes(doc, slide, [presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'Font')])
    const rPr = '<a:rPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" lang="en-US"><a:latin typeface="Calibri" panose="020F0502020204030204" pitchFamily="34" charset="0"/></a:rPr>'
    const text = { type: 'doc', content: [{ type: 'paragraph', attrs: { pPr: null, endRPr: null }, content: [{ type: 'text', text: 'fonts', marks: [{ type: 'font', attrs: { value: 'Georgia' } }, { type: 'rPr', attrs: { value: rPr, rels: null } }] }] }] }
    setShapeText(doc, slide, shape!, text as never)
    const xml = slideXml(await exported(doc), 1)
    const run = /<a:r><a:rPr\b[^>]*>([\s\S]*?)<\/a:rPr><a:t>fonts/.exec(xml)![1]!
    expect(run.match(/<a:latin\b/g)).toHaveLength(1)
    expect(run).toContain('typeface="Georgia"')
  })

  it('refuses pasted numbers outside the integer ranges the file format allows', () => {
    const good = presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'Good')
    const payload = {
      version: 1,
      source: 'elsewhere',
      kind: 'shapes',
      parts: {},
      shapes: [
        good,
        { ...good, key: 'nan', xfrm: { x: 'abc', y: 0, cx: 1, cy: 1 } },
        { ...good, key: 'huge', xfrm: { x: 1e300, y: 0, cx: 1, cy: 1 } },
        { ...good, key: 'id', nvId: 'abc' },
        { ...good, key: 'neg', xfrm: { x: 0, y: 0, cx: -5, cy: 1 } },
        { ...good, key: 'textgroup', kind: 'grpSp', text: plainToText('x') },
      ],
      text: '',
    }
    expect(parseClipboard(JSON.stringify(payload))!.shapes!.map((shape) => shape.key)).toEqual([good.key])
  })

  it('writes no text body into groups or pictures, so pushes stop growing them', async () => {
    const doc = await open(fixture('generated/pictures.pptx'))
    const slide = readSnapshot(doc).slides[0]!
    const picture = slide.shapes.find((shape) => shape.kind === 'pic')!
    setShapeText(doc, slide.key, picture.key, plainToText('should not stick'))
    for (let round = 0; round < 2; round++) await presentationCodec.applyFile(doc, await exportBytes(doc), context)
    expect(slideXml(await exported(doc), 1)).not.toContain('should not stick')
    expect(slideXml(await exported(doc), 1).match(/<p:pic>[\s\S]*?<\/p:pic>/g)!.join('')).not.toContain('txBody')
  })

  it('keeps a concurrent group when someone else brings a shape to front, and deleting the group leaves others’ shapes', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const [a, b, c] = insertShapes(doc, slide, ['A', 'B', 'C'].map((name, index) => presetShape('rect', { x: index * 100_000, y: 0, cx: 90_000, cy: 90_000 }, name)))
    const alice = replica(doc)
    const bob = replica(doc)
    const xfrms = new Map([a!, b!].map((key) => [key, readXfrm(alice, slide, key)!]))
    const group = groupShapes(alice, slide, [a!, b!], xfrms, 'Group')!
    reorderShapes(bob, slide, [c!], 'back')
    sync(alice, bob)
    const shapes = readSlide(alice, slide)!.shapes
    expect(shapes.find((shape) => shape.key === group)?.children?.map((member) => member.key)).toEqual([a, b])
    expect(shapes.map((shape) => shape.key).filter((key) => [a, b, c, group].includes(key))).toEqual([c, group])
    // Bob's copy, which still listed `a` at the top level, must not resurrect it outside the group.
    expect(JSON.stringify(readSnapshot(bob).slides[0]!.shapes)).toBe(JSON.stringify(readSnapshot(alice).slides[0]!.shapes))
  })

  it('clears a member’s rotation and flips when ungrouping a flipped, rotated group', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const [a, b] = insertShapes(doc, slide, ['A', 'B'].map((name, index) => presetShape('rect', { x: index * 200_000, y: 0, cx: 100_000, cy: 100_000 }, name)))
    setXfrm(doc, slide, a!, { rot: 30 * 60000 })
    const group = groupShapes(doc, slide, [a!, b!], new Map([a!, b!].map((key) => [key, readXfrm(doc, slide, key)!])), 'G')!
    setXfrm(doc, slide, group, { rot: 330 * 60000, flipH: true })
    ungroupShape(doc, slide, group)
    // Member rotation 30° under a horizontal flip becomes −30°, plus the group's 330° → 300°.
    expect(readXfrm(doc, slide, a!)!.rot).toBe(300 * 60000)
    setXfrm(doc, slide, a!, { flipH: false })
    const g2 = groupShapes(doc, slide, [a!, b!], new Map([a!, b!].map((key) => [key, readXfrm(doc, slide, key)!])), 'G2')!
    setXfrm(doc, slide, a!, { rot: 30 * 60000 })
    setXfrm(doc, slide, g2, { rot: 30 * 60000, flipH: true })
    ungroupShape(doc, slide, g2)
    const xfrm = readXfrm(doc, slide, a!)!
    expect(xfrm.rot ?? 0).toBe(0)
    expect(xfrm.flipH).toBe(true)
  })

  it('keeps merged cells valid when inserting and deleting rows and columns inside them', async () => {
    const doc = await open(fixture('generated/tables.pptx'))
    const slideIndex = readSnapshot(doc).slides.findIndex((slide) => slide.shapes.some((shape) => shape.table && JSON.stringify(shape.table).includes('gridSpan')))
    const slide = readSnapshot(doc).slides[slideIndex]!
    const table = slide.shapes.find((shape) => shape.table && JSON.stringify(shape.table).includes('gridSpan'))!
    const anchorRow = table.table!.rows.findIndex((row) => Object.values(row.cells).some((cell) => (cell.gridSpan ?? 1) > 1 && !cell.hMerge))
    const anchorColumn = table.table!.columns.findIndex((column) => (table.table!.rows[anchorRow]!.cells[column.key]!.gridSpan ?? 1) > 1)
    const anchorText = textToPlain(table.table!.rows[anchorRow]!.cells[table.table!.columns[anchorColumn]!.key]!.text)
    insertTableColumn(doc, slide.key, table.key, anchorColumn + 1)
    const added = insertTableRow(doc, slide.key, table.key, table.table!.rows.length - 1)!
    deleteTableColumns(doc, slide.key, table.key, [table.table!.columns[anchorColumn]!.key])
    // A row inside a vertical merge: its anchor spans one row less.
    const merged = table.table!.rows.findIndex((row) => Object.values(row.cells).some((cell) => cell.vMerge && !cell.hMerge))
    deleteTableRows(doc, slide.key, table.key, [merged >= 0 ? table.table!.rows[merged]!.key : added])
    const current = readSlide(doc, slide.key)!.shapes.find((shape) => shape.key === table.key)!.table!
    const columns = current.columns.length
    for (const [rowIndex, row] of current.rows.entries()) {
      for (const [index, column] of current.columns.entries()) {
        const cell = row.cells[column.key]!
        if (!cell.vMerge && !cell.hMerge) expect(rowIndex + (cell.rowSpan ?? 1), `rowSpan at ${rowIndex},${index}`).toBeLessThanOrEqual(current.rows.length)
      }
      let covered = 0
      for (const [index, column] of current.columns.entries()) {
        const cell = row.cells[column.key]!
        if (cell.hMerge) {
          if (!cell.vMerge) expect(covered, `row ${row.key} col ${index}`).toBeGreaterThan(0)
          covered = Math.max(0, covered - 1)
        } else {
          expect(index + (cell.gridSpan ?? 1)).toBeLessThanOrEqual(columns)
          covered = (cell.gridSpan ?? 1) - 1
        }
      }
    }
    // The merged cell's text survived deleting its first column.
    if (anchorText.trim()) expect(JSON.stringify(current)).toContain(anchorText.trim().split('\n')[0]!)
    const out = await exportBytes(doc)
    await opensCleanly(out)
    const xml = strFromU8(unzipSync(out)[readSnapshot(await open(out)).slides[slideIndex]!.part!]!)
    const rowIds = [...xml.matchAll(/rowId\b[^>]*\bval="(\d+)"/g)].map((match) => match[1])
    expect(new Set(rowIds).size).toBe(rowIds.length)
  })

  it('drops speaker-notes links to deleted slides and keeps the notes’ own slide link', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    const keys = slideKeys(doc)
    const target = readSlide(doc, keys[2]!)!.part!
    const first = readSlide(doc, keys[0]!)!
    const notes = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { pPr: null, endRPr: null }, content: [{ type: 'text', text: 'see slide three', marks: [{ type: 'link', attrs: { xml: '<a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId9" action="ppaction://hlinksldjump"/>', target, external: false, relType: REL_TYPES.slide } }] }] }],
    }
    setNotesText(doc, first.key, notes as never)
    deleteSlides(doc, [keys[2]!])
    const files = await exported(doc)
    expect(danglingRelationships(files)).toEqual([])
    const notesRels = Object.entries(files).filter(([path]) => /notesSlides\/_rels\//.test(path)).map(([, data]) => strFromU8(data))
    expect(notesRels.some((rels) => rels.includes('../slides/slide1.xml'))).toBe(true)
  })

  it('gives new shapes ids no equation or ink shape on the slide uses', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const opaque: ShapeSnapshot = { key: 'eq', kind: 'opaque', rels: {}, xml: '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a14"><p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:nvSpPr><p:cNvPr id="4" name="Equation"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></mc:Choice><mc:Fallback><p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:nvSpPr><p:cNvPr id="4" name="Equation"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></mc:Fallback></mc:AlternateContent>' }
    insertShapes(doc, slide, [opaque, presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'A'), presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'B'), presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'C')])
    const xml = slideXml(await exported(doc), 1)
    const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((match) => match[1]).filter((id) => id !== '4')
    expect(ids).not.toContain('0')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never deletes a shared image part when someone undoes inserting it', async () => {
    const doc = await open(blankPresentation())
    const controller = controllerFor(doc)
    const png = fixture('generated/pictures.pptx')
    const media = Object.entries(unzipSync(png)).find(([path]) => path.startsWith('ppt/media/'))!
    const key = await controller.insertImage(media[1], 'image/png')
    expect(key).toBeDefined()
    const other = replica(doc)
    const slide = slideKeys(other)[0]!
    const copy = readShapes(other, slide, [key!])
    insertShapes(other, slide, copy.map((shape) => ({ ...shape, key: `${shape.key}-copy` })))
    sync(doc, other)
    await new Promise((resolve) => setTimeout(resolve, 450))
    controller.undo()
    sync(doc, other)
    expect(danglingRelationships(await exported(other))).toEqual([])
    controller.destroy()
  })

  it('merges a typist’s edit into the right row when an agent deletes one row and adds another', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const { tableShape } = await import('./commands.js')
    const [table] = insertShapes(doc, slide, [tableShape(3, 2, { x: 0, y: 0, cx: 4_000_000, cy: 1_200_000 }, 'T')])
    const rows = readSlide(doc, slide)!.shapes.find((shape) => shape.key === table)!.table!
    const { cellFragment } = await import('./commands.js')
    const write = (row: number, text: string) => {
      const fragment = cellFragment(doc, slide, table!, rows.rows[row]!.key, rows.columns[0]!.key)!
      doc.transact(() => {
        fragment.delete(0, fragment.length)
        const paragraph = new Y.XmlElement('paragraph')
        paragraph.insert(0, [new Y.XmlText(text)])
        fragment.insert(0, [paragraph])
      })
    }
    write(0, 'North')
    write(1, 'South')
    write(2, 'West')
    const pulled = await exportBytes(doc)
    const user = replica(doc)
    // The user types into "South" while the agent deletes "South" and appends "East".
    const userRows = readSlide(user, slide)!.shapes.find((shape) => shape.key === table)!.table!
    const fragment = cellFragment(user, slide, table!, userRows.rows[1]!.key, userRows.columns[0]!.key)!
    ;((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(5, '!!')
    const files = unzipSync(pulled)
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    const rowsXml = [...xml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((match) => match[0])
    files['ppt/slides/slide1.xml'] = strToU8(xml.replace(rowsXml[1]!, '').replace(rowsXml[2]!, `${rowsXml[2]}${rowsXml[2]!.replace('West', 'East')}`))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    const texts = readSlide(doc, slide)!.shapes.find((shape) => shape.key === table)!.table!.rows.map((row) => textToPlain(Object.values(row.cells)[0]!.text))
    expect(texts.filter((text) => text.includes('East'))).toEqual(['East'])
    expect(texts).toContain('North')
    expect(texts).toContain('West')
  })

  it('keeps a section an agent inserts in the middle, and re-applying the same file changes nothing', async () => {
    const doc = await open(fixture('generated/layouts-notes-sections.pptx'))
    const files = unzipSync(await exportBytes(doc))
    const xml = strFromU8(files['ppt/presentation.xml']!)
    const sections = [...xml.matchAll(/<p14:section\b[\s\S]*?<\/p14:section>/g)].map((match) => match[0])
    expect(sections.length).toBeGreaterThanOrEqual(2)
    // Move the second section's first slide into a new section between the first two.
    const firstId = /<p14:sldId id="(\d+)"\/>/.exec(sections[1]!)![1]
    const shrunk = sections[1]!.replace(`<p14:sldId id="${firstId}"/>`, '')
    const added = `<p14:section name="Agenda" id="{11111111-2222-3333-4444-555555555555}"><p14:sldIdLst><p14:sldId id="${firstId}"/></p14:sldIdLst></p14:section>`
    files['ppt/presentation.xml'] = strToU8(xml.replace(sections[1]!, `${added}${shrunk}`))
    const pushed = zipSync(files)
    await presentationCodec.applyFile(doc, pushed, context, 'agent')
    const names = readSnapshot(doc).sections.map((section) => section.name)
    expect(names).toContain('Agenda')
    expect(names.length).toBe(sections.length + 1)
    expect((await presentationCodec.applyFile(doc, pushed, context, 'agent')).changed).toBe(false)
  })

  it('moves a slide into the section it is dropped in, keeping sections in slide order', async () => {
    const doc = await open(fixture('generated/layouts-notes-sections.pptx'))
    const keys = slideKeys(doc)
    const snapshot = readSnapshot(doc)
    const secondSection = snapshot.sections[1]!.key
    const firstOfSecond = snapshot.slides.find((slide) => slide.section === secondSection)!.key
    moveSlides(doc, [firstOfSecond], 0)
    expect(readSlide(doc, firstOfSecond)!.section).toBe(snapshot.sections[0]!.key)
    const xml = strFromU8((await exported(doc))['ppt/presentation.xml']!)
    const order = [...xml.matchAll(/<p:sldId id="(\d+)"/g)].map((match) => match[1])
    const sectionOrder = [...xml.matchAll(/<p14:sldId id="(\d+)"/g)].map((match) => match[1])
    expect(sectionOrder).toEqual(order)
    expect(keys.length).toBe(slideKeys(doc).length)
  })

  it('counts visible slides when inserting after two people made the same move', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    const alice = replica(doc)
    const bob = replica(doc)
    const last = slideKeys(doc).at(-1)!
    moveSlides(alice, [last], 0)
    moveSlides(bob, [last], 0)
    sync(alice, bob)
    const before = slideKeys(alice)
    const [copy] = duplicateSlides(alice, [before[2]!])
    const after = slideKeys(alice)
    expect(after.indexOf(copy!)).toBe(3)
  })

  it('does not reuse a deleted slide’s key for a different slide python-pptx gave the same id', async () => {
    const doc = await open(fixture('generated/layouts-notes-sections.pptx'))
    const snapshot = readSnapshot(doc)
    const last = snapshot.slides.at(-1)!
    const files = unzipSync(await exportBytes(doc))
    // Point the last slide at another layout with other shapes, keeping its slide id.
    const slidePath = readSnapshot(await open(zipSync(files))).slides.at(-1)!.part!
    const relsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels'
    const layouts = Object.keys(files).filter((path) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path))
    const currentLayout = last.layout.split('/').pop()!
    const otherLayout = layouts.map((path) => path.split('/').pop()!).find((name) => name !== currentLayout)!
    files[relsPath] = strToU8(strFromU8(files[relsPath]!).replace(currentLayout, otherLayout))
    files[slidePath] = strToU8(strFromU8(files[slidePath]!).replace(/name="[^"]*"/g, 'name="Agent shape"'))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    expect(slideKeys(doc).at(-1)).not.toBe(last.key)
  })
})

describe('second review: collaborators’ carets', () => {
  it('shows only well-formed remote cursors and escapes their colors and names', () => {
    expect(validCursorState(1, 1, { cursor: { anchor: {}, head: {} } })).toBe(false)
    expect(validCursorState(1, 2, { cursor: { anchor: {}, head: {} } })).toBe(true)
    expect(validCursorState(1, 2, { cursor: 5 })).toBe(false)
    expect(validCursorState(1, 2, { cursor: { anchor: null, head: {} } })).toBe(false)
    expect(validCursorState(1, 2, null)).toBe(false)
    expect(remoteSelection({ color: 'red;position:fixed;inset:0;background:url(https://x)' }).style).toBe('background-color: #88888840')
    expect(remoteSelection({ color: '#12ab34' }).style).toBe('background-color: #12ab3440')
  })

  it('builds carets with DOM APIs only', () => {
    if (typeof document === 'undefined') return
    const caret = remoteCaret({ name: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)' })
    expect(caret.querySelector('img')).toBeNull()
    expect(caret.style.borderColor).not.toContain('url')
  })
})

describe('second review: media and image parts', () => {
  it('saves a WebP image as .webp with its own content type', async () => {
    const doc = await open(blankPresentation())
    const asset = await assets.put(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp')
    const part = addImagePart(doc, asset)
    expect(part.endsWith('.webp')).toBe(true)
    insertShapes(doc, slideKeys(doc)[0]!, [pictureShape(part, { x: 0, y: 0, cx: 100, cy: 100 }, 'Picture')])
    const types = strFromU8((await exported(doc))['[Content_Types].xml']!)
    expect(types).toContain('Extension="webp" ContentType="image/webp"')
    expect(types).not.toContain('Extension="png" ContentType="image/webp"')
  })

  it('gives a duplicated slide its own chart part and workbook', async () => {
    const doc = await open(fixture('generated/charts.pptx'))
    duplicateSlides(doc, [slideKeys(doc)[0]!])
    const files = await exported(doc)
    expect(danglingRelationships(files)).toEqual([])
    const chartsBySlide = Object.entries(files)
      .filter(([path]) => /^ppt\/slides\/_rels\//.test(path))
      .flatMap(([, data]) => [...strFromU8(data).matchAll(/Type="[^"]*\/chart" Target="([^"]*)"/g)].map((match) => match[1]))
    expect(new Set(chartsBySlide).size).toBe(chartsBySlide.length)
    await opensCleanly(await exportBytes(doc))
  })

  it('keeps hover links inside run properties pointing at their target when text moves to another slide', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const rPr = '<a:rPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" lang="en-US"><a:hlinkMouseOver r:id="rId7"/></a:rPr>'
    const text = { type: 'doc', content: [{ type: 'paragraph', attrs: { pPr: null, endRPr: null }, content: [{ type: 'text', text: 'hover', marks: [{ type: 'rPr', attrs: { value: rPr, rels: { rId7: { target: 'https://example.com/', external: true, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' } } } }] }] }] }
    const [shape] = insertShapes(doc, slide, [presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'Hover')])
    setShapeText(doc, slide, shape!, text as never)
    const files = await exported(doc)
    const xml = slideXml(files, 1)
    const id = /<a:hlinkMouseOver r:id="([^"]+)"/.exec(xml)?.[1]
    expect(id).toBeDefined()
    expect(strFromU8(files['ppt/slides/_rels/slide1.xml.rels']!)).toMatch(new RegExp(`Id="${id}"[^>]*Target="https://example.com/"|Target="https://example.com/"[^>]*Id="${id}"`))
  })

  it('unlinks slide links in slides pasted from another deck', async () => {
    const source = await open(fixture('generated/text-formatting.pptx'))
    const withLinks = readSnapshot(source).slides.find((slide) => JSON.stringify(slide).includes(REL_TYPES.slide)) ?? readSnapshot(source).slides[0]!
    const clipboard = parseClipboard(JSON.stringify(await copyContent(source, assets, { slides: [withLinks] }, '')))!
    const target = await open(blankPresentation())
    const [pasted] = await pasteSlides(target, assets, clipboard, 1)
    const slide = readSlide(target, pasted!)!
    expect(JSON.stringify(slide)).not.toMatch(/"target":"ppt\/slides\/slide\d+\.xml"/)
    expect(danglingRelationships(await exported(target))).toEqual([])
  })
})

describe('second review: present mode and the controller', () => {
  it('closes the text editor when someone else deletes the shape being edited', async () => {
    const doc = await open(blankPresentation())
    const controller = controllerFor(doc)
    const slide = slideKeys(doc)[0]!
    const shape = readSlide(doc, slide)!.shapes[0]!.key
    controller.setState({ shapes: [shape], editing: { slide, shape } })
    shapeFragment(doc, slide, shape)
    const other = replica(doc)
    deleteShapes(other, slide, [shape])
    sync(doc, other)
    expect(controller.state.editing).toBeUndefined()
    controller.destroy()
  })
})

describe('third review', () => {
  it('copies every picture beyond 200 parts and pastes without dangling relationships', async () => {
    const source = await open(blankPresentation())
    const image = Object.entries(unzipSync(fixture('generated/pictures.pptx'))).find(([path]) => path.startsWith('ppt/media/'))![1]
    const shapes: ShapeSnapshot[] = []
    source.transact(() => {
      for (let index = 0; index < 205; index++) {
        const path = `ppt/media/copy${index}.png`
        setPart(presentationRoot(source), path, { bytes: image, contentType: 'image/png' })
        shapes.push(pictureShape(path, { x: 0, y: 0, cx: 100, cy: 100 }, `Picture ${index}`))
      }
    })
    const clipboard = await copyContent(source, assets, { shapes }, '')
    expect(Object.keys(clipboard.parts)).toHaveLength(205)
    const target = await open(blankPresentation())
    await pasteShapes(target, assets, clipboard, slideKeys(target)[0]!, 0)
    const files = await exported(target)
    expect(danglingRelationships(files)).toEqual([])
    expect(Object.keys(files).filter((path) => path.startsWith('ppt/media/copy'))).toHaveLength(205)
  })

  it('rejects the whole copy when the reachable graph exceeds the part limit, and the controller handles it', async () => {
    const doc = await open(blankPresentation())
    const shape = presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'Many parts')
    doc.transact(() => {
      for (let index = 0; index < 5_001; index++) {
        const target = `ppt/media/image${index}.png`
        setPart(presentationRoot(doc), target, { bytes: new Uint8Array([index % 256]) })
        shape.rels[`rId${index}`] = { type: REL_TYPES.image, target }
      }
    })
    await expect(copyContent(doc, assets, { shapes: [shape] }, '')).rejects.toMatchObject({ code: 'too_large', message: 'Too much to copy at once' })
    const slide = slideKeys(doc)[0]!
    const [key] = insertShapes(doc, slide, [shape])
    const controller = controllerFor(doc)
    try {
      controller.setState({ shapes: [key!] })
      await expect(controller.copy()).resolves.toBeUndefined()
    } finally {
      controller.destroy()
    }
  })

  it('rejects copying assets over the total byte budget before fetching them', async () => {
    const doc = await open(blankPresentation())
    const shape = pictureShape('ppt/media/large.png', { x: 0, y: 0, cx: 100, cy: 100 }, 'Large')
    setPart(presentationRoot(doc), 'ppt/media/large.png', { asset: { hash: 'large', mimeType: 'image/png', sizeBytes: 256 * 1024 * 1024 + 1 } })
    const get = vi.fn(assets.get)
    await expect(copyContent(doc, { ...assets, get }, { shapes: [shape] }, '')).rejects.toMatchObject(new LiveFormatError('too_large', 'Too much to copy at once'))
    expect(get).not.toHaveBeenCalled()
  })

  it('reserves the root group id in the slide template when assigning shape ids deterministically', async () => {
    const files = unzipSync(blankPresentation())
    files['ppt/slides/slide1.xml'] = strToU8(slideXml(files, 1).replace(/(<p:cNvPr\b[^>]* id=")1"/, '$14"'))
    const doc = await open(zipSync(files))
    const slide = slideKeys(doc)[0]!
    insertShapes(doc, slide, Array.from({ length: 3 }, (_, index) => ({ ...presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, `New ${index}`), nvId: index === 0 ? 4 : 0 })))
    const xml = slideXml(await exported(doc), 1)
    const ids = [...xml.matchAll(/<p:cNvPr\b[^>]* id="(\d+)"/g)].map((match) => match[1])
    expect(ids).toContain('4')
    expect(new Set(ids).size).toBe(ids.length)
    expect(slideXml(await exported(doc), 1)).toBe(xml)
  })

  it('marks a slide edited when only its chart cached values change', async () => {
    const before = fixture('generated/charts.pptx')
    const files = unzipSync(before)
    const chart = Object.keys(files).find((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path))!
    const xml = strFromU8(files[chart]!)
    const changed = xml.replace(/<c:v>\d+(?:\.\d+)?<\/c:v>/, '<c:v>987654</c:v>')
    expect(changed).not.toBe(xml)
    files[chart] = strToU8(changed)
    const diff = await diffFiles(before, zipSync(files))
    expect(diff.changed).toBe(true)
    expect(diff.edited).toBe(1)
    expect(diff.slides.find((slide) => slide.status === 'edited')?.shapes.some((shape) => shape.kinds.includes('other'))).toBe(true)
  })

  it('attributes slide-level diagram drawing changes to their graphic frame', async () => {
    const doc = await open(fixture('poi/SmartArt.pptx'))
    const before = readSnapshot(doc)
    const after = structuredClone(before)
    const slide = after.slides.find((slide) => Object.values(slide.rels).some((rel) => rel.type === REL_TYPES.diagramDrawing))!
    const drawing = Object.values(slide.rels).find((rel) => rel.type === REL_TYPES.diagramDrawing)!.target
    after.parts[drawing] = { ...after.parts[drawing], bytes: strToU8('changed drawing') }
    const diff = diffSnapshots(before, after)
    expect(diff.changed).toBe(true)
    expect(diff.slides.find((entry) => entry.afterKey === slide.key)).toMatchObject({ status: 'edited', shapes: [expect.objectContaining({ kinds: ['other'] })] })
  })

  it('unlinks table cells inside groups and speaker notes when pasted into another deck', async () => {
    const source = await open(blankPresentation())
    const slide = slideKeys(source)[0]!
    const text = plainToText('Go to slide one')
    text.content![0]!.content![0]!.marks = [{ type: 'link', attrs: {
      xml: '<a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId9" action="ppaction://hlinksldjump"/>',
      external: false, relType: REL_TYPES.slide, target: 'ppt/slides/slide1.xml',
    } }]
    const table = tableShape(1, 1, { x: 0, y: 0, cx: 100_000, cy: 100_000 }, 'Linked table')
    Object.values(table.table!.rows[0]!.cells)[0]!.text = text
    const keys = insertShapes(source, slide, [table, presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'Other')])
    groupShapes(source, slide, keys, new Map(keys.map((key) => [key, readXfrm(source, slide, key)!])), 'Group')
    setNotesText(source, slide, text)
    const clipboard = await copyContent(source, assets, { slides: [readSlide(source, slide)!] }, '')
    const target = await open(blankPresentation())
    await pasteSlides(target, assets, clipboard, 1)
    const bytes = await exportBytes(target)
    const out = unzipSync(bytes)
    const pasted = readSnapshot(await open(bytes)).slides[1]!
    for (const path of [pasted.part!, pasted.notes!.part!]) {
      const xml = strFromU8(out[path]!)
      expect(xml).toContain('Go to slide one')
      expect(xml).toMatch(/<a:hlinkClick\b[^>]*r:id=""/)
      expect(xml).not.toMatch(/<a:hlinkClick\b[^>]*r:id="[^"]+"/)
    }
    expect(danglingRelationships(out)).toEqual([])
  })

  it('updates an existing notes editor when the controller changes read-only state', async () => {
    // @ts-expect-error jsdom ships without declarations.
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>') as { window: Window & typeof globalThis }
    for (const name of ['window', 'document', 'navigator', 'MutationObserver', 'getComputedStyle']) vi.stubGlobal(name, (dom.window as unknown as Record<string, unknown>)[name])
    const doc = await open(blankPresentation())
    setNotesText(doc, slideKeys(doc)[0]!, plainToText('Notes stay mounted'))
    const controller = controllerFor(doc)
    const notes = new NotesEditor(document.body, controller)
    try {
      const editor = notes.element.querySelector('.pp-text-editor')!
      expect(editor.getAttribute('contenteditable')).toBe('true')
      controller.setReadOnly(true)
      await Promise.resolve()
      expect(notes.element.querySelector('.pp-text-editor')).toBe(editor)
      expect(editor.getAttribute('contenteditable')).toBe('false')
      controller.setReadOnly(false)
      await Promise.resolve()
      expect(editor.getAttribute('contenteditable')).toBe('true')
    } finally {
      notes.destroy()
      controller.destroy()
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })
})


describe('fourth review', () => {
  it('keeps a slide’s identity and unsent title when a push only changes its layout', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    const slide = readSnapshot(doc).slides[0]!
    const title = slide.shapes.find((shape) => shape.text)!
    const user = replica(doc)
    const files = await exported(doc)
    const currentLayout = slide.layout.split('/').pop()!
    const otherLayout = Object.keys(files).filter((path) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path)).map((path) => path.split('/').pop()!).find((name) => name !== currentLayout)!
    const relsPath = slide.part!.replace('slides/', 'slides/_rels/') + '.rels'
    files[relsPath] = strToU8(strFromU8(files[relsPath]!).replace(currentLayout, otherLayout))
    setShapeText(user, slide.key, title.key, plainToText('UNSENT TITLE'))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    for (const copy of [doc, user]) {
      expect(slideKeys(copy)[0]).toBe(slide.key)
      expect(readSlide(copy, slide.key)!.layout).toContain(otherLayout)
      expect(textToPlain(readSlide(copy, slide.key)!.shapes.find((shape) => shape.key === title.key)!.text!)).toBe('UNSENT TITLE')
    }
  })

  it('keeps concurrent typing in its column when a pushed file inserts a leftmost column', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const shape = tableShape(3, 2, { x: 0, y: 0, cx: 2_000_000, cy: 1_000_000 }, 'Data')
    const table = shape.table!
    table.rows.forEach((row, i) => table.columns.forEach((column, j) => { row.cells[column.key]!.text = plainToText(`${j ? 'B' : 'A'}${i}`) }))
    insertShapes(doc, slide, [shape])
    const files = await exported(doc)
    const user = replica(doc)
    const fragment = cellFragment(user, slide, shape.key, table.rows[0]!.key, table.columns[1]!.key)!
    ;((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(2, ' UNSENT')
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
      .replace('<a:tblGrid>', '<a:tblGrid><a:gridCol w="1000000"/>')
      .replace(/<a:tr\b[^>]*>/g, (match) => match + '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>NEW</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>')
    files['ppt/slides/slide1.xml'] = strToU8(xml)
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    for (const copy of [doc, user]) {
      const result = readSlide(copy, slide)!.shapes.find((entry) => entry.key === shape.key)!.table!
      expect(result.columns.map((column) => textToPlain(result.rows[0]!.cells[column.key]!.text))).toEqual(['NEW', 'A0', 'B0 UNSENT'])
      expect(new Set(result.columns.map((column) => column.key)).size).toBe(3)
    }
  })

  const rectangle = () => presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'Rectangle')
  const payload = (shapes: ShapeSnapshot[]) => ({ version: 1 as const, source: 'other', kind: 'shapes' as const, shapes, parts: {}, text: '' })

  it('rejects an entire clipboard with 10,001 rectangles', () => {
    expect(parseClipboard(JSON.stringify(payload(Array.from({ length: 10_001 }, rectangle))))).toBeUndefined()
  })

  it('counts nested group members and shapes on every slide toward the clipboard budget', async () => {
    const group = { ...rectangle(), kind: 'grpSp' as const, children: Array.from({ length: 2_000 }, rectangle) }
    expect(parseClipboard(JSON.stringify(payload([group])))).toBeUndefined()
    const doc = await open(blankPresentation())
    const slide = readSlide(doc, slideKeys(doc)[0]!)!
    expect(parseClipboard(JSON.stringify({ ...payload([]), kind: 'slides', slides: [{ ...slide, shapes: Array.from({ length: 1_001 }, rectangle) }, { ...slide, shapes: Array.from({ length: 1_000 }, rectangle) }] }))).toBeUndefined()
    expect(parseClipboard(JSON.stringify({ ...payload([]), kind: 'slides', slides: Array.from({ length: 201 }, () => ({ ...slide, shapes: [] })) }))).toBeUndefined()
  })

  it('rejects an entire clipboard with 5,001 tiny parts', () => {
    const parts = Object.fromEntries(Array.from({ length: 5_001 }, (_, index) => [`ppt/media/p${index}.bin`, { data: 'eA==' }]))
    expect(parseClipboard(JSON.stringify({ ...payload([rectangle()]), parts }))).toBeUndefined()
  })

  it('refuses a shape paste beyond the slide limit before storing any assets', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const count = readSlide(doc, slide)!.shapes.length
    insertShapes(doc, slide, Array.from({ length: DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide - count }, rectangle))
    const before = readSlide(doc, slide)!.shapes.length
    const put = vi.fn(assets.put)
    const clipboard = { ...payload(Array.from({ length: 5 }, rectangle)), parts: { 'ppt/media/p.png': { data: 'eA==', mimeType: 'image/png' } } }
    expect(await pasteShapes(doc, { ...assets, put }, clipboard, slide, 0)).toEqual([])
    expect(readSlide(doc, slide)!.shapes).toHaveLength(before)
    expect(put).not.toHaveBeenCalled()
    expect(readSnapshot(doc).parts['ppt/media/p.png']).toBeUndefined()
  }, 60_000)

  it('refuses slides with too many nested shapes and pastes beyond the deck limit before storing assets', async () => {
    const doc = await open(blankPresentation())
    const slide = readSnapshot(doc).slides[0]!
    const put = vi.fn(assets.put)
    const clipboard = { ...payload([]), kind: 'slides' as const, slides: [{ ...slide, shapes: [{ ...rectangle(), kind: 'grpSp' as const, children: Array.from({ length: DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide }, rectangle) }] }], parts: { 'ppt/media/p.png': { data: 'eA==', mimeType: 'image/png' } } }
    expect(await pasteSlides(doc, { ...assets, put }, clipboard, 1)).toEqual([])
    insertSlides(doc, Array.from({ length: DEFAULT_PRESENTATION_LIMITS.maxSlides - 1 }, (_, index) => ({ ...slide, key: `extra-${index}`, shapes: [] })), 1)
    expect(await pasteSlides(doc, { ...assets, put }, { ...clipboard, slides: [{ ...slide, shapes: [] }] }, 1)).toEqual([])
    expect(slideKeys(doc)).toHaveLength(DEFAULT_PRESENTATION_LIMITS.maxSlides)
    expect(put).not.toHaveBeenCalled()
  }, 60_000)

  it('reports a section-only rename in an exported presentation', async () => {
    const before = await exportBytes(await open(fixture('generated/layouts-notes-sections.pptx')))
    const files = unzipSync(before)
    const xml = strFromU8(files['ppt/presentation.xml']!)
    const changed = xml.replace(/(<p14:section\b[^>]*name=")[^"]*/, '$1Renamed section')
    expect(changed).not.toBe(xml)
    files['ppt/presentation.xml'] = strToU8(changed)
    const diff = await diffFiles(before, zipSync(files))
    expect(diff.changed).toBe(true)
    expect(diff.deck).toContain('sections')
    expect(diff.added + diff.removed + diff.edited + diff.moved).toBe(0)
  })

  it('compares section order and effective slide membership with aligned keys', async () => {
    const before = readSnapshot(await open(fixture('generated/layouts-notes-sections.pptx')))
    const rekeyed = structuredClone(before)
    for (const section of rekeyed.sections) {
      const old = section.key
      section.key += '-different'
      for (const slide of rekeyed.slides) if (slide.section === old) slide.section = section.key
    }
    expect(diffSnapshots(before, rekeyed).deck).not.toContain('sections')
    const reordered = structuredClone(before)
    reordered.sections.reverse()
    expect(diffSnapshots(before, reordered).deck).toContain('sections')
    const moved = structuredClone(before)
    const firstOfSecond = moved.slides.find((slide) => slide.section === moved.sections[1]!.key)!
    firstOfSecond.section = moved.sections[0]!.key
    expect(diffSnapshots(before, moved).deck).toContain('sections')
    const added = structuredClone(before)
    added.sections.push({ ...added.sections[0]!, key: 'new-section', id: 'new-section', name: 'New section' })
    expect(diffSnapshots(before, added).deck).toContain('sections')
    const removed = structuredClone(before)
    removed.sections.pop()
    expect(diffSnapshots(before, removed).deck).toContain('sections')
  })
})

describe('fifth review', () => {
  const grid = (size: number) => {
    const shape = tableShape(size, size, { x: 0, y: 0, cx: 3_000_000, cy: 1_000_000 }, 'Grid')
    shape.table!.rows.forEach((row, i) => shape.table!.columns.forEach((column, j) => { row.cells[column.key]!.text = plainToText(`R${i}C${j}`) }))
    return shape
  }
  const cellTexts = (doc: Y.Doc, slide: string, key: string) => {
    const table = readSlide(doc, slide)!.shapes.find((entry) => entry.key === key)!.table!
    return table.rows.map((row) => table.columns.map((column) => textToPlain(row.cells[column.key]!.text)))
  }

  for (const change of ['insert', 'delete'] as const) {
    it(`keeps concurrent typing in its cell when a push ${change}s a leading row and column together`, async () => {
      const doc = await open(blankPresentation())
      const slide = slideKeys(doc)[0]!
      const shape = grid(3)
      insertShapes(doc, slide, [shape])
      const files = await exported(doc)
      const user = replica(doc)
      const table = shape.table!
      const fragment = cellFragment(user, slide, shape.key, table.rows[1]!.key, table.columns[1]!.key)!
      ;((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(4, ' UNSENT')
      let xml = strFromU8(files['ppt/slides/slide1.xml']!)
      const cell = (text: string) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
      if (change === 'insert') {
        xml = xml.replace('<a:tblGrid>', '<a:tblGrid><a:gridCol w="1000000"/>').replace(/(<a:tr\b[^>]*>)/g, `$1${cell('NEW')}`)
        const firstRow = /<a:tr\b[\s\S]*?<\/a:tr>/.exec(xml)![0]
        xml = xml.replace(firstRow, firstRow.replace(/<a:t>[^<]*<\/a:t>/g, '<a:t>TOP</a:t>') + firstRow)
      } else {
        xml = xml.replace(/<a:gridCol\b[^>]*\/>|<a:gridCol\b[^>]*>[\s\S]*?<\/a:gridCol>/, '').replace(/(<a:tr\b[^>]*>)<a:tc>[\s\S]*?<\/a:tc>/g, '$1')
        xml = xml.replace(/<a:tr\b[\s\S]*?<\/a:tr>/, '')
      }
      files['ppt/slides/slide1.xml'] = strToU8(xml)
      await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
      sync(doc, user)
      const texts = cellTexts(doc, slide, shape.key).flat()
      expect(texts).toContain('R1C1 UNSENT')
      expect(texts.filter((text) => text.includes('UNSENT'))).toHaveLength(1)
      expect(cellTexts(user, slide, shape.key)).toEqual(cellTexts(doc, slide, shape.key))
    })
  }

  it('keeps a slide and its unsent text when a push only renames a shape', async () => {
    const doc = await open(blankPresentation())
    const slide = readSnapshot(doc).slides[0]!
    const box = slide.shapes.find((shape) => shape.text)!
    setShapeText(doc, slide.key, box.key, plainToText('BASE'))
    const files = await exported(doc)
    const user = replica(doc)
    const fragment = shapeFragment(user, slide.key, box.key)!
    ;((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(4, ' UNSENT')
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    files['ppt/slides/slide1.xml'] = strToU8(xml.replace(`name="${box.name}"`, 'name="Renamed"'))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    expect(slideKeys(doc)[0]).toBe(slide.key)
    const shape = readSlide(doc, slide.key)!.shapes.find((entry) => entry.key === box.key)!
    expect(shape.name).toBe('Renamed')
    expect(textToPlain(shape.text!)).toBe('BASE UNSENT')
  })

  it('refuses the second of two overlapping pastes that would overfill a slide', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const count = readSlide(doc, slide)!.shapes.length
    const rectangle = () => presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'Rectangle')
    insertShapes(doc, slide, Array.from({ length: DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide - count - 2 }, rectangle))
    const clipboard = parseClipboard(JSON.stringify({ version: 1, source: 'other', kind: 'shapes', shapes: [rectangle(), rectangle()], parts: { 'ppt/media/p.png': { data: 'eA==', mimeType: 'image/png' } }, text: '' }))!
    const results = await Promise.all([pasteShapes(doc, assets, clipboard, slide, 0), pasteShapes(doc, assets, clipboard, slide, 0)])
    expect(results.map((keys) => keys.length).sort()).toEqual([0, 2])
    expect(readSlide(doc, slide)!.shapes).toHaveLength(DEFAULT_PRESENTATION_LIMITS.maxShapesPerSlide)
  }, 60_000)
})

describe('closing review', () => {
  const records = (texts: string[][]) => {
    const shape = tableShape(texts.length, texts[0]!.length, { x: 0, y: 0, cx: 3_000_000, cy: 1_000_000 }, 'Records')
    shape.table!.rows.forEach((row, i) => shape.table!.columns.forEach((column, j) => { row.cells[column.key]!.text = plainToText(texts[i]![j]!) }))
    return shape
  }
  const texts = (doc: Y.Doc, slide: string, key: string) => {
    const table = readSlide(doc, slide)!.shapes.find((entry) => entry.key === key)!.table!
    return table.rows.map((row) => table.columns.map((column) => textToPlain(row.cells[column.key]!.text)).join(' | '))
  }
  const append = (doc: Y.Doc, slide: string, shape: ShapeSnapshot, row: number, column: number, text: string) => {
    const fragment = cellFragment(doc, slide, shape.key, shape.table!.rows[row]!.key, shape.table!.columns[column]!.key)!
    const run = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText
    run.insert(run.length, text)
  }

  it('keeps an edit on its own record when a push deletes the record above, even if the two look alike', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const shape = records([['Alice', 'Pending'], ['Bob', 'Pending'], ['Carol', 'Pending']])
    insertShapes(doc, slide, [shape])
    const files = await exported(doc)
    const user = replica(doc)
    append(user, slide, shape, 1, 1, ' UNSENT')
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    files['ppt/slides/slide1.xml'] = strToU8(xml.replace(/<a:tr\b[\s\S]*?<\/a:tr>/, ''))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    expect(texts(doc, slide, shape.key)).toEqual(['Bob | Pending UNSENT', 'Carol | Pending'])
  })

  it('keeps an edit in its own column when a push deletes a look-alike column before it', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const shape = records([['Q1', 'Q2', 'Q3'], ['10', '10', '20']])
    insertShapes(doc, slide, [shape])
    const files = await exported(doc)
    const user = replica(doc)
    append(user, slide, shape, 1, 1, '5')
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    files['ppt/slides/slide1.xml'] = strToU8(xml.replace(/<a:gridCol\b[^>]*\/>|<a:gridCol\b[^>]*>[\s\S]*?<\/a:gridCol>/, '').replace(/(<a:tr\b[^>]*>)<a:tc>[\s\S]*?<\/a:tc>/g, '$1'))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    expect(texts(doc, slide, shape.key)).toEqual(['Q2 | Q3', '105 | 20'])
  })

  it('matches rows by their PowerPoint row ids before their text', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const shape = records([['North', '1'], ['South', '2']])
    shape.table!.rows.forEach((row, index) => { row.xml = row.xml.replace(/\/>$|><\/a:tr>$/, `><a:extLst><a:ext uri="{0D108BD9-81ED-4DB2-BD59-A6C34878D82A}"><a16:rowId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" val="${1000 + index}"/></a:ext></a:extLst></a:tr>`) })
    insertShapes(doc, slide, [shape])
    const files = await exported(doc)
    expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('rowId')
    const user = replica(doc)
    append(user, slide, shape, 1, 1, '0')
    // The agent rewrites both cells of the first row and swaps nothing else.
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    files['ppt/slides/slide1.xml'] = strToU8(xml.replace('<a:t>North</a:t>', '<a:t>East</a:t>').replace('<a:t>1</a:t>', '<a:t>9</a:t>'))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    expect(texts(doc, slide, shape.key)).toEqual(['East | 9', 'South | 20'])
  })

  it('gives new tables, rows, and columns PowerPoint ids, so empty look-alike rows keep their edits', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    const shape = records([['', ''], ['', ''], ['', '']])
    insertShapes(doc, slide, [shape])
    insertTableRow(doc, slide, shape.key, 3)
    const files = await exported(doc)
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    const rowIds = [...xml.matchAll(/rowId\b[^>]*\bval="(\d+)"/g)].map((match) => match[1])
    const columnIds = [...xml.matchAll(/colId\b[^>]*\bval="(\d+)"/g)].map((match) => match[1])
    expect(rowIds).toHaveLength(4)
    expect(new Set(rowIds).size).toBe(4)
    expect(new Set(columnIds).size).toBe(2)
    const user = replica(doc)
    const fragment = cellFragment(user, slide, shape.key, shape.table!.rows[1]!.key, shape.table!.columns[1]!.key)!
    ;(fragment.get(0) as Y.XmlElement).insert(0, [new Y.XmlText('UNSENT')])
    files['ppt/slides/slide1.xml'] = strToU8(xml.replace(/<a:tr\b[\s\S]*?<\/a:tr>/, ''))
    await presentationCodec.applyFile(doc, zipSync(files), context, 'agent')
    sync(doc, user)
    expect(texts(doc, slide, shape.key)).toEqual([' | UNSENT', ' | ', ' | '])
  })
})
