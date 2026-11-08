import type { DocxEditor, DocxFormattingState } from '@pulpo/client-core/office/docx/view'
import { describe, expect, it, vi } from 'vitest'
import { shortcutGroupsFromMenus, type MenuDefinition, type MenuEntry } from '../chrome/menu'
import { docxMenus, type DocxMenuHost } from './docx-menus'
import { DEFAULT_DOCX_PREFERENCES } from './docx-preferences'
import { docxShortcutGroups, WORD_COUNT_SHORTCUT } from './docx-shortcuts'

const STATE: DocxFormattingState = {
  styleId: 'Normal', fontFamily: 'Calibri', fontSize: 11, bold: false, italic: false, underline: false, strike: false,
  superscript: false, subscript: false, color: null, highlight: null, alignment: 'left', lineSpacing: 1.15, list: null,
  inTable: false, tableColumnsEditable: true, bodyCommandsEditable: true, canComment: true, untrackedFormattingEditable: true,
  link: null, canUndo: true, canRedo: false, empty: true, mode: 'editing', readOnly: false, layout: 'print', zoom: 1, pages: 3,
  formatPainter: false, formatPainterSticky: false, doubleStrike: false, caps: false, smallCaps: false, hidden: false,
  underlineStyle: null, spaceBefore: 0, spaceAfter: 8, inRevision: false, editingStory: null, cellVerticalAlign: null, headerRow: false,
}

/** An editor whose state is `state`; any command records its call. */
function fakeEditor(state: Partial<DocxFormattingState> = {}) {
  const calls: unknown[][] = []
  const known: Record<string, unknown> = {
    state: () => ({ ...STATE, ...state }),
    styles: () => [{ id: 'Normal', name: 'Normal' }, { id: 'Title', name: 'Title' }, { id: 'Heading1', name: 'heading 1' }, { id: 'Quote', name: 'Quote' }],
    tableFormat: () => null,
    revisions: () => [],
    editingStory: state.editingStory ?? null,
  }
  const editor = new Proxy(known, {
    get: (target, property: string) => property in target ? target[property] : (...args: unknown[]) => { calls.push([property, ...args]); return true },
  }) as unknown as DocxEditor
  return { editor, calls }
}

function host(editor: DocxEditor, change: Partial<DocxMenuHost> = {}): DocxMenuHost {
  const noop = () => {}
  return {
    editor, panels: { outline: false, comments: false, review: false }, togglePanel: noop, showMarkup: true, setShowMarkup: noop,
    preferences: { ...DEFAULT_DOCX_PREFERENCES }, setPreferences: vi.fn(), zoom: { fitted: false, set: noop }, find: noop,
    requestLink: noop, requestComment: noop, insertImage: noop, insertHeaderFooter: vi.fn(), insertPageNumber: vi.fn(), cut: noop, copy: noop,
    paste: noop, selectAll: noop, downloadText: noop, openPageSetup: vi.fn(), openParagraph: vi.fn(), openWordCount: noop, showShortcuts: noop,
    ...change,
  }
}

/** The entry at a path of ids through a menu and its submenus. */
function entry(menus: MenuDefinition[], menu: string, ...path: string[]): MenuEntry {
  let entries = menus.find((candidate) => candidate.id === menu)!.items()
  let found: MenuEntry | undefined
  for (const id of path) {
    found = entries.find((candidate) => 'id' in candidate && candidate.id === id)
    if (!found) throw new Error(`no ${id} in ${menu}`)
    if (found.type === 'submenu') entries = found.items
  }
  return found!
}
const select = (found: MenuEntry) => { if (found.type === 'item') found.onSelect() }

describe('Word menu bar', () => {
  it('lays the menus out as Docs does', () => {
    const { editor } = fakeEditor()
    expect(docxMenus(host(editor)).map((menu) => menu.id)).toEqual(['file', 'edit', 'view', 'insert', 'format', 'tools', 'help'])
  })

  it('offers Page setup and a plain text download in the File menu', () => {
    const { editor } = fakeEditor()
    const openPageSetup = vi.fn()
    const menus = docxMenus(host(editor, { openPageSetup, fileMenu: { name: 'Report.docx', download: () => {} } }))
    select(entry(menus, 'file', 'page-setup'))
    expect(openPageSetup).toHaveBeenCalled()
    expect(entry(menus, 'file', 'download', 'download-text')).toMatchObject({ label: 'Plain text (.txt)' })
  })

  it('keeps headers, footers, and page numbers from suggestions, which cannot track them', () => {
    const editing = docxMenus(host(fakeEditor().editor))
    const suggesting = docxMenus(host(fakeEditor({ mode: 'suggesting', untrackedFormattingEditable: false }).editor))
    for (const id of ['header', 'footer', 'page-numbers']) {
      expect(entry(editing, 'insert', id)).toMatchObject({ disabled: false })
      expect(entry(suggesting, 'insert', id)).toMatchObject({ disabled: true })
    }
    expect(entry(suggesting, 'insert', 'comment')).toMatchObject({ disabled: false })
  })

  it('inserts page numbers at each position, with or without the page count', () => {
    const { editor } = fakeEditor()
    const insertPageNumber = vi.fn()
    const menus = docxMenus(host(editor, { insertPageNumber }))
    select(entry(menus, 'insert', 'page-numbers', 'page-number-footer-right'))
    select(entry(menus, 'insert', 'page-numbers', 'page-numbers-total', 'page-number-total-header-center'))
    expect(insertPageNumber.mock.calls).toEqual([[{ kind: 'footer', align: 'right', withTotal: false }], [{ kind: 'header', align: 'center', withTotal: true }]])
    // In an open header, a page number can also go at the cursor.
    expect(() => entry(menus, 'insert', 'page-numbers', 'page-number-here')).toThrow()
    const inHeader = docxMenus(host(fakeEditor({ editingStory: 'header:1' }).editor, { insertPageNumber }))
    select(entry(inHeader, 'insert', 'page-numbers', 'page-number-here'))
    expect(insertPageNumber).toHaveBeenLastCalledWith({})
  })

  it('lists paragraph styles as Docs does, with Word\'s heading keys', () => {
    const { editor, calls } = fakeEditor({ styleId: 'Title' })
    const menus = docxMenus(host(editor))
    const styles = entry(menus, 'format', 'paragraph-styles')
    if (styles.type !== 'submenu') throw new Error('not a submenu')
    const ids = styles.items.flatMap((item) => 'id' in item ? [item.id] : [])
    expect(ids).toEqual(['style-normal', 'style-title', ...[1, 2, 3, 4, 5, 6].map((level) => `style-heading-${level}`), 'paragraph-styles-more'])
    expect(entry(menus, 'format', 'paragraph-styles', 'style-title')).toMatchObject({ checked: true })
    expect(entry(menus, 'format', 'paragraph-styles', 'style-heading-3')).toMatchObject({ shortcut: { key: '3', mod: true, alt: true } })
    select(entry(menus, 'format', 'paragraph-styles', 'style-heading-3'))
    select(entry(menus, 'format', 'paragraph-styles', 'paragraph-styles-more', 'style-Quote'))
    expect(calls).toEqual([['applyHeading', 3], ['setStyle', 'Quote']])
  })

  it('opens the Paragraph dialog from Format, and offers the table only in a table', () => {
    const openParagraph = vi.fn()
    const menus = docxMenus(host(fakeEditor().editor, { openParagraph }))
    select(entry(menus, 'format', 'paragraph'))
    select(entry(menus, 'format', 'align-indent', 'indentation-options'))
    select(entry(menus, 'format', 'line-spacing', 'custom-spacing'))
    expect(openParagraph.mock.calls).toEqual([['indents'], ['indents'], ['spacing']])
    expect(entry(menus, 'format', 'table')).toMatchObject({ disabled: true })
    const inTable = docxMenus(host(fakeEditor({ inTable: true, mode: 'suggesting', tableColumnsEditable: false, untrackedFormattingEditable: false }).editor))
    expect(entry(inTable, 'format', 'table')).toMatchObject({ disabled: false })
    expect(entry(inTable, 'format', 'table', 'table-row-below')).toMatchObject({ disabled: false })
    expect(entry(inTable, 'format', 'table', 'table-column-left')).toMatchObject({ disabled: true })
  })

  it('offers removing paragraph spacing where there is some', () => {
    const none = docxMenus(host(fakeEditor({ spaceBefore: 0, spaceAfter: 0 }).editor))
    const some = docxMenus(host(fakeEditor({ spaceBefore: 12, spaceAfter: 8 }).editor))
    expect(entry(none, 'format', 'line-spacing', 'space-before')).toMatchObject({ label: 'Add space before paragraph' })
    expect(entry(some, 'format', 'line-spacing', 'space-before')).toMatchObject({ label: 'Remove space before paragraph' })
    expect(entry(some, 'format', 'line-spacing', 'line-spacing-1.15')).toMatchObject({ checked: true, label: '1.15' })
  })

  it('keeps Tools preferences and the editing mode', () => {
    const setPreferences = vi.fn()
    const { editor, calls } = fakeEditor()
    const menus = docxMenus(host(editor, { setPreferences }))
    expect(entry(menus, 'tools', 'word-count')).toMatchObject({ shortcut: WORD_COUNT_SHORTCUT })
    expect(entry(menus, 'tools', 'autoformat')).toMatchObject({ checked: true })
    select(entry(menus, 'tools', 'autoformat'))
    expect(setPreferences).toHaveBeenCalledWith({ autoformat: false })
    select(entry(menus, 'tools', 'editing-mode', 'mode-suggesting'))
    expect(calls).toContainEqual(['setMode', 'suggesting'])
    expect(entry(docxMenus(host(editor, { documentReadOnly: true })), 'tools', 'editing-mode')).toMatchObject({ disabled: true })
    // Nothing to review: the review commands are off.
    expect(entry(menus, 'tools', 'tools-review', 'review-next')).toMatchObject({ disabled: true })
  })

  it('cuts only a selection and pastes without formatting with Cmd/Ctrl+Shift+V', () => {
    const empty = docxMenus(host(fakeEditor({ empty: true }).editor))
    const selected = docxMenus(host(fakeEditor({ empty: false }).editor))
    expect(entry(empty, 'edit', 'cut')).toMatchObject({ disabled: true })
    expect(entry(selected, 'edit', 'cut')).toMatchObject({ disabled: false })
    expect(entry(selected, 'edit', 'paste-plain')).toMatchObject({ shortcut: { key: 'v', mod: true, shift: true } })
  })

  it('lists the menus\' keys in the shortcuts dialog once', () => {
    const menus = docxMenus(host(fakeEditor().editor))
    const lines = shortcutGroupsFromMenus(menus, docxShortcutGroups()).flatMap((group) => group.items.map((item) => item.label))
    expect(lines.filter((label) => label === 'Word count')).toHaveLength(1)
    expect(lines).toContain('Paste without formatting')
    expect(lines).toContain('Heading 6')
  })
})
