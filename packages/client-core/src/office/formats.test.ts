import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankDocx } from './docx/blank.js'
import { DOC_SCHEMA_VERSION } from '../doc-schema/version.js'
import { MemoryLiveAssetStore } from './assets.js'
import { liveFormatCodec, liveFormatCodecOfName } from './codecs.js'
import { LIVE_FORMATS, liveFormat, liveFormatOfName, liveMimeType, liveSchemaVersions, nameExtension } from './formats.js'

describe('live format catalog', () => {
  it('maps names to formats', () => {
    expect(liveFormatOfName('Notes.md')?.id).toBe('markdown')
    expect(liveFormatOfName('README.MARKDOWN')?.id).toBe('markdown')
    expect(liveFormatOfName('.md')?.id).toBe('markdown')
    expect(liveFormatOfName('main.py')?.id).toBe('text')
    expect(liveFormatOfName('App.TSX')?.id).toBe('text')
    expect(liveFormatOfName('Dockerfile')?.id).toBe('text')
    expect(liveFormatOfName('.gitignore')?.id).toBe('text')
    expect(liveFormatOfName('notes.txt')?.id).toBe('text')
  })

  it('leaves formats other workstreams own, and binary files, as ordinary files', () => {
    for (const name of ['data.csv', 'data.tsv', 'notebook.ipynb', 'logo.svg', 'photo.png', 'Budget.xlsx', 'archive.zip', 'noextension']) {
      expect(liveFormatOfName(name), name).toBeNull()
    }
  })

  it('serves a MIME type per extension', () => {
    expect(liveMimeType(liveFormat('text')!, 'a.json')).toBe('application/json')
    expect(liveMimeType(liveFormat('text')!, 'a.py')).toBe('text/x-python')
    expect(liveMimeType(liveFormat('text')!, 'Dockerfile')).toBe('text/plain')
    expect(liveMimeType(liveFormat('markdown')!, 'a.md')).toBe('text/markdown')
    expect(liveMimeType(liveFormat('document')!, 'Letter.DOTX')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.template')
  })

  it('announces each format schema version, Markdown keeping the document schema version', () => {
    expect(liveSchemaVersions()).toEqual({ markdown: DOC_SCHEMA_VERSION, text: 1, document: 1 })
  })

  it('reads extensions the way file names are split elsewhere', () => {
    expect(nameExtension('a.tar.GZ')).toBe('gz')
    expect(nameExtension('.env')).toBe('')
    expect(nameExtension('plain')).toBe('')
  })

  it('has a codec for every format, agreeing with the catalog', () => {
    for (const format of LIVE_FORMATS) {
      const codec = liveFormatCodec(format.id)
      expect(codec.id).toBe(format.id)
      expect(codec.schemaVersion).toBe(format.schemaVersion)
      expect(codec.extensions).toEqual(format.extensions)
    }
    expect(liveFormatCodecOfName('x.rs')?.id).toBe('text')
    expect(liveFormatCodecOfName('x.bin')).toBeNull()
    expect(() => liveFormatCodec('sheet')).toThrow(/Unknown live format/)
  })

  it('tells whether a document holds content', async () => {
    for (const format of LIVE_FORMATS) {
      const doc = new Y.Doc()
      expect(format.hasContent(doc)).toBe(false)
      const codec = liveFormatCodec(format.id)
      // Text formats read text; binary ones start from their blank file.
      const bytes = format.id === 'document' ? blankDocx() : new TextEncoder().encode('# Title\n\nbody\n')
      await codec.importFile(doc, bytes, { name: `a.${format.extensions[0]}`, assets: new MemoryLiveAssetStore() })
      expect(format.hasContent(doc)).toBe(true)
    }
  })
})
