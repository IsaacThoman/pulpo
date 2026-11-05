import { expect, it } from 'vitest'
import { diffDocxModels } from './diff.js'
import { packJml } from './jsonml.js'
import { emptyMaps, type DocxModel } from './model.js'
import { noteInventory, noteNumbers } from './notes.js'
import { docxSchema, packMarks } from './schema.js'
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
