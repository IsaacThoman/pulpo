// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import {
  applyMarkdownToYDoc,
  applyNodeToYDoc,
  docSchema,
  listSuggestions,
  mergeMarkdown,
  SUGGESTION_DELETE_MARK,
  ydocToMarkdown,
  ydocToNode,
} from '@pulpo/client-core/doc-schema'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
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

/** A server document built from ProseMirror JSON content, for suggestions Markdown cannot set up. */
function serverWith(content: unknown[]): FakeServer {
  const server = new FakeServer()
  applyNodeToYDoc(server.doc, ProseMirrorNode.fromJSON(docSchema(), { type: 'doc', content }))
  return server
}

const insertMark = (id: string) => ({ type: 'suggestionInsert', attrs: { id, changeId: 'change-2' } })

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

  it('keeps the card for a hovered suggestion while the pointer moves onto it', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, ...rest] = listSuggestions(editor().state.doc)
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${first!.id}"]`)!)
    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    expect(card.textContent).toContain('Replace “editor” with “CLI”')

    // A browser fires the pointer events, which React turns into the card's onPointerEnter,
    // before the editor's mouseleave.
    fireEvent.pointerEnter(card)
    fireEvent.mouseLeave(element()!, { relatedTarget: card })
    await new Promise((resolve) => setTimeout(resolve, 400))
    fireEvent.click(within(view.getByRole('dialog', { name: 'Suggestion' })).getByRole('button', { name: 'Reject suggestion' }))
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual(rest.map((hunk) => hunk.id))
  })

  it('hides the hovered suggestion card once the pointer leaves it', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${listSuggestions(editor().state.doc)[0]!.id}"]`)!)
    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.pointerEnter(card)
    fireEvent.mouseLeave(element()!, { relatedTarget: card })
    fireEvent.pointerLeave(card)
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull())
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

describe('nested and block suggestions', () => {
  // A paragraph the agent suggested adding, and later a word suggested inside it.
  const nested = () => serverWith([
    { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
    { type: 'paragraph', attrs: { suggestion: 'insert|change-1|outer' }, content: [
      { type: 'text', text: 'brave', marks: [insertMark('inner')] },
      { type: 'text', text: ' new world' },
    ] },
  ])

  it('acts on the innermost suggestion at the cursor', async () => {
    const { view, element, editor } = mount(nested())
    await waitFor(() => expect(element()?.querySelector('[data-suggestion="insert"]')).toBeTruthy())
    const inner = listSuggestions(editor().state.doc).find((hunk) => hunk.id === 'inner')!
    editor().commands.setTextSelection(inner.from + 2)
    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    expect(card.textContent).toContain('Add “brave”')
    fireEvent.click(within(card).getByRole('button', { name: 'Accept suggestion' }))
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual(['outer'])
  })

  it('steps through nested suggestions without getting stuck', async () => {
    const { view, element } = mount(nested())
    await waitFor(() => expect(element()?.querySelector('[data-suggestion="insert"]')).toBeTruthy())
    const bar = () => view.getByRole('toolbar', { name: 'Suggestions' }).textContent
    const next = () => fireEvent.click(view.getByRole('button', { name: 'Next suggestion' }))
    next()
    expect(bar()).toContain('Suggestion 1 of 2')
    expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain('Add “brave new world”')
    next()
    expect(bar()).toContain('Suggestion 2 of 2')
    expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain('Add “brave”')
    next()
    expect(bar()).toContain('Suggestion 1 of 2')
    fireEvent.click(view.getByRole('button', { name: 'Previous suggestion' }))
    expect(bar()).toContain('Suggestion 2 of 2')
  })

  it('keeps a paragraph suggested for deletion once the user writes in it', async () => {
    const server = serverWith([
      { type: 'paragraph', content: [{ type: 'text', text: 'Keep me' }] },
      { type: 'paragraph', attrs: { suggestion: 'delete|change-1|gone' }, content: [{ type: 'text', text: 'Old words' }] },
    ])
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('[data-suggestion="delete"]')).toBeTruthy())
    const block = listSuggestions(editor().state.doc)[0]!
    editor().chain().setTextSelection(block.to - 1).insertContent(' and mine').run()
    expect(listSuggestions(editor().state.doc)).toEqual([])
    expect(element()!.querySelector('[data-suggestion]')).toBeNull()
    await waitFor(() => expect(view.queryByRole('toolbar', { name: 'Suggestions' })).toBeNull())
    await waitFor(() => expect(ydocToMarkdown(server.doc, 'proposed')).toBe('Keep me\n\nOld words and mine'))
  })

  it('treats typing inside a suggested insertion as a revision of that proposal', async () => {
    const { view, element, editor } = mount(serverWith([
      { type: 'paragraph', content: [
        { type: 'text', text: 'Intro ' },
        { type: 'text', text: 'proposed', marks: [insertMark('inserted')] },
      ] },
    ]))
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const hunk = listSuggestions(editor().state.doc)[0]!
    editor().chain().setTextSelection(hunk.from + 2).insertContent('MY WORDS').run()
    fireEvent.click(view.getByRole('button', { name: /Reject all/ }))
    expect(editor().state.doc.textContent).toBe('Intro ')
  })
})
