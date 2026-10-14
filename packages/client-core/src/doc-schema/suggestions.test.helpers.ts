import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import * as Y from 'yjs'
import { applyNodeToYDoc, ydocToNode } from './index.js'
import { docJSONToMarkdown, docSchema, markdownToDocJSON } from './schema.js'
import { mergeMarkdown, resolveSuggestions, type SuggestionAction, type SuggestionRef } from './suggestions.js'

/** A realistic document with every kind of block the schema has, shared by the doc-schema tests. */
export const sample = `# Launch plan

Some **bold** text, some *italic* words, \`inline code\`, and a [link](https://example.com "Example").

## Goals

- Ship the beta to early users
  - Collect feedback weekly
  - Fix the top three issues
- Prepare the public launch

1. Draft the announcement
2. Review it with the team
3. Publish on Tuesday

- [ ] Book the venue
- [x] Order the shirts

> Quotes keep us honest.
>
> - even with lists inside

\`\`\`ts
const answer = 42
console.log(answer)
\`\`\`

---

| Task | Owner | Due |
| --- | --- | --- |
| Website | Ana | May |
| Press kit | Ben | June |

Special characters: 1 * 2 = 2, snake_case, [brackets], <angle> & ampersands.

The end.`

export function parse(markdown: string): ProseMirrorNode {
  return ProseMirrorNode.fromJSON(docSchema(), markdownToDocJSON(markdown))
}

export function md(node: ProseMirrorNode): string {
  return docJSONToMarkdown(node.toJSON())
}

/** What the Markdown reads like after one trip through the shared parser and serializer. */
export function normalize(markdown: string): string {
  return md(parse(markdown))
}

export function idGenerator(prefix = 'h'): () => string {
  let next = 0
  return () => `${prefix}${++next}`
}

export function suggest(doc: ProseMirrorNode, markdown: string, changeId = 'c1', newId = idGenerator(`${changeId}-`)) {
  return mergeMarkdown(doc, markdown, { mode: 'suggest', changeId, newId })
}

export function write(doc: ProseMirrorNode, markdown: string, changeId = 'c1') {
  return mergeMarkdown(doc, markdown, { mode: 'write', changeId, newId: idGenerator(`${changeId}-`) })
}

export function resolve(doc: ProseMirrorNode, action: SuggestionAction, match: (ref: SuggestionRef) => boolean = () => true): ProseMirrorNode {
  return resolveSuggestions(new Transform(doc), match, action).doc
}

/** The node after a trip through a Y.Doc and a second replica of it. */
export function throughYjs(node: ProseMirrorNode): ProseMirrorNode {
  const doc = new Y.Doc()
  applyNodeToYDoc(doc, node)
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
  return ydocToNode(replica)
}
