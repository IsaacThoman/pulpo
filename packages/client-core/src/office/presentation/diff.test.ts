import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from './blank.js'
import { presentationCodec } from './codec.js'
import { deleteSlides, duplicateSlides, groupShapes, insertShapes, moveSlides, presetShape, reorderShapes, setShapeText, setSlideHidden, setXfrm, slideKeys } from './commands.js'
import { diffDocuments, diffDocumentWithFile, diffFiles } from './diff.js'
import { plainToText } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'
import { readSnapshot } from './ydoc.js'

const assets = memoryAssets()

async function open(bytes: Uint8Array) {
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, { name: 'deck.pptx', assets })
  return doc
}

function fork(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

describe('presentation diff', () => {
  it.each([false, true])('reports a proposal that only reorders overlapping group members (nested: %s)', async (nested) => {
    const seed = await open(blankPresentation())
    const slide = slideKeys(seed)[0]!
    const box = { x: 100_000, y: 100_000, cx: 1_000_000, cy: 1_000_000 }
    const keys = insertShapes(seed, slide, ['FF0000', '0000FF', '00FF00'].map((color) => ({
      ...presetShape('rect', box, color),
      fill: `<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="${color}"/></a:solidFill>`,
    })))
    const groupKey = groupShapes(seed, slide, keys.slice(0, 2), new Map(keys.map((key) => [key, box])), 'Group')!
    if (nested) groupShapes(seed, slide, [groupKey, keys[2]!], new Map([[groupKey, box], [keys[2]!, box]]), 'Outer group')
    // Compare imported documents so the templates and parts are identical; only modeled order changes.
    const before = await open(await presentationCodec.exportFile(seed, { name: 'deck.pptx', assets }))
    const importedSlide = readSnapshot(before).slides[0]!
    const outer = importedSlide.shapes.find((shape) => shape.kind === 'grpSp')!
    const group = nested ? outer.children![0]! : outer
    const after = fork(before)
    expect(diffDocuments(before, after).changed).toBe(false)
    reorderShapes(after, importedSlide.key, [group.children![0]!.key], 'front')
    const diff = diffDocuments(before, after)
    expect(diff.changed).toBe(true)
    expect(diff.edited).toBe(1)
    expect(diff.slides[0]).toMatchObject({ status: 'edited', shapes: [{ key: group.key, kinds: ['other'] }] })
    // The same edit must appear when reviewing an agent's whole-file proposal.
    const proposal = await presentationCodec.exportFile(after, { name: 'deck.pptx', assets })
    const fileDiff = await diffDocumentWithFile(before, proposal)
    expect(fileDiff.slides[0]!.status).toBe('edited')
    expect(fileDiff.slides[0]!.shapes).toContainEqual(expect.objectContaining({ key: group.key, kinds: ['other'] }))
    seed.destroy()
    before.destroy()
    after.destroy()
  })

  it('reports nothing for identical decks', async () => {
    const bytes = fixture('generated/layouts-notes-sections.pptx')
    const diff = await diffFiles(bytes, bytes)
    expect(diff.changed).toBe(false)
    expect(diff.slides.every((slide) => slide.status === 'unchanged')).toBe(true)
  })

  it('finds added, removed, moved, and edited slides with text changes', async () => {
    const before = await open(fixture('generated/layouts-notes-sections.pptx'))
    const after = fork(before)
    const keys = slideKeys(after)
    const title = readSnapshot(after).slides[0]!.shapes.find((shape) => shape.text)!
    setShapeText(after, keys[0]!, title.key, plainToText('A new title'), 'test')
    setXfrm(after, keys[1]!, readSnapshot(after).slides[1]!.shapes[0]!.key, { x: 10, y: 10, cx: 100, cy: 100 }, 'test')
    insertShapes(after, keys[1]!, [presetShape('star5', { x: 0, y: 0, cx: 100, cy: 100 }, 'Star')], 'test')
    moveSlides(after, [keys[5]!], 2, 'test')
    deleteSlides(after, [keys[7]!], 'test')
    duplicateSlides(after, [keys[8]!], 'test')
    setSlideHidden(after, [keys[9]!], true, 'test')
    const diff = diffDocuments(before, after)
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(1)
    expect(diff.moved).toBe(1)
    const first = diff.slides.find((slide) => slide.before === 0)!
    expect(first.status).toBe('edited')
    expect(first.shapes[0]).toMatchObject({ kinds: ['text'], textAfter: 'A new title' })
    const second = diff.slides.find((slide) => slide.before === 1)!
    expect(second.shapes.map((shape) => shape.kinds)).toEqual(expect.arrayContaining([['added'], expect.arrayContaining(['moved'])]))
    expect(diff.slides.find((slide) => slide.before === 9)!.slideChanges).toContain('hidden')
    expect(diff.slides.find((slide) => slide.status === 'removed')!.before).toBe(7)
  })

  it('compares a document with an agent proposal file', async () => {
    const doc = await open(fixture('generated/text-formatting.pptx'))
    const exported = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    const files = unzipSync(exported)
    files['ppt/slides/slide2.xml'] = strToU8(strFromU8(files['ppt/slides/slide2.xml']!).replace('Character formatting', 'Proposed heading'))
    const diff = await diffDocumentWithFile(doc, zipSync(files))
    expect(diff.edited).toBe(1)
    const edited = diff.slides.find((slide) => slide.status === 'edited')!
    expect(edited.after).toBe(1)
    expect(edited.shapes[0]!.textBefore).toBe('Character formatting')
    expect(edited.shapes[0]!.textAfter).toBe('Proposed heading')
    // Media and other parts are compared by content, so an untouched deck has no deck-level changes.
    expect(diff.deck).toEqual([])
  })
})
