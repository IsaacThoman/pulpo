import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from './blank.js'
import { presentationCodec } from './codec.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'

const context = (name = 'deck.pptx') => ({ name, assets: memoryAssets() })

describe('presentationCodec', () => {
  it('round-trips the blank deck with every part byte-identical', async () => {
    const ctx = context()
    const doc = new Y.Doc()
    const bytes = blankPresentation()
    await presentationCodec.importFile(doc, bytes, ctx)
    const out = await presentationCodec.exportFile(doc, ctx)
    const before = unzipSync(bytes)
    const after = unzipSync(out)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    for (const [path, data] of Object.entries(before)) expect(Buffer.from(after[path]!).equals(Buffer.from(data)), path).toBe(true)
  })

  it('reads text, including speaker notes', async () => {
    const ctx = context()
    const doc = new Y.Doc()
    await presentationCodec.importFile(doc, fixture('generated/text-formatting.pptx'), ctx)
    const text = presentationCodec.toText(doc)
    expect(text).toContain('--- Slide 2 ---\nCharacter formatting')
    expect(text).toContain('Each line exercises one run property.')
  })
})
