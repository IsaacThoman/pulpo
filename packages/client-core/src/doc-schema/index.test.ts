import type { JSONContent } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  applyMarkdownToYDoc,
  applyNodeToYDoc,
  docJSONToMarkdown,
  docSchema,
  docToMarkdown,
  DOC_SCHEMA_VERSION,
  formatBlockSuggestion,
  hasSuggestions,
  markdownToDoc,
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

describe('Markdown round trips', () => {
  const schema = docSchema()
  const p = (...content: Array<string | ProseMirrorNode>) => schema.nodes.paragraph!.create(null, content.map((part) => typeof part === 'string' ? schema.text(part) : part))
  const br = () => schema.nodes.hardBreak!.create()
  const doc = (...content: ProseMirrorNode[]) => schema.nodes.doc!.create(null, content)
  const list = (type: 'bulletList' | 'orderedList', ...items: string[]) => schema.nodes[type]!.create(null, items.map((text) => schema.nodes.listItem!.create(null, p(text))))
  const table = (...rows: ProseMirrorNode[][]) => schema.nodes.table!.create(null, rows.map((cells) => schema.nodes.tableRow!.create(null, cells)))
  const cell = (type: 'tableCell' | 'tableHeader', ...content: Array<string | ProseMirrorNode>) => schema.nodes[type]!.create(null, p(...content))

  it.each([
    ['a line break in a table cell', doc(table([cell('tableHeader', 'Head')], [cell('tableCell', 'one', br(), 'two')]))],
    ['adjacent bullet lists', doc(list('bulletList', 'a'), list('bulletList', 'b'), list('bulletList', 'c'))],
    ['adjacent ordered lists', doc(list('orderedList', 'a'), list('orderedList', 'b'), list('orderedList', 'c'))],
    ['adjacent nested lists', doc(schema.nodes.bulletList!.create(null, schema.nodes.listItem!.create(null, [p('outer'), list('orderedList', 'a'), list('orderedList', 'b')])))],
    ['a line break ending a paragraph', doc(p('end', br()), p('next'))],
    ['a line break starting a paragraph', doc(p(br(), 'start'))],
    ['two line breaks in a row', doc(p('a', br(), br(), 'b'))],
    ['a paragraph of only line breaks', doc(p(br()), p(br(), br()))],
    ['a line break next to spaces', doc(p('a ', br(), ' b'))],
    ['a line break in a heading', doc(schema.nodes.heading!.create({ level: 2 }, [schema.text('a'), br(), schema.text('b')]))],
    ['paragraphs that look like blocks', doc(p('- dash'), p('+ plus'), p('1. one'), p('7) seven'), p('# hash'), p('---'), p('==='), p('line\n- dash\n2. two'))],
  ])('keeps %s', (_, node) => {
    node.check()
    const markdown = docToMarkdown(node)
    expect(markdownToDoc(markdown).eq(node)).toBe(true)
    expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown)
  })

  it('repairs what the parser gets wrong instead of producing invalid documents', () => {
    for (const source of ['>', '> ', '1. a\n2. \n', '- [ ] ', '- a\n-', 'x ****bold**** y']) {
      const parsed = markdownToDoc(source)
      parsed.check()
      expect(() => docToMarkdown(parsed)).not.toThrow()
    }
    expect(markdownToDoc('>').toString()).toBe('doc(blockquote(paragraph))')
    expect(docToMarkdown(markdownToDoc('1. a\n2. \n'))).toBe('1. a\n2. ')
    // Documents already holding invalid content still serialize.
    const invalid = { type: 'doc', content: [{ type: 'orderedList', content: [{ type: 'listItem', content: [] }] }] }
    expect(docJSONToMarkdown(invalid)).toBe('1. ')
    expect(markdownToDoc('').childCount).toBe(0)
  })

  it('refuses to write an invalid document to a Y.Doc', () => {
    const ydoc = new Y.Doc()
    applyMarkdownToYDoc(ydoc, 'Keep me.')
    const invalid = schema.nodes.doc!.create(null, schema.nodes.blockquote!.create())
    expect(() => applyNodeToYDoc(ydoc, invalid)).toThrow(/invalid document/)
    expect(ydocToMarkdown(ydoc)).toBe('Keep me.')
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
