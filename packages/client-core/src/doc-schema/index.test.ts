import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, markdownToDocJSON, ydocToMarkdown } from './index.js'

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
