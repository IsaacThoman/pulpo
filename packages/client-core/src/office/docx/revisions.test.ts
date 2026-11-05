import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { docxCodec, referencedAssets } from './codec.js'
import { MemoryAssetStore } from './memory-assets.js'
import { newInlinePicture } from './drawing.js'
import { OoxmlPackage } from '../ooxml/package.js'
import { copyRelatedParts, receiveCopiedParts } from './copy-relationships.js'
import { readDocxModel, writeFragment } from './model.js'
import { Slice } from '@tiptap/pm/model'
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { acceptedText, baseText, docxToText } from './text.js'
import { diffDocxModels } from './diff.js'
import { packJml, jmlChild, unpackJml, type JmlElement } from './jsonml.js'
import { emptyMaps, type DocxModel } from './model.js'
import { listRevisions, resolveAllRevisions, revisionModel, revisionProjection } from './revisions.js'
import { docxSchema } from './schema.js'
import { findMatches, replaceMatches, wordCount } from './view/commands.js'

const schema = docxSchema()
const mark = (name: string, id = '1') => schema.mark(name, { v: packJml([`w:${name}`, { 'w:id': id, 'w:author': 'Ada' }, '\u0000']) })
const change = (name: string, attrs: Record<string, string> = {}): JmlElement => [name, { 'w:id': '1', 'w:author': 'Ada', ...attrs }]
const p = (text: string, attrs: Record<string, unknown> = {}, marks: string[] = []) => schema.node('paragraph', attrs, text ? schema.text(text, marks.map((name) => mark(name))) : undefined)
const cell = (text: string, marker?: JmlElement) => schema.node('tableCell', { tcPr: marker ? packJml(['w:tcPr', {}, marker]) : null }, [p(text)])
const row = (cells: ProseMirrorNode[], marker?: JmlElement) => schema.node('tableRow', { trPr: marker ? packJml(['w:trPr', {}, marker]) : null }, cells)
const table = (...rows: ProseMirrorNode[]) => schema.node('table', null, rows)
const model = (...content: ProseMirrorNode[]): DocxModel => ({ body: schema.node('doc', null, content), maps: emptyMaps(), stories: new Map() })
function resolvedDoc(doc: ProseMirrorNode, action: 'accept' | 'reject') {
  const state = EditorState.create({ schema, doc })
  const tr = resolveAllRevisions(state, action)
  return tr ? state.apply(tr).doc : doc
}
function check(model: DocxModel) {
  for (const action of ['accept', 'reject'] as const) {
    const resolved = { ...model, body: resolvedDoc(model.body, action), stories: new Map([...model.stories].map(([id, story]) => [id, { ...story, doc: resolvedDoc(story.doc, action) }])) }
    expect(action === 'accept' ? acceptedText(model) : baseText(model)).toBe(docxToText(resolved, 'raw'))
    expect(listRevisions(resolved.body)).toHaveLength(0)
    expect(resolvedDoc(resolved.body, action).eq(resolved.body)).toBe(true)
    resolved.body.descendants((node) => { if (node.type.name === 'table') expect(TableMap.get(node).problems).toBeNull(); return true })
  }
}

describe('shared semantic revision views', () => {
  it('applies run insert/delete and both move directions to accepted and base text', () => {
    const doc = model(schema.node('paragraph', null, [schema.text('keep '), schema.text('insert ', [mark('ins')]), schema.text('delete ', [mark('del')]), schema.text('source ', [mark('moveFrom')]), schema.text('target', [mark('moveTo')])]))
    expect(acceptedText(doc)).toBe('keep insert target\n')
    expect(baseText(doc)).toBe('keep delete source \n')
    check(doc)
  })

  it.each(['ins', 'del'])('resolves paragraph-mark %s with paragraph/list formatting from the editor transaction', (kind) => {
    const doc = model(p('foo', { markRPr: packJml(['w:rPr', {}, change(`w:${kind}`)]), outlineLvl: packJml(['w:outlineLvl', { 'w:val': '0' }]) }), p('bar'))
    expect(acceptedText(doc)).toBe(kind === 'del' ? '# foobar\n' : '# foo\nbar\n')
    expect(baseText(doc)).toBe(kind === 'ins' ? '# foobar\n' : '# foo\nbar\n')
    check(doc)
  })

  it('removes a fully deleted terminal paragraph without a spare blank line', () => {
    const doc = model(p('kept'), p('gone', { markRPr: packJml(['w:rPr', {}, change('w:del')]) }, ['del']))
    expect(acceptedText(doc)).toBe('kept\n')
    expect(baseText(doc)).toBe('kept\ngone\n')
    check(doc)
  })

  it('resolves row and cell insertions/deletions through the same table operations', () => {
    const doc = model(table(row([cell('row delete')], change('w:del')), row([cell('keep'), cell('cell delete', change('w:cellDel')), cell('cell insert', change('w:cellIns'))]), row([cell('row insert')], change('w:ins'))))
    expect(acceptedText(doc)).toBe('| keep | cell insert |\n| row insert |\n')
    expect(baseText(doc)).toBe('| row delete |\n| keep | cell delete |\n')
    check(doc)
  })

  it('keeps a covered row when its last own cell is deleted', () => {
    const spanning = schema.node('tableCell', { rowspan: 2 }, [p('source')])
    const doc = model(table(row([spanning, cell('top')]), row([cell('bottom', change('w:cellDel'))])))
    const accepted = revisionModel(doc)
    expect(accepted.body.firstChild!.firstChild!.firstChild!.attrs.rowspan).toBe(2)
    expect(acceptedText(doc)).toBe('| source | top |\n')
    expect(baseText(doc)).toBe('| source | top |\n| bottom |\n')
    check(doc)
  })

  it('accepts a cell merge and rejects it into the original separate cells', () => {
    const doc = model(table(row([cell('left'), cell('top')]), row([cell('right'), cell('bottom', change('w:cellMerge', { 'w:vMerge': 'cont' }))])))
    const accepted = revisionModel(doc)
    expect(accepted.body.firstChild!.firstChild!.lastChild!.attrs.rowspan).toBe(2)
    expect(accepted.body.firstChild!.lastChild!.childCount).toBe(1)
    expect(acceptedText(doc)).toBe('| left | top |\n| right |\n')
    expect(baseText(doc)).toBe('| left | top |\n| right | bottom |\n')
    check(doc)
  })

  it('rejects a tracked cell split by restoring the original vertical merge', () => {
    const doc = model(table(row([cell('left'), cell('top')]), row([cell('right'), cell('bottom', change('w:cellMerge', { 'w:vMergeOrig': 'cont' }))])))
    expect(acceptedText(doc)).toBe('| left | top |\n| right | bottom |\n')
    expect(baseText(doc)).toBe('| left | top |\n| right |\n')
    check(doc)
  })

  it('finds and rejects merge revisions inside imported continuation XML, including wholly covered rows', () => {
    const continuation: JmlElement = ['w:tc', {}, ['w:tcPr', {}, ['w:vMerge', {}], change('w:cellMerge', { 'w:vMerge': 'cont' })], ['w:p', {}, ['w:r', {}, ['w:t', {}, 'bottom']]]]
    const top = schema.node('tableCell', { rowspan: 2, vMergeCells: packJml([continuation]) }, [p('top')])
    const doc = model(table(row([top]), row([])))
    expect(listRevisions(doc.body).some((revision) => revision.kind === 'cellMerge')).toBe(true)
    expect(acceptedText(doc)).toBe('| top |\n')
    expect(baseText(doc)).toBe('| top |\n| bottom |\n')
    check(doc)
  })

  it.each(['w:ins', 'w:del'])('settles cell-merge history before resolving a %s row', (kind) => {
    const continuation: JmlElement = ['w:tc', {}, ['w:tcPr', {}, ['w:vMerge', {}], change('w:cellMerge', { 'w:vMerge': 'cont' })], ['w:p', {}, ['w:r', {}, ['w:t', {}, 'bottom']]]]
    const top = schema.node('tableCell', { rowspan: 2, vMergeCells: packJml([continuation]) }, [p('source')])
    const doc = model(table(row([top, cell('left')], change(kind)), row([cell('kept')])))
    expect(acceptedText(doc)).toBe(kind === 'w:del' ? '| source | kept |\n' : '| source | left |\n| kept |\n')
    expect(baseText(doc)).toBe(kind === 'w:ins' ? '| bottom | kept |\n' : '| source | left |\n| bottom | kept |\n')
    check(doc)
  })

  it('treats run/paragraph property changes as formatting while restoring base heading/list labels', () => {
    const old: JmlElement = ['w:pPrChange', { 'w:id': '4' }, ['w:pPr', {}, ['w:outlineLvl', { 'w:val': '1' }]]]
    const format = schema.mark('rPrChange', { v: packJml(['w:rPrChange', { 'w:id': '5' }, ['w:rPr', {}, ['w:b', {}]]]) })
    const doc = model(schema.node('paragraph', { pPrChange: packJml(old) }, schema.text('same words', [format])))
    expect(acceptedText(doc)).toBe('same words\n')
    expect(baseText(doc)).toBe('## same words\n')
    const base = revisionModel(doc, 'reject').body.firstChild!
    expect(base.firstChild!.marks.some((mark) => mark.type.name === 'b')).toBe(true)
    expect(jmlChild(unpackJml<JmlElement>(base.attrs.pPrChange), 'w:pPr')).toBeUndefined()
    check(doc)
  })

  it('keeps images and private copied part bindings in preserved merge continuations', async () => {
    const assets = new MemoryAssetStore()
    const image = await assets.put(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'image/png')
    const picture = schema.node('drawing', { src: image.hash, v: packJml(newInlinePicture(20, 20, 'Hidden picture')) })
    const lower = schema.node('tableCell', { tcPr: packJml(['w:tcPr', {}, change('w:cellMerge', { 'w:vMerge': 'cont' })]) }, schema.node('paragraph', null, [picture, schema.text('linked', [schema.mark('link', { href: 'https://example.test/kept-link', v: packJml(['w:hyperlink', {}, '\u0000']) })])]))
    const source = model(table(row([cell('left'), cell('top')]), row([cell('right'), lower])))
    const accepted = revisionModel(source)
    const doc = new Y.Doc()
    const target = new Y.Doc()
    try {
      await docxCodec.createEmpty(doc, { name: 'merged.docx', assets })
      writeFragment(doc, doc.getXmlFragment('body'), accepted.body)
      expect(referencedAssets(doc).has(image.hash)).toBe(true)
      const bytes = await docxCodec.exportFile(doc, { name: 'merged.docx', assets })
      expect(OoxmlPackage.read(bytes).text('word/document.xml')).not.toContain('pulpo:src')
      const otherAssets = new MemoryAssetStore()
      await docxCodec.createEmpty(target, { name: 'copy.docx', assets: otherAssets })
      const copied = await copyRelatedParts(new Slice(accepted.body.content, 0, 0), doc, assets)
      const slice = await receiveCopiedParts(copied, otherAssets)
      writeFragment(target, target.getXmlFragment('body'), schema.node('doc', null, slice.content))
      const out = OoxmlPackage.read(await docxCodec.exportFile(target, { name: 'copy.docx', assets: otherAssets }))
      const rels = out.relationships('word/document.xml')
      expect(rels.some((rel) => rel.type.endsWith('/image'))).toBe(true)
      expect(rels.some((rel) => rel.type.endsWith('/hyperlink') && rel.target === 'https://example.test/kept-link')).toBe(true)
      expect(readDocxModel(target).body.firstChild!.firstChild!.lastChild!.attrs.rowspan).toBe(2)
    } finally { doc.destroy(); target.destroy() }
  })

  it('maps search across removed runs and paragraph marks back to editable source positions', () => {
    const doc = model(schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, change('w:del')]) }, [schema.text('f'), schema.text('gone', [mark('del')]), schema.text('oo')]), p('bar'))
    const match = findMatches(doc.body, 'foobar')
    expect(match).toHaveLength(1)
    const state = EditorState.create({ schema, doc: doc.body })
    const replaced = state.apply(replaceMatches(state, match, 'replacement', 'foobar'))
    expect(acceptedText({ ...doc, body: replaced.doc })).toBe('replacement\n')
    expect(wordCount(doc.body).words).toBe(1)
  })

  it('retains source positions for a rowspan cell moved out of a deleted row', () => {
    const a = schema.node('tableCell', { rowspan: 2 }, [p('source')])
    const doc = model(table(row([a, cell('deleted')], change('w:del')), row([cell('kept')])))
    expect(acceptedText(doc)).toBe('| source | kept |\n')
    const original = doc.body.textBetween(4, 10)
    expect(original).toBe('source')
    expect(findMatches(doc.body, 'source')).toEqual([{ from: 4, to: 10 }])
    const state = EditorState.create({ schema, doc: doc.body })
    const changed = state.apply(replaceMatches(state, findMatches(state.doc, 'source'), 'changed', 'source'))
    expect(acceptedText({ ...doc, body: changed.doc })).toBe('| changed | kept |\n')
    check(doc)
  })

  it('uses resolved paragraph boundaries for both sides of a review', () => {
    const before = model(p('foo'), p('bar'))
    const after = model(p('foo', { markRPr: packJml(['w:rPr', {}, change('w:del')]) }), p('bar'))
    const diff = diffDocxModels(before, after)
    expect(diff.identical).toBe(false)
    expect(diff.blocks.some((block) => (block.kind === 'insert' ? block.block.text : block.kind === 'modify' ? block.after.text : '') === 'foobar')).toBe(true)
    expect(diffDocxModels(after, revisionModel(after)).blocks.every((block) => block.kind === 'equal')).toBe(true)
  })

  it('projects a roughly 100-page tracked document within a practical budget', () => {
    const paragraphs = Array.from({ length: 1600 }, (_, index) => schema.node('paragraph', null, [
      schema.text(`Current paragraph ${index}: ${'accepted text '.repeat(20)}`, [mark('ins', String(index * 2))]),
      schema.text('deleted text', [mark('del', String(index * 2 + 1))]),
    ]))
    const doc = model(...paragraphs)
    const start = performance.now()
    const text = acceptedText(doc)
    expect(text).toContain('Current paragraph 1599:')
    expect(text).not.toContain('deleted text')
    expect(performance.now() - start).toBeLessThan(2500)
  })

  it('matches actual accept-all/reject-all text for seeded combinations of every revision type', () => {
    let seed = 0x94244799
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 0x1_0000_0000 }
    const count = process.env.PULPO_DOCX_FIDELITY === '1' ? 256 : 24
    const runKinds = ['', 'ins', 'del', 'moveFrom', 'moveTo']
    for (let trial = 0; trial < count; trial++) {
      const blocks: ProseMirrorNode[] = []
      for (let i = 0; i < 5; i++) {
        const kind = runKinds[Math.floor(random() * runKinds.length)]!
        const boundary = random() < .5 ? 'ins' : 'del'
        const attrs: Record<string, unknown> = random() < .6 ? { markRPr: packJml(['w:rPr', {}, change(`w:${boundary}`)]) } : {}
        if (random() < .4) attrs.pPrChange = packJml(['w:pPrChange', {}, ['w:pPr', {}, ['w:outlineLvl', { 'w:val': '1' }]]])
        const marks = kind ? [mark(kind, `${trial}-${i}`)] : []
        if (random() < .4) marks.push(schema.mark('rPrChange', { v: packJml(['w:rPrChange', {}, ['w:rPr', {}, ['w:i', {}]]]) }))
        blocks.push(schema.node('paragraph', attrs, schema.text(`Trial ${trial} item ${i} `, marks)))
      }
      const rowKind = random() < .5 ? 'w:ins' : 'w:del'
      const cellKind = random() < .5 ? 'w:cellIns' : 'w:cellDel'
      blocks.push(table(row([cell('row revision'), cell('other')], change(rowKind)), row([cell('cell revision', change(cellKind)), cell('keep')]), row([cell('left'), cell('merge', change('w:cellMerge', random() < .5 ? { 'w:vMerge': 'cont' } : { 'w:vMergeOrig': 'cont' }))])))
      const doc = model(...blocks)
      doc.stories.set('header:1', { meta: { kind: 'header' }, doc: schema.node('doc', null, blocks.slice(0, 2)) })
      doc.maps.comments.set('1', JSON.stringify({ author: 'Ada' }))
      doc.stories.set('comment:1', { meta: { kind: 'comment' }, doc: schema.node('doc', null, blocks.slice(1, 3)) })
      check(doc)
      expect(revisionProjection(doc.body).doc).toBe(revisionProjection(doc.body).doc)
    }
  })
})
