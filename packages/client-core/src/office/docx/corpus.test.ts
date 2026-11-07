import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { LiveFormatError } from '../live-format.js'
import { OoxmlPackage } from '../ooxml/package.js'
import { docxCodec } from './codec.js'
import { MemoryAssetStore } from './memory-assets.js'
import { readDocxModel } from './model.js'
import { canonicalDiff, canonicalXml } from './canonical.js'
import { exportDocx } from './export.js'

/**
 * Round trips over a corpus outside the repository: `PULPO_DOCX_CORPUS=/path/to/docx-files`.
 * `scripts/fetch-docx-corpus.mjs` downloads Apache POI's Word test files there.
 */
const corpus = process.env.PULPO_DOCX_CORPUS

/** Paragraph ids the exporter may add (comments) or drop (duplicates) on purpose. */
function withoutParaIds(json: unknown): unknown {
  return JSON.parse(JSON.stringify(json), (key, value) => {
    if (key !== 'xmlAttrs' || typeof value !== 'string') return value
    const { 'w14:paraId': _paraId, 'w14:textId': _textId, ...rest } = JSON.parse(value) as Record<string, string>
    return Object.keys(rest).length ? JSON.stringify(rest) : null
  })
}

/** Tables without a grid get one on export; keep the expectation's absence where that happened. */
function withGeneratedGrids(received: unknown, expected: unknown): unknown {
  if (Array.isArray(received) && Array.isArray(expected)) return received.map((item, index) => withGeneratedGrids(item, expected[index]))
  if (!received || typeof received !== 'object' || !expected || typeof expected !== 'object') return received
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(received)) {
    const wanted = (expected as Record<string, unknown>)[key]
    result[key] = key === 'tblGrid' && wanted === null ? null : withGeneratedGrids(value, wanted)
  }
  return result
}

describe.runIf(corpus)('docx corpus', () => {
  const files = corpus ? readdirSync(corpus).filter((name) => /\.(docx|docm|dotx|dotm)$/i.test(name)).sort() : []
  for (const name of files) {
    it(`round trips ${name}`, { timeout: 60_000 }, async () => {
      const bytes = new Uint8Array(readFileSync(join(corpus!, name)))
      const assets = new MemoryAssetStore()
      const doc = new Y.Doc()
      try {
        await docxCodec.importFile(doc, bytes, { name, assets })
      } catch (error) {
        // Encrypted, truncated, and fuzzed files must fail cleanly.
        expect(error).toBeInstanceOf(LiveFormatError)
        return
      }
      const exported = await docxCodec.exportFile(doc, { name, assets })
      const original = OoxmlPackage.read(bytes)
      const output = OoxmlPackage.read(exported)
      // Without edits, every part comes back byte for byte.
      for (const path of original.paths()) {
        const before = original.get(path)!
        const after = output.get(path)
        expect(after, path).toBeDefined()
        if (Buffer.compare(Buffer.from(before), Buffer.from(after!)) !== 0) {
          const x = original.text(path) ?? ''
          const y = output.text(path) ?? ''
          let index = 0
          while (index < x.length && x[index] === y[index]) index++
          expect.fail(`${path} changed at ${index}: ${JSON.stringify(x.slice(index - 80, index + 120))} → ${JSON.stringify(y.slice(index - 80, index + 120))}`)
        }
      }
      // Reading the export gives the same model.
      const again = new Y.Doc()
      await docxCodec.importFile(again, exported, { name, assets })
      expect(readDocxModel(again).body.toJSON()).toEqual(readDocxModel(doc).body.toJSON())
      expect(docxCodec.toText(again)).toBe(docxCodec.toText(doc))

      // Writing every modeled part from the model changes nothing but what canonicalXml irons out,
      // and reads back as the same model.
      const model = readDocxModel(doc)
      const regenerated = await exportDocx(model, assets, 'docx', { regenerate: true })
      const rewritten = OoxmlPackage.read(regenerated)
      for (const path of original.paths()) {
        if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|styles|numbering)\.xml$/.test(path)) continue
        const before = canonicalXml(original.text(path)!)
        const after = canonicalXml(rewritten.text(path)!)
        const differences = canonicalDiff(before, after)
        if (differences.length) expect.fail(`${path}:\n${differences.join('\n')}`)
      }
      const third = new Y.Doc()
      await docxCodec.importFile(third, regenerated, { name, assets })
      const reread = readDocxModel(third)
      const same = (received: unknown, expected: unknown, label?: string) => {
        const wanted = withoutParaIds(expected)
        expect(withGeneratedGrids(withoutParaIds(received), wanted), label).toEqual(wanted)
      }
      same(reread.body.toJSON(), model.body.toJSON())
      for (const [id, story] of model.stories) same(reread.stories.get(id)?.doc.toJSON(), story.doc.toJSON(), id)
      for (const map of ['styles', 'numbering', 'comments', 'settings'] as const) expect(reread.maps[map], map).toEqual(model.maps[map])
    })
  }
})
