import type { TextEditor, TextEditorState } from '@pulpo/client-core/office/text/view'
import { describe, expect, it, vi } from 'vitest'
import { normalizeEntries, type MenuEntry } from '../chrome/menu'
import { textMenus, TEXT_ZOOM_PRESETS, type TextMenuContext } from './text-menus'
import { textShortcutGroups } from './text-shortcuts'

function stubEditor(state: Partial<TextEditorState> = {}, comments = true): TextEditor {
  const snapshot: TextEditorState = {
    canUndo: true, canRedo: false, line: 1, column: 1, selected: 0, selections: 1, lines: 3, language: 'Python',
    wrap: false, indent: { size: 4, tabs: false }, readOnly: false, focused: true, ...state,
  }
  return {
    state: () => snapshot,
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    openGotoLine: vi.fn(),
    canToggleComment: () => comments,
    toggleComment: vi.fn(() => true),
    indent: vi.fn(),
    setIndent: vi.fn(),
  } as unknown as TextEditor
}

function context(overrides: Partial<TextMenuContext> = {}): TextMenuContext {
  return {
    editor: stubEditor(),
    editable: true,
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    find: vi.fn(),
    replace: vi.fn(),
    toggleWrap: vi.fn(),
    lineNumbers: true,
    setLineNumbers: vi.fn(),
    spellcheck: false,
    setSpellcheck: vi.fn(),
    zoom: 1,
    setZoom: vi.fn(),
    wordCount: vi.fn(),
    ...overrides,
  }
}

function rows(entries: MenuEntry[]): Map<string, MenuEntry> {
  const found = new Map<string, MenuEntry>()
  const visit = (list: readonly MenuEntry[]) => {
    for (const entry of normalizeEntries(list)) {
      if (entry.type === 'item' || entry.type === 'submenu') found.set(entry.id, entry)
      if (entry.type === 'submenu') visit(entry.items)
    }
  }
  visit(entries)
  return found
}

function menu(options: TextMenuContext, id: string) {
  return rows(textMenus(options).find((entry) => entry.id === id)!.items())
}

function item(entries: Map<string, MenuEntry>, id: string): Extract<MenuEntry, { type: 'item' }> {
  const entry = entries.get(id)
  if (entry?.type !== 'item') throw new Error(`no ${id} item`)
  return entry
}

describe('text editor menus', () => {
  it('lays out Edit, View, and Tools between the host\'s File and Help', () => {
    expect(textMenus(context()).map((entry) => entry.label)).toEqual(['Edit', 'View', 'Tools'])
  })

  it('offers cut and copy only with a selection, and nothing that edits to viewers', () => {
    const caret = menu(context(), 'edit')
    expect([item(caret, 'cut').disabled, item(caret, 'copy').disabled, item(caret, 'paste').disabled]).toEqual([true, true, false])
    const selection = menu(context({ editor: stubEditor({ selected: 5 }) }), 'edit')
    expect([item(selection, 'cut').disabled, item(selection, 'copy').disabled]).toEqual([false, false])
    const viewer = menu(context({ editable: false, editor: stubEditor({ selected: 5, readOnly: true }) }), 'edit')
    expect(['undo', 'cut', 'paste', 'toggle-comment', 'indent', 'outdent', 'indentation'].map((id) => (viewer.get(id) as { disabled?: boolean }).disabled)).toEqual([true, true, true, true, true, true, true])
    expect([item(viewer, 'copy').disabled, item(viewer, 'select-all').disabled, item(viewer, 'go-to-line').disabled]).toEqual([false, undefined, undefined])
  })

  it('runs Edit commands on the editor', () => {
    const options = context()
    const edit = menu(options, 'edit')
    item(edit, 'select-all').onSelect()
    item(edit, 'go-to-line').onSelect()
    item(edit, 'toggle-comment').onSelect()
    item(edit, 'indent').onSelect()
    item(edit, 'outdent').onSelect()
    item(edit, 'find').onSelect()
    item(edit, 'replace').onSelect()
    const { editor } = options
    expect(editor.selectAll).toHaveBeenCalledOnce()
    expect(editor.openGotoLine).toHaveBeenCalledOnce()
    expect(editor.toggleComment).toHaveBeenCalledOnce()
    expect(vi.mocked(editor.indent).mock.calls).toEqual([['more'], ['less']])
    expect(options.find).toHaveBeenCalledOnce()
    expect(options.replace).toHaveBeenCalledOnce()
  })

  it('offers Toggle line comment only where the language has comments', () => {
    expect(menu(context({ editor: stubEditor({}, false) }), 'edit').has('toggle-comment')).toBe(false)
  })

  it('checks the file\'s indentation and sets another', () => {
    const options = context({ editor: stubEditor({ indent: { size: 2, tabs: true } }) })
    const edit = menu(options, 'edit')
    expect(item(edit, 'indent-tabs-2').checked).toBe(true)
    expect(item(edit, 'indent-spaces-2').checked).toBe(false)
    item(edit, 'indent-spaces-4').onSelect()
    expect(options.editor.setIndent).toHaveBeenCalledWith({ size: 4, tabs: false })
  })

  it('shows the view options as they are, with Preview only for web pages', () => {
    const options = context({ editor: stubEditor({ wrap: true }), spellcheck: true, zoom: 1.5 })
    const view = menu(options, 'view')
    expect([item(view, 'wrap').checked, item(view, 'line-numbers').checked, item(view, 'spellcheck').checked]).toEqual([true, true, true])
    expect(view.has('preview')).toBe(false)
    item(view, 'line-numbers').onSelect()
    expect(options.setLineNumbers).toHaveBeenCalledWith(false)
    item(view, 'spellcheck').onSelect()
    expect(options.setSpellcheck).toHaveBeenCalledWith(false)
    const zoom = view.get('zoom')
    expect(zoom?.type === 'submenu' && zoom.items.map((entry) => entry.type === 'item' ? `${entry.label}${entry.checked ? '*' : ''}` : '')).toEqual(['80%', '90%', '100%', '110%', '125%', '150%*', '175%', '200%'])
    item(view, 'zoom-200').onSelect()
    expect(options.setZoom).toHaveBeenCalledWith(2)
    expect(TEXT_ZOOM_PRESETS.at(0)).toBe(0.8)
    const toggle = vi.fn()
    const html = menu(context({ preview: { on: true, toggle } }), 'view')
    item(html, 'preview').onSelect()
    expect([item(html, 'preview').checked, toggle.mock.calls.length]).toEqual([true, 1])
  })

  it('opens the word count from Tools', () => {
    const options = context()
    item(menu(options, 'tools'), 'word-count').onSelect()
    expect(options.wordCount).toHaveBeenCalledOnce()
  })

  it('lists every menu shortcut in the shortcuts dialog under the same name', () => {
    const listed = new Set(textShortcutGroups().flatMap((group) => group.items.map((entry) => entry.label)))
    const edit = menu(context(), 'edit')
    for (const id of ['undo', 'redo', 'find', 'replace', 'go-to-line', 'toggle-comment', 'select-all']) expect(listed).toContain(item(edit, id).label)
    expect(listed).toContain(item(menu(context(), 'view'), 'wrap').label)
  })
})
