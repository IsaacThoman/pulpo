import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from './blank.js'
import { copyContent, parseClipboard, pasteShapes, pasteSlides } from './clipboard.js'
import { presentationCodec } from './codec.js'
import { readShapes, slideKeys } from './commands.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'
import { readSnapshot } from './ydoc.js'

async function open(bytes: Uint8Array, assets = memoryAssets()) {
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, { name: 'deck.pptx', assets })
  return { doc, assets }
}

describe('copy and paste between decks', () => {
  it('brings pictures along under new part names', async () => {
    const source = await open(fixture('generated/pictures.pptx'))
    const target = await open(blankPresentation())
    const slide = slideKeys(source.doc)[0]!
    const pictures = readSnapshot(source.doc).slides[0]!.shapes.filter((shape) => shape.kind === 'pic')
    expect(pictures.length).toBeGreaterThan(0)
    const clipboard = parseClipboard(JSON.stringify(await copyContent(source.doc, source.assets, { shapes: readShapes(source.doc, slide, pictures.map((shape) => shape.key)) }, '')))!
    const keys = await pasteShapes(target.doc, target.assets, clipboard, slideKeys(target.doc)[0]!, 0)
    expect(keys.length).toBe(pictures.length)
    const out = unzipSync(await presentationCodec.exportFile(target.doc, { name: 'deck.pptx', assets: target.assets }))
    const media = Object.keys(out).filter((path) => path.startsWith('ppt/media/'))
    expect(media.length).toBeGreaterThan(0)
    const rels = new TextDecoder().decode(out['ppt/slides/_rels/slide1.xml.rels'])
    for (const path of media) expect(rels).toContain(path.replace('ppt/', '../'))
    // The pasted deck opens again with the pictures' bytes intact.
    const reopened = await open(await presentationCodec.exportFile(target.doc, { name: 'deck.pptx', assets: target.assets }))
    expect(readSnapshot(reopened.doc).slides[0]!.shapes.filter((shape) => shape.kind === 'pic').length).toBe(pictures.length)
  })

  it('pastes slides with charts into another deck, mapping layouts by name', async () => {
    const source = await open(fixture('generated/charts.pptx'))
    const target = await open(blankPresentation())
    const slides = readSnapshot(source.doc).slides.slice(0, 2)
    const clipboard = parseClipboard(JSON.stringify(await copyContent(source.doc, source.assets, { slides }, '')))!
    expect(Object.keys(clipboard.parts).some((path) => path.startsWith('ppt/charts/'))).toBe(true)
    await pasteSlides(target.doc, target.assets, clipboard, 1)
    const out = await presentationCodec.exportFile(target.doc, { name: 'deck.pptx', assets: target.assets })
    const files = unzipSync(out)
    const charts = Object.keys(files).filter((path) => /^ppt\/charts\/[^/]+\.xml$/.test(path))
    expect(charts.length).toBeGreaterThanOrEqual(2)
    // Each chart's own relationships (its workbook) came along and point at copied parts.
    for (const chart of charts) {
      const relsPath = chart.replace('charts/', 'charts/_rels/') + '.rels'
      if (!files[relsPath]) continue
      for (const [, target] of new TextDecoder().decode(files[relsPath]).matchAll(/Target="([^"]+)"/g)) {
        const resolved = new URL(target!, `file:///${chart}`).pathname.slice(1)
        expect(files[resolved], `${chart} → ${resolved}`).toBeDefined()
      }
    }
    const snapshot = readSnapshot((await open(out)).doc)
    expect(snapshot.slides.length).toBe(3)
    expect(presentationCodec.toText((await open(out)).doc)).toContain('[Chart')
  })

  it('pastes within the same deck without copying parts', async () => {
    const source = await open(fixture('generated/pictures.pptx'))
    const parts = Object.keys(readSnapshot(source.doc).parts).length
    const slide = slideKeys(source.doc)[0]!
    const shapes = readSnapshot(source.doc).slides[0]!.shapes.slice(0, 2)
    const clipboard = parseClipboard(JSON.stringify(await copyContent(source.doc, source.assets, { shapes }, '')))!
    await pasteShapes(source.doc, source.assets, clipboard, slide, 182880)
    expect(Object.keys(readSnapshot(source.doc).parts).length).toBe(parts)
  })

  it('ignores clipboard payloads that are not ours', () => {
    expect(parseClipboard('not json')).toBeUndefined()
    expect(parseClipboard(JSON.stringify({ version: 2 }))).toBeUndefined()
  })
})
