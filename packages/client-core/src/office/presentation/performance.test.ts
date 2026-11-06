import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { presentationCodec } from './codec.js'
import { cloneSlide, insertSlides, readSlide, setShapeText, slideKeys } from './commands.js'
import { plainToText } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'
import { readSnapshot } from './ydoc.js'

/**
 * Loose budgets for big decks, so regressions of an order of magnitude fail. The numbers are a
 * few times what a laptop takes (recorded in docs/presentations.md), to stay stable on CI.
 */
const SLIDES = 300

describe('performance', () => {
  it(`imports, exports, diffs, and re-applies a ${SLIDES}-slide deck within budget`, async () => {
    const assets = memoryAssets()
    const context = { name: 'big.pptx', assets }
    const seed = new Y.Doc()
    await presentationCodec.importFile(seed, fixture('generated/autoshapes.pptx'), context)
    const keys = slideKeys(seed)
    const copies = Array.from({ length: SLIDES - keys.length }, (_, index) => cloneSlide(readSlide(seed, keys[index % keys.length]!)!))
    insertSlides(seed, copies, keys.length)
    const bytes = await presentationCodec.exportFile(seed, context)

    const timings: Record<string, number> = {}
    const time = async <T,>(name: string, run: () => Promise<T> | T): Promise<T> => {
      const started = performance.now()
      const result = await run()
      timings[name] = Math.round(performance.now() - started)
      return result
    }
    const heapBefore = process.memoryUsage().heapUsed
    const doc = new Y.Doc()
    await time('import', () => presentationCodec.importFile(doc, bytes, context))
    const update = await time('encode', () => Y.encodeStateAsUpdate(doc))
    const replica = new Y.Doc()
    await time('sync', () => Y.applyUpdate(replica, update))
    await time('snapshot', () => readSnapshot(replica))
    await time('text', () => presentationCodec.toText(replica))
    const exported = await time('export', () => presentationCodec.exportFile(replica, context))
    // A one-slide change re-exports: untouched slides take the fast path.
    const target = slideKeys(replica)[150]!
    setShapeText(replica, target, readSnapshot(replica).slides[150]!.shapes[0]!.key, plainToText('Changed'))
    await time('exportAfterEdit', () => presentationCodec.exportFile(replica, context))
    await time('applyFile', () => presentationCodec.applyFile(doc, exported, context))
    const heapGrowth = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024)
    console.info(`performance (${SLIDES} slides, ${Math.round(bytes.byteLength / 1024)} KB zipped, Yjs update ${Math.round(update.byteLength / 1024)} KB, heap +${heapGrowth} MB):`, timings)
    expect(timings.import).toBeLessThan(15_000)
    expect(timings.export).toBeLessThan(15_000)
    expect(timings.exportAfterEdit).toBeLessThan(15_000)
    expect(timings.applyFile).toBeLessThan(20_000)
    expect(timings.text).toBeLessThan(5_000)
    // The document keeps templates and original slide bytes next to the model (for lossless
    // export), so it is a few times the uncompressed package (about 4× for shape-heavy decks).
    const uncompressed = Object.values(unzipSync(bytes)).reduce((sum, part) => sum + part.byteLength, 0)
    expect(update.byteLength).toBeLessThan(uncompressed * 5)
  }, 120_000)
})
