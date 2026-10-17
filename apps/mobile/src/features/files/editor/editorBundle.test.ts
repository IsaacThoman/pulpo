// @vitest-environment node
import { DOC_SCHEMA_VERSION } from '@pulpo/client-core/doc-schema'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDocEditorPage } from '../../../../scripts/build-doc-editor.mjs'
import { docEditorInputHash } from '../../../../scripts/doc-editor-inputs.mjs'
import { EDITOR_BUNDLE } from './editorBundle.generated'
import { EDITOR_PROTOCOL_VERSION } from './protocol'

describe('the bundled document editor', () => {
  it('was built from the current editor, schema, and dependencies', () => {
    // If this fails, run `npm run build:editor -w @pulpo/mobile` and commit the result.
    expect(EDITOR_BUNDLE.inputHash).toBe(docEditorInputHash())
    expect(EDITOR_BUNDLE.schemaVersion).toBe(DOC_SCHEMA_VERSION)
    expect(EDITOR_BUNDLE.protocolVersion).toBe(EDITOR_PROTOCOL_VERSION)
  })

  it('is exactly the page those sources build', async () => {
    // The page is hidden from diffs, so an edit that kept the recorded hash would go unseen.
    const built = await buildDocEditorPage()
    const digest = (html: string) => createHash('sha256').update(html).digest('hex')
    expect(digest(EDITOR_BUNDLE.html)).toBe(digest(built.html))
    expect(EDITOR_BUNDLE.schemaVersion).toBe(built.schemaVersion)
    expect(EDITOR_BUNDLE.protocolVersion).toBe(built.protocolVersion)
  }, 60_000)

  it('loads nothing from outside the page', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(EDITOR_BUNDLE.html)?.[1]
    expect(csp).toContain("default-src 'none'")
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'(;|$)/)
    expect(EDITOR_BUNDLE.html).not.toMatch(/<script[^>]+src=/)
  })
})

describe('the app bundle', () => {
  it('leaves TipTap and ProseMirror to the editor page', () => {
    // The app's JavaScript only needs Yjs; the editor (and the schema behind it) runs in the web view.
    const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
    const offenders = sources(join(__dirname, '../../../../src')).filter((path) => (
      /^import (?!type )[^;]*from '(@pulpo\/client-core\/(doc-editor|doc-schema)|@tiptap\/[^']+|prosemirror-[^']+)'/m.test(readFileSync(path, 'utf8'))
    ))
    expect(offenders).toEqual([])
  })
})

