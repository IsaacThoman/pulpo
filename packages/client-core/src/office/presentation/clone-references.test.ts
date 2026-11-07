import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { copyContent, parseClipboard, pasteShapes } from './clipboard.js'
import { presentationCodec } from './codec.js'
import { cloneShape, cloneShapes, duplicateShapes, duplicateSlides, groupShapes, presetShape, readSlide, readXfrm, slideKeys } from './commands.js'
import type { ShapeSnapshot } from './model.js'
import { memoryAssets } from './testing/assets.js'
import { assertReadableZip, fidelityAvailable, fixture, runPython, runTool, scratchDir, writeScratch } from './testing/fixtures.js'
import { presentationRoot, readSnapshot } from './ydoc.js'
import { attr, childElements, NS, parseFragment } from './xml.js'

async function open() {
  const doc = new Y.Doc()
  const assets = memoryAssets()
  await presentationCodec.importFile(doc, fixture('generated/autoshapes.pptx'), { name: 'deck.pptx', assets })
  return { doc, assets, slide: readSnapshot(doc).slides[4]! }
}

function endpoint(shape: ShapeSnapshot, name: 'stCxn' | 'endCxn'): number | undefined {
  const stack = [parseFragment(shape.xml)]
  while (stack.length) {
    const node = stack.pop()!
    if (node.localName === name) return Number(attr(node, 'id'))
    stack.push(...childElements(node))
  }
  return undefined
}

const selected = (shapes: ShapeSnapshot[], ids = [11, 12, 14]) => shapes.filter((shape) => ids.includes(shape.nvId!))

describe('cloned in-slide shape references', () => {
  it('duplicates connected shapes together and keeps references through export and undo', async () => {
    const { doc, assets, slide } = await open()
    const origin = {}
    const undo = new Y.UndoManager(presentationRoot(doc), { trackedOrigins: new Set([origin]) })
    const keys = duplicateShapes(doc, slide.key, selected(slide.shapes).map((shape) => shape.key), 100, origin)
    const copies = readSlide(doc, slide.key)!.shapes.filter((shape) => keys.includes(shape.key))
    const [start, end, connector] = copies
    expect(endpoint(connector!, 'stCxn')).toBe(start!.nvId)
    expect(endpoint(connector!, 'endCxn')).toBe(end!.nvId)
    expect(new Set([...slide.shapes, ...copies].map((shape) => shape.nvId)).size).toBe(slide.shapes.length + copies.length)
    const bytes = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    assertReadableZip(bytes)
    const reopened = new Y.Doc()
    await presentationCodec.importFile(reopened, bytes, { name: 'deck.pptx', assets })
    const exported = readSnapshot(reopened).slides[4]!.shapes.slice(-3)
    expect(endpoint(exported[2]!, 'stCxn')).toBe(exported[0]!.nvId)
    expect(endpoint(exported[2]!, 'endCxn')).toBe(exported[1]!.nvId)
    if (fidelityAvailable()) {
      const file = writeScratch(scratchDir(), 'cloned-connectors.pptx', bytes)
      expect(runPython('import sys\nfrom pptx import Presentation\np=Presentation(sys.argv[1]);s=p.slides[4].shapes\nassert s[-1]._element.nvCxnSpPr.cNvCxnSpPr.stCxn.id==s[-3].shape_id\nassert s[-1]._element.nvCxnSpPr.cNvCxnSpPr.endCxn.id==s[-2].shape_id\nprint("ok")', file).trim()).toBe('ok')
      expect(runTool('lo_open_check.sh', [file]).output).toContain('ok ')
    }
    undo.undo()
    expect(readSlide(doc, slide.key)!.shapes).toHaveLength(slide.shapes.length)
    undo.redo()
    expect(endpoint(readSlide(doc, slide.key)!.shapes.at(-1)!, 'stCxn')).toBe(start!.nvId)
    undo.destroy()
    reopened.destroy()
    doc.destroy()
  }, 300_000)

  it.each(['same slide', 'another slide', 'another deck'].flatMap((mode) => [false, true].map((both) => ({ mode, both }))))('pastes connected shapes onto $mode (both endpoints: $both)', async ({ mode, both }) => {
    const source = await open()
    const target = mode === 'another deck' ? await open() : source
    const destination = mode === 'same slide' || mode === 'another deck' ? target.slide.key : slideKeys(target.doc)[0]!
    const clipboard = parseClipboard(JSON.stringify(await copyContent(source.doc, source.assets, { shapes: selected(source.slide.shapes, both ? [11, 12, 14] : [11, 14]), slideKey: source.slide.key }, '')))!
    const keys = await pasteShapes(target.doc, target.assets, clipboard, destination, 100)
    const copies = readSlide(target.doc, destination)!.shapes.filter((shape) => keys.includes(shape.key))
    const start = copies[0]!
    const connector = copies.at(-1)!
    const expectedEnd = both ? copies[1]!.nvId : mode === 'same slide' ? 12 : undefined
    expect(endpoint(connector!, 'stCxn')).toBe(start!.nvId)
    expect(endpoint(connector!, 'endCxn')).toBe(expectedEnd)
    const bytes = await presentationCodec.exportFile(target.doc, { name: 'deck.pptx', assets: target.assets })
    const fresh = new Y.Doc()
    await presentationCodec.importFile(fresh, bytes, { name: 'deck.pptx', assets: target.assets })
    const index = slideKeys(target.doc).indexOf(destination)
    const exported = readSnapshot(fresh).slides[index]!.shapes.slice(-copies.length)
    expect(endpoint(exported.at(-1)!, 'stCxn')).toBe(exported[0]!.nvId)
    expect(endpoint(exported.at(-1)!, 'endCxn')).toBe(expectedEnd)
    fresh.destroy()
    if (source !== target) target.doc.destroy()
    source.doc.destroy()
  })

  it('remaps every member when a connected group is cloned', async () => {
    const { doc, slide } = await open()
    const keys = selected(slide.shapes).map((shape) => shape.key)
    const group = groupShapes(doc, slide.key, keys, new Map(keys.map((key) => [key, readXfrm(doc, slide.key, key)!])), 'Connected group')!
    const [copy] = duplicateShapes(doc, slide.key, [group], 100)
    const [start, end, connector] = readSlide(doc, slide.key)!.shapes.find((shape) => shape.key === copy)!.children!
    expect(endpoint(connector!, 'stCxn')).toBe(start!.nvId)
    expect(endpoint(connector!, 'endCxn')).toBe(end!.nvId)
    doc.destroy()
  })

  it('remaps timing and other spid references along with whole-slide duplication', async () => {
    const { doc, assets, slide } = await open()
    const store = (presentationRoot(doc).get('slides') as Y.Map<Y.Map<unknown>>).get(slide.key)!
    store.set('xml', slide.xml.replace('</p:sld>', `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:par><p:cTn id="2"><p:childTnLst><p:anim><p:cBhvr><p:cTn id="3"/><p:tgtEl><p:spTgt spid="11"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="12" grpId="0"/></p:bldLst></p:timing><p:extLst><p:ext uri="test"><x:target xmlns:x="urn:test" spid="13"/><x:frame xmlns:x="urn:test" spid="1"/></p:ext></p:extLst></p:sld>`))
    store.set('background', `<p:bg xmlns:p="${NS.p}"><p:bgPr><a:noFill xmlns:a="${NS.a}"/></p:bgPr><p:extLst><p:ext uri="test"><x:target xmlns:x="urn:test" spid="11"/></p:ext></p:extLst></p:bg>`)
    const [key] = duplicateSlides(doc, [slide.key])
    const copy = readSlide(doc, key!)!
    const ids = new Map(slide.shapes.map((shape, index) => [shape.nvId, copy.shapes[index]!.nvId]))
    expect(endpoint(copy.shapes.find((shape) => shape.kind === 'cxnSp')!, 'stCxn')).toBe(ids.get(11))
    expect(copy.xml).toContain(`spid="${ids.get(11)}"`)
    expect(copy.xml).toContain(`spid="${ids.get(12)}"`)
    expect(copy.xml).toContain(`spid="${ids.get(13)}"`)
    expect(copy.xml).toContain('spid="1"')
    expect(copy.background).toContain(`spid="${ids.get(11)}"`)
    const bytes = await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets })
    const fresh = new Y.Doc()
    await presentationCodec.importFile(fresh, bytes, { name: 'deck.pptx', assets })
    const reread = readSnapshot(fresh).slides[5]!
    expect(strFromU8(unzipSync(bytes)[reread.part!]!)).toContain(`spid="${ids.get(11)}"`)
    expect(endpoint(reread.shapes.find((shape) => shape.kind === 'cxnSp')!, 'stCxn')).toBe(ids.get(11))
    fresh.destroy()
    doc.destroy()
  })

  it('remaps definitions and references in every preserved AlternateContent branch', () => {
    const shape: ShapeSnapshot = { key: 'opaque', kind: 'opaque', rels: {}, xml: `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:p="${NS.p}" xmlns:a="${NS.a}"><mc:Choice Requires="test"><p:sp><p:nvSpPr><p:cNvPr id="101" name="A"/></p:nvSpPr><a:stCxn id="102" idx="0"/></p:sp></mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="102" name="B"/></p:nvSpPr><p:spTgt spid="101"/></p:sp></mc:Fallback></mc:AlternateContent>` }
    const copy = cloneShape(shape)
    const ids = [...copy.xml.matchAll(/cNvPr id="(\d+)"/g)].map((match) => Number(match[1]))
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain(101)
    expect(ids).not.toContain(102)
    expect(endpoint(copy, 'stCxn')).toBe(ids[1])
    expect(copy.xml).toContain(`spid="${ids[0]}"`)
  })

  it('assigns separate IDs to new templates and remaps references in modeled text XML', async () => {
    const { doc, slide } = await open()
    const a = presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'New A')
    const b = presetShape('rect', { x: 0, y: 0, cx: 100, cy: 100 }, 'New B')
    const original = selected(slide.shapes, [11])[0]!
    const extended = { ...original, bodyPr: `<a:bodyPr xmlns:a="${NS.a}"><a:extLst><a:ext uri="test"><x:target xmlns:x="urn:test" spid="11"/></a:ext></a:extLst></a:bodyPr>`, text: { type: 'doc', content: [{ type: 'paragraph', attrs: { pPr: `<a:pPr xmlns:a="${NS.a}"><a:extLst><a:ext uri="test"><x:target xmlns:x="urn:test" spid="11"/></a:ext></a:extLst></a:pPr>` } }] } }
    const [first, second, third] = cloneShapes([a, b, extended], slide, false)
    expect(first!.nvId).not.toBe(second!.nvId)
    expect(first!.xml).toContain(`id="${first!.nvId}"`)
    expect(second!.xml).toContain(`id="${second!.nvId}"`)
    expect(third!.bodyPr).toContain(`spid="${third!.nvId}"`)
    expect(third!.text!.content![0]!.attrs!.pPr).toContain(`spid="${third!.nvId}"`)
    expect(extended.bodyPr).toContain('spid="11"')
    doc.destroy()
  })

  it('keeps OLE string spids that refer to VML rather than in-slide shape IDs', async () => {
    const { doc, slide } = await open()
    const shape: ShapeSnapshot = { key: 'ole', kind: 'opaque', rels: {}, xml: `<p:graphicFrame xmlns:p="${NS.p}"><p:nvGraphicFramePr><p:cNvPr id="101"/></p:nvGraphicFramePr><p:oleObj spid="_x0000_s1026"/></p:graphicFrame>` }
    expect(cloneShapes([shape], slide, false)[0]!.xml).toContain('spid="_x0000_s1026"')
    doc.destroy()
  })

  it('keeps independently duplicated sets connected after concurrent edits merge', async () => {
    const { doc: alice, assets, slide } = await open()
    const bob = new Y.Doc()
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice))
    const keys = selected(slide.shapes).map((shape) => shape.key)
    const a = duplicateShapes(alice, slide.key, keys, 100)
    const b = duplicateShapes(bob, slide.key, keys, 200)
    Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob))
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice))
    for (const doc of [alice, bob]) {
      const shapes = readSlide(doc, slide.key)!.shapes
      expect(new Set(shapes.map((shape) => shape.nvId)).size).toBe(shapes.length)
      for (const copied of [a, b]) {
        const [start, end, connector] = shapes.filter((shape) => copied.includes(shape.key))
        expect(endpoint(connector!, 'stCxn')).toBe(start!.nvId)
        expect(endpoint(connector!, 'endCxn')).toBe(end!.nvId)
      }
    }
    const bytes = await presentationCodec.exportFile(alice, { name: 'deck.pptx', assets })
    expect(await presentationCodec.exportFile(bob, { name: 'deck.pptx', assets })).toEqual(bytes)
    alice.destroy()
    bob.destroy()
  })
})
