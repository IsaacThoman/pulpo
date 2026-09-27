import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, ydocToMarkdown } from './index.js'

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
})
