import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { presentationCodec } from './codec.js'
import {
  addSlide,
  deleteShapes,
  deleteSlides,
  duplicateSlides,
  groupShapes,
  insertShapes,
  insertTableRow,
  moveSlides,
  presetShape,
  readXfrm,
  reorderShapes,
  setShapeProperty,
  setShapeText,
  setSlideHidden,
  setXfrm,
  shapeFragment,
  slideKeys,
  tableShape,
  ungroupShape,
} from './commands.js'
import { DeckResources } from './render/deck.js'
import { plainToText } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'
import { readSnapshot } from './ydoc.js'
import { stableStringify } from './xml.js'

/** A small deterministic PRNG, so failures reproduce from the seed. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (max: number) => Math.floor(next() * max), pick: <T,>(items: readonly T[]): T | undefined => items[Math.floor(next() * items.length)] }
}

function topShapes(doc: Y.Doc, slide: string): string[] {
  return readSnapshot(doc).slides.find((entry) => entry.key === slide)?.shapes.map((shape) => shape.key) ?? []
}

function randomEdit(doc: Y.Doc, rng: ReturnType<typeof random>, layouts: string[]): void {
  const slides = slideKeys(doc)
  const slide = rng.pick(slides)
  const shapes = slide ? topShapes(doc, slide) : []
  const shape = rng.pick(shapes)
  const origin = { local: true }
  switch (rng.int(14)) {
    case 0:
      if (slide && shape) setShapeText(doc, slide, shape, plainToText(`Text ${rng.int(1000)}\nline ${rng.int(10)}`), origin)
      break
    case 1: {
      // Typing in the middle of a paragraph, as the inline editor would.
      const fragment = slide && shape ? shapeFragment(doc, slide, shape, origin) : undefined
      const paragraph = fragment?.get(0)
      const text = paragraph instanceof Y.XmlElement ? paragraph.get(0) : undefined
      if (text instanceof Y.XmlText) doc.transact(() => text.insert(rng.int(text.length + 1), `t${rng.int(9)}`, rng.int(2) ? { b: { value: true } } : {}), origin)
      break
    }
    case 2:
      if (slide && shape) setXfrm(doc, slide, shape, rng.int(2) ? { x: rng.int(9_000_000), y: rng.int(5_000_000) } : { cx: 100_000 + rng.int(3_000_000), rot: rng.int(4) * 5_400_000 }, origin)
      break
    case 3:
      if (slide && shape) setShapeProperty(doc, slide, [shape], 'fill', `<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="${rng.int(0xffffff).toString(16).padStart(6, '0').toUpperCase()}"/></a:solidFill>`, origin)
      break
    case 4:
      if (slide) insertShapes(doc, slide, [presetShape(rng.pick(['rect', 'ellipse', 'star5', 'rightArrow', 'line'])!, { x: rng.int(9_000_000), y: rng.int(5_000_000), cx: 900_000, cy: 600_000 }, 'Shape')], origin)
      break
    case 5:
      if (slide && shape) deleteShapes(doc, slide, [shape], origin)
      break
    case 6:
      addSlide(doc, new DeckResources(readSnapshot(doc).parts, 'ppt/presentation.xml'), rng.pick(layouts)!, rng.int(slides.length + 1), origin)
      break
    case 7:
      if (slide) duplicateSlides(doc, [slide], origin)
      break
    case 8:
      if (slide && slides.length > 2) deleteSlides(doc, [slide], origin)
      break
    case 9:
      if (slide) moveSlides(doc, [slide], rng.int(slides.length), origin)
      break
    case 10:
      if (slide) setSlideHidden(doc, [slide], rng.int(2) === 0, origin)
      break
    case 11: {
      if (!slide || shapes.length < 2) break
      const keys = [shapes[0]!, shapes[1]!]
      const xfrms = new Map(keys.map((key) => [key, readXfrm(doc, slide, key) ?? { x: 0, y: 0, cx: 100, cy: 100 }]))
      groupShapes(doc, slide, keys, xfrms, 'Group', origin)
      break
    }
    case 12: {
      const group = slide && readSnapshot(doc).slides.find((entry) => entry.key === slide)?.shapes.find((entry) => entry.kind === 'grpSp')
      if (slide && group) ungroupShape(doc, slide, group.key, origin)
      else if (slide) reorderShapes(doc, slide, shape ? [shape] : [], rng.pick(['front', 'back', 'forward', 'backward'] as const)!, origin)
      break
    }
    case 13: {
      const table = slide && readSnapshot(doc).slides.find((entry) => entry.key === slide)?.shapes.find((entry) => entry.table)
      if (slide && table) insertTableRow(doc, slide, table.key, rng.int(3), origin)
      else if (slide) insertShapes(doc, slide, [tableShape(2, 2, { x: 0, y: 0, cx: 2_000_000, cy: 600_000 }, 'Table')], origin)
      break
    }
  }
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('concurrent editing', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`converges and exports a valid deck (seed ${seed})`, async () => {
      const rng = random(seed)
      const assets = memoryAssets()
      const context = { name: 'deck.pptx', assets }
      const base = new Y.Doc()
      await presentationCodec.importFile(base, fixture('generated/layouts-notes-sections.pptx'), context)
      const replicas = [0, 1, 2].map(() => {
        const doc = new Y.Doc()
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
        return doc
      })
      const layouts = Object.keys(readSnapshot(base).parts).filter((path) => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml'))
      for (let round = 0; round < 40; round++) {
        for (const doc of replicas) for (let edit = 0; edit < 3; edit++) randomEdit(doc, rng, layouts)
        if (rng.int(3) === 0) sync(replicas[rng.int(3)]!, replicas[rng.int(3)]!)
      }
      sync(replicas[0]!, replicas[1]!)
      sync(replicas[1]!, replicas[2]!)
      sync(replicas[0]!, replicas[1]!)
      const snapshots = replicas.map((doc) => stableStringify(readSnapshot(doc)))
      expect(snapshots[1]).toBe(snapshots[0])
      expect(snapshots[2]).toBe(snapshots[0])

      const exported = await presentationCodec.exportFile(replicas[0]!, context)
      const reread = new Y.Doc()
      await presentationCodec.importFile(reread, exported, context)
      const snapshot = readSnapshot(reread)
      expect(snapshot.slides.length).toBe(readSnapshot(replicas[0]!).slides.length)
      expect(presentationCodec.toText(reread)).toBe(presentationCodec.toText(replicas[0]!))
      for (const slide of snapshot.slides) {
        const ids: number[] = []
        const walk = (shapes: typeof slide.shapes) => shapes.forEach((shape) => (shape.nvId !== undefined && ids.push(shape.nvId), walk(shape.children ?? [])))
        walk(slide.shapes)
        expect(new Set(ids).size, `unique shape ids on ${slide.part}`).toBe(ids.length)
      }
      // Exporting again is stable: a second round trip changes nothing.
      expect(unzipSync(await presentationCodec.exportFile(reread, context))).toEqual(unzipSync(exported))
    }, 60_000)
  }
})
