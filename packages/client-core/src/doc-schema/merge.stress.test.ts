import { describe, expect, it } from 'vitest'
import { docToMarkdown, markdownToDoc } from './schema.js'
import { mergeMarkdown } from './merge.js'
import { docView } from './suggestions.js'

const corpus = [
  '', 'Hello world.', 'Hello brave world.', '# Plan\n\nShip soon.',
  '## Plan\n\nShip **soon**.', 'One\n\nTwo\n\nThree', 'Three\n\nOne\n\nTwo',
  '- first\n- second\n- third', '- first\n  - nested\n- last',
  '1. first\n2. second', '3. first\n4. revised',
  '- [ ] todo\n- [x] done', '> A quote\n>\n> Two paragraphs',
  '```ts\nconst value = 1\n```', '```js\nconst value = 2\n```',
  'before\n\n---\n\nafter', 'A [link](https://example.test) and `code`.',
  '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |',
  '| One |\n| --- |\n| cell |',
  '你好世界。こんにちは。안녕하세요.', 'Café e\u0301lan 👩🏽‍💻 🐙 مرحبا',
  'line one  \nline two', '**bold** and *italic* and ~~gone~~',
  '# Heading\n\n- a\n- b\n\n> quote\n\nlast paragraph',
]

describe('agent Markdown merge corpus', () => {
  it('preserves both review outcomes and schema validity across every pair of block structures', () => {
    for (const before of corpus) for (const after of corpus) {
      const source = markdownToDoc(before)
      const expected = docToMarkdown(markdownToDoc(after))
      const context = `${JSON.stringify(before)} → ${JSON.stringify(after)}`
      const result = mergeMarkdown(source, after, { mode: 'suggest', changeId: 'audit' })
      if (result.doc.childCount) result.doc.check()
      expect(docToMarkdown(docView(result.doc, 'base')), context).toBe(docToMarkdown(source))
      expect(docToMarkdown(docView(result.doc, 'proposed')), context).toBe(expected)
      const written = mergeMarkdown(source, after, { mode: 'write', changeId: 'audit' })
      if (written.doc.childCount) written.doc.check()
      expect(docToMarkdown(written.doc), context).toBe(expected)
    }
  })

  it('keeps pending suggestions stable through repeated agent revisions', () => {
    let current = markdownToDoc('Owner text.\n\nUnchanged footer.')
    for (let revision = 0; revision < 100; revision++) {
      const markdown = `Owner text with revision ${revision}.\n\nUnchanged footer.\n\n- Added ${revision}`
      current = mergeMarkdown(current, markdown, { mode: 'suggest', changeId: `reply-${revision}` }).doc
      current.check()
      expect(docToMarkdown(docView(current, 'base'))).toBe('Owner text.\n\nUnchanged footer.')
      expect(docToMarkdown(docView(current, 'proposed'))).toBe(docToMarkdown(markdownToDoc(markdown)))
    }
  })
})
