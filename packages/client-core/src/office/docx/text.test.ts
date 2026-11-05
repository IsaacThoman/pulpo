import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { OoxmlPackage } from '../ooxml/package.js'
import { blankDocx } from './blank.js'
import { docxCodec } from './codec.js'
import { diffDocxModels } from './diff.js'
import { packJml, type JmlElement } from './jsonml.js'
import { MemoryAssetStore } from './memory-assets.js'
import { emptyMaps, readDocxModel, type DocxModel } from './model.js'
import { docxSchema } from './schema.js'
import { blocksText, commentAnchors, docxToText, textContext } from './text.js'
import { findMatches, validFindMatches, wordCount } from './view/commands.js'
import { listRevisions, resolveRevisions } from './view/track-changes.js'

const schema = docxSchema()
const p = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const marker = (name: string): JmlElement => [name, { 'w:id': '1', 'w:author': 'Ada' }]
const cell = (text: string, revision?: string) => schema.node('tableCell', { tcPr: revision ? packJml(['w:tcPr', {}, marker(revision)]) : null }, [p(text)])
const row = (text: string, revision?: string) => schema.node('tableRow', { trPr: revision ? packJml(['w:trPr', {}, marker(revision)]) : null }, [cell(text)])
const table = (...rows: ReturnType<typeof row>[]) => schema.node('table', null, rows)
const model = (...content: ReturnType<typeof p>[]): DocxModel => ({ body: schema.node('doc', null, content), maps: emptyMaps(), stories: new Map() })
const changedTexts = (diff: ReturnType<typeof diffDocxModels>) => diff.blocks.flatMap((block) => block.kind === 'modify' ? [block.before.text, block.after.text] : [block.block.text]).join('\n')

describe('semantic paragraph boundaries', () => {
  it('extracts deleted paragraph marks exactly as Accept all joins them', () => {
    const first = schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, marker('w:del')]) }, schema.text('foo'))
    const original = model(first, p('bar'))
    const state = EditorState.create({ schema, doc: original.body })
    const accepted = state.apply(resolveRevisions(state, listRevisions(state.doc), 'accept')!).doc
    expect(docxToText(original)).toBe('foobar\n')
    expect(docxToText(original)).toBe(docxToText({ ...original, body: accepted }))
    expect(findMatches(original.body, 'foobar')).toHaveLength(1)
  })

  it('does not leave a blank line for a fully deleted paragraph and its mark', () => {
    const mark = schema.mark('del', { v: packJml(['w:del', { 'w:id': '2' }, '\u0000']) })
    const original = model(schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, marker('w:del')]) }, schema.text('gone', [mark])), p('kept'))
    expect(docxToText(original)).toBe('kept\n')
  })
})

describe('accepted table revision text', () => {
  it('excludes row/cell deletions, includes insertions, and skips nested deleted content in all text consumers', () => {
    const nested = schema.node('tableCell', null, [p('hidden parent'), table(row('hidden nested'))])
    const doc = model(table(
      schema.node('tableRow', { trPr: packJml(['w:trPr', {}, marker('w:del')]) }, [nested]),
      schema.node('tableRow', null, [cell('kept'), cell('hidden cell', 'w:cellDel'), cell('present')]),
      schema.node('tableRow', { trPr: packJml(['w:trPr', {}, marker('w:ins')]) }, [cell('inserted'), cell('new cell', 'w:cellIns')]),
    ))
    expect(docxToText(doc)).toBe('| kept | present |\n| inserted | new cell |\n')
    expect(blocksText(doc.body, textContext(doc)).join('\n')).not.toContain('hidden')
    expect(findMatches(doc.body, 'hidden')).toHaveLength(0)
    expect(findMatches(doc.body, 'inserted')).toHaveLength(1)
    expect(findMatches(doc.body, 'new cell')).toHaveLength(1)
    expect(wordCount(doc.body)).toMatchObject({ words: 5, paragraphs: 4 })
  })

  it('imports row/cell-only tracked deletions with ordinary, unmarked runs', async () => {
    const pkg = OoxmlPackage.read(blankDocx())
    const xml = pkg.xml('word/document.xml')!
    const body = xml.getElementsByTagName('w:body').item(0)!
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const tbl = xml.createElementNS(w, 'w:tbl')
    for (const [text, revision, cellRevision] of [['hidden row', 'del', ''], ['hidden cell', '', 'cellDel'], ['visible insert', 'ins', 'cellIns']]) {
      const tr = xml.createElementNS(w, 'w:tr')
      if (revision) {
        const pr = xml.createElementNS(w, 'w:trPr'); pr.appendChild(xml.createElementNS(w, `w:${revision}`)); tr.appendChild(pr)
      }
      const tc = xml.createElementNS(w, 'w:tc')
      if (cellRevision) {
        const pr = xml.createElementNS(w, 'w:tcPr'); pr.appendChild(xml.createElementNS(w, `w:${cellRevision}`)); tc.appendChild(pr)
      }
      const paragraph = xml.createElementNS(w, 'w:p')
      const run = xml.createElementNS(w, 'w:r')
      const t = xml.createElementNS(w, 'w:t'); t.appendChild(xml.createTextNode(text!)); run.appendChild(t); paragraph.appendChild(run); tc.appendChild(paragraph); tr.appendChild(tc); tbl.appendChild(tr)
    }
    body.insertBefore(tbl, body.firstChild)
    const doc = new Y.Doc()
    try {
      await docxCodec.importFile(doc, pkg.write(), { name: 'tracked.docx', assets: new MemoryAssetStore() })
      expect(docxCodec.toText(doc).trim()).toBe('| visible insert |')
      expect(findMatches(readDocxModel(doc).body, 'hidden')).toHaveLength(0)
    } finally { doc.destroy() }
  })

  it('keeps row text consistent with accepting and rejecting imported row revisions', () => {
    const proposed = model(table(row('removed', 'w:del'), row('kept'), row('added', 'w:ins')))
    const base = model(table(row('removed'), row('kept')))
    const state = EditorState.create({ schema, doc: proposed.body })
    const accepted = state.apply(resolveRevisions(state, listRevisions(state.doc), 'accept')!).doc
    const rejected = state.apply(resolveRevisions(state, listRevisions(state.doc), 'reject')!).doc
    expect(docxToText(proposed)).toBe(docxToText({ ...proposed, body: accepted }))
    expect(docxToText(base)).toBe(docxToText({ ...proposed, body: rejected }))
    const diff = diffDocxModels(base, proposed)
    expect(diff.blocks).toContainEqual({ kind: 'delete', block: { type: 'row', text: 'removed' } })
    expect(diff.blocks).toContainEqual({ kind: 'insert', block: { type: 'row', text: 'added' } })
    expect(diff.stats).toMatchObject({ deletedWords: 1, insertedWords: 1, deletedBlocks: 1, insertedBlocks: 1 })
  })

  it('omits cells deleted in either diff side and excludes removed rows from story diffs', () => {
    const before = model(table(schema.node('tableRow', null, [cell('kept'), cell('hidden left', 'w:cellDel')])))
    const after = model(table(schema.node('tableRow', null, [cell('kept'), cell('hidden right', 'w:cellDel'), cell('added', 'w:cellIns')])))
    const diff = diffDocxModels(before, after)
    expect(changedTexts(diff)).not.toContain('hidden')
    expect(diff.stats).toMatchObject({ insertedWords: 1, deletedWords: 0 })
    before.stories.set('header:1', { meta: { kind: 'header' }, doc: schema.node('doc', null, [table(row('removed'), row('kept'))]) })
    after.stories.set('header:1', { meta: { kind: 'header' }, doc: schema.node('doc', null, [table(row('removed', 'w:del'), row('kept'), row('added', 'w:ins'))]) })
    const story = diffDocxModels(before, after).stories[0]!
    expect(story.segments.some((segment) => segment.op === 'delete' && segment.text.includes('removed'))).toBe(true)
    expect(story.segments.some((segment) => segment.op === 'insert' && segment.text.includes('added'))).toBe(true)
  })

  it('still reports preserved changes inside hidden revisions, without exposing their text as accepted content', () => {
    const before = model(table(row('hidden old', 'w:del')))
    const after = model(table(row('hidden new', 'w:del')))
    const diff = diffDocxModels(before, after)
    expect(diff.identical).toBe(false)
    expect(changedTexts(diff)).not.toContain('hidden')
    expect(diff.stats).toMatchObject({ insertedWords: 0, deletedWords: 0 })
    expect(diff.formats?.length).toBeGreaterThan(0)
  })

  it('keeps properties of an entirely deleted table visible beside another recognized change', () => {
    const hidden = table(row('hidden text', 'w:del'))
    const before = model(hidden, p('Visible'))
    const changed = hidden.type.create({ ...hidden.attrs, tblPr: packJml(['w:tblPr', {}, ['w:tblW', { 'w:w': '5000' }]]) }, hidden.content)
    const after = model(changed, schema.node('paragraph', null, schema.text('Visible', [schema.mark('b', { v: packJml(['w:b', {}]) })])))
    const diff = diffDocxModels(before, after)
    expect(changedTexts(diff)).not.toContain('hidden')
    expect(diff.formats).toContainEqual({ property: 'layout', text: '', location: [{ kind: 'table', index: 1 }] })
    expect(diff.blocks.some((block) => block.kind === 'modify' && block.formats.some((format) => format.property === 'b'))).toBe(true)
  })

  it('drops stale find ranges after a row or cell becomes deleted', () => {
    for (const kind of ['row', 'cell']) {
      const initial = model(table(row('cat')))
      const state = EditorState.create({ schema, doc: initial.body })
      const matches = findMatches(state.doc, 'cat')
      const pos = kind === 'row' ? 1 : 2
      const node = state.doc.nodeAt(pos)!
      const property = kind === 'row' ? 'trPr' : 'tcPr'
      const name = kind === 'row' ? 'w:del' : 'w:cellDel'
      const changed = state.apply(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [property]: packJml([`w:${property}`, {}, marker(name)]) }))
      expect(validFindMatches(changed.doc, matches, 'cat')).toHaveLength(0)
    }
  })

  it('does not count deleted notes, comment anchor text, or list items before visible rows', () => {
    const before = schema.node('commentMark', { id: '1', edge: 'start' })
    const after = schema.node('commentMark', { id: '1', edge: 'end' })
    const hiddenParagraph = schema.node('paragraph', null, [before, schema.text('hidden anchor'), schema.node('noteRef', { id: '1', kind: 'footnote' }), after])
    const hidden = schema.node('tableRow', { trPr: packJml(['w:trPr', {}, marker('w:del')]) }, [schema.node('tableCell', null, hiddenParagraph)])
    const doc = model(table(hidden, row('kept')))
    const context = textContext(doc)
    blocksText(doc.body, context)
    expect(context.notes.size).toBe(0)
    expect(commentAnchors(doc.body).size).toBe(0)
    expect(docxToText(doc)).toBe('| kept |\n')
  })

  it('does not advance list numbering for deleted rows or cells', () => {
    const doc = model(table(
      row('hidden row', 'w:del'),
      schema.node('tableRow', null, [cell('hidden cell', 'w:cellDel'), cell('kept')]),
      row('added', 'w:ins'),
    ))
    doc.maps.numbering.set('abstract:1', packJml(['w:abstractNum', { 'w:abstractNumId': '1' }, ['w:lvl', { 'w:ilvl': '0' }, ['w:start', { 'w:val': '1' }], ['w:numFmt', { 'w:val': 'decimal' }], ['w:lvlText', { 'w:val': '%1.' }]]]))
    doc.maps.numbering.set('num:1', packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }]]))
    let state = EditorState.create({ schema, doc: doc.body })
    const tr = state.tr
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') tr.setNodeMarkup(pos, undefined, { ...node.attrs, numPr: packJml(['w:numPr', {}, ['w:numId', { 'w:val': '1' }]]) })
    })
    state = state.apply(tr)
    doc.body = state.doc
    expect(docxToText(doc)).toBe('| 1. kept |\n| 2. added |\n')
    const summaries = changedTexts(diffDocxModels(doc, doc))
    expect(summaries).toBe('1. kept\n2. added')
  })

  it('ignores historical row/cell deletion markers inside property-change snapshots', () => {
    const doc = model(table(schema.node('tableRow', { trPr: packJml(['w:trPr', {}, ['w:trPrChange', {}, ['w:trPr', {}, marker('w:del')]]]) }, [
      schema.node('tableCell', { tcPr: packJml(['w:tcPr', {}, ['w:tcPrChange', {}, ['w:tcPr', {}, marker('w:cellDel')]]]) }, [p('current text')]),
    ])))
    expect(docxToText(doc)).toBe('| current text |\n')
  })
})
