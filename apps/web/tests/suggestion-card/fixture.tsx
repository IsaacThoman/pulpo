import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyNodeToYDoc, docSchema } from '@pulpo/client-core/doc-schema'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import * as Y from 'yjs'
import '../../src/index.css'
import '../../src/i18n'
import { DocEditor } from '../../src/features/files/editor/DocEditor'
import { SocketIOYProvider, type DocSocket } from '@pulpo/client-core/doc-sync'
import { FakeServer, FakeSocket } from '@pulpo/client-core/doc-sync/testing'

const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks && { marks }) })
const mark = (type: 'suggestionInsert' | 'suggestionDelete', id: string) => ({ type, attrs: { id, changeId: 'change-1' } })
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content })

const filler = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => paragraph(text(`Filler line ${from + index}.`)))

// A suggested replacement, a word suggested inside a suggested paragraph, a long suggested
// paragraph, two suggestions after a line break, and enough text to scroll.
const server = new FakeServer()
applyNodeToYDoc(server.doc, ProseMirrorNode.fromJSON(docSchema(), { type: 'doc', content: [
  paragraph(text('hey this is a '), text('stinky', [mark('suggestionDelete', 'swap')]), text('awesome', [mark('suggestionInsert', 'swap')]), text(' test')),
  paragraph(text('A second paragraph under the first.')),
  { ...paragraph(text('brave', [mark('suggestionInsert', 'inner')]), text(' new world')), attrs: { suggestion: 'insert|change-1|outer' } },
  ...filler(1, 30),
  { ...paragraph(text('A long suggested paragraph. '.repeat(40).trim())), attrs: { suggestion: 'insert|change-1|long' } },
  ...filler(31, 45),
  paragraph(text('Line one'), { type: 'hardBreak' }, text('starts', [mark('suggestionInsert', 'afterbreak')]), text('here', [mark('suggestionInsert', 'adjacent')]), text(' tail.')),
] }))

const doc = new Y.Doc()
const provider = new SocketIOYProvider('doc-1', doc)
provider.attach(new FakeSocket(server) as unknown as DocSocket)

// Scrolls like the file page, with the editor's toolbar sticking to the top.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div data-scroller className="h-screen overflow-y-auto">
      <DocEditor session={{ doc, provider }} editable />
    </div>
  </StrictMode>,
)
