import { strFromU8, strToU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { relationshipsPathFor, resolveTarget } from '../ooxml/package.js'
import { blankPresentation } from './blank.js'
import { copyContent, parseClipboard, pasteShapes, pasteSlides } from './clipboard.js'
import { presentationCodec } from './codec.js'
import { readShapes, slideKeys } from './commands.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'
import { presentationRoot, readSnapshot, setPart } from './ydoc.js'
import { REL_TYPES } from './xml.js'

async function open(bytes: Uint8Array, assets = memoryAssets()) {
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, { name: 'deck.pptx', assets })
  return { doc, assets }
}

describe('copy and paste between decks', () => {
  it('rechecks same-document asset contents after asynchronous paste preparation', async () => {
    const { doc, assets } = await open(fixture('generated/pictures.pptx'))
    const slide = readSnapshot(doc).slides[0]!
    const picture = slide.shapes.find((shape) => shape.kind === 'pic')!
    const clipboard = (await copyContent(doc, assets, { shapes: [picture] }, ''))
    const path = Object.values(picture.rels).find((rel) => rel.type === REL_TYPES.image)!.target
    const oldPart = readSnapshot(doc).parts[path]!
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const pasting = pasteShapes(doc, { ...assets, put: async (bytes, mimeType) => { started(); await gate; return assets.put(bytes, mimeType) } }, clipboard, slide.key, 0)
    await entered
    const replacement = await assets.put(strToU8('new picture while paste waits'), oldPart.asset!.mimeType)
    setPart(presentationRoot(doc), path, { ...oldPart, asset: replacement })
    release()
    const [key] = await pasting
    const after = readSnapshot(doc)
    const pasted = after.slides[0]!.shapes.find((shape) => shape.key === key)!
    const pastedPath = Object.values(pasted.rels).find((rel) => rel.type === REL_TYPES.image)!.target
    expect(pastedPath).not.toBe(path)
    expect(after.parts[pastedPath]!.asset!.hash).toBe(oldPart.asset!.hash)
    expect(after.parts[path]!.asset!.hash).toBe(replacement.hash)
    doc.destroy()
  })

  it.each(['picture', 'chart', 'workbook'])('preserves copied %s contents when its part is replaced in the same deck', async (kind) => {
    const { doc, assets } = await open(fixture(kind === 'picture' ? 'generated/pictures.pptx' : 'generated/charts.pptx'))
    const snapshot = readSnapshot(doc)
    const slide = snapshot.slides.find((slide) => slide.shapes.some((shape) => Object.values(shape.rels).some((rel) => rel.type === (kind === 'picture' ? REL_TYPES.image : REL_TYPES.chart))))!
    const shape = slide.shapes.find((shape) => Object.values(shape.rels).some((rel) => rel.type === (kind === 'picture' ? REL_TYPES.image : REL_TYPES.chart)))!
    const clipboard = parseClipboard(JSON.stringify(await copyContent(doc, assets, { shapes: [shape] }, '')))!
    const rootPart = Object.values(shape.rels).find((rel) => rel.type === (kind === 'picture' ? REL_TYPES.image : REL_TYPES.chart))!.target
    const changedPath = kind === 'workbook' ? Object.keys(clipboard.parts).find((path) => path.endsWith('.xlsx'))! : rootPart
    const original = Uint8Array.from(atob(clipboard.parts[changedPath]!.data), (char) => char.charCodeAt(0))
    const current = snapshot.parts[changedPath]!
    const replacement = current.asset ? strToU8('replacement asset bytes') : strToU8(strFromU8(original).replace(/<c:v>([^<]*)<\/c:v>/, '<c:v>Replacement</c:v>'))
    expect(replacement).not.toEqual(original)
    setPart(presentationRoot(doc), changedPath, current.asset ? { ...current, asset: await assets.put(replacement, current.asset.mimeType) } : { ...current, bytes: replacement })
    const [pastedKey] = await pasteShapes(doc, assets, clipboard, slide.key, 0)
    const pasted = readSnapshot(doc).slides.find((entry) => entry.key === slide.key)!.shapes.find((entry) => entry.key === pastedKey)!
    const pastedRoot = Object.values(pasted.rels).find((rel) => rel.type === (kind === 'picture' ? REL_TYPES.image : REL_TYPES.chart))!.target
    expect(pastedRoot).not.toBe(rootPart)
    const out = unzipSync(await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets }))
    let pastedPart = pastedRoot
    if (kind === 'workbook') {
      const rels = strFromU8(out[relationshipsPathFor(pastedRoot)]!)
      pastedPart = resolveTarget(pastedRoot, /Target="([^"]+\.xlsx)"/.exec(rels)![1]!)
    }
    expect(out[pastedPart]).toEqual(original)
    expect(out[changedPath]).toEqual(replacement)
    doc.destroy()
  })

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
