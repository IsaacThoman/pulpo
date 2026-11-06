import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { OoxmlPackage } from '../ooxml/package.js'
import { docxCodec } from './codec.js'
import { exportDocx } from './export.js'
import { MemoryAssetStore } from './memory-assets.js'
import { BODY_FRAGMENT, readDocxModel, storyFragmentName, writeFragment } from './model.js'
import { docxSchema } from './schema.js'
import { createTable, insertPageBreak, setAlignment, toggleList, toggleRunProperty } from './view/commands.js'
import { DocxViewContext } from './view/context.js'
import { addComment, addNote } from './view/stories.js'
import { trackTransaction } from './view/track-changes.js'

/**
 * Fidelity against other Word readers: python-docx reads what Pulpo writes the same as the
 * original, LibreOffice opens it, edits made with Pulpo's commands come out as Word expects, and
 * an agent's python-docx edit merges with a concurrent user edit through applyFile.
 *
 * Opt in with PULPO_DOCX_FIDELITY=1 (see scripts/docx-fidelity/README.md); PULPO_DOCX_CORPUS adds
 * a directory of more files to the round trips.
 */

const enabled = process.env.PULPO_DOCX_FIDELITY === '1'
const python = process.env.PULPO_DOCX_PYTHON ?? '/tmp/pulpo-docx-venv/bin/python'
const scripts = join(process.cwd(), 'scripts/docx-fidelity')
const hasLibreOffice = existsSync('/Applications/LibreOffice.app/Contents/MacOS/soffice') || Boolean(process.env.PULPO_DOCX_SOFFICE)
const fixtures = join(process.cwd(), 'fixtures/docx')

function fixtureFiles(): string[] {
  const files = [
    ...readdirSync(fixtures).filter((name) => name.endsWith('.docx')).map((name) => join(fixtures, name)),
    ...readdirSync(join(fixtures, 'poi')).filter((name) => name.endsWith('.docx')).map((name) => join(fixtures, 'poi', name)),
  ]
  const corpus = process.env.PULPO_DOCX_CORPUS
  if (corpus) files.push(...readdirSync(corpus).filter((name) => /\.docx$/i.test(name)).map((name) => join(corpus, name)))
  return files
}

function runPython(args: string[], input?: string) {
  return spawnSync(python, ['-I', ...args], { encoding: 'utf8', input, timeout: 180_000 })
}

/**
 * Every export must read back as a package, by our own reader and by Python's zipfile with a CRC
 * check of every entry: invalid deflate data or zip framing fails here before any Word reader.
 */
function expectReadableZip(file: string): void {
  expect(() => OoxmlPackage.read(new Uint8Array(readFileSync(file))), file).not.toThrow()
  const check = runPython(['-c', 'import sys, zipfile\nbad = zipfile.ZipFile(sys.argv[1]).testzip()\nprint(bad or "")\nsys.exit(1 if bad else 0)', file])
  expect(check.status, `${file}: ${check.stdout}${check.stderr}`).toBe(0)
}

function libreOffice(file: string, outdir: string) {
  return runPython([join(scripts, 'libreoffice.py'), file, '--outdir', outdir])
}

const schema = docxSchema()

/** Applies `edit` to the body as an editor would, writing the result back to the Y.Doc. */
function editBody(doc: Y.Doc, edit: (state: EditorState) => Transaction | null): void {
  const state = EditorState.create({ schema, doc: readDocxModel(doc).body })
  const tr = edit(state)
  if (tr) doc.transact(() => writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), tr.doc))
}

function selectText(state: EditorState, text: string): EditorState {
  let range: { from: number; to: number } | undefined
  state.doc.descendants((node, pos) => {
    if (range || !node.isText) return !range
    const index = node.text!.indexOf(text)
    if (index >= 0) range = { from: pos + index, to: pos + index + text.length }
    return false
  })
  if (!range) throw new Error(`No "${text}" in the document`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to)))
}

describe.runIf(enabled)('docx fidelity', () => {
  const work = mkdtempSync(join(tmpdir(), 'pulpo-docx-fidelity-'))

  for (const file of fixtureFiles()) {
    const name = file.slice(file.lastIndexOf('/') + 1)
    it(`python-docx reads ${name} the same after Pulpo rewrites it`, { timeout: 240_000 }, async () => {
      const assets = new MemoryAssetStore()
      const doc = new Y.Doc()
      try {
        await docxCodec.importFile(doc, new Uint8Array(readFileSync(file)), { name, assets })
      } catch {
        return
      }
      const output = join(work, `rewritten-${name}`)
      writeFileSync(output, await exportDocx(readDocxModel(doc), assets, 'docx', { regenerate: true }))
      expectReadableZip(output)
      // An original python-docx cannot read is not ours to judge.
      if (runPython([join(scripts, 'compare.py'), file, file]).status !== 0) return
      const result = runPython([join(scripts, 'compare.py'), file, output, '--json'])
      const report = JSON.parse(result.stdout || '{"ok":false,"differences":["no output"]}') as { ok: boolean; differences: unknown[] }
      expect(report.differences.slice(0, 5), result.stderr).toEqual([])
      if (hasLibreOffice) {
        const converted = libreOffice(output, work)
        expect(converted.status, converted.stdout + converted.stderr).toBe(0)
      }
    })
  }

  it('writes edits made with the editor commands as Word does', { timeout: 240_000 }, async () => {
    const assets = new MemoryAssetStore()
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, new Uint8Array(readFileSync(join(fixtures, 'basic-formatting.docx'))), { name: 'a.docx', assets })
    const context = new DocxViewContext(doc)
    editBody(doc, (state) => toggleRunProperty('b')(selectText(state, 'plain text'), context))
    editBody(doc, (state) => setAlignment('center')(selectText(state, 'Left alignment.'), context))
    let numbering: [string, string][] = []
    editBody(doc, (state) => {
      const result = toggleList('decimal', selectText(state, 'Justify alignment.'), context)!
      numbering = (result.maps ?? []).map(([, key, value]) => [key, value!])
      return result.tr
    })
    doc.transact(() => { for (const [key, value] of numbering) doc.getMap<string>('numbering').set(key, value) })
    editBody(doc, (state) => {
      const at = selectText(state, 'Line spacing single').selection.$from
      return state.tr.insert(at.after(1), [createTable(schema, 2, 3, context), schema.node('paragraph', null, schema.text('After the new table.'))])
    })
    editBody(doc, (state) => insertPageBreak(selectText(state, 'Second line'), context))
    const applyStory = (result: { tr: Transaction | null; maps: [string, string, string | null][]; stories: { id: string; meta: unknown; doc?: ProseMirrorNode }[] }) => {
      doc.transact(() => {
        for (const [map, key, value] of result.maps) {
          if (value === null) doc.getMap(map).delete(key)
          else doc.getMap(map).set(key, value)
        }
        for (const story of result.stories) {
          doc.getMap('stories').set(story.id, JSON.stringify(story.meta))
          if (story.doc) writeFragment(doc, doc.getXmlFragment(storyFragmentName(story.id)), story.doc)
        }
        if (result.tr) writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), result.tr.doc)
      })
    }
    {
      const state = selectText(EditorState.create({ schema, doc: readDocxModel(doc).body }), 'Hanging indent')
      applyStory(addComment(state, context, { name: 'Ada Lovelace' }, 'A comment from Pulpo.'))
    }
    {
      const state = selectText(EditorState.create({ schema, doc: readDocxModel(doc).body }), 'Explicit line break:')
      const end = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.selection.to)))
      applyStory(addNote(end, context, 'footnote', 'A footnote from Pulpo.'))
    }
    editBody(doc, (state) => {
      const at = selectText(state, 'Kept companion.').selection.to
      return trackTransaction(state, state.tr.insertText(' Suggested words.', at), { author: 'Grace', date: '2026-11-04T12:00:00Z' })
    })
    const output = join(work, 'edited.docx')
    writeFileSync(output, await docxCodec.exportFile(doc, { name: 'a.docx', assets }))
    expectReadableZip(output)
    const check = runPython(['-c', `
import sys, zipfile, re, docx
d = docx.Document(sys.argv[1])
ps = d.paragraphs
def para(text):
    return next(p for p in ps if text in p.text)
bold = [r for r in para('plain text').runs if r.bold]
assert any('plain text' in r.text for r in bold), [ (r.text, r.bold) for r in para('plain text').runs ]
assert para('Left alignment.').alignment == 1, para('Left alignment.').alignment
assert para('Justify alignment.')._p.pPr.numPr is not None
assert any(len(t.rows) == 2 and len(t.columns) == 3 for t in d.tables), [ (len(t.rows), len(t.columns)) for t in d.tables ]
assert any(c.text.strip() == 'A comment from Pulpo.' and c.author == 'Ada Lovelace' for c in d.comments), [ (c.author, c.text) for c in d.comments ]
xml = zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode()
notes = zipfile.ZipFile(sys.argv[1]).read('word/footnotes.xml').decode()
assert 'A footnote from Pulpo.' in notes
assert re.search(r'<w:ins [^>]*w:author="Grace"[^>]*>.*?Suggested words', xml), 'tracked insertion'
assert '<w:br w:type="page"/>' in xml
print('ok')
`, output])
    expect(check.stdout.trim(), check.stderr).toBe('ok')
    if (hasLibreOffice) {
      const converted = libreOffice(output, work)
      expect(converted.status, converted.stdout + converted.stderr).toBe(0)
    }
  })

  it('merges an agent edit made with python-docx with a concurrent user edit', { timeout: 240_000 }, async () => {
    const assets = new MemoryAssetStore()
    const server = new Y.Doc()
    await docxCodec.importFile(server, new Uint8Array(readFileSync(join(fixtures, 'basic-formatting.docx'))), { name: 'a.docx', assets })
    // The agent pulls the file.
    const pulled = join(work, 'pulled.docx')
    writeFileSync(pulled, await docxCodec.exportFile(server, { name: 'a.docx', assets }))
    expectReadableZip(pulled)
    // Meanwhile a user edits the first paragraph in their replica.
    const user = new Y.Doc()
    Y.applyUpdate(user, Y.encodeStateAsUpdate(server))
    editBody(user, (state) => {
      const selection = selectText(state, 'A normal paragraph').selection
      return state.tr.insertText('User says hi. ', selection.from)
    })
    // The agent edits with python-docx and pushes.
    const pushed = join(work, 'pushed.docx')
    const agent = runPython(['-c', `
import sys, docx
d = docx.Document(sys.argv[1])
p = next(p for p in d.paragraphs if p.text.startswith('Right alignment'))
for r in p.runs[1:]:
    r._r.getparent().remove(r._r)
p.runs[0].text = 'The agent rewrote this paragraph.'
d.add_paragraph('A paragraph the agent appended.')
d.save(sys.argv[2])
print('ok')
`, pulled, pushed])
    expect(agent.stdout.trim(), agent.stderr).toBe('ok')
    const result = await docxCodec.applyFile(server, new Uint8Array(readFileSync(pushed)), { name: 'a.docx', assets }, 'agent')
    expect(result.changed).toBe(true)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(user))
    Y.applyUpdate(user, Y.encodeStateAsUpdate(server))
    const text = docxCodec.toText(server)
    expect(text).toContain('User says hi. A normal paragraph')
    expect(text).toContain('The agent rewrote this paragraph.')
    expect(text).toContain('A paragraph the agent appended.')
    expect(docxCodec.toText(user)).toBe(text)
    const merged = join(work, 'merged.docx')
    writeFileSync(merged, await docxCodec.exportFile(server, { name: 'a.docx', assets }))
    expectReadableZip(merged)
    const check = runPython(['-c', `
import sys, docx
t = [p.text for p in docx.Document(sys.argv[1]).paragraphs]
assert any(x.startswith('User says hi. A normal paragraph') for x in t)
assert 'The agent rewrote this paragraph.' in t and 'A paragraph the agent appended.' in t
print('ok')
`, merged])
    expect(check.stdout.trim(), check.stderr).toBe('ok')
  })
})
