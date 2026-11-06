import { EditorState, TextSelection } from '@tiptap/pm/state'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { resolveTarget } from '../ooxml/package.js'
import { blankPresentation } from './blank.js'
import { parseClipboard } from './clipboard.js'
import { presentationCodec } from './codec.js'
import { addSlide, cloneSlide, deleteShapes, deleteSlides, duplicateSlides, ensureNotes, insertShapes, insertTableRow, presetShape, readSlide, setShapeText, slideKeys } from './commands.js'
import { assignIdentifiers } from './write.js'
import { DeckResources } from './render/deck.js'
import { displayableMediaType } from './render/env.js'
import { plainToText, slideTextSchema, textToPlain } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { assertReadableZip, fidelityAvailable, fixture, runPython, scratchDir, writeScratch } from './testing/fixtures.js'
import { splitParagraph } from './view/text-editor.js'
import { readSnapshot } from './ydoc.js'
import { REL_TYPES } from './xml.js'

/** Regressions found by review: each case reproduces a bug that once lost or corrupted content. */

const assets = memoryAssets()
const context = { name: 'deck.pptx', assets }

async function open(bytes: Uint8Array) {
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, context)
  return doc
}

const exported = async (doc: Y.Doc) => {
  const bytes = await presentationCodec.exportFile(doc, context)
  assertReadableZip(bytes)
  return unzipSync(bytes)
}

/** Every internal relationship in the package points at a part that exists. */
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
      const resolved = resolveTarget(source, target)
      if (!files[resolved]) dangling.push(`${path} → ${resolved}`)
    }
  }
  return dangling
}

describe('regressions', () => {
  it('keeps slide part names when a slide is inserted before them, so slide links stay right', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    const deck = new DeckResources(readSnapshot(doc).parts, 'ppt/presentation.xml')
    const layout = deck.master(deck.masterPaths()[0]!)!.layouts[0]!
    addSlide(doc, deck, layout, 0)
    duplicateSlides(doc, [slideKeys(doc)[1]!])
    const files = await exported(doc)
    // The original slides keep their parts (and bytes); only the new ones get new names.
    const before = unzipSync(fixture('generated/text-formatting.pptx'))
    for (let index = 1; index <= 6; index++) expect(files[`ppt/slides/slide${index}.xml`], `slide${index}`).toEqual(before[`ppt/slides/slide${index}.xml`])
    expect(files['ppt/slides/slide7.xml']).toBeDefined()
    expect(files['ppt/slides/slide8.xml']).toBeDefined()
    expect(danglingRelationships(files)).toEqual([])
  })

  it('writes cleared table cells after a pushed file re-keyed the rows', async () => {
    const doc = await open(fixture('poi/shapes.pptx'))
    const slide = slideKeys(doc)[3]!
    const table = readSnapshot(doc).slides[3]!.shapes.find((shape) => shape.table)!
    insertTableRow(doc, slide, table.key, 0)
    await presentationCodec.applyFile(doc, await presentationCodec.exportFile(doc, context), context)
    const current = readSnapshot(doc).slides[3]!.shapes.find((shape) => shape.table)!.table!
    const row = current.rows.find((entry) => Object.values(entry.cells).some((cell) => textToPlain(cell.text) === 'header1'))!
    const column = Object.entries(row.cells).find(([, cell]) => textToPlain(cell.text) === 'header1')![0]
    const fragment = (doc.getMap('presentation').get('slides') as Y.Map<Y.Map<unknown>>).get(slide)!
    const cell = (((fragment.get('shapes') as Y.Map<Y.Map<unknown>>).get(table.key)!.get('table') as Y.Map<unknown>).get('rows') as Y.Map<Y.Map<unknown>>).get(row.key)!.get('cells') as Y.Map<Y.Map<unknown>>
    const text = cell.get(column)!.get('text') as Y.XmlFragment
    doc.transact(() => {
      const paragraph = text.get(0) as Y.XmlElement
      paragraph.delete(0, paragraph.length)
    })
    const files = await exported(doc)
    const slidePart = readSnapshot(await open(await presentationCodec.exportFile(doc, context))).slides[3]!.part!
    expect(strFromU8(files[slidePart]!)).not.toContain('>header1<')
  })

  it('keeps the relationship type of internal hyperlinks that are not slides', async () => {
    const doc = await open(fixture('poi/with_japanese.pptx'))
    const slide = readSnapshot(doc).slides[0]!
    const shape = slide.shapes.find((entry) => entry.text && JSON.stringify(entry.text).includes('"link"'))
    expect(shape).toBeDefined()
    const text = structuredClone(shape!.text!)
    text.content!.find((paragraph) => paragraph.content?.length)!.content!.push({ type: 'text', text: ' edited' })
    setShapeText(doc, slide.key, shape!.key, text)
    const files = await exported(doc)
    const rels = strFromU8(files[`ppt/slides/_rels/${slide.part!.split('/').pop()}.rels`]!)
    for (const [, attributes] of rels.matchAll(/<Relationship ([^>]*)\/>/g)) {
      if (/Target="#/.test(attributes!)) expect(attributes).toContain(REL_TYPES.hyperlink)
    }
  })

  it('keeps animation targets connected to their shapes when duplicating a slide', async () => {
    const doc = await open(fixture('poi/bug68703.pptx'))
    const [copy] = duplicateSlides(doc, [slideKeys(doc)[0]!])
    const files = await exported(doc)
    const part = readSnapshot(await open(await presentationCodec.exportFile(doc, context))).slides.find((_, index) => slideKeys(doc)[index] === copy)!.part!
    const xml = strFromU8(files[part]!)
    const ids = new Set([...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((match) => match[1]))
    const targets = [...xml.matchAll(/spid="(\d+)"/g)].map((match) => match[1])
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) expect(ids.has(target), `spid ${target}`).toBe(true)
  })

  it('leaves no links, custom show entries, or animations pointing at deleted slides and shapes', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    deleteSlides(doc, [slideKeys(doc)[0]!])
    expect(danglingRelationships(await exported(doc))).toEqual([])

    const animated = await open(fixture('poi/bug68703.pptx'))
    const slide = readSnapshot(animated).slides[0]!
    const xml = strFromU8(unzipSync(fixture('poi/bug68703.pptx'))['ppt/slides/slide1.xml']!)
    const target = /spid="(\d+)"/.exec(xml)![1]
    const shape = slide.shapes.find((entry) => String(entry.nvId) === target)!
    deleteShapes(animated, slide.key, [shape.key])
    const out = strFromU8((await exported(animated))['ppt/slides/slide1.xml']!)
    expect(out).not.toContain(`spid="${target}"`)
    // The file still opens.
    await open(await presentationCodec.exportFile(animated, context))
  })

  it('keeps both people’s notes when two start notes on a slide at once', async () => {
    const base = await open(blankPresentation())
    const alice = new Y.Doc()
    const bob = new Y.Doc()
    Y.applyUpdate(alice, Y.encodeStateAsUpdate(base))
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(base))
    const slide = slideKeys(alice)[0]!
    for (const [doc, name] of [
      [alice, 'Alice notes'],
      [bob, 'Bob notes'],
    ] as const) {
      const fragment = ensureNotes(doc, slide)!
      doc.transact(() => {
        const paragraph = new Y.XmlElement('paragraph')
        paragraph.insert(0, [new Y.XmlText(name)])
        fragment.insert(fragment.length, [paragraph])
      })
    }
    Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob))
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice))
    const notes = textToPlain(readSnapshot(alice).slides[0]!.notes!.text)
    expect(notes).toContain('Alice notes')
    expect(notes).toContain('Bob notes')
    // And a slide nobody wrote notes for gets no notes page.
    const files = await exported(await open(blankPresentation()))
    expect(Object.keys(files).some((path) => path.includes('notesSlide'))).toBe(false)
  })

  it('keeps paragraph properties when Enter splits a paragraph', () => {
    const schema = slideTextSchema()
    const pPr = '<a:pPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" lvl="2" algn="ctr"/>'
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { pPr, endRPr: null }, content: [{ type: 'text', text: 'Item' }] }] })
    let state = EditorState.create({ schema, doc })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)))
    splitParagraph(state, (transaction) => (state = state.apply(transaction)))
    expect(state.doc.childCount).toBe(2)
    expect(state.doc.child(1).attrs.pPr).toBe(pPr)
  })

  it('writes vertical tabs as line breaks and drops characters XML cannot hold', async () => {
    const doc = await open(blankPresentation())
    const slide = readSnapshot(doc).slides[0]!
    setShapeText(doc, slide.key, slide.shapes[0]!.key, plainToText('Line one\u000bsoft break \u0001￿ end'))
    const files = await exported(doc)
    const xml = strFromU8(files['ppt/slides/slide1.xml']!)
    expect(xml).toContain('<a:br')
    for (const character of ['\u0001', '\u000b', '\uffff']) expect(xml.includes(character)).toBe(false)
    if (fidelityAvailable()) {
      const file = writeScratch(scratchDir(), 'control.pptx', await presentationCodec.exportFile(doc, context))
      expect(runPython('import sys\nfrom pptx import Presentation\nprint(Presentation(sys.argv[1]).slides[0].shapes[0].text_frame.text)', file)).toContain('soft break')
    }
  })

  it('drops pasted shapes and slides whose XML is broken', () => {
    const good = presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'Good')
    const payload = {
      version: 1,
      source: 'elsewhere',
      kind: 'shapes',
      parts: { '../../evil': { data: '' }, 'ppt/media/a.png': { data: 'AA==' } },
      shapes: [good, { ...good, key: 'bad1', xml: '<p:sp><unclosed>' }, { ...good, key: 'bad2', text: { type: 'doc', content: [{ type: 'paragraph', attrs: { pPr: '<a:pPr><broken' } }] } }, { ...good, key: 'bad3', kind: 'script' }],
      text: '',
    }
    const clipboard = parseClipboard(JSON.stringify(payload))!
    expect(clipboard.shapes!.map((shape) => shape.key)).toEqual([good.key])
    expect(Object.keys(clipboard.parts)).toEqual(['ppt/media/a.png'])
  })

  it('still saves a deck that holds a shape whose XML cannot be built', async () => {
    const doc = await open(blankPresentation())
    const slide = slideKeys(doc)[0]!
    insertShapes(doc, slide, [{ ...presetShape('rect', { x: 0, y: 0, cx: 10, cy: 10 }, 'Broken'), xml: '<p:sp><unclosed>' }])
    const files = await exported(doc)
    expect(files['ppt/slides/slide1.xml']).toBeDefined()
  })

  it('only turns raster images, media, and SVG (as data URLs) into URLs', () => {
    expect(displayableMediaType('image/png')).toBe('blob')
    expect(displayableMediaType('video/mp4')).toBe('blob')
    expect(displayableMediaType('image/svg+xml')).toBe('svg')
    expect(displayableMediaType('text/html')).toBeUndefined()
    expect(displayableMediaType('application/xhtml+xml')).toBeUndefined()
    expect(displayableMediaType('image/x-emf')).toBeUndefined()
  })

  it('drops modern and legacy comments from duplicated slides', () => {
    const copy = cloneSlide({
      key: 's',
      layout: 'ppt/slideLayouts/slideLayout1.xml',
      hidden: false,
      xml: '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      shapes: [],
      rels: {
        rId1: { type: 'http://schemas.microsoft.com/office/2018/10/relationships/comments', target: 'ppt/comments/modernComment_1.xml' },
        rId2: { type: REL_TYPES.comments, target: 'ppt/comments/comment1.xml' },
        rId3: { type: REL_TYPES.tags, target: 'ppt/tags/tag1.xml' },
      },
    })
    expect(Object.values(copy.rels).map((rel) => rel.target)).toEqual(['ppt/tags/tag1.xml'])
  })

  it('never assigns a slide id above the schema maximum', async () => {
    const doc = await open(blankPresentation())
    const snapshot = readSnapshot(doc)
    snapshot.slides[0]!.sldId = 2_147_483_647
    snapshot.slides.push(cloneSlide(readSlide(doc, slideKeys(doc)[0]!)!))
    const assigned = assignIdentifiers(snapshot)
    expect(assigned.slides[1]!.sldId).toBeGreaterThanOrEqual(256)
    expect(assigned.slides[1]!.sldId).toBeLessThanOrEqual(2_147_483_647)
    expect(assigned.slides[1]!.sldId).not.toBe(2_147_483_647)
  })
})

/** Values Yjs stores as plain JSON; its development build deep-freezes them, so they must not nest typed arrays. */
function nestedTypedArrays(type: unknown, path = "presentation"): string[] {
  const found: string[] = []
  const plain = (value: unknown, at: string, depth: number) => {
    if (depth > 0 && ArrayBuffer.isView(value)) found.push(at)
    else if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) for (const [key, inner] of Object.entries(value)) plain(inner, `${at}.${key}`, depth + 1)
  }
  const visit = (value: unknown, at: string) => {
    if (value instanceof Y.Map) for (const [key, inner] of value.entries()) visit(inner, `${at}.${key}`)
    else if (value instanceof Y.Array) value.toArray().forEach((inner, index) => visit(inner, `${at}[${index}]`))
    else if (!(value instanceof Y.AbstractType)) plain(value, at, 0)
  }
  visit(type, path)
  return found
}

describe('stored values', () => {
  it('never nests binary data inside plain values (Yjs development builds freeze them)', async () => {
    for (const name of ['generated/pictures.pptx', 'poi/SmartArt.pptx', 'poi/EmbeddedVideo.pptx']) {
      const doc = await open(fixture(name))
      expect(nestedTypedArrays(doc.getMap('presentation')), name).toEqual([])
    }
    const blank = new Y.Doc()
    await presentationCodec.createEmpty(blank, context)
    expect(nestedTypedArrays(blank.getMap('presentation'))).toEqual([])
  })
})
