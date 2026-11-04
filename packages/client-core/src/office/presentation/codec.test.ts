import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from './blank.js'
import { presentationCodec } from './codec.js'
import { memoryAssets } from './testing/assets.js'

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

  it('reads text', async () => {
    const ctx = context()
    const doc = new Y.Doc()
    await presentationCodec.importFile(doc, readFileSync('/tmp/pptx-ws6/basic.pptx'), ctx)
    expect(presentationCodec.toText(doc)).toContain('World\nSecond')
    expect(presentationCodec.toText(doc)).toContain('My notes')
    const out = await presentationCodec.exportFile(doc, ctx)
    const before = unzipSync(readFileSync('/tmp/pptx-ws6/basic.pptx'))
    const after = unzipSync(out)
    for (const [path, data] of Object.entries(before)) expect(Buffer.from(after[path]!).equals(Buffer.from(data)), path).toBe(true)
  })
})
