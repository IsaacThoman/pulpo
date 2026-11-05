import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { LiveFormatError } from '../live-format.js'
import { presentationCodec } from './codec.js'
import { readSnapshot } from './ydoc.js'
import { memoryAssets } from './testing/assets.js'
import { corpus, fidelityAvailable, fixture, hostileCorpus, runTool, scratchDir, writeScratch } from './testing/fixtures.js'
import { readFileSync } from 'node:fs'

async function roundTrip(bytes: Uint8Array, name: string) {
  const context = { name, assets: memoryAssets() }
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, bytes, context)
  // Through a second replica, so the test covers what syncs, not just the local document.
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
  return { doc: replica, out: await presentationCodec.exportFile(replica, context), context }
}

describe('presentation round trip', () => {
  for (const entry of corpus()) {
    it(`keeps every part of ${entry.name} byte for byte`, async () => {
      const bytes = new Uint8Array(readFileSync(entry.path))
      const { out } = await roundTrip(bytes, entry.name)
      const before = unzipSync(bytes)
      const after = unzipSync(out)
      const normalize = (name: string) => name.replace(/^\//, '')
      const beforeNames = Object.keys(before).filter((name) => !name.endsWith('/')).map(normalize).sort()
      expect(Object.keys(after).sort()).toEqual(beforeNames)
      const changed = Object.entries(before)
        .filter(([name]) => !name.endsWith('/'))
        .filter(([name, data]) => !Buffer.from(after[normalize(name)] ?? new Uint8Array()).equals(Buffer.from(data)))
        .map(([name]) => name)
      expect(changed).toEqual([])
    })
  }

  it('exports text for every fixture', async () => {
    for (const entry of corpus()) {
      const doc = new Y.Doc()
      await presentationCodec.importFile(doc, fixture(entry.name), { name: entry.name, assets: memoryAssets() })
      const text = presentationCodec.toText(doc)
      expect(text, entry.name).toContain('--- Slide 1')
    }
  })

  it('reads speaker notes, hidden slides, and sections', async () => {
    const doc = new Y.Doc()
    await presentationCodec.importFile(doc, fixture('generated/layouts-notes-sections.pptx'), { name: 'deck.pptx', assets: memoryAssets() })
    const snapshot = readSnapshot(doc)
    expect(snapshot.slides[3]!.hidden).toBe(true)
    expect(snapshot.sections.length).toBe(3)
    expect(snapshot.slides.every((slide) => slide.section)).toBe(true)
    expect(snapshot.slides.filter((slide) => slide.notes).length).toBe(snapshot.slides.length)
    expect(presentationCodec.toText(doc)).toContain('(hidden)')
  })

  it('keeps vbaProject.bin in macro decks and drops it when saved as .pptx', async () => {
    const bytes = fixture('poi/SimpleMacro.pptm')
    const context = { name: 'deck.pptm', assets: memoryAssets() }
    const doc = new Y.Doc()
    await presentationCodec.importFile(doc, bytes, context)
    const asPptm = unzipSync(await presentationCodec.exportFile(doc, context))
    expect(asPptm['ppt/vbaProject.bin']).toEqual(unzipSync(bytes)['ppt/vbaProject.bin'])
    const asPptx = unzipSync(await presentationCodec.exportFile(doc, { ...context, name: 'deck.pptx' }))
    expect(asPptx['ppt/vbaProject.bin']).toBeUndefined()
    expect(new TextDecoder().decode(asPptx['[Content_Types].xml'])).toContain('presentationml.presentation.main+xml')
    expect(new TextDecoder().decode(asPptx['[Content_Types].xml'])).not.toContain('vbaProject')
  })

  it('writes the content type of the requested format', async () => {
    const doc = new Y.Doc()
    const context = { name: 'deck.pptx', assets: memoryAssets() }
    await presentationCodec.importFile(doc, fixture('generated/theme-custom-template.potx'), context)
    const types = new TextDecoder().decode(unzipSync(await presentationCodec.exportFile(doc, context))['[Content_Types].xml'])
    expect(types).toContain('presentationml.presentation.main+xml')
    expect(types).not.toContain('template.main')
  })
})

describe('hostile presentations', () => {
  for (const entry of hostileCorpus()) {
    it(`handles ${entry.name} with a typed error or a clean import`, async () => {
      const started = Date.now()
      const doc = new Y.Doc()
      const context = { name: 'deck.pptx', assets: memoryAssets() }
      try {
        await presentationCodec.importFile(doc, fixture(entry.name), context)
        // Whatever imported must export to something that imports again.
        const out = await presentationCodec.exportFile(doc, context)
        await presentationCodec.importFile(new Y.Doc(), out, context)
        presentationCodec.toText(doc)
      } catch (error) {
        expect(error, String(error)).toBeInstanceOf(LiveFormatError)
      }
      expect(Date.now() - started).toBeLessThan(30_000)
    }, 30_000)
  }

  it('refuses garbage, legacy binaries, and empty input', async () => {
    const context = { name: 'deck.pptx', assets: memoryAssets() }
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('not a deck'), new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0])]) {
      await expect(presentationCodec.importFile(new Y.Doc(), bytes, context)).rejects.toBeInstanceOf(LiveFormatError)
    }
  })
})

describe.runIf(fidelityAvailable())('round trip fidelity (python-pptx and LibreOffice)', () => {
  const directory = scratchDir()
  for (const entry of corpus()) {
    it(`${entry.name} reads the same in python-pptx and opens in LibreOffice`, async () => {
      const bytes = new Uint8Array(readFileSync(entry.path))
      const { out } = await roundTrip(bytes, entry.name)
      const extension = entry.name.slice(entry.name.lastIndexOf('.'))
      const original = writeScratch(directory, `original-${entry.name.replace('/', '-')}`, bytes)
      const exported = writeScratch(directory, `exported-${entry.name.replace('/', '-').replace(extension, '')}${extension}`, out)
      runTool('pptx_compare.py', [original, exported, '--roundtrip'])
      runTool('lo_open_check.sh', [exported])
    }, 300_000)
  }
})
