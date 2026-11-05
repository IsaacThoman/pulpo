// @vitest-environment node
import { DOC_SCHEMA_VERSION } from '@pulpo/client-core/doc-schema'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEXT_SCHEMA_VERSION } from '@pulpo/client-core/office/text'
import { buildEditorPage } from '../../../../scripts/build-doc-editor.mjs'
import { editorInputHash } from '../../../../scripts/doc-editor-inputs.mjs'
import { EDITOR_BUNDLE } from './editorBundle.generated'
import { EDITOR_PROTOCOL_VERSION } from './protocol'
import { TEXT_EDITOR_BUNDLE } from './textEditorBundle.generated'

const BUNDLES = [
  { format: 'markdown', bundle: EDITOR_BUNDLE, schemaVersion: DOC_SCHEMA_VERSION },
  { format: 'text', bundle: TEXT_EDITOR_BUNDLE, schemaVersion: TEXT_SCHEMA_VERSION },
] as const

describe.each(BUNDLES)('the bundled $format editor', ({ format, bundle, schemaVersion }) => {
  it('was built from the current editor, schema, and dependencies', () => {
    // If this fails, run `npm run build:editor -w @pulpo/mobile` and commit the result.
    expect(bundle.inputHash).toBe(editorInputHash(format))
    expect(bundle.format).toBe(format)
    expect(bundle.schemaVersion).toBe(schemaVersion)
    expect(bundle.protocolVersion).toBe(EDITOR_PROTOCOL_VERSION)
  })

  it('is exactly the page those sources build', async () => {
    // The page is hidden from diffs, so an edit that kept the recorded hash would go unseen.
    const built = await buildEditorPage(format)
    const digest = (html: string) => createHash('sha256').update(html).digest('hex')
    expect(digest(bundle.html)).toBe(digest(built.html))
    expect(bundle.schemaVersion).toBe(built.schemaVersion)
    expect(bundle.protocolVersion).toBe(built.protocolVersion)
  }, 120_000)

  it('loads nothing from outside the page', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(bundle.html)?.[1]
    expect(csp).toContain("default-src 'none'")
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'(;|$)/)
    expect(bundle.html).not.toMatch(/<script[^>]+src=/)
    // Only data: and (for decks' pictures and media) blob: URLs the page makes itself.
    expect(csp).not.toMatch(/https?:|\*|'self'|connect-src/)
  })
})

describe('the app bundle', () => {
  it('leaves TipTap, ProseMirror, and CodeMirror to the editor pages', () => {
    // The app's JavaScript only needs Yjs; the editor (and the schema behind it) runs in the web view.
    const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
    const offenders = sources(join(__dirname, '../../../../src')).filter((path) => (
      /^import (?!type )[^;]*from '(@pulpo\/client-core\/(doc-editor|doc-schema|office\/text\/view|office\/codecs|office\/markdown)|@tiptap\/[^']+|prosemirror-[^']+|@codemirror\/[^']+|y-codemirror\.next)'/m.test(readFileSync(path, 'utf8'))
    ))
    expect(offenders).toEqual([])
  })
})

