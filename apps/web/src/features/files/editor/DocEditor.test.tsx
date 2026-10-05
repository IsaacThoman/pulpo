// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import type { Editor } from '@tiptap/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { PulpoSocket } from '@/lib/realtime-socket'
import { DocEditor } from './DocEditor'
import { FakeServer, FakeSocket } from './fake-doc-server.test.helpers'
import { SocketIOYProvider } from './socket-provider'

afterEach(cleanup)

function mount(server: FakeServer) {
  const doc = new Y.Doc()
  const provider = new SocketIOYProvider('doc-1', doc)
  provider.attach(new FakeSocket(server) as unknown as PulpoSocket)
  const view = render(<DocEditor session={{ doc, provider }} editable />)
  const element = () => view.container.querySelector<HTMLElement & { editor?: Editor }>('.pulpo-doc-editor')
  return { doc, provider, view, element }
}

describe('DocEditor', () => {
  it('syncs edits between two mounted editors through the provider', async () => {
    const server = new FakeServer()
    const a = mount(server)
    const b = mount(server)
    await waitFor(() => expect(a.element()?.editor).toBeTruthy())
    a.element()!.editor!.commands.setContent('<h1>Plan</h1><p>Ship the <strong>editor</strong></p>')
    await waitFor(() => expect(b.element()?.querySelector('h1')?.textContent).toBe('Plan'))
    expect(b.element()?.querySelector('strong')?.textContent).toBe('editor')
    b.element()!.editor!.commands.insertContentAt(b.element()!.editor!.state.doc.content.size, '<p>From B</p>')
    await waitFor(() => expect(a.element()?.textContent).toContain('From B'))
    // The server derives Markdown from the same state with the shared schema.
    await waitFor(() => expect(ydocToMarkdown(server.doc)).toBe('# Plan\n\nShip the **editor**\n\nFrom B'))
  })

  it('renders a read-only editor when editing is not allowed', async () => {
    const doc = new Y.Doc()
    const provider = new SocketIOYProvider('doc-1', doc)
    const view = render(<DocEditor session={{ doc, provider }} editable={false} />)
    await waitFor(() => expect(view.container.querySelector('.pulpo-doc-editor')?.getAttribute('contenteditable')).toBe('false'))
  })
})
