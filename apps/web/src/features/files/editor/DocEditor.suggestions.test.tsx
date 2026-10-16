// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import {
  applyMarkdownToYDoc,
  applyNodeToYDoc,
  docSchema,
  listSuggestions,
  mergeMarkdown,
  resolveSuggestions,
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
import { describeHunk } from './suggestion-review'

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

/** Longer than the card's grace period after the pointer leaves its suggestion. */
const pastGrace = () => new Promise((resolve) => setTimeout(resolve, 400))
/** Lets React render what the last change led to, so an assertion that nothing showed means something. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))

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
    await pastGrace()
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

  it('keeps the card while the pointer crosses another suggestion on the way to it', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, second] = listSuggestions(editor().state.doc)
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${first!.id}"]`)!)
    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${second!.id}"]`)!)
    expect(card.textContent).toContain(describeHunk(first!))
    fireEvent.pointerEnter(card)
    await pastGrace()
    expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain(describeHunk(first!))
  })

  it('moves the card to another suggestion the pointer stays on', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, second] = listSuggestions(editor().state.doc)
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${first!.id}"]`)!)
    await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${second!.id}"]`)!)
    await waitFor(() => expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain(describeHunk(second!)))
  })

  it('closes the card with Escape until the cursor leaves the suggestion', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first] = listSuggestions(editor().state.doc)
    editor().commands.setTextSelection(first!.from + 1)
    await view.findByRole('dialog', { name: 'Suggestion' })

    fireEvent.keyDown(element()!, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull())
    editor().commands.setTextSelection(first!.from + 2)
    await settle()
    expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull()
    editor().commands.setTextSelection(1)
    await waitFor(() => expect(view.getByRole('toolbar', { name: 'Suggestions' }).textContent).not.toContain('Suggestion 1 of'))
    editor().commands.setTextSelection(first!.from + 1)
    await view.findByRole('dialog', { name: 'Suggestion' })
  })

  it('accepts and rejects the suggestion at the cursor with shortcuts', async () => {
    const server = suggestingServer()
    const { element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, second, ...rest] = listSuggestions(editor().state.doc)
    const ids = () => listSuggestions(editor().state.doc).map((hunk) => hunk.id)

    editor().commands.setTextSelection(first!.from + 1)
    fireEvent.keyDown(element()!, { key: 'Enter', ctrlKey: true, altKey: true })
    expect(ids()).toEqual([second!.id, ...rest.map((hunk) => hunk.id)])
    expect(editor().state.doc.textContent).toContain('Ship the CLI soon.')

    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    fireEvent.keyDown(element()!, { key: 'Backspace', ctrlKey: true, altKey: true })
    expect(ids()).toEqual(rest.map((hunk) => hunk.id))
    expect(editor().state.doc.textContent).not.toContain(second!.inserted.trim())
  })

  it('leaves Escape to the page when no card is open', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    try {
      fireEvent.keyDown(element()!, { key: 'Escape' })
      expect(reached).toHaveBeenCalledTimes(1)
      editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
      await view.findByRole('dialog', { name: 'Suggestion' })
      fireEvent.keyDown(element()!, { key: 'Escape' })
      expect(reached).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', reached)
    }
  })

  it('leaves Escape to an input method that is composing', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.keyDown(element()!, { key: 'Escape', isComposing: true })
    await settle()
    expect(view.queryByRole('dialog', { name: 'Suggestion' })).not.toBeNull()
  })

  it('closes the card with Escape from the review bar', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    await view.findByRole('dialog', { name: 'Suggestion' })
    const acceptAll = view.getByRole('button', { name: /Accept all/ })
    acceptAll.focus()
    fireEvent.keyDown(acceptAll, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull())
    expect(document.activeElement).toBe(acceptAll)
  })

  it('shows a closed card again when stepping to its suggestion', async () => {
    const { view, element, editor } = mount(serverWith([
      { type: 'paragraph', content: [{ type: 'text', text: 'Only ' }, { type: 'text', text: 'this', marks: [insertMark('only')] }] },
    ]))
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from)
    await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.keyDown(element()!, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull())
    fireEvent.click(view.getByRole('button', { name: 'Next suggestion' }))
    await view.findByRole('dialog', { name: 'Suggestion' })
  })

  it('resolves the suggestion whose card shows with the shortcuts', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, second] = listSuggestions(editor().state.doc)
    editor().commands.setTextSelection(first!.from + 1)
    await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${second!.id}"]`)!)
    await waitFor(() => expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain(describeHunk(second!)))
    fireEvent.keyDown(element()!, { key: 'Enter', ctrlKey: true, altKey: true })
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toContain(first!.id)
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).not.toContain(second!.id)
  })

  it('does not resolve with the shortcuts held down, with AltGr or Shift, or for viewers', async () => {
    const server = suggestingServer()
    const { element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const ids = () => listSuggestions(editor().state.doc).map((hunk) => hunk.id)
    const before = ids()
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    fireEvent.keyDown(element()!, { key: 'Backspace', ctrlKey: true, altKey: true, repeat: true })
    fireEvent.keyDown(element()!, { key: 'Enter', ctrlKey: true, altKey: true, shiftKey: true })
    // Windows sends AltGr as Ctrl-Alt.
    fireEvent.keyDown(element()!, { key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true })
    fireEvent.keyDown(element()!, { key: 'Backspace', ctrlKey: true, altKey: true })
    fireEvent.keyUp(element()!, { key: 'AltGraph', code: 'AltRight' })
    expect(ids()).toEqual(before)
    // Once resolved, the held keys' repeats leave the next suggestion alone.
    fireEvent.keyDown(element()!, { key: 'Backspace', ctrlKey: true, altKey: true })
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    fireEvent.keyDown(element()!, { key: 'Backspace', ctrlKey: true, altKey: true, repeat: true })
    expect(ids()).toEqual(before.slice(1))
    cleanup()

    const viewer = mount(suggestingServer(), false)
    await waitFor(() => expect(viewer.element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const viewerIds = () => listSuggestions(viewer.editor().state.doc).map((hunk) => hunk.id)
    const shown = viewerIds()
    const next = viewer.view.getByRole('button', { name: 'Next suggestion' })
    fireEvent.click(next)
    await viewer.view.findByRole('dialog', { name: 'Suggestion' })
    next.focus()
    fireEvent.keyDown(next, { key: 'Enter', ctrlKey: true, altKey: true })
    expect(viewerIds()).toEqual(shown)
  })

  it('takes the shortcuts with Ctrl-Alt reported as AltGraph, as Firefox does, and away from suggestions', async () => {
    const server = suggestingServer()
    const { element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, ...rest] = listSuggestions(editor().state.doc)
    editor().commands.setTextSelection(first!.from + 1)
    fireEvent.keyDown(element()!, { key: 'Enter', ctrlKey: true, altKey: true, modifierAltGraph: true })
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual(rest.map((hunk) => hunk.id))
    // A right Alt key that is no AltGr, as on US layouts, is Alt.
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    fireEvent.keyDown(element()!, { key: 'Alt', code: 'AltRight', altKey: true })
    fireEvent.keyDown(element()!, { key: 'Enter', ctrlKey: true, altKey: true })
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual(rest.slice(1).map((hunk) => hunk.id))
    // With no suggestion at the cursor the keys do nothing, rather than Backspace deleting.
    editor().commands.setTextSelection(1)
    expect(fireEvent.keyDown(element()!, { key: 'Backspace', ctrlKey: true, altKey: true })).toBe(false)
  })

  it('leaves focus on a control outside the review when resolving', async () => {
    const server = suggestingServer()
    const { view, element } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const outside = document.body.appendChild(document.createElement('button'))
    try {
      outside.focus()
      fireEvent.click(view.getByRole('button', { name: /Accept all/ }))
      expect(document.activeElement).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  it('keeps keyboard focus in the document when the card closes or resolves', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[0]!.from + 1)
    let card = await view.findByRole('dialog', { name: 'Suggestion' })
    within(card).getByRole('button', { name: 'Reject suggestion' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(element())

    editor().commands.setTextSelection(listSuggestions(editor().state.doc)[1]!.from + 1)
    card = await view.findByRole('dialog', { name: 'Suggestion' })
    const accept = within(card).getByRole('button', { name: 'Accept suggestion' })
    accept.focus()
    fireEvent.click(accept)
    expect(document.activeElement).toBe(element())
  })

  it('hides a card the pointer passed straight over before it showed', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const first = listSuggestions(editor().state.doc)[0]!
    // Both moves arrive before React renders the card.
    act(() => {
      element()!.querySelector(`[data-suggestion-id="${first.id}"]`)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      element()!.querySelector('h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    await pastGrace()
    expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull()
  })

  it('does not bring back the card of a suggestion restored after the pointer moved off', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const first = listSuggestions(editor().state.doc)[0]!
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${first.id}"]`)!)
    await view.findByRole('dialog', { name: 'Suggestion' })
    // Resolved without the card, as a collaborator or undo does.
    act(() => editor().view.dispatch(resolveSuggestions(editor().state.tr, (ref) => ref.id === first.id, 'accept')))
    expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull()
    fireEvent.mouseOver(element()!.querySelector('h1')!)
    await pastGrace()
    act(() => editor().commands.undo())
    expect(listSuggestions(editor().state.doc)[0]!.id).toBe(first.id)
    await pastGrace()
    expect(view.queryByRole('dialog', { name: 'Suggestion' })).toBeNull()
  })

  it('moves the card at once to a suggestion the cursor is put in, as a tap does', async () => {
    const server = suggestingServer()
    const { view, element, editor } = mount(server)
    await waitFor(() => expect(element()?.querySelector('.pulpo-suggestion-insert')).toBeTruthy())
    const [first, second] = listSuggestions(editor().state.doc)
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${first!.id}"]`)!)
    act(() => editor().commands.setTextSelection(first!.from + 1))
    await view.findByRole('dialog', { name: 'Suggestion' })
    fireEvent.mouseOver(element()!.querySelector(`[data-suggestion-id="${second!.id}"]`)!)
    act(() => editor().commands.setTextSelection(second!.from + 1))
    await waitFor(() => expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain(describeHunk(second!)), { timeout: 100 })
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

  it('keeps the card for an inner suggestion while the pointer crosses the block around it', async () => {
    const { view, element, editor } = mount(nested())
    await waitFor(() => expect(element()?.querySelector('[data-suggestion="insert"]')).toBeTruthy())
    fireEvent.mouseOver(element()!.querySelector('[data-suggestion-id="inner"]')!)
    const card = await view.findByRole('dialog', { name: 'Suggestion' })
    expect(card.textContent).toContain('Add “brave”')
    fireEvent.mouseOver(element()!.querySelector('[data-suggestion-id="outer"]')!)
    fireEvent.pointerEnter(card)
    await pastGrace()
    fireEvent.click(within(view.getByRole('dialog', { name: 'Suggestion' })).getByRole('button', { name: 'Accept suggestion' }))
    expect(listSuggestions(editor().state.doc).map((hunk) => hunk.id)).toEqual(['outer'])
  })

  it('keeps the card of a suggestion clicked at its end, where the block around it goes on', async () => {
    const { view, element, editor } = mount(nested())
    await waitFor(() => expect(element()?.querySelector('[data-suggestion="insert"]')).toBeTruthy())
    fireEvent.mouseOver(element()!.querySelector('[data-suggestion-id="inner"]')!)
    await view.findByRole('dialog', { name: 'Suggestion' })
    act(() => editor().commands.setTextSelection(listSuggestions(editor().state.doc).find((hunk) => hunk.id === 'inner')!.to))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(view.getByRole('dialog', { name: 'Suggestion' }).textContent).toContain('Add “brave”')
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
