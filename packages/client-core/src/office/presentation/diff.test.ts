import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { presentationCodec } from './codec.js'
import { deleteSlides, duplicateSlides, insertShapes, moveSlides, presetShape, setShapeText, setSlideHidden, setXfrm, slideKeys } from './commands.js'
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
