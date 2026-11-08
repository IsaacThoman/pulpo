import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { insertMarkdownLink, toggleMarkdownBold, toggleMarkdownItalic } from './markdown-format.js'
import type { StateCommand } from '@codemirror/state'

/** Runs a command on `text` with the selection marked by `[` and `]` (or a caret `|`), and returns the result marked the same way. */
function run(command: StateCommand, marked: string, readOnly = false): { text: string; ran: boolean } {
  const caret = marked.indexOf('|')
  const from = caret >= 0 ? caret : marked.indexOf('[')
  const to = caret >= 0 ? caret : marked.indexOf(']') - 1
  const doc = marked.replace(/[[\]|]/g, '')
  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: [EditorState.readOnly.of(readOnly)] })
  const ran = command({ state, dispatch: (transaction) => { state = transaction.state } })
  const { from: start, to: end } = state.selection.main
  const text = state.doc.toString()
  return { ran, text: start === end ? `${text.slice(0, start)}|${text.slice(start)}` : `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}` }
}

describe('Markdown cell formatting', () => {
  it('wraps the selection in ** for bold and takes them off again', () => {
    expect(run(toggleMarkdownBold, 'a [word] b').text).toBe('a **[word]** b')
    expect(run(toggleMarkdownBold, 'a **[word]** b').text).toBe('a [word] b')
    expect(run(toggleMarkdownBold, 'a [**word**] b').text).toBe('a [word] b')
  })

  it('wraps in * for italic, and keeps bold apart from italic', () => {
    expect(run(toggleMarkdownItalic, '[word]').text).toBe('*[word]*')
    expect(run(toggleMarkdownItalic, '*[word]*').text).toBe('[word]')
    // Italic inside bold, and bold inside bold italic.
    expect(run(toggleMarkdownItalic, '**[word]**').text).toBe('***[word]***')
    expect(run(toggleMarkdownItalic, '***[word]***').text).toBe('**[word]**')
    expect(run(toggleMarkdownBold, '*[word]*').text).toBe('***[word]***')
    expect(run(toggleMarkdownBold, '***[word]***').text).toBe('*[word]*')
  })

  it('puts the caret between the markers with nothing selected, and a second press takes them off', () => {
    const once = run(toggleMarkdownBold, 'a | b')
    expect(once.text).toBe('a **|** b')
    expect(run(toggleMarkdownBold, once.text).text).toBe('a | b')
  })

  it('makes a link with the url selected, or the caret in the text when nothing is selected', () => {
    expect(run(insertMarkdownLink, 'see [the docs] now').text).toBe('see [the docs]([url]) now')
    expect(run(insertMarkdownLink, 'see | now').text).toBe('see [|](url) now')
  })

  it('leaves read-only cells alone, so the key is not taken', () => {
    expect(run(toggleMarkdownBold, '[word]', true)).toEqual({ ran: false, text: '[word]' })
    expect(run(insertMarkdownLink, '[word]', true).ran).toBe(false)
  })
})
