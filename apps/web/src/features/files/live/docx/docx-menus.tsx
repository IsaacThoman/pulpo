import type { CaseChange, DocxEditor, DocxFormattingState, HeaderFooterKind, ListKind } from '@pulpo/client-core/office/docx/view'
import {
  Bold,
  CaseSensitive,
  ClipboardPaste,
  ClipboardType,
  Copy,
  FileText,
  ImagePlus,
  Italic,
  Keyboard,
  Link2,
  ListTree,
  MessageSquare,
  MessageSquarePlus,
  PanelBottom,
  PanelTop,
  PenLine,
  Pilcrow,
  RemoveFormatting,
  Scissors,
  SeparatorHorizontal,
  Sigma,
  Strikethrough,
  Table,
  TableOfContents,
  TextSelect,
  Underline,
  WholeWord,
} from 'lucide-react'
import { activeLocale, ui } from '@/i18n/ui'
import { isAppleShortcut } from '../../browser/shortcuts'
import { fileMenuDefinition, type FileMenuHost } from '../chrome/file-menu'
import { separator, type MenuDefinition, type MenuEntry, type MenuItemEntry } from '../chrome/menu'
import type { ShortcutSpec } from '../chrome/shortcuts'
import { findEntries, helpMenu, undoRedoEntries } from '../chrome/standard-menus'
import { SHORTCUTS_SHORTCUT } from '../chrome/use-editor-shortcuts'
import { zoomMenu } from '../chrome/zoom'
import type { DocxPreferences } from './docx-preferences'
import { PLAIN_PASTE_SHORTCUT, WORD_COUNT_SHORTCUT } from './docx-shortcuts'
import { ShadingSwatches, SymbolGrid, TableGridPicker } from './docx-pickers'
import type { ParagraphDialogFocus } from './paragraph-format'

export interface DocxPanelsState {
  outline: boolean
  comments: boolean
  review: boolean
}

/** What the Word editor's menus do beyond calling the editor: panels, dialogs, and pickers of the view. */
export interface DocxMenuHost {
  editor: DocxEditor
  fileMenu?: FileMenuHost
  /** The file is read-only for this person (not just Viewing mode): the mode cannot change. */
  documentReadOnly?: boolean
  panels: DocxPanelsState
  togglePanel: (panel: keyof DocxPanelsState) => void
  showMarkup: boolean
  setShowMarkup: (show: boolean) => void
  preferences: DocxPreferences
  setPreferences: (change: Partial<DocxPreferences>) => void
  zoom: { fitted: boolean; fit?: () => void; set: (zoom: number) => void }
  find: (mode: 'find' | 'replace') => void
  requestLink: () => void
  requestComment: () => void
  insertImage: () => void
  insertHeaderFooter: (kind: HeaderFooterKind) => void
  insertPageNumber: (options: { kind?: HeaderFooterKind; align?: 'left' | 'center' | 'right'; withTotal?: boolean }) => void
  cut: () => void
  copy: () => void
  paste: (plain: boolean) => void
  selectAll: () => void
  downloadText: () => void
  openPageSetup: () => void
  openParagraph: (focus: ParagraphDialogFocus) => void
  openWordCount: () => void
  showShortcuts: () => void
}

const key = (k: string, more: Omit<ShortcutSpec, 'key'> = {}): ShortcutSpec => ({ key: k, mod: true, ...more })

const item = (id: string, label: string, onSelect: () => void, extra: Partial<MenuItemEntry> = {}): MenuEntry => ({ type: 'item', id, label, onSelect, ...extra })

/** The heading level (1 to 6, the ones Docs lists) of a style, by Word's built-in id or name. */
function headingLevel(style: { id: string; name: string }): number | undefined {
  const match = /^heading\s?([1-6])$/i.exec(style.id) ?? /^heading ([1-6])$/i.exec(style.name)
  return match ? Number(match[1]) : undefined
}

function paragraphStylesMenu(editor: DocxEditor, state: DocxFormattingState): MenuEntry {
  const styles = editor.styles()
  const current = styles.find((style) => style.id === state.styleId)
  const currentLevel = current ? headingLevel(current) : undefined
  const named = (name: string) => styles.find((style) => style.id.toLowerCase() === name || style.name.toLowerCase() === name)
  const title = named('title')
  const subtitle = named('subtitle')
  const normal = named('normal')
  const shown = new Set([title?.id, subtitle?.id, normal?.id].filter(Boolean))
  const others = styles.filter((style) => !shown.has(style.id) && headingLevel(style) === undefined)
  const disabled = state.readOnly
  return {
    type: 'submenu',
    id: 'paragraph-styles',
    label: ui("Paragraph styles"),
    icon: Pilcrow,
    disabled,
    items: [
      item('style-normal', ui("Normal text"), () => editor.setStyle(normal?.id ?? null), { radio: true, checked: Boolean(normal && state.styleId === normal.id) || state.styleId === null, shortcut: key('0', { alt: true }) }),
      ...(title ? [item('style-title', ui("Title"), () => editor.setStyle(title.id), { radio: true, checked: state.styleId === title.id })] : []),
      ...(subtitle ? [item('style-subtitle', ui("Subtitle"), () => editor.setStyle(subtitle.id), { radio: true, checked: state.styleId === subtitle.id })] : []),
      ...[1, 2, 3, 4, 5, 6].map((level) => item(`style-heading-${level}`, ui("Heading {{level}}", { level }), () => editor.applyHeading(level), { radio: true, checked: currentLevel === level, shortcut: key(String(level), { alt: true }) })),
      ...(others.length ? [separator, {
        type: 'submenu',
        id: 'paragraph-styles-more',
        label: ui("More styles"),
        items: others.map((style) => item(`style-${style.id}`, style.name, () => editor.setStyle(style.id), { radio: true, checked: state.styleId === style.id })),
      } satisfies MenuEntry] : []),
    ],
  }
}

function tableMenu(host: DocxMenuHost, state: DocxFormattingState): MenuEntry {
  const { editor } = host
  const rows = state.readOnly
  const columns = !state.tableColumnsEditable
  const cells = !state.untrackedFormattingEditable
  const table = editor.tableFormat()
  return {
    type: 'submenu',
    id: 'table',
    label: ui("Table"),
    icon: Table,
    disabled: !state.inTable || state.readOnly,
    items: [
      item('table-row-above', ui("Insert row above"), () => editor.addRowBefore(), { disabled: rows }),
      item('table-row-below', ui("Insert row below"), () => editor.addRowAfter(), { disabled: rows }),
      item('table-column-left', ui("Insert column left"), () => editor.addColumnBefore(), { disabled: columns }),
      item('table-column-right', ui("Insert column right"), () => editor.addColumnAfter(), { disabled: columns }),
      separator,
      item('table-delete-row', ui("Delete row"), () => editor.deleteRow(), { disabled: rows }),
      item('table-delete-column', ui("Delete column"), () => editor.deleteColumn(), { disabled: columns }),
      item('table-delete', ui("Delete table"), () => editor.deleteTable(), { disabled: rows, destructive: true }),
      separator,
      item('table-merge', ui("Merge cells"), () => editor.mergeCells(), { disabled: columns }),
      item('table-split', ui("Split cell"), () => editor.splitCell(), { disabled: columns }),
      separator,
      {
        type: 'submenu',
        id: 'table-cell-align',
        label: ui("Cell vertical alignment"),
        disabled: cells,
        items: (['top', 'center', 'bottom'] as const).map((value) => item(`table-cell-align-${value}`, value === 'top' ? ui("Top") : value === 'center' ? ui("Middle") : ui("Bottom"), () => editor.setCellVerticalAlign(value), { radio: true, checked: (state.cellVerticalAlign ?? 'top') === value })),
      },
      {
        type: 'submenu',
        id: 'table-align',
        label: ui("Table alignment"),
        disabled: cells,
        items: (['left', 'center', 'right'] as const).map((value) => item(`table-align-${value}`, value === 'left' ? ui("Align left") : value === 'center' ? ui("Center") : ui("Align right"), () => editor.setTableAlignment(value), { radio: true, checked: (table?.alignment ?? 'left') === value })),
      },
      item('table-header-row', ui("Repeat as header row"), () => editor.setHeaderRow(!state.headerRow), { checked: state.headerRow, disabled: cells }),
      separator,
      {
        type: 'submenu',
        id: 'table-borders',
        label: ui("Borders"),
        disabled: cells,
        items: [
          item('table-borders-all', ui("All borders"), () => editor.setCellBorders('all')),
          item('table-borders-outside', ui("Outside borders"), () => editor.setCellBorders('outside')),
          item('table-borders-inside', ui("Inside borders"), () => editor.setCellBorders('inside')),
          item('table-borders-none', ui("No borders"), () => editor.setCellBorders('none')),
        ],
      },
      {
        type: 'submenu',
        id: 'table-shading',
        label: ui("Cell shading"),
        disabled: cells,
        items: [{ type: 'custom', id: 'table-shading-swatches', render: (close) => <ShadingSwatches onPick={(color) => { close(); editor.setCellShading(color) }} /> }],
      },
      separator,
      {
        type: 'submenu',
        id: 'table-select',
        label: ui("Select"),
        items: [
          item('table-select-row', ui("Row"), () => editor.selectTable('row')),
          item('table-select-column', ui("Column"), () => editor.selectTable('column')),
          item('table-select-table', ui("Table"), () => editor.selectTable('table')),
        ],
      },
    ],
  }
}

const caseChanges = (): [Exclude<CaseChange, 'cycle'>, string][] => [
  ['lower', ui("lowercase")],
  ['upper', ui("UPPERCASE")],
  ['title', ui("Title Case")],
  ['sentence', ui("Sentence case")],
  ['toggle', ui("tOGGLE cASE")],
]

const underlineStyles = (): [string, string][] => [
  ['single', ui("Single")],
  ['double', ui("Double")],
  ['thick', ui("Thick")],
  ['dotted', ui("Dotted")],
  ['dash', ui("Dashed")],
  ['wave', ui("Wave")],
]

/**
 * The Word editor's menu bar, laid out as Google Docs' (File, Edit, View, Insert, Format, Tools,
 * Help) with Word's commands where Docs has none. Build it in render; each menu reads the editor's
 * state as it opens.
 */
export function docxMenus(host: DocxMenuHost): MenuDefinition[] {
  const { editor } = host
  const apple = isAppleShortcut()
  return [
    fileMenuDefinition(host.fileMenu, () => {
      const state = editor.state()
      return {
        print: () => editor.print(),
        downloads: [item('download-text', ui("Plain text (.txt)"), host.downloadText, { icon: FileText })],
        items: [item('page-setup', ui("Page setup…"), host.openPageSetup, { disabled: state.readOnly })],
      }
    }),
    {
      id: 'edit',
      label: ui("Edit"),
      items: () => {
        const state = editor.state()
        return [
          ...undoRedoEntries({ undo: () => editor.undo(), redo: () => editor.redo(), canUndo: !state.readOnly && state.canUndo, canRedo: !state.readOnly && state.canRedo }),
          separator,
          item('cut', ui("Cut"), host.cut, { icon: Scissors, shortcut: key('x'), disabled: state.readOnly || state.empty }),
          item('copy', ui("Copy"), host.copy, { icon: Copy, shortcut: key('c'), disabled: state.empty }),
          item('paste', ui("Paste"), () => host.paste(false), { icon: ClipboardPaste, shortcut: key('v'), disabled: state.readOnly }),
          item('paste-plain', ui("Paste without formatting"), () => host.paste(true), { icon: ClipboardType, shortcut: PLAIN_PASTE_SHORTCUT, disabled: state.readOnly }),
          separator,
          item('select-all', ui("Select all"), host.selectAll, { icon: TextSelect, shortcut: key('a') }),
          separator,
          ...findEntries({ find: () => host.find('find'), replace: state.readOnly ? undefined : () => host.find('replace') }),
        ]
      },
    },
    {
      id: 'view',
      label: ui("View"),
      items: () => {
        const state = editor.state()
        const print = state.layout === 'print'
        return [
          item('layout-print', ui("Print layout"), () => editor.setLayout('print'), { radio: true, checked: print }),
          item('layout-web', ui("Web layout"), () => editor.setLayout('web'), { radio: true, checked: !print }),
          separator,
          item('outline', ui("Show outline"), () => host.togglePanel('outline'), { icon: ListTree, checked: host.panels.outline }),
          item('comments', ui("Comments"), () => host.togglePanel('comments'), { icon: MessageSquare, checked: host.panels.comments, disabled: Boolean(editor.editingStory) }),
          item('review', ui("Review changes"), () => host.togglePanel('review'), { icon: PenLine, checked: host.panels.review }),
          separator,
          item('show-markup', ui("Show markup"), () => host.setShowMarkup(!host.showMarkup), { checked: host.showMarkup }),
          item('show-word-count', ui("Show word count"), () => host.setPreferences({ wordCount: !host.preferences.wordCount }), { checked: host.preferences.wordCount }),
          separator,
          zoomMenu({ zoom: state.zoom, onZoom: host.zoom.set, fitted: print && host.zoom.fitted, onFit: print ? host.zoom.fit : undefined }),
        ]
      },
    },
    {
      id: 'insert',
      label: ui("Insert"),
      items: () => {
        const state = editor.state()
        const sections = !state.untrackedFormattingEditable || !state.bodyCommandsEditable
        // Headers, footers, and page numbers are section properties, which cannot be suggested.
        const pages = !state.untrackedFormattingEditable
        const inHeaderFooter = /^(header|footer):/.test(state.editingStory ?? '')
        const positions = (withTotal: boolean): MenuEntry[] => [
          { type: 'label', label: ui("Top of page") },
          ...(['left', 'center', 'right'] as const).map((align) => item(`page-number-${withTotal ? 'total-' : ''}header-${align}`, align === 'left' ? ui("Top left") : align === 'center' ? ui("Top center") : ui("Top right"), () => host.insertPageNumber({ kind: 'header', align, withTotal }))),
          { type: 'label', label: ui("Bottom of page") },
          ...(['left', 'center', 'right'] as const).map((align) => item(`page-number-${withTotal ? 'total-' : ''}footer-${align}`, align === 'left' ? ui("Bottom left") : align === 'center' ? ui("Bottom center") : ui("Bottom right"), () => host.insertPageNumber({ kind: 'footer', align, withTotal }))),
        ]
        return [
          item('image', ui("Image…"), host.insertImage, { icon: ImagePlus, disabled: state.readOnly }),
          {
            type: 'submenu',
            id: 'table',
            label: ui("Table"),
            icon: Table,
            disabled: state.readOnly,
            items: [{ type: 'custom', id: 'table-grid', render: (close) => <TableGridPicker onPick={(rows, cols) => { close(); editor.insertTable(rows, cols) }} /> }],
          },
          separator,
          item('link', ui("Link"), host.requestLink, { icon: Link2, shortcut: key('k'), disabled: !state.untrackedFormattingEditable }),
          item('comment', ui("Comment"), host.requestComment, { icon: MessageSquarePlus, shortcut: key('m', { alt: true }), disabled: !state.canComment }),
          separator,
          item('horizontal-line', ui("Horizontal line"), () => editor.insertHorizontalLine(), { icon: SeparatorHorizontal, disabled: state.readOnly }),
          {
            type: 'submenu',
            id: 'special-characters',
            label: ui("Special characters"),
            icon: Sigma,
            disabled: state.readOnly,
            items: [{ type: 'custom', id: 'special-characters-grid', render: (close) => <SymbolGrid onPick={(symbol) => { close(); editor.insertSymbol(symbol) }} /> }],
          },
          separator,
          item('header', ui("Header"), () => host.insertHeaderFooter('header'), { icon: PanelTop, disabled: pages }),
          item('footer', ui("Footer"), () => host.insertHeaderFooter('footer'), { icon: PanelBottom, disabled: pages }),
          {
            type: 'submenu',
            id: 'page-numbers',
            label: ui("Page numbers"),
            disabled: pages,
            items: [
              ...positions(false),
              separator,
              { type: 'submenu', id: 'page-numbers-total', label: ui("Page X of Y"), items: positions(true) },
              ...(inHeaderFooter ? [item('page-number-here', ui("At the cursor"), () => host.insertPageNumber({}))] : []),
            ],
          },
          item('page-break', ui("Page break"), () => editor.insertPageBreak(), { shortcut: key('Enter'), disabled: state.readOnly }),
          {
            type: 'submenu',
            id: 'section-break',
            label: ui("Section break"),
            disabled: sections,
            items: [
              item('section-break-next', ui("Next page"), () => editor.insertSectionBreak('nextPage')),
              item('section-break-continuous', ui("Continuous"), () => editor.insertSectionBreak('continuous')),
              item('section-break-even', ui("Even page"), () => editor.insertSectionBreak('evenPage')),
              item('section-break-odd', ui("Odd page"), () => editor.insertSectionBreak('oddPage')),
            ],
          },
          separator,
          item('footnote', ui("Footnote"), () => editor.insertNote('footnote'), { shortcut: key('f', { alt: true }), disabled: !state.bodyCommandsEditable }),
          item('endnote', ui("Endnote"), () => editor.insertNote('endnote'), { shortcut: key('d', { alt: true }), disabled: !state.bodyCommandsEditable }),
          separator,
          item('table-of-contents', ui("Table of contents"), () => editor.insertTableOfContents(), { icon: TableOfContents, disabled: !state.bodyCommandsEditable }),
          item('update-table-of-contents', ui("Update table of contents"), () => editor.updateTableOfContents(), { disabled: !state.bodyCommandsEditable }),
        ]
      },
    },
    {
      id: 'format',
      label: ui("Format"),
      items: () => {
        const state = editor.state()
        const readOnly = state.readOnly
        const toggle = (id: string, label: string, checked: boolean, run: () => void, extra: Partial<MenuItemEntry> = {}) => item(id, label, run, { checked, disabled: readOnly, ...extra })
        const lineSpacing = (value: number, label = new Intl.NumberFormat(activeLocale()).format(value)) => item(`line-spacing-${value}`, label, () => editor.setLineSpacing(value), { radio: true, checked: state.lineSpacing === value, disabled: readOnly })
        const list = (kind: ListKind, label: string, shortcut?: ShortcutSpec) => item(`list-${kind}`, label, () => editor.toggleList(kind), { checked: state.list === kind, disabled: readOnly, ...(shortcut ? { shortcut } : {}) })
        const align = (value: 'left' | 'center' | 'right' | 'both', label: string, letter: string) => item(`align-${value}`, label, () => editor.setAlignment(value), { radio: true, checked: state.alignment === value, shortcut: key(letter), disabled: readOnly })
        return [
          {
            type: 'submenu',
            id: 'text',
            label: ui("Text"),
            icon: Bold,
            disabled: readOnly,
            items: [
              toggle('bold', ui("Bold"), state.bold, () => editor.toggleBold(), { icon: Bold, shortcut: key('b') }),
              toggle('italic', ui("Italic"), state.italic, () => editor.toggleItalic(), { icon: Italic, shortcut: key('i') }),
              toggle('underline', ui("Underline"), state.underline, () => editor.toggleUnderline(), { icon: Underline, shortcut: key('u') }),
              toggle('strikethrough', ui("Strikethrough"), state.strike && !state.doubleStrike, () => editor.toggleStrike(), { icon: Strikethrough, shortcut: apple ? key('x', { shift: true }) : { key: '5', alt: true, shift: true } }),
              toggle('double-strikethrough', ui("Double strikethrough"), state.doubleStrike, () => editor.toggle('dstrike')),
              toggle('superscript', ui("Superscript"), state.superscript, () => editor.setSuperscript(), { shortcut: key('.') }),
              toggle('subscript', ui("Subscript"), state.subscript, () => editor.setSubscript(), { shortcut: key(',') }),
              toggle('small-caps', ui("Small caps"), state.smallCaps, () => editor.toggle('smallCaps')),
              toggle('all-caps', ui("All caps"), state.caps, () => editor.toggle('caps')),
              {
                type: 'submenu',
                id: 'underline-style',
                label: ui("Underline style"),
                items: [
                  ...underlineStyles().map(([value, label]) => item(`underline-${value}`, label, () => editor.setUnderline(value), { radio: true, checked: state.underlineStyle === value })),
                  separator,
                  item('underline-none', ui("No underline"), () => editor.setUnderline(null), { radio: true, checked: state.underlineStyle === null }),
                ],
              },
              separator,
              item('font-size-up', ui("Increase font size"), () => editor.stepFontSize(1), { shortcut: key('.', { shift: true }) }),
              item('font-size-down', ui("Decrease font size"), () => editor.stepFontSize(-1), { shortcut: key(',', { shift: true }) }),
            ],
          },
          {
            type: 'submenu',
            id: 'change-case',
            label: ui("Change case"),
            icon: CaseSensitive,
            disabled: readOnly,
            items: [
              ...caseChanges().map(([change, label]) => item(`case-${change}`, label, () => editor.changeCase(change))),
              separator,
              item('case-cycle', ui("Cycle through cases"), () => editor.changeCase('cycle'), { shortcut: { key: 'F3', shift: true } }),
            ],
          },
          separator,
          paragraphStylesMenu(editor, state),
          {
            type: 'submenu',
            id: 'align-indent',
            label: ui("Align & indent"),
            disabled: readOnly,
            items: [
              align('left', ui("Align left"), 'l'),
              align('center', ui("Center"), 'e'),
              align('right', ui("Align right"), 'r'),
              align('both', ui("Justify"), 'j'),
              separator,
              item('indent-increase', ui("Increase indent"), () => editor.indent()),
              item('indent-decrease', ui("Decrease indent"), () => editor.outdent()),
              separator,
              item('indentation-options', ui("Indentation options…"), () => host.openParagraph('indents')),
            ],
          },
          {
            type: 'submenu',
            id: 'line-spacing',
            label: ui("Line & paragraph spacing"),
            disabled: readOnly,
            items: [
              lineSpacing(1, ui("Single")),
              lineSpacing(1.15),
              lineSpacing(1.5),
              lineSpacing(2, ui("Double")),
              separator,
              state.spaceBefore > 0
                ? item('space-before', ui("Remove space before paragraph"), () => editor.setParagraphSpacing(0, undefined))
                : item('space-before', ui("Add space before paragraph"), () => editor.setParagraphSpacing(12, undefined)),
              state.spaceAfter > 0
                ? item('space-after', ui("Remove space after paragraph"), () => editor.setParagraphSpacing(undefined, 0))
                : item('space-after', ui("Add space after paragraph"), () => editor.setParagraphSpacing(undefined, 8)),
              separator,
              item('custom-spacing', ui("Custom spacing…"), () => host.openParagraph('spacing')),
            ],
          },
          {
            type: 'submenu',
            id: 'lists',
            label: ui("Bullets & numbering"),
            disabled: readOnly,
            items: [
              list('bullet', ui("Bulleted list"), key('8', { shift: true })),
              list('decimal', ui("Numbered list"), key('7', { shift: true })),
              list('multilevel', ui("Multilevel list")),
              separator,
              item('list-level-up', ui("Increase list level"), () => editor.indent()),
              item('list-level-down', ui("Decrease list level"), () => editor.outdent()),
            ],
          },
          {
            type: 'submenu',
            id: 'paragraph-borders',
            label: ui("Paragraph borders"),
            disabled: readOnly,
            items: [
              item('border-bottom', ui("Bottom border"), () => editor.setParagraphBorder('bottom')),
              item('border-top', ui("Top border"), () => editor.setParagraphBorder('top')),
              item('border-box', ui("Box"), () => editor.setParagraphBorder('box')),
              item('border-none', ui("No border"), () => editor.setParagraphBorder('none')),
            ],
          },
          item('paragraph', ui("Paragraph…"), () => host.openParagraph('indents'), { disabled: readOnly }),
          separator,
          tableMenu(host, state),
          separator,
          item('clear-formatting', ui("Clear formatting"), () => editor.clearFormatting(), { icon: RemoveFormatting, shortcut: key('\\'), disabled: readOnly }),
        ]
      },
    },
    {
      id: 'tools',
      label: ui("Tools"),
      items: () => {
        const state = editor.state()
        const hasRevisions = editor.revisions().length > 0
        const resolveDisabled = state.readOnly || !hasRevisions
        return [
          item('word-count', ui("Word count"), host.openWordCount, { icon: WholeWord, shortcut: WORD_COUNT_SHORTCUT }),
          separator,
          {
            type: 'submenu',
            id: 'editing-mode',
            label: ui("Editing mode"),
            icon: PenLine,
            disabled: host.documentReadOnly,
            items: [
              item('mode-editing', ui("Editing"), () => editor.setMode('editing'), { radio: true, checked: state.mode === 'editing' }),
              item('mode-suggesting', ui("Suggesting"), () => editor.setMode('suggesting'), { radio: true, checked: state.mode === 'suggesting', shortcut: key('e', { shift: true }) }),
              item('mode-viewing', ui("Viewing"), () => editor.setMode('viewing'), { radio: true, checked: state.mode === 'viewing' }),
            ],
          },
          {
            type: 'submenu',
            id: 'tools-review',
            label: ui("Review suggested edits"),
            items: [
              item('review-next', ui("Next change"), () => editor.nextRevision(1), { disabled: !hasRevisions }),
              item('review-previous', ui("Previous change"), () => editor.nextRevision(-1), { disabled: !hasRevisions }),
              separator,
              item('review-accept', ui("Accept change"), () => editor.acceptRevisionAtCaret(), { disabled: state.readOnly || !state.inRevision }),
              item('review-reject', ui("Reject change"), () => editor.rejectRevisionAtCaret(), { disabled: state.readOnly || !state.inRevision }),
              separator,
              item('review-accept-all', ui("Accept all"), () => editor.acceptAll(), { disabled: resolveDisabled }),
              item('review-reject-all', ui("Reject all"), () => editor.rejectAll(), { disabled: resolveDisabled }),
            ],
          },
          separator,
          item('autoformat', ui("AutoFormat as you type"), () => host.setPreferences({ autoformat: !host.preferences.autoformat }), { checked: host.preferences.autoformat }),
          item('tools-keyboard-shortcuts', ui("Keyboard shortcuts"), host.showShortcuts, { icon: Keyboard, shortcut: SHORTCUTS_SHORTCUT }),
        ]
      },
    },
    helpMenu(host.showShortcuts),
  ]
}
