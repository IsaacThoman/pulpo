import type { JSONContent } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  applyMarkdownToYDoc,
  docJSONToMarkdown,
  docSchema,
  DOC_SCHEMA_VERSION,
  formatBlockSuggestion,
  hasSuggestions,
  markdownToDocJSON,
  parseBlockSuggestion,
  SUGGESTION_BLOCK_ATTR,
  SUGGESTION_DELETE_MARK,
  SUGGESTION_INSERT_MARK,
  suggestionFromMark,
  ydocToMarkdown,
} from './index.js'

const sample = `# Plan

Some **bold**, *italic*, \`code\`, and a [link](https://example.com).

- one
  - nested
- two

1. first
2. second

- [ ] todo
- [x] done

> quote

\`\`\`ts
const answer = 42
\`\`\`

---

End.`

describe('document schema', () => {
  it('round-trips common Markdown through a Y.Doc', () => {
    const doc = new Y.Doc()
    applyMarkdownToYDoc(doc, sample)
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    expect(ydocToMarkdown(copy).trim()).toBe(sample)
  })

  it('keeps tables', () => {
    const doc = new Y.Doc()
    applyMarkdownToYDoc(doc, '| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(ydocToMarkdown(doc)).toMatch(/\|\s*a\s*\|\s*b\s*\|[\s\S]*\|\s*1\s*\|\s*2\s*\|/)
  })

  it('applies Markdown rewrites as small forward edits that merge with concurrent changes', () => {
    const server = new Y.Doc()
    applyMarkdownToYDoc(server, 'First paragraph.\n\nSecond paragraph.')
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    const before = Y.encodeStateVector(server)
    applyMarkdownToYDoc(server, 'First paragraph.\n\nSecond paragraph, revised.')
    const edit = Y.encodeStateAsUpdate(server, before)
    expect(edit.byteLength).toBeLessThan(200)
    // A concurrent client edit to the other paragraph survives the merge.
    client.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
    Y.applyUpdate(client, edit)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client))
    expect(ydocToMarkdown(server)).toBe(ydocToMarkdown(client))
    expect(ydocToMarkdown(server)).toContain('Second paragraph, revised.')
  })

  it('serializes an empty document as empty Markdown', () => {
    expect(ydocToMarkdown(new Y.Doc()).trim()).toBe('')
  })

  it('parses lists and tables in linear time', () => {
    const shape = (node: JSONContent): string => node.type === 'text' ? '' : `${node.type}${node.attrs?.checked ? '+' : ''}${node.content?.some((child) => child.type !== 'text') ? `(${node.content.map(shape).filter(Boolean).join(' ')})` : ''}`
    expect(shape(markdownToDocJSON('Intro\n3) three\n4) four\n\na. letter\nb. next\n\niv. roman\n\n10. ten\n    indented\n\n1.not a list')))
      .toBe('doc(paragraph orderedList(listItem(paragraph) listItem(paragraph) listItem(paragraph) listItem(paragraph)) paragraph)')
    expect(shape(markdownToDocJSON('Text\n\n\n- [ ] task after blanks\n  - [x] nested\n\n  continued\n- [X] upper\n\n* [ ] star\n\n- [] not a task')))
      .toBe('doc(paragraph taskList(taskItem(paragraph taskList(taskItem+(paragraph)) paragraph) taskItem+(paragraph)) taskList(taskItem(paragraph)) bulletList(listItem(paragraph)))')
    expect(shape(markdownToDocJSON('Para\n| a | b |\n| --- | :-: |\n| 1 | 2 |\n\n| no | delimiter |\n| x | y |\n\nx | y\n--|--\n1 | 2')))
      .toBe('doc(paragraph table(tableRow(tableHeader(paragraph) tableHeader(paragraph)) tableRow(tableCell(paragraph) tableCell(paragraph))) paragraph table(tableRow(tableHeader(paragraph) tableHeader(paragraph)) tableRow(tableCell(paragraph) tableCell(paragraph))))')

    const long = Array.from({ length: 4000 }, (_, i) => (i % 50 === 0 ? `1. item ${i}\n2. next\n\n- [ ] task ${i}\n\n| a | b |\n| - | - |\n| ${i} | x |` : `Paragraph ${i} with **bold** text.`)).join('\n\n')
    const started = performance.now()
    expect(markdownToDocJSON(long).content).toHaveLength(4000 + 80 * 2)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('suggestion schema', () => {
  const schema = docSchema()

  it('adds the suggestion marks and the block attribute', () => {
    expect(DOC_SCHEMA_VERSION).toBe(2)
    const insert = schema.marks[SUGGESTION_INSERT_MARK]!.create({ id: 'h1', changeId: 'c1' })
    expect(insert.type.spec.inclusive).toBe(false)
    expect(insert.type.spec.parseDOM).toBeUndefined()
    expect(insert.type.spec.toDOM!(insert, true)).toEqual(['span', { class: 'pulpo-suggestion-insert', 'data-suggestion-id': 'h1', 'data-change-id': 'c1' }, 0])
    const remove = schema.marks[SUGGESTION_DELETE_MARK]!.create({ id: 'h1', changeId: 'c1' })
    expect(remove.type.spec.toDOM!(remove, true)).toEqual(['span', { class: 'pulpo-suggestion-delete', 'data-suggestion-id': 'h1', 'data-change-id': 'c1' }, 0])
    // A text can be inserted or deleted, never both.
    expect(remove.addToSet([insert])).toEqual([remove])
    expect(suggestionFromMark(insert)).toEqual({ kind: 'insert', changeId: 'c1', id: 'h1' })
    expect(suggestionFromMark(schema.marks.bold!.create())).toBeNull()

    for (const name of ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']) {
      expect(schema.nodes[name]!.spec.attrs?.[SUGGESTION_BLOCK_ATTR], name).toEqual({ default: null })
    }
    const value = formatBlockSuggestion({ kind: 'delete', changeId: 'c1', id: 'h2' })
    const paragraph = schema.nodes.paragraph!.create({ [SUGGESTION_BLOCK_ATTR]: value })
    expect(paragraph.type.spec.toDOM!(paragraph)).toEqual(['p', { 'data-suggestion': 'delete', 'data-suggestion-id': 'h2', 'data-change-id': 'c1' }, 0])
    expect(schema.nodes.paragraph!.spec.toDOM!(schema.nodes.paragraph!.create())).toEqual(['p', {}, 0])
    expect(parseBlockSuggestion(value)).toEqual({ kind: 'delete', changeId: 'c1', id: 'h2' })
    expect(parseBlockSuggestion('bogus|c1|h2')).toBeNull()
  })

  it('lets code carry suggestions while still excluding formatting', () => {
    for (const mark of Object.values(schema.marks)) {
      const suggestion = mark.name === SUGGESTION_INSERT_MARK || mark.name === SUGGESTION_DELETE_MARK
      expect(schema.marks.code!.excludes(mark), mark.name).toBe(!suggestion)
      expect(schema.nodes.codeBlock!.allowsMarkType(mark), mark.name).toBe(suggestion)
    }
  })

  it('never reads suggestions from Markdown or HTML in it', () => {
    const json = markdownToDocJSON('<span class="pulpo-suggestion-insert" data-suggestion-id="x" data-change-id="y">hi</span>\n\n<p data-suggestion="insert|y|x">para</p>')
    expect(hasSuggestions(ProseMirrorNode.fromJSON(schema, json))).toBe(false)
  })

  it('serializes suggestion marks as plain text if they ever reach Markdown', () => {
    const mark = (name: string) => schema.marks[name]!.create({ id: 'h1', changeId: 'c1' })
    const paragraph = schema.nodes.paragraph!.create(null, [
      schema.text('Keep '),
      schema.text('this', [mark(SUGGESTION_DELETE_MARK)]),
      schema.text('that', [schema.marks.bold!.create(), mark(SUGGESTION_INSERT_MARK)]),
      schema.text(' word.'),
    ])
    const doc = schema.nodes.doc!.create(null, paragraph)
    expect(hasSuggestions(doc)).toBe(true)
    expect(docJSONToMarkdown(doc.toJSON())).toBe('Keep this**that** word.')
  })
})
