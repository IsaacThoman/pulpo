import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, ydocToMarkdown } from '../../doc-schema/index.js'
import { MemoryLiveAssetStore } from '../assets.js'
import { markdownCodec } from './index.js'

const context = { name: 'Plan.md', assets: new MemoryLiveAssetStore() }
const bytes = (text: string) => new TextEncoder().encode(text)

describe('markdownCodec', () => {
  it('lays documents out exactly as the editor does', async () => {
    const source = '# Plan\n\n- one\n- **two**\n'
    const viaCodec = new Y.Doc()
    await markdownCodec.importFile(viaCodec, bytes(source), context)
    const direct = new Y.Doc()
    applyMarkdownToYDoc(direct, source, 'import')
    expect(ydocToMarkdown(viaCodec)).toBe(ydocToMarkdown(direct))
    expect(markdownCodec.toText(viaCodec)).toBe(ydocToMarkdown(direct))
    expect(new TextDecoder().decode(await markdownCodec.exportFile(viaCodec, context))).toBe(ydocToMarkdown(direct))
  })

  it('strips a byte order mark and leaves empty files empty', async () => {
    const doc = new Y.Doc()
    await markdownCodec.importFile(doc, Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes('Hi')]), context)
    expect(markdownCodec.toText(doc)).toBe('Hi')
    const empty = new Y.Doc()
    await markdownCodec.importFile(empty, bytes('  \n'), context)
    expect(empty.getXmlFragment('default').length).toBe(0)
  })

  it('refuses bytes that are not UTF-8', async () => {
    await expect(markdownCodec.importFile(new Y.Doc(), Uint8Array.from([0xff, 0x41]), context)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('applies a new version as a minimal diff', async () => {
    const doc = new Y.Doc()
    await markdownCodec.importFile(doc, bytes('# Plan\n\nKeep this paragraph.\n\nChange this one.\n'), context)
    const vector = Y.encodeStateVector(doc)
    expect(await markdownCodec.applyFile(doc, bytes('# Plan\n\nKeep this paragraph.\n\nChanged this one.\n'), context, 'agent')).toEqual({ changed: true })
    expect(markdownCodec.toText(doc)).toContain('Changed this one.')
    expect(Y.encodeStateAsUpdate(doc, vector).byteLength).toBeLessThan(200)
    expect(await markdownCodec.applyFile(doc, bytes(markdownCodec.toText(doc)), context, 'agent')).toEqual({ changed: false })
    // Only deleting is a change too.
    expect(await markdownCodec.applyFile(doc, bytes('# Plan\n\nKeep this paragraph.\n'), context, 'agent')).toEqual({ changed: true })
    expect(markdownCodec.toText(doc)).not.toContain('Changed')
  })
})
