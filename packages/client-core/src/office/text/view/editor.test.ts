// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { textOf } from '../codec.js'
import { createTextEditor, textCounts, type TextEditor, type TextEditorOptions } from './editor.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })

function open(text: string, readOnly = false, options: Partial<TextEditorOptions> = {}): { editor: TextEditor; doc: Y.Doc } {
  const doc = new Y.Doc()
  textOf(doc).insert(0, text)
  const awareness = new Awareness(doc)
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createTextEditor({ container, doc, awareness, readOnly, user: { name: 'Ana', color: '#3366ff' }, name: 'notes.txt', ...options })
  cleanup.push(() => { editor.destroy(); awareness.destroy(); doc.destroy(); container.remove() })
  return { editor, doc }
}

/** A keydown CodeMirror's keymaps see, as a keyboard sends it to the focused editor. */
function press(editor: TextEditor, key: string, modifiers: Partial<Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  editor.view.contentDOM.dispatchEvent(event)
  return event.defaultPrevented
}

describe('text editor find and go to line', () => {
  it('leaves the caret in the find field when find opens', () => {
    const { editor } = open('alpha\nbeta')
    editor.focus()
    editor.openSearch()
    expect(document.activeElement).toBe(editor.view.dom.querySelector('.cm-search input[name=search]'))
  })

  it('opens replace in the find field, then in the replace field once there is something to find', () => {
    const { editor } = open('alpha\nbeta')
    const field = (name: string) => editor.view.dom.querySelector(`.cm-search input[name=${name}]`)
    editor.openReplace()
    expect(document.activeElement).toBe(field('search'))
    editor.focus()
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } })
    // jsdom is not a Mac, so the Windows and Linux binding applies; the selection is the query.
    expect(press(editor, 'h', { ctrlKey: true })).toBe(true)
    expect((field('search') as HTMLInputElement).value).toBe('alpha')
    expect(document.activeElement).toBe(field('replace'))
    editor.focus()
    editor.openReplace()
    expect(document.activeElement).toBe(field('replace'))
  })

  it('goes to a line (and column) with Ctrl+G', async () => {
    const { editor } = open('one\ntwo\nthree\nfour')
    editor.focus()
    expect(press(editor, 'g', { ctrlKey: true })).toBe(true)
    const dialog = editor.view.dom.querySelector('.cm-goto-line')
    expect(dialog).toBeTruthy()
    const field = dialog!.querySelector<HTMLInputElement>('input[name=line]')!
    field.value = '3'
    dialog!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(editor.state().line).toBe(3)
    editor.openGotoLine()
    const again = editor.view.dom.querySelector('.cm-goto-line')!
    // Columns count from 1, as the status bar shows them.
    again.querySelector<HTMLInputElement>('input[name=line]')!.value = '2:3'
    again.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(editor.state()).toMatchObject({ line: 2, column: 3 })
    expect(editor.view.dom.querySelector('.cm-goto-line')).toBeNull()
    expect(document.activeElement).toBe(editor.view.contentDOM)
  })
})

describe('text editor counts', () => {
  it('counts words and characters as the Word editor does', () => {
    expect(textCounts('')).toEqual({ words: 0, characters: 0, charactersWithSpaces: 0, lines: 0 })
    expect(textCounts('Hello, world — 42 times!\nCafé  über')).toEqual({ words: 6, characters: 28, charactersWithSpaces: 34, lines: 2 })
  })

  it('counts the document and the selection, and reports how many ranges are selected', () => {
    const { editor } = open('one two\nthree\n\nfour five six')
    expect(editor.counts('document')).toEqual({ words: 6, characters: 22, charactersWithSpaces: 25, lines: 4 })
    expect(editor.state().selections).toBe(1)
    expect(editor.counts('selection')).toEqual({ words: 0, characters: 0, charactersWithSpaces: 0, lines: 0 })
    editor.view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 7), EditorSelection.range(15, 19)]) })
    expect(editor.state()).toMatchObject({ selections: 2, selected: 11 })
    expect(editor.counts('selection')).toEqual({ words: 3, characters: 10, charactersWithSpaces: 11, lines: 2 })
  })
})

describe('text editor view options and commands', () => {
  it('shows line numbers unless asked not to, and turns them on and off', () => {
    const { editor } = open('a\nb')
    expect(editor.view.dom.querySelector('.cm-lineNumbers')).toBeTruthy()
    editor.setLineNumbers(false)
    expect(editor.view.dom.querySelector('.cm-lineNumbers')).toBeNull()
    editor.setLineNumbers(true)
    expect(editor.view.dom.querySelector('.cm-lineNumbers')).toBeTruthy()
    const hidden = open('a', false, { lineNumbers: false })
    expect(hidden.editor.view.dom.querySelector('.cm-lineNumbers')).toBeNull()
  })

  it('spell checks only when asked, keeping its other attributes', () => {
    const { editor } = open('teh text', false, { labels: { Editor: 'Notes' } })
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('false')
    editor.setSpellcheck(true)
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('true')
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBe('Notes')
    expect(open('x', false, { spellcheck: true }).editor.view.contentDOM.getAttribute('spellcheck')).toBe('true')
  })

  it('comments lines out in a language with comments, and not in plain text', async () => {
    const plain = open('words')
    expect(plain.editor.canToggleComment()).toBe(false)
    expect(plain.editor.toggleComment()).toBe(false)
    const { editor, doc } = open('x = 1\n', false, { name: 'main.py' })
    await vi.waitFor(() => expect(editor.canToggleComment()).toBe(true))
    expect(editor.toggleComment()).toBe(true)
    expect(textOf(doc).toString()).toBe('# x = 1\n')
    const viewer = open('x = 1\n', true, { name: 'main.py' })
    await vi.waitFor(() => expect(viewer.editor.canToggleComment()).toBe(true))
    expect(viewer.editor.toggleComment()).toBe(false)
    expect(textOf(viewer.doc).toString()).toBe('x = 1\n')
  })
})

describe('text editor clipboard commands', () => {
  it('selects everything, reads the selection, and replaces it as one undo step', () => {
    const { editor, doc } = open('alpha beta\ngamma')
    expect(editor.selectionText()).toBe('')
    editor.selectAll()
    expect(editor.selectionText()).toBe('alpha beta\ngamma')
    editor.view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(11, 16)]) })
    expect(editor.selectionText()).toBe('alpha\ngamma')
    expect(editor.replaceSelection('X')).toBe(true)
    expect(textOf(doc).toString()).toBe('X beta\nX')
    editor.undo()
    expect(textOf(doc).toString()).toBe('alpha beta\ngamma')
  })

  it('keeps a replacement right after typing as its own undo step', () => {
    const { editor, doc } = open('a')
    editor.view.dispatch({ changes: { from: 1, insert: 'b' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    editor.replaceSelection('c')
    expect(textOf(doc).toString()).toBe('abc')
    editor.undo()
    expect(textOf(doc).toString()).toBe('ab')
  })

  it('cuts with an empty replacement, and changes nothing in a read-only file', () => {
    const { editor, doc } = open('keep cut')
    editor.view.dispatch({ selection: { anchor: 4, head: 8 } })
    expect(editor.replaceSelection('', 'delete.cut')).toBe(true)
    expect(textOf(doc).toString()).toBe('keep')
    const viewer = open('fixed', true)
    viewer.editor.selectAll()
    expect(viewer.editor.selectionText()).toBe('fixed')
    expect(viewer.editor.replaceSelection('changed')).toBe(false)
    expect(textOf(viewer.doc).toString()).toBe('fixed')
  })
})
