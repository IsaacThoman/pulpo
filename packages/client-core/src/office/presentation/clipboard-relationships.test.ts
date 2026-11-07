import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { OoxmlPackage, relationshipsPathFor, resolveTarget } from '../ooxml/package.js'
import { blankPresentation } from './blank.js'
import { copyContent, parseClipboard, pasteShapes, pasteSlides } from './clipboard.js'
import { presentationCodec } from './codec.js'
import { cloneSlide, groupShapes, insertShapes, insertSlides, presetShape, readXfrm, slideKeys } from './commands.js'
import { DeckResources } from './render/deck.js'
import { renderSlide } from './render/slide.js'
import { memoryAssets } from './testing/assets.js'
import { assertReadableZip, fidelityAvailable, fixture, runPython, runTool, scratchDir, writeScratch } from './testing/fixtures.js'
import { readSnapshot } from './ydoc.js'
import { NS, REL_TYPES } from './xml.js'

async function open(bytes: Uint8Array) {
  const doc = new Y.Doc()
  const assets = memoryAssets()
  await presentationCodec.importFile(doc, bytes, { name: 'deck.pptx', assets })
  return { doc, assets }
}

function checkRelationships(bytes: Uint8Array): void {
  const pkg = OoxmlPackage.read(bytes)
  for (const source of pkg.paths().filter((path) => !path.endsWith('.rels'))) for (const rel of pkg.relationships(source)) {
    if (rel.targetMode !== 'External') expect(pkg.has(resolveTarget(source, rel.target)), `${source} → ${rel.target}`).toBe(true)
  }
}

describe('clipboard relationship closure', () => {
  it.each(['same deck', 'another deck', 'whole slide'])('copies SmartArt and binds its cached drawing on %s', async (mode) => {
    const source = await open(fixture('poi/SmartArt.pptx'))
    const initial = readSnapshot(source.doc).slides[0]!
    insertShapes(source.doc, initial.key, [{ ...presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'Local id collision'), rels: { rId6: { type: REL_TYPES.hyperlink, target: 'https://example.test/local', external: true } } }])
    const before = readSnapshot(source.doc)
    const slide = before.slides[0]!
    const smartArt = slide.shapes[0]!
    const clipboard = parseClipboard(JSON.stringify(await copyContent(source.doc, source.assets, mode === 'whole slide' ? { slides: [slide] } : { shapes: [smartArt], slideKey: slide.key }, '')))!
    for (const rel of [...Object.values(smartArt.rels), ...Object.values(slide.rels).filter((rel) => rel.type === REL_TYPES.diagramDrawing)]) expect(clipboard.parts[rel.target]).toBeDefined()
    const target = mode === 'same deck' ? source : await open(blankPresentation())
    const targetSlide = cloneSlide(slide)
    targetSlide.shapes = []
    const collision = { type: REL_TYPES.hyperlink, target: 'https://example.test/keep', external: true }
    targetSlide.rels = { rId6: collision }
    const [destination] = insertSlides(target.doc, [targetSlide], 1)
    let pastedSlide = destination!
    let key: string | undefined
    if (mode === 'whole slide') [pastedSlide] = await pasteSlides(target.doc, target.assets, clipboard, 1) as [string]
    else [key] = await pasteShapes(target.doc, target.assets, clipboard, destination!, 0)
    const after = readSnapshot(target.doc)
    const pasted = after.slides.find((slide) => slide.key === pastedSlide)!
    const shape = pasted.shapes.find((shape) => key ? shape.key === key : shape.kind === 'graphicFrame')!
    const data = Object.values(shape.rels).find((rel) => rel.type === REL_TYPES.diagramData)!.target
    const xml = strFromU8(after.parts[data]!.bytes!)
    const drawingId = /dataModelExt\b[^>]*\brelId="([^"]+)"/.exec(xml)![1]!
    expect(pasted.rels[drawingId]!.type).toBe(REL_TYPES.diagramDrawing)
    if (mode !== 'whole slide') expect(pasted.rels.rId6).toEqual(collision)
    const html = renderSlide({ ...pasted, shapes: [shape], xml: `<p:sld xmlns:p="${NS.p}" showMasterSp="0"/>` }, after, { deck: new DeckResources(after.parts, after.mainPart), mode: 'view', idPrefix: 'copy', slideNumber: 1, assetUrl: () => 'blob:test' })
    expect(html).toContain('<path')
    const bytes = await presentationCodec.exportFile(target.doc, { name: 'deck.pptx', assets: target.assets })
    checkRelationships(bytes)
    const reopened = await open(bytes)
    expect(readSnapshot(reopened.doc).slides.some((slide) => Object.values(slide.rels).some((rel) => rel.type === REL_TYPES.diagramDrawing))).toBe(true)
    reopened.doc.destroy()
    if (target !== source) target.doc.destroy()
    source.doc.destroy()
  })

  it('pastes SmartArt, a chart and a picture in a group into a deck Office can reopen', async () => {
    const target = await open(blankPresentation())
    const dest = slideKeys(target.doc)[0]!
    for (const name of ['poi/SmartArt.pptx', 'generated/charts.pptx', 'generated/pictures.pptx']) {
      const source = await open(fixture(name))
      let slide = readSnapshot(source.doc).slides[0]!
      let shapes = slide.shapes.filter((shape) => name.includes('SmartArt') ? shape.kind === 'graphicFrame' : Object.values(shape.rels).some((rel) => rel.type === (name.includes('charts') ? REL_TYPES.chart : REL_TYPES.image)))
      if (name.includes('pictures')) {
        const picture = shapes[0]!
        const [other] = insertShapes(source.doc, slide.key, [presetShape('rect', picture.xfrm!, 'Group member')])
        const keys = [picture.key, other!]
        const boxes = new Map(keys.map((key) => [key, readXfrm(source.doc, slide.key, key)!]))
        const group = groupShapes(source.doc, slide.key, keys, boxes, 'Grouped picture')!
        slide = readSnapshot(source.doc).slides[0]!
        shapes = [slide.shapes.find((shape) => shape.key === group)!]
      }
      const copied = parseClipboard(JSON.stringify(await copyContent(source.doc, source.assets, { shapes, slideKey: slide.key }, '')))!
      expect(copied.shapes).toHaveLength(shapes.length)
      expect((await pasteShapes(target.doc, target.assets, copied, dest, 0)).length).toBe(shapes.length)
      source.doc.destroy()
    }
    const bytes = await presentationCodec.exportFile(target.doc, { name: 'deck.pptx', assets: target.assets })
    assertReadableZip(bytes)
    checkRelationships(bytes)
    const reopened = await open(bytes)
    const slide = readSnapshot(reopened.doc).slides[0]!
    expect(slide.shapes.some((shape) => shape.children?.some((child) => child.kind === 'pic'))).toBe(true)
    expect(slide.shapes.some((shape) => Object.values(shape.rels).some((rel) => rel.type === REL_TYPES.chart))).toBe(true)
    if (fidelityAvailable()) {
      const file = writeScratch(scratchDir(), 'copied-objects.pptx', bytes)
      const result = JSON.parse(runPython('import sys,json\nfrom pptx import Presentation\np=Presentation(sys.argv[1])\ns=p.slides[0].shapes\nprint(json.dumps({"slides":len(p.slides),"chart":any(x.has_chart for x in s),"grouped_picture":any(x.shape_type==6 and any(c.shape_type==13 for c in x.shapes) for x in s)}))', file))
      expect(result).toEqual({ slides: 1, chart: true, grouped_picture: true })
      expect(runTool('lo_open_check.sh', [file]).output).toContain('ok 1')
    }
    reopened.doc.destroy()
    target.doc.destroy()
  }, 300_000)

  it('follows every relationship namespace attribute in AlternateContent and recursive part graphs', async () => {
    const files = unzipSync(blankPresentation())
    const attributes = ['id', 'embed', 'link', 'dm', 'lo', 'qs', 'cs']
    const xml = `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><mc:Choice Requires="a"><p:oleObj r:id="ole"/></mc:Choice><mc:Fallback><a:extLst>${attributes.map((name) => `<a:ext r:${name}="${name}"/>`).join('')}</a:extLst></mc:Fallback></mc:AlternateContent>`
    files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']!).replace('</p:spTree>', `${xml}</p:spTree>`))
    const rels = 'ppt/slides/_rels/slide1.xml.rels'
    files[rels] = strToU8(strFromU8(files[rels]!).replace('</Relationships>', [...attributes, 'ole'].map((id) => `<Relationship Id="${id}" Type="${REL_TYPES.image}" Target="../custom/${id}.xml"/>`).join('') + '</Relationships>'))
    for (const id of [...attributes, 'ole']) {
      files[`ppt/custom/${id}.xml`] = strToU8(`<w xmlns:r="${NS.r}" r:embed="nested"/>`)
      files[relationshipsPathFor(`ppt/custom/${id}.xml`)] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="nested" Type="${REL_TYPES.image}" Target="nested.xml"/></Relationships>`)
    }
    files['ppt/custom/nested.xml'] = strToU8('<nested/>')
    const source = await open(zipSync(files))
    const slide = readSnapshot(source.doc).slides[0]!
    const selected = structuredClone(slide.shapes.find((shape) => shape.kind === 'opaque')!)
    // The collector must resolve preserved XML against its source scope, even without cached shape rels.
    selected.rels = {}
    const copied = await copyContent(source.doc, source.assets, { shapes: [selected], slideKey: slide.key }, '')
    for (const id of [...attributes, 'ole', 'nested']) expect(copied.parts[`ppt/custom/${id}.xml`]).toBeDefined()
    expect(Object.keys(copied.parts).filter((path) => path.endsWith('nested.xml'))).toHaveLength(1)
    source.doc.destroy()
  })
})
