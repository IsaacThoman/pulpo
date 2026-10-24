// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { Awareness } from 'y-protocols/awareness'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { ydocToMarkdown } from '../doc-schema/index.js'
import { createEditorExtensions } from './extensions.js'
import { formattingState, isFormatCommand, runFormatCommand, sameFormattingState } from './formatting.js'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

function open(editable = true) {
  const doc = new Y.Doc()
  const editor = new Editor({
    element: document.createElement('div'),
    editable,
    extensions: createEditorExtensions({ doc, awareness: new Awareness(doc), user: { name: 'Test', color: '#000' }, placeholder: 'Write' }),
  })
  editors.push(editor)
  return { doc, editor }
}

describe('formatting commands', () => {
  it('formats the selection and reports what is active', () => {
    const { doc, editor } = open()
    editor.commands.insertContent('Hello world')
    editor.commands.selectAll()
    expect(runFormatCommand(editor, 'bold')).toBe(true)
    expect(formattingState(editor).active).toContain('bold')
    runFormatCommand(editor, 'heading2')
    editor.commands.setTextSelection(3)
    expect(formattingState(editor).active).toEqual(expect.arrayContaining(['bold', 'heading2']))
    expect(formattingState(editor).active).not.toContain('paragraph')
    expect(ydocToMarkdown(doc).trim()).toBe('## **Hello world**')
  })

  it('sets and removes links', () => {
    const { doc, editor } = open()
    editor.commands.insertContent('Pulpo')
    editor.commands.selectAll()
    runFormatCommand(editor, 'link', { href: ' https://pulpo.baby ' })
    expect(formattingState(editor).linkHref).toBe('https://pulpo.baby')
    expect(ydocToMarkdown(doc).trim()).toBe('[Pulpo](https://pulpo.baby)')
    runFormatCommand(editor, 'link', { href: '' })
    expect(formattingState(editor).linkHref).toBeNull()
  })

  it('undoes through the Yjs history and indents list items', () => {
    const { doc, editor } = open()
    expect(formattingState(editor).disabled).toEqual(expect.arrayContaining(['undo', 'redo', 'indent', 'outdent']))
    runFormatCommand(editor, 'bulletList')
    editor.commands.insertContent('one')
    editor.commands.splitListItem('listItem')
    editor.commands.insertContent('two')
    expect(formattingState(editor).disabled).not.toContain('indent')
    runFormatCommand(editor, 'indent')
    expect(ydocToMarkdown(doc).trim()).toBe('- one\n  - two')
    runFormatCommand(editor, 'outdent')
    expect(ydocToMarkdown(doc).trim()).toBe('- one\n- two')
    expect(formattingState(editor).canUndo).toBe(true)
  })

  it('disables everything while read only', () => {
    const { editor } = open(false)
    const state = formattingState(editor)
    expect(state.editable).toBe(false)
    expect(state.disabled).toContain('bold')
    expect(state.canUndo).toBe(false)
    expect(sameFormattingState(state, formattingState(editor))).toBe(true)
  })

  it('recognizes command names', () => {
    expect(isFormatCommand('taskList')).toBe(true)
    expect(isFormatCommand('deleteEverything')).toBe(false)
    expect(isFormatCommand(3)).toBe(false)
  })
})
