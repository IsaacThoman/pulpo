import { expect, it } from 'vitest'
import { diffDocxModels } from './diff.js'
import { packJml } from './jsonml.js'
import { emptyMaps, type DocxModel } from './model.js'
import { noteInventory, noteNumbers } from './notes.js'
import { docxSchema, packMarks } from './schema.js'
import { docxCodec } from './codec.js'
import { MemoryAssetStore } from './memory-assets.js'
import { readDocxModel, writeFragment } from './model.js'
import { resolveNoteLabels } from './notes.js'
import { unpackJml, type JmlElement } from './jsonml.js'
import * as Y from 'yjs'
import { blocksText, docxToText, textContext } from './text.js'

const schema = docxSchema()
const p = (text: string) => schema.node('paragraph', null, schema.text(text))
const ref = (id: string, custom = false, revision?: string) => schema.node('noteRef', {
  kind: 'footnote', id,
  v: packJml(['w:footnoteReference', { 'w:id': id, ...(custom ? { 'w:customMarkFollows': '1' } : {}) }]),
  marks: revision ? packMarks([schema.mark(revision, { v: packJml([`w:${revision}`, { 'w:id': id }, '\u0000']) })]) : null,
})

it('shares accepted reference ordering across extraction, numbering, and note review', () => {
  const row = (id: string, deleted = false) => schema.node('tableRow', { trPr: deleted ? packJml(['w:trPr', {}, ['w:del', { 'w:id': id }]]) : null }, [schema.node('tableCell', null, [schema.node('paragraph', null, [ref(id)])])])
  const body = schema.node('doc', null, [
    schema.node('paragraph', null, [ref('1'), ref('custom', true), ref('deleted', true, 'del'), ref('from', false, 'moveFrom'), ref('to', false, 'moveTo'), ref('custom', true)]),
    schema.node('table', null, [row('deleted-row', true), row('2')]),
  ])
  const model: DocxModel = { body, maps: emptyMaps(), stories: new Map() }
  for (const id of ['1', 'custom', 'deleted', 'from', 'to', 'deleted-row', '2']) model.stories.set(`footnote:${id}`, { meta: { kind: 'footnote' }, doc: schema.node('doc', null, [p(`Note ${id}`)]) })
  const context = textContext(model)
  blocksText(body, context)
  const inventory = noteInventory(body)
  expect([...context.notes]).toEqual([...inventory])
  expect([...noteNumbers(body)]).toEqual([['footnote:1', 1], ['footnote:custom', ''], ['footnote:to', 2], ['footnote:2', 3]])
  expect(noteInventory(body)).toBe(inventory)
  const text = docxToText(model)
  for (const reference of inventory.values()) expect(text).toContain(`[^${reference.textLabel}]: Note ${reference.id}`)
  expect(text).not.toContain('Note deleted')
  expect(text).not.toContain('Note from')
  const after = { ...model, stories: new Map(model.stories).set('footnote:custom', { meta: { kind: 'footnote' as const }, doc: schema.node('doc', null, [p('Changed custom note')]) }) }
  const diff = diffDocxModels(model, after)
  expect(diff.stories.find((story) => story.id === 'footnote:custom')).toMatchObject({ change: 'modify' })
  expect(diff.stories.find((story) => story.id === 'footnote:custom')!.segments.filter((segment) => segment.op !== 'delete').map((segment) => segment.text).join('')).toBe('Changed custom note')
})

it.each(['footnote', 'endnote'] as const)('imports document-wide %s defaults without changing unchanged exports', async (kind) => {
  const doc = new Y.Doc()
  const imported = new Y.Doc()
  const assets = new MemoryAssetStore()
  try {
    await docxCodec.createEmpty(doc, { name: 'notes.docx', assets })
    doc.getMap('settings').set(`w:${kind}Pr`, packJml([`w:${kind}Pr`, {}, ['w:numFmt', { 'w:val': 'upperLetter' }], ['w:numStart', { 'w:val': '4' }], ['w:numRestart', { 'w:val': 'eachSect' }]]))
    const note = (id: string) => schema.node('noteRef', { kind, id })
    writeFragment(doc, doc.getXmlFragment('body'), schema.node('doc', null, [schema.node('paragraph', { sectPr: packJml(['w:sectPr', {}]) }, [note('1'), note('2')]), schema.node('paragraph', null, note('3'))]))
    for (const id of ['1', '2', '3']) {
      doc.getMap('stories').set(`${kind}:${id}`, JSON.stringify({ kind }))
      writeFragment(doc, doc.getXmlFragment(`story:${kind}:${id}`), schema.node('doc', null, [p('Note')]))
    }
    const bytes = await docxCodec.exportFile(doc, { name: 'notes.docx', assets })
    await docxCodec.importFile(imported, bytes, { name: 'notes.docx', assets })
    const model = readDocxModel(imported)
    const defaults = { [kind]: unpackJml<JmlElement>(model.maps.settings.get(`w:${kind}Pr`)) }
    expect([...resolveNoteLabels(model.body, defaults, unpackJml<JmlElement>(model.maps.docx.get('sectPr'))).values()]).toEqual(['D', 'E', 'D'])
    const exported = await docxCodec.exportFile(imported, { name: 'notes.docx', assets })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)
  } finally { doc.destroy(); imported.destroy() }
})

it('keeps continuous numbering across sections and skips custom marks at restart points', () => {
  const first = schema.node('paragraph', { sectPr: packJml(['w:sectPr', {}]) }, [ref('1'), ref('custom', true)])
  const body = schema.node('doc', null, [first, schema.node('paragraph', null, [ref('2'), ref('3')])])
  const defaults = { footnote: ['w:footnotePr', {}, ['w:numFmt', { 'w:val': 'decimal' }], ['w:numStart', { 'w:val': '4' }]] as JmlElement }
  expect([...resolveNoteLabels(body, defaults).values()]).toEqual(['4', '', '5', '6'])
  const pages = new Map([['footnote:1', 0], ['footnote:custom', 1], ['footnote:2', 1], ['footnote:3', 1]])
  defaults.footnote.push(['w:numRestart', { 'w:val': 'eachPage' }])
  expect([...resolveNoteLabels(body, defaults, undefined, pages).values()]).toEqual(['4', '', '4', '5'])
})
