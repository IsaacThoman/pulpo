// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import {
  applyMarkdownToYDoc,
  applyNodeToYDoc,
  listSuggestions,
  mergeMarkdown,
  SUGGESTION_DELETE_MARK,
  ydocToMarkdown,
  ydocToNode,
} from '@pulpo/client-core/doc-schema'
import type { Editor } from '@tiptap/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { PulpoSocket } from '@/lib/realtime-socket'
import { DocEditor } from './DocEditor'
import { FakeServer, FakeSocket } from './fake-doc-server.test.helpers'
import { SocketIOYProvider } from './socket-provider'

afterEach(cleanup)

// jsdom has no layout; ProseMirror measures text ranges to place the card and scroll to it.
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 16, width: 0, height: 16, toJSON: () => ({}) } as DOMRect
Range.prototype.getBoundingClientRect = () => rect
Range.prototype.getClientRects = () => Object.assign([rect], { item: () => rect }) as unknown as DOMRectList
window.scrollBy = () => undefined

const BASE = '# Plan\n\nShip the editor soon.\n\nKeep this paragraph.'
const PROPOSED = '# Plan\n\nShip the CLI soon.\n\nKeep this paragraph.\n\nA brand new paragraph.'

/** A server document holding an agent's suggestions, as a Suggest-mode push leaves it. */
function suggestingServer(): FakeServer {
  const server = new FakeServer()
  applyMarkdownToYDoc(server.doc, BASE)
  const merged = mergeMarkdown(ydocToNode(server.doc), PROPOSED, { mode: 'suggest', changeId: 'change-1' })
  applyNodeToYDoc(server.doc, merged.doc)
  return server
}

function mount(server: FakeServer, editable = true) {
  const doc = new Y.Doc()
  const provider = new SocketIOYProvider('doc-1', doc)
  provider.attach(new FakeSocket(server) as unknown as PulpoSocket)
  const onSuggestionsResolved = vi.fn()
  const view = render(<DocEditor session={{ doc, provider }} editable={editable} onSuggestionsResolved={onSuggestionsResolved} />)
  const element = () => view.container.querySelector<HTMLElement & { editor?: Editor }>('.pulpo-doc-editor')
  const editor = () => element()!.editor!
  return { view, element, editor, onSuggestionsResolved }
}

describe('DocEditor suggestions', () => {
  it('shows insertions and deletions and accepts them all', async () => {
    const server = suggestingServer()
    const { view, element, editor, onSuggestionsResolved } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    expect(element()!.querySelector('.pulpo-suggestion-delete')?.textContent).toBe('editor')
    const count = listSuggestions(editor().state.doc).length
    expect(count).toBeGreaterThan(1)
    const bar = view.getByRole('toolbar', { name: 'Suggestions' })
    expect(bar.textContent).toContain(`${count} suggestions`)

    fireEvent.click(within(bar).getByRole('button', { name: /Accept all/ }))
    expect(element()!.querySelector('[data-suggestion-id]')).toBeNull()
    expect(view.queryByRole('toolbar', { name: 'Suggestions' })).toBeNull()
    expect(onSuggestionsResolved).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(ydocToMarkdown(server.doc)).toBe(PROPOSED))
  })

  it('rejects them all, back to the original', async () => {
    const server = suggestingServer()
    const { view, element } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /Reject all/ }))
    await waitFor(() => expect(ydocToMarkdown(server.doc, 'proposed')).toBe(BASE))
  })

  it('describes the suggestion at the cursor and resolves just that one', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, ...rest] = listSuggestions(editor().state.doc)
    editor().commands.setTextSelection(first!.from + 1)

    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    expect(card.textContent).toContain('Replace “editor” with “CLI”')
    expect(view.getByRole('toolbar', { name: 'Suggestions' }).textContent).toContain(`Suggestion 1 of ${rest.length + 1}`)
    fireEvent.click(within(card).getByRole('button', { name: 'Accept suggestion' }))

    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual(rest.map((hunk) => hunk.id))
    expect(editor().state.doc.textContent).toContain('Ship the CLI soon.')
    // The editor's own undo brings the suggestion back.
    editor().commands.undo()
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual([first!.id, ...rest.map((hunk) => hunk.id)])
  })

  it('steps through suggestions from the review bar', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const hunks = listSuggestions(editor().state.doc)
    fireEvent.click(view.getByRole('button', { name: 'Next suggestion' }))
    expect(view.getByRole('toolbar', { name: 'Suggestions' }).textContent).toContain(`Suggestion 1 of ${hunks.length}`)
    fireEvent.click(view.getByRole('button', { name: 'Next suggestion' }))
    expect(view.getByRole('toolbar', { name: 'Suggestions' }).textContent).toContain(`Suggestion 2 of ${hunks.length}`)
    fireEvent.click(view.getByRole('button', { name: 'Previous suggestion' }))
    fireEvent.click(view.getByRole('button', { name: 'Previous suggestion' }))
    expect(view.getByRole('toolbar', { name: 'Suggestions' }).textContent).toContain(`Suggestion ${hunks.length} of ${hunks.length}`)
  })

  it('shows suggestions without actions to viewers who cannot edit', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server, false)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    expect(view.queryByRole('button', { name: /Accept all/ })).toBeNull()
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('keeps text typed inside a suggested deletion out of it', async () => {
    const server = suggestingServer()
    const { element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-delete')).toBeTruthy())
    let inside = -1
    editor().state.doc.descendants((node, pos) => {
      if (inside < 0 && node.isText && node.marks.some((mark) => mark.type.name === SUGGESTION_DELETE_MARK)) inside = pos + 2
    })
    editor().chain().setTextSelection(inside).insertContent('X').run()
    const typed = editor().state.doc.nodeAt(inside)!
    expect(typed.text?.startsWith('X')).toBe(true)
    expect(typed.marks.map((mark) => mark.type.name)).not.toContain(SUGGESTION_DELETE_MARK)
  })
})
