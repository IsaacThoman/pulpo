import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyMarkdownToYDoc, applyNodeToYDoc, mergeMarkdown, ydocToNode } from '@pulpo/client-core/doc-schema'
import * as Y from 'yjs'
import '../../src/index.css'
import '../../src/i18n'
import { DocEditor } from '../../src/features/files/editor/DocEditor'
import { FakeServer, FakeSocket } from '../../src/features/files/editor/fake-doc-server.test.helpers'
import { SocketIOYProvider } from '../../src/features/files/editor/socket-provider'
import type { PulpoSocket } from '../../src/lib/realtime-socket'

// A document holding one suggested replacement, as a Suggest-mode push leaves it.
const server = new FakeServer()
applyMarkdownToYDoc(server.doc, 'hey this is a stinky test\n\nA second paragraph under the first.')
const merged = mergeMarkdown(ydocToNode(server.doc), 'hey this is a awesome test\n\nA second paragraph under the first.', { mode: 'suggest', changeId: 'change-1' })
applyNodeToYDoc(server.doc, merged.doc)

const doc = new Y.Doc()
const provider = new SocketIOYProvider('doc-1', doc)
provider.attach(new FakeSocket(server) as unknown as PulpoSocket)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DocEditor session={{ doc, provider }} editable />
  </StrictMode>,
)
