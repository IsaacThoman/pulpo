import { pushAll, maxOf } from '../../../collections.js'
import { baseKeymap } from '@tiptap/pm/commands'
import { dropCursor } from '@tiptap/pm/dropcursor'
import { gapCursor } from '@tiptap/pm/gapcursor'
import { keymap } from '@tiptap/pm/keymap'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Selection, type Transaction, type SelectionBookmark } from '@tiptap/pm/state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  mergeCells,
  splitCell,
  tableEditing,
} from '@tiptap/pm/tables'
import { Decoration, DecorationSet, EditorView, type EditorProps } from '@tiptap/pm/view'
import { redo, undo, yCursorPlugin, ySyncPlugin, ySyncPluginKey, yUndoPlugin, yUndoPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import { builtInHeadingStyles } from '../blank.js'
import { copyRelatedParts, needsRelatedParts, receiveCopiedParts } from '../copy-relationships.js'
import { fontStack, isThemeFontVar, latinFont } from '../css.js'
import { DOCX_MAX_TABLE_DEPTH } from '../format.js'
import { drawingInfo, newInlinePicture } from '../drawing.js'
import { jmlAttr, jmlChild, jmlNumber, jmlOn, packJml, unpackJml, type JmlElement } from '../jsonml.js'
import { BODY_FRAGMENT, fragmentToNode, parseJson, readDocxMap, storyFragmentName, writeFragment, type StoryMeta } from '../model.js'
import { effectiveNumPr } from '../numbering.js'
import { noteInventory, resolveNoteLabels } from '../notes.js'
import { docxSchema, inlineMarks, packMarks, textAreaWidth } from '../schema.js'
import { inlineText } from '../text.js'
import { AssetUrls } from './assets.js'
import { clipboardParser, clipboardSerializer, importCopiedNumbering, limitPastedTables, recallCopy, rememberCopy, sanitizePastedHtml, withoutForeignParts, withoutStoryReferences } from './clipboard.js'
import {
  applyPageSetup,
  changeCase,
  changeIndent,
  clearCharacterFormatting,
  clearFormatting,
  copyFormat,
  documentOutline,
  editSections,
  effectiveParagraphProperties,
  effectiveRunProperties,
  findMatches,
  validFindMatches,
  freshId,
  headingStyleId,
  hyperlinkMarks,
  insertHorizontalLine,
  insertInline,
  insertLineBreak,
  insertPageBreak,
  insertParagraphBreak,
  insertSectionBreak,
  insertSymbol,
  insertTable,
  linkAround,
  listDefinition,
  listKind,
  paragraphStyleOptions,
  pasteFormat,
  readPageSetup,
  readParagraphFormat,
  replaceMatches,
  sectionHolders,
  sectionIndexAt,
  sectionOf,
  selectedParagraphs,
  selectionWordCount,
  selectTablePart,
  setAlignment,
  setCellBorders,
  setCellShading,
  setCellVerticalAlign,
  setFontFamily,
  setFontSize,
  setHeaderRows,
  setHighlight,
  setLineSpacing,
  setLink,
  setParagraphBorder,
  setParagraphFormat,
  setParagraphSpacing,
  setParagraphStyle,
  setTableAlignment,
  setTextColor,
  setUnderline,
  setVerticalAlign,
  splitParagraphAttrs,
  startNumberedList,
  tableFormat,
  toggleList,
  toggleRunProperty,
  withTitlePage,
  wordAt,
  wordCount,
  type Alignment,
  type BorderPreset,
  type CaseChange,
  type CellVerticalAlign,
  type Command,
  type CopiedFormat,
  type EditResult,
  type FindOptions,
  type FindMatch,
  type HeaderFooterKind,
  type HeaderFooterType,
  type LineSpacing,
  type LinkRange,
  type ListKind,
  type MapEdit,
  type OutlineEntry,
  type PageSetupChange,
  type PageSetupInfo,
  type ParagraphBorder,
  type ParagraphFormat,
  type ParagraphFormatChange,
  type ToggleProperty,
  type WordCount,
} from './commands.js'
import { autoformatPlugin, autoformatSettings, carryAutoformat, undoAutoformat, type AutoformatOptions, type ListMarker } from './autoformat.js'
import { createHeaderFooter, headerFooterInfo, headerFooterOf, headerFooterParagraph, removeHeaderFooter, storyByRelationship, type HeaderFooterInfo } from './headers.js'
import { DocxViewContext } from './context.js'
import { computeDecorations } from './decorations.js'
import { DEFAULT_DOCX_LABELS, type DocxLabels } from './labels.js'
import { PAGE_GAP, PX_PER_PT, sectionContentWidth, type LayoutResult } from './layout.js'
import { normalizeAtomMarks, selectionMarks } from './marks.js'
import { DrawingView, MathView } from './nodeviews.js'
import { documentSections, paginate, storyReference, type RepeatedHeader, type Section } from './paginate.js'
import { preservePastedMarks, sectionEndsPlugin } from './sections.js'
import { layoutStaticTabs, renderStory } from './static.js'
import { layoutTabs, paragraphTabs } from './tabs.js'
import {
  addComment,
  addNote,
  commentThreads,
  deleteComment,
  editCommentText,
  replyToComment,
  setCommentResolved,
  type CommentAuthor,
  type CommentThread,
  type StoryResult,
} from './stories.js'
import { DOCX_BASE_CSS, documentStylesheet } from './stylesheet.js'
import { listRevisions, resolveAllRevisions, resolveRevisions, revisionDate, trackTransaction, type Revision } from './track-changes.js'

export type DocxLayout = 'print' | 'web'
export type DocxMode = 'editing' | 'suggesting' | 'viewing'

/**
 * The type of a picture `insertImage` accepts, by its signature: PNG, JPEG, GIF, or BMP, which Word
 * shows as they are. Anything else (SVG, which Word needs a PNG beside, TIFF, HEIC, PDF) is refused.
 */
export function insertablePicture(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x42, 0x4d) && bytes.length > 26) return 'image/bmp'
  return null
}

/** Tables around the selection: pasted tables nest inside them. */
function tableDepth(view: EditorView): number {
  const { $from } = view.state.selection
  let depth = 0
  for (let level = $from.depth; level > 0; level--) if ($from.node(level).type.name === 'table') depth++
  return depth
}

/** The pictures in a slice, by asset hash. */
function slicePictures(slice: Slice): Set<string> {
  const found = new Set<string>()
  slice.content.descendants((node) => {
    if (node.type.name === 'drawing' && typeof node.attrs.src === 'string') found.add(node.attrs.src)
    return true
  })
  return found
}

/** The story a note reference or comment marker points at. */
function referencedStory(node: ProseMirrorNode): string | null {
  if (node.type.name === 'noteRef') return `${node.attrs.kind}:${node.attrs.id}`
  if (node.type.name === 'commentMark') return `comment:${node.attrs.id}`
  return null
}

/** Every picture a document's body and stories show, by asset hash. */
function documentPictures(doc: Y.Doc): Set<string> {
  const found = new Set<string>()
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === 'drawing') {
        const src = child.getAttribute('src')
        if (typeof src === 'string') found.add(src)
      }
      visit(child)
    }
  }
  visit(doc.getXmlFragment(BODY_FRAGMENT))
  for (const id of doc.getMap('stories').keys()) visit(doc.getXmlFragment(storyFragmentName(id)))
  return found
}

const REVISION_MARKS = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'])

/** Whether the selection touches a tracked change, looking only around it (state is read every frame). */
function selectionInRevision(state: EditorState): boolean {
  const { from, to, $from } = state.selection
  let found = false
  const changed = (value: unknown, ...names: string[]) => names.some((name) => jmlChild(jml(value), name) !== undefined)
  const visit = (node: ProseMirrorNode | null | undefined): boolean => {
    if (!node || found) return false
    if (node.type.name === 'paragraph') found = Boolean(node.attrs.pPrChange) || changed(node.attrs.markRPr, 'w:ins', 'w:del')
    else if (node.type.name === 'tableRow') found = changed(node.attrs.trPr, 'w:ins', 'w:del')
    else if (node.type.name === 'tableCell') found = changed(node.attrs.tcPr, 'w:cellIns', 'w:cellDel', 'w:cellMerge')
    else if (node.isInline) found = inlineMarks(node).some((mark) => REVISION_MARKS.has(mark.type.name))
    return !found
  }
  for (let depth = $from.depth; depth > 0 && !found; depth--) visit($from.node(depth))
  if (from === to) {
    visit($from.nodeBefore)
    visit($from.nodeAfter)
  } else if (!found) state.doc.nodesBetween(from, to, (node) => visit(node))
  return found
}

/** Reads a selection the browser just made (keys, pointer) before ProseMirror's own selectionchange handling does. */
function flushSelection(view: EditorView): void {
  ;(view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.()
}

/** Picture files on a clipboard or a drop, in order. */
function imageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data?.files?.length) return []
  return [...data.files].filter((file) => IMAGE_FILE.test(file.type))
}

/** Clipboard HTML that is only the wrapper browsers put around a copied picture. */
function onlyPictures(html: string): boolean {
  if (typeof DOMParser === 'undefined') return false
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return Boolean(body.querySelector('img')) && !body.textContent?.trim() && !body.querySelector('table')
}

/** Content that came in from outside: pasted, or dropped from another app. */
function pasted(tr: Transaction): boolean {
  const event = tr.getMeta('uiEvent')
  return event === 'paste' || event === 'drop'
}

export interface DocxEditorOptions {
  container: HTMLElement
  doc: Y.Doc
  awareness: Awareness
  readOnly?: boolean
  assets: LiveAssetStore
  user: { name: string; color: string }
  labels?: Partial<DocxLabels>
  layout?: DocxLayout
  zoom?: number
  mode?: DocxMode
  /** AutoFormat As You Type (lists, smart quotes, dashes, links); on unless turned off. */
  autoformat?: boolean | AutoformatOptions
}

/** What is under a point in the editor, for context menus (`contextAt`). */
export interface DocxContextInfo {
  /** The position under the point, in the story it is in. */
  pos: number
  /** The open header, footer, or note editor the point is in; null for the body. */
  storyId: string | null
  /** Whether the point is inside the current (non-empty) selection. */
  inSelection: boolean
  editable: boolean
  /** In a table cell. */
  table: boolean
  /** A picture under the point, by position, with its description. */
  picture: { pos: number; description: string } | null
  link: Omit<LinkRange, 'mark'> | null
  /** Comment threads whose range the point is in. */
  comments: string[]
  /** Tracked changes the point is in. */
  revisions: Revision[]
}

/** A picture `insertImage` (or a paste or drop) could not insert, for hosts to tell the user. */
export interface DocxRefusedImage {
  name: string
  type: string
  reason: 'unsupported' | 'readOnly'
}

export interface DocxFormattingState {
  styleId: string | null
  fontFamily: string | null
  fontSize: number | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  superscript: boolean
  subscript: boolean
  color: string | null
  highlight: string | null
  alignment: Alignment
  lineSpacing: number | null
  list: ListKind | null
  inTable: boolean
  tableColumnsEditable: boolean
  bodyCommandsEditable: boolean
  canComment: boolean
  /** Whether commands without Word revision support (including section breaks) are available. */
  untrackedFormattingEditable: boolean
  link: string | null
  canUndo: boolean
  canRedo: boolean
  empty: boolean
  mode: DocxMode
  readOnly: boolean
  layout: DocxLayout
  zoom: number
  pages: number
  formatPainter: boolean
  /** The format painter stays on after applying (double-clicked in Word) until Escape. */
  formatPainterSticky: boolean
  doubleStrike: boolean
  caps: boolean
  smallCaps: boolean
  hidden: boolean
  /** Word's underline style (`single`, `double`, `dotted`, `wave`, …); null without underline. */
  underlineStyle: string | null
  /** Space before and after the paragraph, in points. */
  spaceBefore: number
  spaceAfter: number
  /** The selection touches a tracked change. */
  inRevision: boolean
  /** The open header, footer, or note editor. */
  editingStory: string | null
  cellVerticalAlign: CellVerticalAlign | null
  /** The row at the selection repeats as a header row on each page. */
  headerRow: boolean
}

export type DocxRequest = 'link' | 'find' | 'replace' | 'comment' | 'image'

type Listener<T> = (value: T) => void

const decorationsKey = new PluginKey<{ set: DecorationSet; version: number }>('docx-decorations')
const paginationKey = new PluginKey<DecorationSet>('docx-pagination')
interface FindState { query: string; options: FindOptions; matches: FindMatch[]; current: number }
const findKey = new PluginKey<FindState>('docx-find')
const pendingPasteKey = new PluginKey<Map<object, SelectionBookmark>>('docx-pending-paste')
/** Y transaction meta: an editor step that changes only section properties, still on the body's undo stack. */
const SECTION_UNDO = 'docx-section-undo'
/** Files a paste or drop treats as pictures; `insertImage` then takes or refuses each by its bytes. */
const IMAGE_FILE = /^image\//

let scopeCounter = 0

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * The Word editor core: a ProseMirror view of a document's body bound to its Y.Doc, with page
 * layout, headers and footers, notes, comments, tracked changes, and a command API for
 * toolbars. Framework-agnostic: hosts (the web app, the mobile web view) render their own UI
 * around it from `state()`, `comments()`, and the events.
 */
export class DocxEditor {
  readonly view: EditorView
  readonly context: DocxViewContext
  readonly labels: DocxLabels
  private readonly root: HTMLElement
  private readonly canvas: HTMLElement
  private readonly pagesLayer: HTMLElement
  private readonly bandsLayer: HTMLElement
  private readonly flowHost: HTMLElement
  private readonly notesHost: HTMLElement
  private readonly styleElement: HTMLStyleElement
  private readonly scope: string
  private readonly urls: AssetUrls
  private readonly listeners = { update: new Set<Listener<void>>(), layout: new Set<Listener<LayoutResult | null>>(), request: new Set<Listener<DocxRequest>>(), activeComment: new Set<Listener<string | null>>(), imageRefused: new Set<Listener<DocxRefusedImage>>() }
  private autoformatOptions: Required<AutoformatOptions>
  /** Format painter: what it copied, from where, and whether it stays on. */
  private painter: { format: CopiedFormat; sticky: boolean; storyId: string | null; from: number; to: number } | null = null
  private pointerInText = false
  /** The selection when Shift went down, so releasing it paints only a selection it changed. */
  private shiftSelection: Selection | null = null
  /** Escape was pressed: the next Tab moves focus out of the document instead of indenting. */
  private tabLeaves = false
  /** Where the flow column starts on the canvas, from the last print layout. */
  private flowTop = 0
  private layoutMode: DocxLayout
  private zoomLevel: number
  private modeValue: DocxMode
  private readOnlyValue: boolean
  /** Asset hashes known to be this document's, so pasting them checks nothing. */
  private readonly knownAssets = new Set<string>()
  /** Stories the last paste's references point at. */
  private readonly pastedReferences = new Set<string>()
  private readonly pastedSlices = new WeakMap<EditorView, { slice: Slice; maps?: MapEdit[] }>()
  private lastLayout: LayoutResult | null = null
  /** Measured units of the last layout, for diagnostics and tests. */
  private lastUnits: unknown[] = []
  private notePageDoc: ProseMirrorNode | undefined
  private notePageIndexes = new Map<string, number>()
  private measuringNotePages = false
  private lastSections: Section[] = []
  private layoutFrame = 0
  private layoutTimer: ReturnType<typeof setTimeout> | undefined
  private lastLayoutAt = 0
  private activeCommentId: string | null = null
  private storyEditor: { view: EditorView; element: HTMLElement; storyId: string; over?: HTMLElement; occurrence: number; stop: () => void } | null = null
  private readonly unsubscribe: (() => void)[] = []
  private destroyed = false
  private noteHeights = new Map<string, number>()
  private printing = false
  private endnotesHeight = 0

  constructor(private readonly options: DocxEditorOptions) {
    this.labels = { ...DEFAULT_DOCX_LABELS, ...options.labels }
    this.autoformatOptions = autoformatSettings(options.autoformat)
    this.layoutMode = options.layout ?? 'print'
    this.zoomLevel = options.zoom ?? 1
    this.readOnlyValue = options.readOnly ?? false
    this.context = new DocxViewContext(options.doc)
    this.modeValue = options.mode ?? (this.readOnlyValue ? 'viewing' : this.context.trackRevisions ? 'suggesting' : 'editing')
    this.urls = new AssetUrls(options.assets)
    this.scope = `docx-scope-${++scopeCounter}`
    options.awareness.setLocalStateField('user', { name: options.user.name, color: options.user.color })

    this.root = document.createElement('div')
    this.root.className = `docx-editor ${this.scope}`
    this.styleElement = document.createElement('style')
    this.root.appendChild(this.styleElement)
    this.canvas = document.createElement('div')
    this.canvas.className = 'docx-canvas'
    this.pagesLayer = document.createElement('div')
    this.pagesLayer.className = 'docx-pages'
    this.bandsLayer = document.createElement('div')
    this.bandsLayer.className = 'docx-bands'
    this.flowHost = document.createElement('div')
    this.flowHost.className = 'docx-flow-host'
    this.notesHost = document.createElement('div')
    this.notesHost.className = 'docx-endnotes docx-flow'
    this.canvas.append(this.pagesLayer, this.flowHost, this.bandsLayer)
    this.root.appendChild(this.canvas)
    options.container.appendChild(this.root)
    this.renderStylesheet()
    this.root.addEventListener('click', (event) => this.followLink(event))
    // The format painter applies when a selection made with the mouse or Shift and the arrows is done.
    // Only selections started in the text being edited: not clicks on page margins or static headers.
    this.root.addEventListener('mousedown', (event) => {
      this.pointerInText = this.activeView.dom.contains(event.target as Node)
      this.tabLeaves = false
    })
    this.root.addEventListener('mouseup', (event) => {
      const started = this.pointerInText
      this.pointerInText = false
      if (started && event.button === 0 && this.painter) this.paintSoon()
    })
    // Only a selection Shift changed: pressing and releasing it alone keeps the painter armed.
    this.root.addEventListener('keydown', (event) => {
      // Escape lets only the next Tab (or Shift+Tab) out; any other key keeps Tab in the page.
      if (event.key !== 'Escape' && event.key !== 'Shift') this.tabLeaves = false
      if (event.key !== 'Shift' || event.repeat || !this.painter) return
      flushSelection(this.activeView)
      this.shiftSelection = this.activeView.state.selection
    })
    this.root.addEventListener('keyup', (event) => {
      if (event.key !== 'Shift' || !this.painter) return
      const before = this.shiftSelection
      this.shiftSelection = null
      this.paintSoon({ unchanged: before })
    })

    const dispatch = (view: EditorView, tr: Transaction) => this.dispatch(view, tr)
    const clipboard = this.clipboardProps('body')
    this.view = new EditorView({ mount: this.flowHost }, {
      state: EditorState.create({ schema: docxSchema(), plugins: this.plugins(options.doc.getXmlFragment(BODY_FRAGMENT), 'cursor', undefined) }),
      editable: () => !this.readOnlyValue && this.modeValue !== 'viewing',
      nodeViews: this.nodeViews(),
      ...clipboard,
      attributes: { class: 'docx-flow', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' },
      // y-tiptap dispatches while the view is constructed, before `this.view` is set.
      dispatchTransaction: function (this: EditorView, tr: Transaction) { dispatch(this, tr) },
      handleDOMEvents: {
        ...clipboard.handleDOMEvents,
        click: (_view, event) => this.handleClick(event),
      },
    })
    this.unsubscribe.push(this.context.onChange(() => {
      this.renderStylesheet()
      if (this.layoutMode !== 'print') this.applyWebWidth()
      // Map observers can run before body observers; refreshing must not write the old body back.
      for (const view of [this.view, this.storyEditor?.view]) if (view) this.refreshDecorations(view)
      this.scheduleLayout()
      this.emit('update')
    }))
    const storiesMap = options.doc.getMap('stories')
    const storyObserver = () => this.scheduleLayout()
    // y-tiptap opens a Y transaction on every dispatch, even one that changes nothing; only real
    // changes from elsewhere (collaborators editing headers, notes) need new pages.
    const deepObserver = (transaction: Y.Transaction) => {
      if (transaction.changed.size && transaction.origin !== ySyncPluginKey) this.scheduleLayout()
    }
    storiesMap.observe(storyObserver)
    // Edits to headers, footers, and notes by anyone redraw the pages.
    options.doc.on('afterTransaction', deepObserver)
    this.unsubscribe.push(() => storiesMap.unobserve(storyObserver), () => options.doc.off('afterTransaction', deepObserver))
    if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(() => this.scheduleLayout(true))
    this.applyLayoutMode()
    this.scheduleLayout(true)
  }

  private get activeView(): EditorView {
    return this.storyEditor?.view ?? this.view
  }

  private refreshDecorations(view: EditorView): void {
    const { binding } = ySyncPluginKey.getState(view.state)
    binding.mux(() => view.dispatch(view.state.tr.setMeta(decorationsKey, 'refresh')))
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  private plugins(fragment: Y.XmlFragment, cursorField: string, storyId: string | undefined): Plugin[] {
    return [
      ySyncPlugin(fragment),
      yCursorPlugin(this.options.awareness, {}, cursorField),
      yUndoPlugin(),
      new Plugin({
        state: {
          init: (_config, state) => {
            const manager = yUndoPluginKey.getState(state).undoManager as Y.UndoManager
            const scope = manager.scope[0]!
            const capture = manager.captureTransaction
            // Numbering is shared, but its undo belongs to the fragment edited with it. Page
            // setup changes only the final section, so the editor marks those steps itself.
            manager.captureTransaction = (tr: Y.Transaction) => capture(tr) && scope instanceof Y.AbstractType && (tr.changedParentTypes.has(scope) || tr.meta.get(SECTION_UNDO) === true || tr.origin === manager)
            manager.addToScope(this.options.doc.getMap('numbering'))
            // The final section lives outside the body but must share its undo step.
            if (fragment === this.options.doc.getXmlFragment(BODY_FRAGMENT)) {
              yUndoPluginKey.getState(state).undoManager.addToScope(this.options.doc.getMap('docx'))
            }
            return null
          },
          apply: () => null,
        },
      }),
      new Plugin({
        key: pendingPasteKey,
        state: {
          init: () => new Map<object, SelectionBookmark>(),
          apply: (tr, bookmarks: Map<object, SelectionBookmark>) => {
            const next = new Map([...bookmarks].map(([id, bookmark]) => [id, bookmark.map(tr.mapping)]))
            const meta = tr.getMeta(pendingPasteKey) as { id: object; bookmark?: SelectionBookmark } | undefined
            if (meta?.bookmark) next.set(meta.id, meta.bookmark)
            else if (meta) next.delete(meta.id)
            return next
          },
        },
      }),
      sectionEndsPlugin(),
      autoformatPlugin({
        options: () => this.autoformatOptions,
        suggesting: () => this.modeValue === 'suggesting',
        list: (state, marker, from, to) => this.autoformatList(state, marker, from, to),
        linkMarks: (state, href) => hyperlinkMarks(state.schema, href),
        apply: (view, tr, maps) => this.applyAutoformat(view, tr, maps),
        undo: () => !this.readOnly && undo(this.activeView.state),
      }),
      keymap(this.shortcuts()),
      keymap(baseKeymap),
      tableEditing(),
      gapCursor(),
      dropCursor({ color: '#1a73e8', width: 2 }),
      new Plugin({
        key: decorationsKey,
        state: {
          init: (_config, state) => ({ set: this.decorate(state.doc, storyId), version: this.context.version }),
          apply: (tr, value, _old, state) => {
            if (!tr.docChanged && !tr.getMeta(decorationsKey) && value.version === this.context.version) return value
            return { set: this.decorate(state.doc, storyId), version: this.context.version }
          },
        },
        props: { decorations: (state) => decorationsKey.getState(state)?.set },
      }),
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta = tr.getMeta(paginationKey) as Decoration[] | null | undefined
            if (meta !== undefined) return meta ? DecorationSet.create(tr.doc, meta) : DecorationSet.empty
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: { decorations: (state) => paginationKey.getState(state) },
      }),
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: (): FindState => ({ query: '', options: {}, matches: [], current: -1 }),
          apply: (tr, value) => {
            const meta = tr.getMeta(findKey) as FindState | undefined
            if (meta) return meta
            if (!tr.docChanged || !value.query) return value
            const mapped = value.matches.map((match) => ({ from: tr.mapping.map(match.from, 1), to: tr.mapping.map(match.to, -1) }))
            const active = mapped[value.current]
            // Remote edits can introduce matches anywhere, including when the old result set
            // was empty. Local edits retain only mapped ranges that still satisfy the query.
            const matches = tr.getMeta(ySyncPluginKey) !== undefined
              ? findMatches(tr.doc, value.query, value.options)
              : validFindMatches(tr.doc, mapped, value.query, value.options)
            let current = active ? matches.findIndex((match) => match.from === active.from && match.to === active.to) : -1
            if (current < 0 && matches.length) current = Math.max(0, matches.findIndex((match) => match.from >= (active?.from ?? tr.selection.from)))
            return { ...value, matches, current }
          },
        },
        props: {
          decorations: (state) => {
            const find = findKey.getState(state)
            if (!find?.matches.length) return null
            return DecorationSet.create(state.doc, find.matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === find.current ? 'docx-find-match docx-find-current' : 'docx-find-match' })))
          },
        },
      }),
      new Plugin({
        appendTransaction: (transactions, _old, state) => transactions.some((tr) => tr.docChanged) ? normalizeAtomMarks(state) : null,
      }),
    ]
  }

  private nodeViews() {
    return {
      drawing: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => new DrawingView(node, view, getPos, { urls: this.urls, labels: this.labels, readOnly: () => this.readOnly, onUpdate: (listener) => this.on('update', listener) }),
      math: (node: ProseMirrorNode) => new MathView(node, this.labels),
    }
  }

  private decorate(doc: ProseMirrorNode, storyId: string | undefined): DecorationSet {
    const body = storyId && this.view ? this.view.state.doc : doc
    const numbers = this.noteLabels(body)
    const set = computeDecorations(doc, {
      context: this.context,
      noteNumbers: numbers,
      noteNumber: storyId ? numbers.get(storyId) : undefined,
      activeComment: this.activeCommentId,
    })
    if (storyId !== undefined || this.layoutMode !== 'print') return set
    // Constrain the actual DOM before pagination measures it. Wrappers establish their own
    // containing width; only top-level paragraphs need an inset in the shared flow column.
    const { sections, sectionOfBlock } = documentSections(doc, this.context.finalSectPr)
    const widths = sections.map((section) => sectionContentWidth(section.setup))
    const widest = maxOf(widths)
    const extra: Decoration[] = []
    let index = 0
    doc.forEach((node, offset) => {
      const width = widths[sectionOfBlock[index++] ?? 0] ?? widest
      const inset = widest - width
      let style = node.type.name === 'paragraph'
        ? `--docx-sec-inset:${inset}px`
        : `max-width:${width}px;box-sizing:border-box;--docx-sec-inset:0px`
      if (node.type.name === 'table') {
        const props = jml(node.attrs.tblPr)
        const preferred = jmlChild(props, 'w:tblW')
        if (jmlAttr(preferred, 'w:type') === 'pct') {
          const raw = jmlAttr(preferred, 'w:w') ?? ''
          const fraction = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : (jmlNumber(preferred, 'w:w') ?? 5000) / 5000
          if (Number.isFinite(fraction)) style += `;width:${Math.max(0, width * fraction)}px`
        }
        // Auto margins align in the widest flow column; move the table into its section.
        const align = jmlAttr(jmlChild(props, 'w:jc'), 'w:val')
        if (align === 'center') style += `;left:${-inset / 2}px`
        else if (align === 'right' || align === 'end') style += `;left:${-inset}px`
      }
      extra.push(Decoration.node(offset, offset + node.nodeSize, { style }))
    })
    return set.add(doc, extra)
  }

  private shortcuts(): Record<string, (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean> {
    const run = (command: Command) => () => this.run(command)
    const bind: Record<string, () => boolean> = {
      'Mod-z': () => this.undo(),
      'Mod-y': () => this.redo(),
      'Shift-Mod-z': () => this.redo(),
      'Mod-b': run(toggleRunProperty('b')),
      'Mod-i': run(toggleRunProperty('i')),
      'Mod-u': () => this.toggleUnderline(),
      'Alt-Shift-5': run(toggleRunProperty('strike')),
      'Mod-Shift-x': run(toggleRunProperty('strike')),
      'Mod-e': () => this.alignmentKey('center'),
      'Mod-l': () => this.alignmentKey('left'),
      'Mod-r': () => this.alignmentKey('right'),
      'Mod-j': () => this.alignmentKey('both'),
      'Mod-Shift-7': () => this.toggleList('decimal'),
      'Mod-Shift-8': () => this.toggleList('bullet'),
      'Mod-Shift-l': () => this.toggleList('bullet'),
      'Mod-]': () => this.stepFontSize(1),
      'Mod-[': () => this.stepFontSize(-1),
      'Mod-Shift-.': () => this.stepFontSize(1),
      'Mod-Shift-,': () => this.stepFontSize(-1),
      'Mod-Enter': run(insertPageBreak),
      'Shift-Enter': run(insertLineBreak),
      'Mod-Alt-0': () => this.setStyle(this.context.styles.defaultStyle('paragraph')?.id ?? null),
      // Word's Normal key; browsers keep it for a new private window, the desktop app passes it on.
      'Mod-Shift-n': () => this.setStyle(this.context.styles.defaultStyle('paragraph')?.id ?? null),
      'Mod-=': run(setVerticalAlign('subscript')),
      'Mod-Shift-=': run(setVerticalAlign('superscript')),
      'Mod-.': run(setVerticalAlign('superscript')),
      'Mod-,': run(setVerticalAlign('subscript')),
      'Mod-\\': run(clearFormatting),
      // Word's Ctrl+Space keeps the paragraph's style; Clear formatting (Mod-\) resets it too.
      'Mod-Space': run(clearCharacterFormatting),
      'Shift-F3': run(changeCase('cycle')),
      // Word's Track Changes key: between Editing and Suggesting.
      'Mod-Shift-e': () => {
        if (this.readOnly) return false
        this.setMode(this.modeValue === 'suggesting' ? 'editing' : 'suggesting')
        return true
      },
      // The app's search shares Mod-K: keep the key in an editable document even while links are unavailable.
      'Mod-k': () => this.request('link') || (!this.readOnly && this.listeners.request.size > 0),
      'Mod-f': () => this.request('find'),
      'Mod-h': () => this.request('replace'),
      'Mod-Alt-m': () => this.request('comment'),
      'Mod-Alt-f': () => this.insertNote('footnote') !== null,
      'Mod-Alt-d': () => this.insertNote('endnote') !== null,
      Tab: () => this.tabKey(1),
      'Shift-Tab': () => this.tabKey(-1),
      Enter: () => this.enter(),
      Backspace: () => this.backspaceInList(),
      Escape: () => {
        if (this.cancelFormatPainter() || this.closeStoryEditor()) return true
        // The keyboard way out of a page that keeps Tab: Escape, then Tab or Shift+Tab moves focus on.
        this.tabLeaves = true
        return false
      },
    }
    for (let level = 1; level <= 6; level++) bind[`Mod-Alt-${level}`] = () => this.applyHeading(level)
    if (isMac) bind['Ctrl-Space'] = run(clearCharacterFormatting)
    if (!isMac) bind['Ctrl-Shift-z'] = () => this.redo()
    return bind as Record<string, () => boolean>
  }

  // ── Transactions ─────────────────────────────────────────────────────────

  private dispatch(view: EditorView, tr: Transaction): void {
    if (this.destroyed || view.isDestroyed) return
    this.preparePaste(view, tr)
    const before = view.state
    const transaction = this.applyTransaction(view, tr)
    // Suggesting mode tracks the paste in a new transaction; the original says what it was.
    if (pasted(tr)) {
      this.convertPastedLists(view)
      this.dropForeignReferences(view)
    }
    if (transaction.docChanged || before.selection !== view.state.selection || transaction.storedMarksSet || transaction.getMeta(findKey) !== undefined) this.emit('update')
    if (transaction.docChanged && !transaction.getMeta(paginationKey) && this.view) {
      this.scheduleLayout()
      if (view === this.view && this.storyEditor) this.refreshDecorations(this.storyEditor.view)
    }
  }

  /** Story and body pastes must import list definitions in the same undo step as their content. */
  private applyTransaction(view: EditorView, tr: Transaction): Transaction {
    let transaction = tr
    const fromSync = tr.getMeta(ySyncPluginKey) !== undefined
    if (this.modeValue === 'suggesting' && tr.docChanged && !fromSync && !tr.getMeta('docx-tracked') && !tr.getMeta('docx-untracked')) {
      transaction = trackTransaction(view.state, tr, this.reviewer()) ?? tr
      if (transaction !== tr) carryAutoformat(tr, transaction)
    }
    const maps = tr.getMeta('docx-paste-maps') as MapEdit[] | undefined
    if (maps?.length) {
      this.separateUndo(view)
      this.options.doc.transact(() => {
        this.applyMapEdits(maps)
        view.updateState(view.state.apply(transaction))
      }, ySyncPluginKey)
      this.separateUndo(view)
    } else view.updateState(view.state.apply(transaction))
    return transaction
  }

  /**
   * Copy and paste for the body and the story editors: Pulpo's own copies come back exactly from
   * memory, everything else as sanitized HTML, with tables kept to a size editors can hold.
   */
  private clipboardProps(storyId: string): Partial<EditorProps> {
    const schema = docxSchema()
    // Where copies come from: content keeps its part's relationships only within the same story.
    const origin = `${this.options.doc.guid}:${storyId}`
    let recalled: Slice | undefined
    let recalledMaps: MapEdit[] | undefined
    return {
      handleDOMEvents: {
        paste: (view, event) => {
          recalled = undefined
          recalledMaps = undefined
          this.pastedSlices.delete(view)
          // DOM handlers run before ProseMirror parses HTML; Shift must keep its plain-text path.
          const plain = (view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey
          if (!view.editable || plain) return false
          const html = event.clipboardData?.getData('text/html')
          const copy = recallCopy(html, view.state.schema)
          // Screenshots and copied pictures come as files, sometimes with an <img> wrapper beside
          // them. Pulpo's own copies keep their pictures exactly, even when a browser adds files.
          const pictures = copy ? [] : imageFiles(event.clipboardData)
          if (pictures.length && (!html || onlyPictures(html))) {
            event.preventDefault()
            void this.insertImages(pictures, view)
            return true
          }
          if (!copy) return false
          const foreign = copy.origin.split(':', 1)[0] !== this.options.doc.guid
          const prepare = (slice: Slice) => {
            slice = limitPastedTables(slice, Math.max(0, DOCX_MAX_TABLE_DEPTH - tableDepth(view)))
            if (copy.origin !== origin) slice = withoutForeignParts(slice)
            if (foreign) {
              const imported = importCopiedNumbering(withoutStoryReferences(slice), copy.numbering, this.options.doc.getMap('numbering').keys())
              slice = imported.slice
              recalledMaps = imported.maps
            }
            this.notePastedReferences(slice)
            this.checkPastedPictures(slice)
            return slice
          }
          if (copy.origin !== origin && copy.resources) {
            event.preventDefault()
            const id = {}
            view.dispatch(view.state.tr.setMeta(pendingPasteKey, { id, bookmark: view.state.selection.getBookmark() }))
            void (async () => {
              const resources = await copy.resources
              if (this.destroyed || view.isDestroyed || !view.editable) return
              const source = foreign ? resources?.numberedSlice ?? resources?.slice ?? copy.numberedSlice ?? copy.slice : resources?.slice ?? copy.slice
              if (resources) await receiveCopiedParts({ slice: source, assets: resources.assets }, this.options.assets)
              if (this.destroyed || view.isDestroyed || !view.editable) return
              const bookmark = pendingPasteKey.getState(view.state)?.get(id)
              if (!bookmark) return
              const slice = prepare(source)
              this.pastedSlices.set(view, { slice, maps: recalledMaps })
              const tr = view.state.tr.setSelection(bookmark.resolve(view.state.doc)).replaceSelection(slice).setMeta('uiEvent', 'paste').setMeta(pendingPasteKey, { id })
              view.dispatch(tr)
            })().catch(() => {
              // Failed asset transfers cannot leave unresolved references in the shared document.
            }).finally(() => {
              if (!this.destroyed && !view.isDestroyed && pendingPasteKey.getState(view.state)?.has(id)) view.dispatch(view.state.tr.setMeta(pendingPasteKey, { id }))
            })
            return true
          }
          recalled = prepare(foreign ? copy.numberedSlice ?? copy.slice : copy.slice)
          return false
        },
        drop: (view, event) => {
          // Content dragged inside the editors moves as ProseMirror moves it, even with picture files beside it.
          const dragging = [this.view, this.storyEditor?.view].some((editor) => editor?.dragging)
          if (dragging || recallCopy(event.dataTransfer?.getData('text/html'), view.state.schema)) return false
          const pictures = imageFiles(event.dataTransfer)
          if (!pictures.length) return false
          event.preventDefault()
          if (!view.editable) return true
          // Pictures land where they are dropped, as in Word.
          let found: { pos: number } | null = null
          try {
            found = view.posAtCoords({ left: event.clientX, top: event.clientY })
          } catch {
            // Without layout (or off the text) the picture goes to the cursor.
          }
          if (found) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(found.pos))))
          void this.insertImages(pictures, view)
          return true
        },
      },
      clipboardSerializer: clipboardSerializer(schema),
      clipboardParser: clipboardParser(schema),
      transformPastedHTML: sanitizePastedHtml,
      transformCopied: (slice) => {
        // A copy or cut of this document's pictures: they are its own when pasted back, even
        // after the cut took the last one away.
        const own = documentPictures(this.options.doc)
        for (const src of slicePictures(slice)) if (own.has(src)) this.knownAssets.add(src)
        return rememberCopy(slice, origin, this.options.doc.getMap('numbering'), this.context.styles, needsRelatedParts(slice) ? (slice) => copyRelatedParts(slice, this.options.doc, this.options.assets, storyId) : undefined)
      },
      transformPasted: (slice, view, plain) => {
        const copy = view.editable && !plain ? recalled : undefined
        recalled = undefined
        const limited = copy ?? limitPastedTables(slice, Math.max(0, DOCX_MAX_TABLE_DEPTH - tableDepth(view)))
        if (!copy) {
          this.notePastedReferences(limited)
          this.checkPastedPictures(limited)
        }
        if (view.editable) this.pastedSlices.set(view, { slice: limited, maps: copy ? recalledMaps : undefined })
        else this.pastedSlices.delete(view)
        recalledMaps = undefined
        return limited
      },
    }
  }

  /** Preserve Word paragraph ends after ProseMirror (or its table plugin) has fitted the paste. */
  private preparePaste(view: EditorView, tr: Transaction): void {
    if (tr.getMeta('uiEvent') !== 'paste') return
    const slice = this.pastedSlices.get(view)
    this.pastedSlices.delete(view)
    if (slice) {
      preservePastedMarks(tr, slice.slice)
      tr.setMeta('docx-paste-maps', slice.maps)
    }
  }

  /**
   * Pictures pasted from another document refer to assets this one may not have; those that
   * cannot be loaded are taken out again rather than left to break every export.
   */
  private checkPastedPictures(slice: Slice): void {
    const sources = slicePictures(slice)
    if (!sources.size) return
    // Pictures this document already shows are its own; only new ones are checked, and only those
    // are taken out (all their copies came with pastes) if this document cannot load them.
    const own = documentPictures(this.options.doc)
    for (const src of sources) {
      if (this.knownAssets.has(src) || own.has(src)) {
        this.knownAssets.add(src)
        continue
      }
      this.options.assets.get(src).then(() => { this.knownAssets.add(src) }, () => {
        if (this.destroyed) return
        for (const view of [this.view, this.storyEditor?.view]) {
          if (!view) continue
          const ranges: [number, number][] = []
          view.state.doc.descendants((node, pos) => {
            if (node.type.name === 'drawing' && node.attrs.src === src) ranges.push([pos, pos + node.nodeSize])
          })
          if (!ranges.length) continue
          const tr = view.state.tr
          for (const [from, to] of ranges.reverse()) tr.delete(from, to)
          view.dispatch(tr.setMeta('addToHistory', false).setMeta('docx-untracked', true))
        }
      })
    }
  }

  /** The stories a paste's note references and comment ranges point at, checked once it lands. */
  private notePastedReferences(slice: Slice): void {
    slice.content.descendants((node) => {
      const story = referencedStory(node)
      if (story) this.pastedReferences.add(story)
      return true
    })
  }

  /**
   * Note references and comment ranges pasted from another document point at nothing here. Only
   * what the paste brought is looked at; markers already in the document are left alone.
   */
  private dropForeignReferences(view: EditorView): void {
    const pasted = new Set(this.pastedReferences)
    this.pastedReferences.clear()
    if (!pasted.size) return
    const stories = this.options.doc.getMap('stories')
    const ranges: [number, number][] = []
    view.state.doc.descendants((node, pos) => {
      const story = referencedStory(node)
      if (story && pasted.has(story) && !stories.has(story)) ranges.push([pos, pos + node.nodeSize])
      return true
    })
    if (!ranges.length) return
    const tr = view.state.tr
    for (const [from, to] of ranges.reverse()) tr.delete(from, to)
    // Not a suggestion: the references never belonged to this document.
    view.dispatch(tr.setMeta('docx-untracked', true))
  }

  /** Lists pasted from HTML or Word become Word lists: one new list per kind per paste. */
  private convertPastedLists(view: EditorView): void {
    const found: { pos: number; node: ProseMirrorNode; kind: 'bullet' | 'decimal'; level: number }[] = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return true
      const attrs = parseJson<Record<string, string>>(node.attrs.xmlAttrs as string | null)
      const kind = attrs?.['pulpo:list']
      if (kind === 'bullet' || kind === 'decimal') found.push({ pos, node, kind, level: Math.max(0, Math.min(8, Number(attrs?.['pulpo:level']) || 0)) })
      return false
    })
    if (!found.length) return
    const tr = view.state.tr
    const edits: MapEdit[] = []
    const numIds = new Map<string, string>()
    const numbering = this.options.doc.getMap('numbering')
    const fresh = (prefix: string) => freshId([...numbering.keys(), ...edits.map(([, key]) => key)], prefix)
    for (const { pos, node, kind, level } of found) {
      let numId = numIds.get(kind)
      if (!numId) {
        const abstractId = fresh('abstract')
        numId = fresh('num')
        edits.push(['numbering', `abstract:${abstractId}`, packJml(listDefinition(kind, abstractId))], ['numbering', `num:${numId}`, packJml(['w:num', { 'w:numId': numId }, ['w:abstractNumId', { 'w:val': abstractId }]])])
        numIds.set(kind, numId)
      }
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        xmlAttrs: null,
        pStyle: node.attrs.pStyle ?? (this.context.styles.get('ListParagraph') ? 'ListParagraph' : null),
        numPr: packJml(['w:numPr', {}, ['w:ilvl', { 'w:val': String(level) }], ['w:numId', { 'w:val': numId }]]),
      })
    }
    this.applyMapEdits(edits)
    // The pasted paragraphs are already suggested insertions in Suggesting mode; their list format goes with them.
    view.dispatch(tr.setMeta('addToHistory', true).setMeta('docx-untracked', true))
  }

  private reviewer() {
    return { author: this.options.user.name || this.labels.unknownAuthor, date: revisionDate() }
  }

  /** Applies map edits in one Y transaction. */
  private applyMapEdits(edits: MapEdit[] | undefined): void {
    if (!edits?.length) return
    this.options.doc.transact(() => {
      for (const [map, key, value] of edits) {
        const target = this.options.doc.getMap<string>(map)
        if (value === null) target.delete(key)
        else target.set(key, value)
      }
    })
  }

  private applyStoryEdits(result: StoryResult | EditResult, view = this.activeView): void {
    const stories = 'stories' in result ? result.stories : []
    this.options.doc.transact(() => {
      for (const story of stories) {
        const fragment = this.options.doc.getXmlFragment(storyFragmentName(story.id))
        if (story.meta === null) {
          this.options.doc.getMap<string>('stories').delete(story.id)
          if (fragment.length) fragment.delete(0, fragment.length)
          continue
        }
        this.options.doc.getMap<string>('stories').set(story.id, JSON.stringify(story.meta))
        if (story.doc) writeFragment(this.options.doc, fragment, story.doc)
      }
    })
    this.applyMapEdits(result.maps)
    if (result.tr?.docChanged) view.dispatch(result.tr)
  }

  /** Commands are undo steps of their own, as in Word, not merged with the typing around them. */
  private separateUndo(view: EditorView): void {
    const undo = yUndoPluginKey.getState(view.state) as { undoManager?: { stopCapturing(): void } } | undefined
    undo?.undoManager?.stopCapturing()
  }

  /** Runs a command against the active story; false when it does not apply. */
  run(command: Command): boolean {
    if (this.readOnly) return false
    const target = this.activeView
    const tr = command(target.state, this.context)
    if (!tr) return false
    this.separateUndo(target)
    target.dispatch(tr)
    this.separateUndo(target)
    target.focus()
    return true
  }

  private runResult(result: EditResult | null): boolean {
    if (!result || this.readOnly) return false
    const target = this.activeView
    this.separateUndo(target)
    this.options.doc.transact(() => {
      this.applyMapEdits(result.maps)
      target.dispatch(result.tr)
    }, ySyncPluginKey)
    this.separateUndo(target)
    target.focus()
    return true
  }

  // ── Keys ─────────────────────────────────────────────────────────────────

  private enter(): boolean {
    const view = this.activeView
    const { state } = view
    if (!(state.selection instanceof TextSelection) && !(state.selection instanceof NodeSelection)) return false
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph) return false
    // Enter in an empty list item ends the list, as in Word.
    if (paragraph.node.content.size === 0 && effectiveNumPr(jml(paragraph.node.attrs.numPr), paragraph.node.attrs.pStyle as string | null, this.context.styles)) {
      return this.toggleListOff()
    }
    const tr = insertParagraphBreak(state, this.context)
    if (!tr) return false
    view.dispatch(tr.scrollIntoView())
    return true
  }

  private backspaceInList(): boolean {
    const view = this.activeView
    const { state } = view
    if (!state.selection.empty || state.selection.$from.parentOffset !== 0) return false
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph || !effectiveNumPr(jml(paragraph.node.attrs.numPr), paragraph.node.attrs.pStyle as string | null, this.context.styles)) return false
    return this.toggleListOff()
  }

  private toggleListOff(): boolean {
    const state = (this.activeView).state
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph) return false
    const list = effectiveNumPr(jml(paragraph.node.attrs.numPr), paragraph.node.attrs.pStyle as string | null, this.context.styles)
    if (!list) return false
    const kind = listKind(list.numId, this.context) ?? 'bullet'
    return this.runResult(toggleList(kind, state, this.context))
  }

  /**
   * Tab and Shift+Tab, as in Word: between table cells (Tab in the last cell adds a row), list
   * levels in lists, a tab character or an outdent elsewhere. An editable document keeps the
   * key, so focus never jumps out of the page; a read-only one lets it move focus.
   */
  private tabKey(direction: 1 | -1): boolean {
    const leave = this.tabLeaves
    this.tabLeaves = false
    if (this.readOnly || leave) return false
    const view = this.activeView
    const state = view.state
    if (isInTable(state)) {
      if (goToNextCell(direction)(state, (tr) => view.dispatch(tr.scrollIntoView()))) return true
      if (direction > 0) this.addRowAndEnter(view)
      return true
    }
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph) return true
    const inList = effectiveNumPr(jml(paragraph.node.attrs.numPr), paragraph.node.attrs.pStyle as string | null, this.context.styles)
    if (inList) return this.run(changeIndent(direction)) || true
    if (direction > 0) return this.run((current) => insertInline(current, current.schema.node('tab', { v: packJml(['w:tab', {}]) }))) || true
    const indent = readParagraphFormat(paragraph.node, this.context).indent.left
    if (indent > 0) this.run(changeIndent(-1))
    return true
  }

  /** Tab in a table's last cell: a new row below, with the cursor in its first cell. */
  private addRowAndEnter(view: EditorView): void {
    this.separateUndo(view)
    if (!addRowAfter(view.state, (tr) => view.dispatch(tr))) return
    goToNextCell(1)(view.state, (tr) => view.dispatch(tr.scrollIntoView()))
    this.separateUndo(view)
  }

  /** Word's alignment keys: pressed again on an aligned paragraph, they go back to left. */
  private alignmentKey(alignment: Alignment): boolean {
    if (this.readOnly) return false
    const current = this.state().alignment
    this.run(setAlignment(current === alignment && alignment !== 'left' ? 'left' : alignment))
    return true
  }

  /** Mod-Alt-1…6: the document's heading style for the level, adding Word's built-in one when it has none. */
  applyHeading(level: number): boolean {
    if (this.readOnly) return false
    const id = headingStyleId(this.context, level)
    if (id) return this.setStyle(id) || true
    const definitions = builtInHeadingStyles(level, this.context.styles.defaultStyle('paragraph')?.id)
    if (!definitions || this.context.styles.get(`Heading${level}`) || this.context.styles.get(`Heading${level}Char`)) return false
    const tr = setParagraphStyle(`Heading${level}`)(this.activeView.state, this.context)
    if (!tr) return false
    return this.runResult({ tr, maps: definitions.map((element): MapEdit => ['styles', `style:${element[1]['w:styleId']}`, packJml(element)]) })
  }

  /** The list typing a marker asks for, without the marker (the AutoFormat host). */
  private autoformatList(state: EditorState, marker: ListMarker, from: number, to: number): EditResult | null {
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph || selectedParagraphs(state).length !== 1) return null
    const { node } = paragraph
    if (effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, this.context.styles)) return null
    // Headings (anything with an outline level) stay as they are.
    if (jml(node.attrs.outlineLvl) || this.context.styles.outlineLevel(node.attrs.pStyle as string | null) !== undefined) return null
    const result = marker.kind === 'bullet'
      ? toggleList('bullet', state, this.context)
      : startNumberedList(state, this.context, marker.format, marker.start, marker.suffix)
    if (!result) return null
    result.tr.delete(result.tr.mapping.map(from), result.tr.mapping.map(to))
    return result
  }

  /** An AutoFormat change, as an undo step of its own after the typing that caused it. */
  private applyAutoformat(view: EditorView, tr: Transaction, maps?: MapEdit[]): void {
    this.separateUndo(view)
    if (maps?.length) {
      this.options.doc.transact(() => {
        this.applyMapEdits(maps)
        view.dispatch(tr)
      }, ySyncPluginKey)
    } else view.dispatch(tr)
    this.separateUndo(view)
  }

  // ── Public state ─────────────────────────────────────────────────────────

  /** Comments can be added and changed in Viewing mode, but not when the document is read-only. */
  get canComment(): boolean {
    return !this.readOnlyValue && !this.destroyed && !this.storyEditor
  }

  get readOnly(): boolean {
    return this.readOnlyValue || this.modeValue === 'viewing'
  }

  get mode(): DocxMode {
    return this.modeValue
  }

  get layout(): DocxLayout {
    return this.layoutMode
  }

  get zoom(): number {
    return this.zoomLevel
  }

  get pages(): number {
    return this.layoutMode === 'print' ? (this.lastLayout?.pages.length ?? 1) : 1
  }

  state(): DocxFormattingState {
    const view = this.activeView
    const { state } = view
    const run = effectiveRunProperties(state, this.context)
    const paragraph = selectedParagraphs(state)[0]?.node
    const paragraphProps = paragraph ? effectiveParagraphProperties(paragraph, this.context) : new Map<string, JmlElement>()
    const font = latinFont(run.get('w:rFonts'), this.context.theme)
    const size = jmlNumber(run.get('w:sz'), 'w:val')
    const vertAlign = jmlAttr(run.get('w:vertAlign'), 'w:val')
    const underline = jmlAttr(run.get('w:u'), 'w:val')
    const color = jmlAttr(run.get('w:color'), 'w:val')
    const highlight = jmlAttr(run.get('w:highlight'), 'w:val')
    const jc = jmlAttr(paragraphProps.get('w:jc'), 'w:val')
    const spacing = paragraphProps.get('w:spacing')
    const line = jmlNumber(spacing, 'w:line')
    const list = paragraph ? effectiveNumPr(jml(paragraph.attrs.numPr), paragraph.attrs.pStyle as string | null, this.context.styles) : undefined
    const link = selectionMarks(state).find((mark) => mark.type.name === 'link')
    const undoState = yUndoPluginKey.getState(state) as { undoManager?: { undoStack: unknown[]; redoStack: unknown[] } } | undefined
    const table = tableFormat(state)
    return {
      styleId: (paragraph?.attrs.pStyle as string | null) ?? this.context.styles.defaultStyle('paragraph')?.id ?? null,
      fontFamily: font && !isThemeFontVar(font) ? font : (this.context.theme?.fonts.minor ?? null),
      fontSize: size ? size / 2 : null,
      bold: jmlOn(run.get('w:b')) === true,
      italic: jmlOn(run.get('w:i')) === true,
      underline: underline !== undefined && underline !== 'none',
      strike: jmlOn(run.get('w:strike')) === true || jmlOn(run.get('w:dstrike')) === true,
      superscript: vertAlign === 'superscript',
      subscript: vertAlign === 'subscript',
      color: color && color !== 'auto' ? `#${color.toLowerCase()}` : null,
      highlight: highlight && highlight !== 'none' ? highlight : null,
      alignment: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'both' : 'left',
      lineSpacing: line !== undefined && (jmlAttr(spacing, 'w:lineRule') ?? 'auto') === 'auto' ? Math.round((line / 240) * 100) / 100 : null,
      list: list ? (listKind(list.numId, this.context) ?? null) : null,
      inTable: isInTable(state),
      bodyCommandsEditable: !this.readOnly && !this.storyEditor,
      canComment: this.canComment,
      tableColumnsEditable: !this.readOnly && this.modeValue !== 'suggesting',
      untrackedFormattingEditable: !this.readOnly && this.modeValue !== 'suggesting',
      link: (link?.attrs.href as string | null) ?? null,
      canUndo: (undoState?.undoManager?.undoStack.length ?? 0) > 0,
      canRedo: (undoState?.undoManager?.redoStack.length ?? 0) > 0,
      empty: state.selection.empty,
      mode: this.modeValue,
      readOnly: this.readOnly,
      layout: this.layoutMode,
      zoom: this.zoomLevel,
      pages: this.pages,
      formatPainter: this.painter !== null,
      formatPainterSticky: this.painter?.sticky ?? false,
      doubleStrike: jmlOn(run.get('w:dstrike')) === true,
      caps: jmlOn(run.get('w:caps')) === true,
      smallCaps: jmlOn(run.get('w:smallCaps')) === true,
      hidden: jmlOn(run.get('w:vanish')) === true,
      underlineStyle: underline !== undefined && underline !== 'none' ? underline : null,
      spaceBefore: (jmlNumber(spacing, 'w:before') ?? 0) / 20,
      spaceAfter: (jmlNumber(spacing, 'w:after') ?? 0) / 20,
      inRevision: selectionInRevision(state),
      editingStory: this.editingStory,
      cellVerticalAlign: table?.verticalAlign ?? null,
      headerRow: table?.headerRow ?? false,
    }
  }

  styles(): { id: string; name: string }[] {
    return paragraphStyleOptions(this.context)
  }

  fontStack(name: string): string {
    return fontStack(name)
  }

  on(event: 'update', listener: Listener<void>): () => void
  on(event: 'layout', listener: Listener<LayoutResult | null>): () => void
  on(event: 'request', listener: Listener<DocxRequest>): () => void
  on(event: 'activeComment', listener: Listener<string | null>): () => void
  /** A picture pasted, dropped, or inserted that Word could not show, or that arrived while read-only. */
  on(event: 'imageRefused', listener: Listener<DocxRefusedImage>): () => void
  on(event: keyof DocxEditor['listeners'], listener: Listener<never>): () => void {
    const set = this.listeners[event] as Set<Listener<never>>
    set.add(listener)
    return () => set.delete(listener)
  }

  private emit(event: 'update'): void
  private emit(event: 'layout', value: LayoutResult | null): void
  private emit(event: 'request', value: DocxRequest): void
  private emit(event: 'activeComment', value: string | null): void
  private emit(event: 'imageRefused', value: DocxRefusedImage): void
  private emit(event: keyof DocxEditor['listeners'], value?: unknown): void {
    for (const listener of this.listeners[event] as Set<Listener<unknown>>) listener(value)
  }

  private request(kind: DocxRequest): boolean {
    if (kind === 'comment' && !this.canComment) return false
    if (kind === 'link' && (this.readOnly || this.modeValue === 'suggesting')) return false
    if (!this.listeners.request.size) return false
    this.emit('request', kind)
    return true
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  undo(): boolean {
    if (this.readOnly) return false
    const view = this.activeView
    // Right after an AutoFormat change, undo gives the literal text back with the cursor after it.
    const done = undoAutoformat(view, () => undo(view.state)) || undo(view.state)
    view.focus()
    return done
  }

  redo(): boolean {
    if (this.readOnly) return false
    const view = this.activeView
    const done = redo(view.state)
    view.focus()
    return done
  }

  toggle(property: ToggleProperty): boolean {
    return this.run(toggleRunProperty(property))
  }

  toggleBold(): boolean {
    return this.toggle('b')
  }

  toggleItalic(): boolean {
    return this.toggle('i')
  }

  toggleStrike(): boolean {
    return this.toggle('strike')
  }

  toggleUnderline(): boolean {
    return this.run(setUnderline(this.state().underline ? 'none' : 'single'))
  }

  setUnderline(style: string | null): boolean {
    return this.run(setUnderline(style))
  }

  setFontFamily(font: string | null): boolean {
    return this.run(setFontFamily(font))
  }

  setFontSize(points: number | null): boolean {
    return this.run(setFontSize(points))
  }

  /** Word's font size steps for Ctrl+] and Ctrl+[. */
  stepFontSize(direction: 1 | -1): boolean {
    const sizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]
    const current = this.state().fontSize ?? 11
    const next = direction > 0 ? (sizes.find((size) => size > current) ?? current + 10) : ([...sizes].reverse().find((size) => size < current) ?? Math.max(1, current - 1))
    return this.setFontSize(next)
  }

  setColor(hex: string | null): boolean {
    return this.run(setTextColor(hex))
  }

  setHighlight(name: string | null): boolean {
    return this.run(setHighlight(name))
  }

  setSuperscript(): boolean {
    return this.run(setVerticalAlign('superscript'))
  }

  setSubscript(): boolean {
    return this.run(setVerticalAlign('subscript'))
  }

  setAlignment(alignment: Alignment): boolean {
    return this.run(setAlignment(alignment))
  }

  /** Line spacing as a multiple (1, 1.15, 2), or `{ exact }` / `{ atLeast }` in points. */
  setLineSpacing(spacing: number | LineSpacing): boolean {
    return this.run(setLineSpacing(typeof spacing === 'number' ? { multiple: spacing } : spacing))
  }

  setParagraphSpacing(before: number | undefined, after: number | undefined): boolean {
    return this.run(setParagraphSpacing(before, after))
  }

  setStyle(styleId: string | null): boolean {
    return this.run(setParagraphStyle(styleId))
  }

  toggleList(kind: ListKind): boolean {
    const view = this.activeView
    return this.runResult(toggleList(kind, view.state, this.context))
  }

  indent(): boolean {
    return this.run(changeIndent(1))
  }

  outdent(): boolean {
    return this.run(changeIndent(-1))
  }

  clearFormatting(): boolean {
    return this.run(clearFormatting)
  }

  /**
   * Format painter, as in Word: the first call copies the selection's format, which the next
   * selection made with the mouse (a click paints the word under it) or with Shift and the arrow
   * keys takes. `sticky` (Word's double-click) keeps painting until Escape or another call.
   * Called again before painting, it applies to a selection made otherwise, or turns off.
   */
  formatPainter(options: { sticky?: boolean } = {}): boolean {
    if (this.readOnly) return false
    const view = this.activeView
    if (!this.painter) {
      const { from, to } = view.state.selection
      this.painter = { format: copyFormat(view.state), sticky: options.sticky ?? false, storyId: this.editingStory, from, to }
      this.root.classList.add('docx-painting')
      this.emit('update')
      return true
    }
    const { from, to, empty } = view.state.selection
    const moved = this.painter.storyId !== this.editingStory || from !== this.painter.from || to !== this.painter.to
    if (this.painter.sticky || !moved || empty) return this.cancelFormatPainter()
    return this.paint()
  }

  /** Turns the format painter off; false when it was not on. */
  cancelFormatPainter(): boolean {
    if (!this.painter) return false
    this.painter = null
    this.root.classList.remove('docx-painting')
    this.emit('update')
    return true
  }

  /** Paints once the browser has settled the selection a pointer or key just made. */
  /**
   * Paints once the browser has settled the selection a pointer or key just made. A keyboard
   * selection (`unchanged` given) paints only when it is not empty and differs from that one.
   */
  private paintSoon(keyboard?: { unchanged: Selection | null }): void {
    requestAnimationFrame(() => {
      if (!this.painter || this.destroyed) return
      const view = this.activeView
      flushSelection(view)
      const { selection } = view.state
      if (keyboard && (selection.empty || (keyboard.unchanged && selection.eq(keyboard.unchanged)))) return
      this.paint()
    })
  }

  private paint(): boolean {
    const painter = this.painter
    if (!painter || this.readOnly) return false
    const view = this.activeView
    const { selection } = view.state
    // A click paints the word under it.
    const word = selection.empty ? wordAt(view.state.doc, selection.from) : null
    const tr = pasteFormat(painter.format, word ?? undefined)(view.state, this.context)
    if (!painter.sticky) this.cancelFormatPainter()
    if (!tr?.docChanged) return false
    this.separateUndo(view)
    view.dispatch(tr)
    this.separateUndo(view)
    view.focus()
    return true
  }

  insertTable(rows: number, cols: number): boolean {
    return this.run(insertTable(rows, cols))
  }

  private tableCommand(command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean): boolean {
    if (this.readOnly) return false
    const view = this.activeView
    this.separateUndo(view)
    const done = command(view.state, (tr) => view.dispatch(tr))
    this.separateUndo(view)
    view.focus()
    return done
  }

  addRowBefore(): boolean { return this.tableCommand(addRowBefore) }
  addRowAfter(): boolean { return this.tableCommand(addRowAfter) }
  /** Row revisions cannot represent column edits or changes to cell merges. */
  addColumnBefore(): boolean { return this.modeValue !== 'suggesting' && this.tableCommand(addColumnBefore) }
  addColumnAfter(): boolean { return this.modeValue !== 'suggesting' && this.tableCommand(addColumnAfter) }
  deleteRow(): boolean { return this.tableCommand(deleteRow) }
  deleteColumn(): boolean { return this.modeValue !== 'suggesting' && this.tableCommand(deleteColumn) }
  deleteTable(): boolean { return this.tableCommand(deleteTable) }
  mergeCells(): boolean { return this.modeValue !== 'suggesting' && this.tableCommand(mergeCells) }
  splitCell(): boolean { return this.modeValue !== 'suggesting' && this.tableCommand(splitCell) }

  setCellShading(hex: string | null): boolean {
    return this.modeValue !== 'suggesting' && this.run(setCellShading(hex))
  }

  setCellBorders(preset: BorderPreset): boolean {
    return this.modeValue !== 'suggesting' && this.run(setCellBorders(preset))
  }

  setLink(href: string | null, text?: string): boolean {
    return this.modeValue !== 'suggesting' && this.run(setLink(href, text))
  }

  insertPageBreak(): boolean {
    return this.run(insertPageBreak)
  }

  insertSectionBreak(type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage'): boolean {
    if (this.modeValue === 'suggesting' || this.storyEditor) return false
    const view = this.activeView
    return this.runResult(insertSectionBreak(type, view.state, this.context))
  }

  insertSymbol(text: string): boolean {
    return this.run(insertSymbol(text))
  }

  /**
   * Inserts a picture from a file at the cursor (where the cursor was when called, however long
   * the upload takes), sized to fit the text width of its section. Formats Word cannot show are
   * refused, with an `imageRefused` event.
   */
  async insertImage(file: Blob, description = '', target = this.activeView): Promise<boolean> {
    const name = typeof File !== 'undefined' && file instanceof File ? file.name : ''
    if (this.readOnly || target.isDestroyed) {
      this.emit('imageRefused', { name, type: file.type, reason: 'readOnly' })
      return false
    }
    // Keep the place: the selection may move (or collaborators edit) while the picture uploads.
    const id = {}
    target.dispatch(target.state.tr.setMeta(pendingPasteKey, { id, bookmark: target.state.selection.getBookmark() }))
    const release = () => {
      if (!target.isDestroyed && pendingPasteKey.getState(target.state)?.has(id)) target.dispatch(target.state.tr.setMeta(pendingPasteKey, { id }))
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Formats Word shows as plain pictures (SVG would need a PNG fallback beside it).
      const mimeType = insertablePicture(bytes)
      if (!mimeType) {
        this.emit('imageRefused', { name, type: file.type, reason: 'unsupported' })
        return false
      }
      const ref = await this.options.assets.put(bytes, mimeType)
      let width = 300
      let height = 200
      try {
        const bitmap = await createImageBitmap(file)
        width = bitmap.width * 0.75
        height = bitmap.height * 0.75
        bitmap.close()
      } catch {
        // Keep the default size for formats the browser cannot decode.
      }
      if (this.destroyed || this.readOnly || target.isDestroyed) return false
      const bookmark = pendingPasteKey.getState(target.state)?.get(id)
      if (!bookmark) return false
      const selection = bookmark.resolve(target.state.doc)
      const section = target === this.view ? sectionOf(target.state.doc, selection.from, this.context.finalSectPr).sectPr : this.context.finalSectPr
      const maxWidth = textAreaWidth(section)
      if (width > maxWidth) {
        height = (height * maxWidth) / width
        width = maxWidth
      }
      const node = target.state.schema.node('drawing', { v: packJml(newInlinePicture(width, height, description || 'Picture', description)), src: ref.hash })
      target.dispatch(target.state.tr.setSelection(selection).replaceSelectionWith(node, false).setMeta(pendingPasteKey, { id }).scrollIntoView())
      target.focus()
      return true
    } finally {
      release()
    }
  }

  /** Inserts pictures one after another, as a paste or drop of several files does. */
  private async insertImages(files: Blob[], view: EditorView): Promise<void> {
    for (const file of files) {
      if (this.destroyed || view.isDestroyed) return
      await this.insertImage(file, '', view)
    }
  }

  insertNote(kind: 'footnote' | 'endnote', text = ''): string | null {
    if (this.readOnly || this.storyEditor) return null
    const result = addNote(this.view.state, this.context, kind, text)
    this.applyStoryEdits(result)
    if (this.openStoryEditor(`${kind}:${result.id}`)) {
      const view = this.activeView
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).scrollIntoView())
    }
    return result.id
  }

  /** A line break within the paragraph (Shift+Enter). */
  insertLineBreak(): boolean {
    return this.run(insertLineBreak)
  }

  /** A horizontal line (a bottom-bordered paragraph), with the cursor below it. */
  insertHorizontalLine(): boolean {
    return this.run(insertHorizontalLine)
  }

  /** Removes direct character formatting only (Word's Ctrl+Space). */
  clearCharacterFormatting(): boolean {
    return this.run(clearCharacterFormatting)
  }

  /** Word's Change Case on the selection, or on the word at the cursor. */
  changeCase(change: CaseChange): boolean {
    return this.run(changeCase(change))
  }

  /** The link at the cursor (inside it or at its end): its target, text, and range. */
  linkAt(): Omit<LinkRange, 'mark'> | null {
    const { state } = this.activeView
    if (!state.selection.empty) return null
    const found = linkAround(state.doc, state.selection.from)
    if (!found) return null
    const { mark: _mark, ...link } = found
    return link
  }

  /** The format of the first selected paragraph, in points. */
  paragraphFormat(): ParagraphFormat | null {
    const paragraph = selectedParagraphs(this.activeView.state)[0]
    return paragraph ? readParagraphFormat(paragraph.node, this.context) : null
  }

  /** Changes the selected paragraphs' indents, spacing, line spacing, alignment, and break options in one step. */
  setParagraphFormat(change: ParagraphFormatChange): boolean {
    return this.run(setParagraphFormat(change))
  }

  setParagraphBorder(preset: ParagraphBorder): boolean {
    return this.run(setParagraphBorder(preset))
  }

  // Cell and table properties have no tracked form, like shading.
  setCellVerticalAlign(value: CellVerticalAlign): boolean {
    return this.modeValue !== 'suggesting' && this.run(setCellVerticalAlign(value))
  }

  /** Word's "Repeat as header row at the top of each page" for the rows down to the selection. */
  setHeaderRow(on: boolean): boolean {
    return this.modeValue !== 'suggesting' && this.run(setHeaderRows(on))
  }

  setTableAlignment(alignment: 'left' | 'center' | 'right'): boolean {
    return this.modeValue !== 'suggesting' && this.run(setTableAlignment(alignment))
  }

  /** Selects the row, column, or table around the selection. */
  selectTable(part: 'row' | 'column' | 'table'): boolean {
    const view = this.activeView
    const tr = selectTablePart(part)(view.state, this.context)
    if (!tr) return false
    view.dispatch(tr)
    view.focus()
    return true
  }

  /** Vertical alignment, header row, and table alignment at the selection; null outside tables. */
  tableFormat(): ReturnType<typeof tableFormat> {
    return tableFormat(this.activeView.state)
  }

  // ── Page setup, headers, and footers ─────────────────────────────────────

  /** The page of the section at the cursor, in points, and which section that is. */
  pageSetup(): PageSetupInfo & { section: number; sections: number } {
    const { state } = this.view
    const holders = sectionHolders(state.doc, this.context.finalSectPr)
    const section = sectionIndexAt(state.doc, state.selection.from)
    return { ...readPageSetup(holders[section]?.sectPr), section, sections: holders.length }
  }

  /**
   * Page size, orientation, and margins (points) for the whole document or the section at the
   * cursor; false when the change leaves no room for text. One undo step; refused while
   * suggesting, as section properties have no tracked form.
   */
  setPageSetup(change: PageSetupChange, scope: 'document' | 'section' = 'document'): boolean {
    if (this.readOnly || this.modeValue === 'suggesting') return false
    return this.applySectionEdit(editSections(this.view.state, this.context, scope === 'document' ? 'all' : [sectionIndexAt(this.view.state.doc, this.view.state.selection.from)], (sectPr) => applyPageSetup(sectPr, change)))
  }

  /** Section property edits to the body, as one undo step even when only the final section changes. */
  private applySectionEdit(result: EditResult | null): boolean {
    if (!result) return false
    const view = this.view
    this.separateUndo(view)
    this.options.doc.transact((transaction) => {
      transaction.meta.set(SECTION_UNDO, true)
      this.applyMapEdits(result.maps)
      if (result.tr.docChanged) view.dispatch(result.tr.setMeta('docx-untracked', true))
    }, ySyncPluginKey)
    this.separateUndo(view)
    if (this.layoutMode !== 'print') this.applyWebWidth()
    this.scheduleLayout(true)
    return true
  }

  /** Headers and footers of the section at the cursor (own or inherited) and its first-page and odd/even options. */
  headerFooter(): HeaderFooterInfo {
    return headerFooterInfo(this.view.state, this.context)
  }

  /**
   * Opens the header or footer of the section at the cursor for editing, creating it when the
   * section has none (Word's Insert Header). Returns its story id, or null when it cannot: while
   * suggesting (sections have no tracked form), read-only, or in web layout, which has no pages.
   */
  addHeaderFooter(kind: HeaderFooterKind, type: HeaderFooterType = 'default'): string | null {
    if (this.readOnly || this.modeValue === 'suggesting' || this.layoutMode !== 'print') return null
    if (type === 'first' && !this.headerFooter().differentFirstPage) this.setDifferentFirstPage(true)
    if (type === 'even' && !this.context.evenAndOddHeaders) this.setDifferentOddEven(true)
    let storyId = headerFooterOf(this.view.state, this.context, kind, type)?.storyId
    if (!storyId) {
      const result = createHeaderFooter(this.view.state, this.context, kind, type)
      if (!result) return null
      storyId = result.storyId
      // Not an undo step, like comments: it adds a part, and the caret moves into it.
      this.options.doc.transact((transaction) => {
        transaction.meta.set('addToHistory', false)
        for (const story of result.stories) {
          this.options.doc.getMap<string>('stories').set(story.id, JSON.stringify(story.meta))
          if (story.doc) writeFragment(this.options.doc, this.options.doc.getXmlFragment(storyFragmentName(story.id)), story.doc)
        }
        this.applyMapEdits(result.maps)
        if (result.tr?.docChanged) this.view.dispatch(result.tr.setMeta('addToHistory', false).setMeta('docx-untracked', true))
      }, ySyncPluginKey)
    }
    this.relayout()
    return this.openHeaderFooter(storyId) ? storyId : null
  }

  /** Opens a header or footer at the occurrence nearest the cursor's page, with the cursor at its end. */
  private openHeaderFooter(storyId: string): boolean {
    if (this.storyEditor?.storyId === storyId) return true
    const page = this.currentPage()?.index ?? 1
    const pages = [...this.pagesLayer.querySelectorAll<HTMLElement>('.docx-page')]
    const sheet = pages[page - 1]?.getBoundingClientRect()
    const candidates = this.storyElements(storyId)
    const over = sheet ? candidates.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= sheet.top - 1 && rect.top <= sheet.bottom + 1
    }) ?? candidates[0] : candidates[0]
    if (!this.openStoryEditor(storyId, over)) return false
    const view = this.activeView
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    return true
  }

  /** Removes the header or footer the section at the cursor shows (from every section that shows it). */
  removeHeaderFooter(kind: HeaderFooterKind, type: HeaderFooterType = 'default'): boolean {
    if (this.readOnly || this.modeValue === 'suggesting') return false
    const found = headerFooterOf(this.view.state, this.context, kind, type)
    if (!found) return false
    const result = removeHeaderFooter(this.view.state, this.context, found.storyId)
    if (!result) return false
    if (this.storyEditor?.storyId === found.storyId) this.closeStoryEditor()
    this.options.doc.transact((transaction) => {
      transaction.meta.set('addToHistory', false)
      this.applyMapEdits(result.maps)
      this.options.doc.getMap<string>('stories').delete(found.storyId)
      const fragment = this.options.doc.getXmlFragment(storyFragmentName(found.storyId))
      if (fragment.length) fragment.delete(0, fragment.length)
      if (result.tr?.docChanged) this.view.dispatch(result.tr.setMeta('addToHistory', false).setMeta('docx-untracked', true))
    }, ySyncPluginKey)
    this.scheduleLayout(true)
    return true
  }

  /** Word's "Different first page" for the section at the cursor (one undo step). */
  setDifferentFirstPage(on: boolean): boolean {
    if (this.readOnly || this.modeValue === 'suggesting') return false
    const section = sectionIndexAt(this.view.state.doc, this.view.state.selection.from)
    return this.applySectionEdit(editSections(this.view.state, this.context, [section], (sectPr) => withTitlePage(sectPr, on)))
  }

  /** Word's "Different odd and even pages", a document setting. */
  setDifferentOddEven(on: boolean): boolean {
    if (this.readOnly || this.modeValue === 'suggesting' || this.context.evenAndOddHeaders === on) return false
    this.applyMapEdits([['settings', 'w:evenAndOddHeaders', on ? packJml(['w:evenAndOddHeaders', {}]) : '']])
    this.scheduleLayout(true)
    return true
  }

  /**
   * Page numbers as Word's Insert Page Number does: with `kind`, a paragraph of its own at the top
   * of the header or bottom of the footer (created when needed), aligned; without, a PAGE field at
   * the cursor of the open header or footer. `withTotal` writes "Page X of Y" (the `pageOfPages` label).
   */
  insertPageNumber(options: { kind?: HeaderFooterKind; align?: 'left' | 'center' | 'right'; withTotal?: boolean } = {}): boolean {
    if (this.readOnly || this.modeValue === 'suggesting') return false
    if (options.kind && !this.addHeaderFooter(options.kind)) return false
    const story = this.storyEditor
    if (!story || !/^(header|footer):/.test(story.storyId)) return false
    const { view } = story
    const { schema } = view.state
    const field = (instr: string) => schema.text('1', [schema.marks.fldSimple!.create({ v: packJml(['w:fldSimple', { 'w:instr': ` ${instr} ` }, '\u0000']) })])
    const content: ProseMirrorNode[] = []
    if (options.withTotal) {
      for (const part of this.labels.pageOfPages.split(/(\{page\}|\{pages\})/)) {
        if (part === '{page}') content.push(field('PAGE'))
        else if (part === '{pages}') content.push(field('NUMPAGES'))
        else if (part) content.push(schema.text(part))
      }
    } else content.push(field('PAGE'))
    const tr = view.state.tr
    if (!options.kind) {
      tr.replaceSelection(new Slice(Fragment.fromArray(content), 0, 0))
    } else {
      const kind = story.storyId.startsWith('header:') ? 'header' : 'footer'
      const jc = packJml(['w:jc', { 'w:val': options.align ?? 'center' }])
      const doc = view.state.doc
      const only = doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && !doc.firstChild!.content.size ? doc.firstChild! : null
      if (only) tr.replaceWith(0, only.nodeSize, only.type.create({ ...only.attrs, jc }, content))
      else tr.insert(kind === 'header' ? 0 : doc.content.size, headerFooterParagraph(schema, this.context, kind, { jc }, content))
    }
    this.separateUndo(view)
    view.dispatch(tr.scrollIntoView())
    this.separateUndo(view)
    view.focus()
    this.scheduleLayout(true)
    return true
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  private author(): CommentAuthor {
    return { name: this.options.user.name || this.labels.unknownAuthor }
  }

  addComment(text: string): string | null {
    if (!this.canComment) return null
    const result = addComment(this.activeView.state, this.context, this.author(), text)
    this.applyStoryEdits(result)
    this.setActiveComment(result.id)
    return result.id
  }

  replyToComment(parentId: string, text: string): string | null {
    if (!this.canComment) return null
    const result = replyToComment(this.activeView.state, this.context, parentId, this.author(), text)
    if (!result) return null
    this.applyStoryEdits(result)
    return result.id
  }

  resolveComment(id: string, done = true): void {
    if (!this.canComment) return
    this.applyStoryEdits(setCommentResolved(this.context, id, done))
  }

  deleteComment(id: string): void {
    if (!this.canComment) return
    this.applyStoryEdits(deleteComment(this.activeView.state, this.context, id))
    if (this.activeCommentId === id) this.setActiveComment(null)
  }

  editComment(id: string, text: string): void {
    if (!this.canComment) return
    this.applyStoryEdits(editCommentText(this.activeView.state, this.context, id, text))
  }

  comments(): CommentThread[] {
    return commentThreads(this.view.state.doc, this.context, (storyId) => {
      if (!this.options.doc.getMap('stories').has(storyId)) return undefined
      return fragmentToNode(this.options.doc.getXmlFragment(storyFragmentName(storyId)))
    })
  }

  /** Vertical position of each comment's anchor, relative to the editor's root, in screen pixels. */
  commentPositions(): Map<string, number> {
    const positions = new Map<string, number>()
    const rootTop = this.root.getBoundingClientRect().top
    this.view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'commentMark' && node.attrs.edge === 'start' && !positions.has(String(node.attrs.id))) {
        try {
          positions.set(String(node.attrs.id), this.view.coordsAtPos(pos).top - rootTop)
        } catch {
          // Positions inside hidden content have no coordinates.
        }
      }
      return true
    })
    return positions
  }

  get activeComment(): string | null {
    return this.activeCommentId
  }

  setActiveComment(id: string | null): void {
    if (this.destroyed) return
    if (this.activeCommentId === id) return
    this.activeCommentId = id
    for (const view of [this.view, this.storyEditor?.view]) if (view) this.refreshDecorations(view)
    this.emit('activeComment', id)
  }

  private handleClick(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null
    const range = target?.closest<HTMLElement>('.docx-comment-range')
    const ids = range?.dataset.comments?.split(' ')
    this.setActiveComment(ids?.[0] ?? null)
    return false
  }

  /**
   * Links never navigate the page the editor is in. While editing, Ctrl/Cmd-click follows them
   * (like Word) and a plain click places the caret; read-only, and in headers and footers, a click
   * follows them. They open in a new tab, or move to the bookmark they name.
   */
  private followLink(event: MouseEvent): void {
    const link = (event.target as Element | null)?.closest?.('a[href]')
    if (!link || !this.root.contains(link)) return
    event.preventDefault()
    const editable = link.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true'
    if (editable && !event.metaKey && !event.ctrlKey) return
    const href = link.getAttribute('href') ?? ''
    if (href.startsWith('#')) this.goToBookmark(decodeURIComponent(href.slice(1)))
    else if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
  }

  goToBookmark(name: string): void {
    const targets = [{ view: this.activeView, storyId: this.editingStory ?? undefined }]
    if (this.storyEditor) targets.push({ view: this.view, storyId: undefined })
    for (const { view, storyId } of targets) {
      let found: number | undefined
      view.state.doc.descendants((node, pos) => {
        if (found === undefined && node.type.name === 'bookmark' && node.attrs.name === name && node.attrs.edge === 'start') found = pos
        return found === undefined
      })
      if (found !== undefined) { this.goTo(found, storyId); return }
    }
  }

  // ── Tracked changes ──────────────────────────────────────────────────────

  setMode(mode: DocxMode): void {
    if (this.destroyed) return
    if (this.readOnlyValue && mode !== 'viewing') return
    this.modeValue = mode
    this.view.setProps({ editable: () => !this.readOnly })
    this.storyEditor?.view.setProps({ editable: () => !this.readOnly })
    this.root.classList.toggle('docx-suggesting', mode === 'suggesting')
    // A read-only document has nothing to paint.
    if (this.readOnly) this.cancelFormatPainter()
    this.emit('update')
  }

  /** Word's Track Changes setting, stored in the document's settings. */
  setTrackRevisions(on: boolean): void {
    this.applyMapEdits([['settings', 'w:trackRevisions', on ? packJml(['w:trackRevisions', {}]) : '']])
  }

  revisions(): Revision[] {
    const revisions = listRevisions(this.view.state.doc)
    for (const [id, json] of readDocxMap(this.options.doc, 'stories')) {
      const meta = parseJson<StoryMeta>(json)
      if (!meta) continue
      pushAll(revisions, listRevisions(fragmentToNode(this.options.doc.getXmlFragment(storyFragmentName(id))), id))
    }
    return revisions
  }

  resolveRevisions(revisions: Revision[], action: 'accept' | 'reject'): boolean {
    return this.resolveStories(revisions, action, false)
  }

  private resolveStories(revisions: Revision[], action: 'accept' | 'reject', all: boolean): boolean {
    if (this.readOnlyValue) return false
    const groups = new Map<string | undefined, Revision[]>()
    for (const revision of revisions) {
      const group = groups.get(revision.storyId) ?? []
      group.push(revision)
      groups.set(revision.storyId, group)
    }
    let changed = false
    for (const [storyId, group] of groups) {
      const view = storyId ? (this.storyEditor?.storyId === storyId ? this.storyEditor.view : undefined) : this.view
      const story = storyId && !view ? this.storyDoc(storyId) : undefined
      if (!view && !story) continue
      const state = view?.state ?? EditorState.create({ doc: story!, schema: docxSchema() })
      const tr = all ? resolveAllRevisions(state, action) : resolveRevisions(state, group, action)
      if (!tr) continue
      if (view) view.dispatch(tr.setMeta('docx-untracked', true))
      else this.options.doc.transact(() => writeFragment(this.options.doc, this.options.doc.getXmlFragment(storyFragmentName(storyId!)), tr.doc))
      changed = true
    }
    if (changed) this.emit('update')
    return changed
  }

  /** Tracked changes in the active story that the selection touches. */
  revisionsAt(): Revision[] {
    const { state } = this.activeView
    const { from, to } = state.selection
    return listRevisions(state.doc, this.editingStory ?? undefined).filter((revision) => revision.from <= to && revision.to >= from)
  }

  /**
   * Selects the next (or previous) tracked change after the selection, through the body and then
   * the headers, footers, and notes, wrapping around as Word's Next does.
   */
  nextRevision(direction: 1 | -1 = 1): Revision | null {
    const all = this.revisions()
    if (!all.length) return null
    const order = [undefined, ...new Set(all.map((revision) => revision.storyId).filter((id): id is string => id !== undefined))]
    const story = order.indexOf(this.editingStory ?? undefined)
    const { from } = this.activeView.state.selection
    const rank = (revision: Revision) => order.indexOf(revision.storyId)
    const after = (revision: Revision) => rank(revision) > story || (rank(revision) === story && revision.from > from)
    const before = (revision: Revision) => rank(revision) < story || (rank(revision) === story && revision.from < from)
    const sorted = [...all].sort((a, b) => rank(a) - rank(b) || a.from - b.from)
    const target = direction > 0 ? sorted.find(after) ?? sorted[0]! : [...sorted].reverse().find(before) ?? sorted.at(-1)!
    this.goTo(Math.max(0, target.from - 1), target.storyId)
    // A story that cannot open (read-only) is still reported, without moving the selection into the body.
    if ((this.editingStory ?? undefined) !== target.storyId) return target
    const view = this.activeView
    const size = view.state.doc.content.size
    const selection = TextSelection.between(view.state.doc.resolve(Math.min(target.from, size)), view.state.doc.resolve(Math.min(target.to, size)))
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
    return target
  }

  /** Accepts the tracked changes the selection touches. */
  acceptRevisionAtCaret(): boolean {
    const revisions = this.revisionsAt()
    return revisions.length > 0 && this.resolveRevisions(revisions, 'accept')
  }

  /** Rejects the tracked changes the selection touches. */
  rejectRevisionAtCaret(): boolean {
    const revisions = this.revisionsAt()
    return revisions.length > 0 && this.resolveRevisions(revisions, 'reject')
  }

  acceptAll(): boolean {
    return this.resolveStories(this.revisions(), 'accept', true)
  }

  rejectAll(): boolean {
    return this.resolveStories(this.revisions(), 'reject', true)
  }

  /** Shows the document as if every change were accepted, without changing it. */
  setShowMarkup(show: boolean): void {
    this.root.classList.toggle('docx-final', !show)
    this.view.dom.classList.toggle('docx-final', !show)
    this.scheduleLayout()
  }

  // ── Find and tools ───────────────────────────────────────────────────────

  find(query: string, options: FindOptions = {}): number {
    const matches = findMatches(this.activeView.state.doc, query, options)
    const head = this.activeView.state.selection.from
    const current = matches.length ? Math.max(0, matches.findIndex((match) => match.from >= head)) : -1
    this.activeView.dispatch(this.activeView.state.tr.setMeta(findKey, { query, options: { ...options }, matches, current }))
    if (current >= 0) this.revealMatch(current)
    return matches.length
  }

  findStep(direction: 1 | -1): { index: number; count: number } {
    const find = findKey.getState(this.activeView.state)
    if (!find?.matches.length) return { index: -1, count: 0 }
    const current = (find.current + direction + find.matches.length) % find.matches.length
    this.activeView.dispatch(this.activeView.state.tr.setMeta(findKey, { ...find, current }))
    this.revealMatch(current)
    return { index: current, count: find.matches.length }
  }

  findState(): { index: number; count: number } {
    const find = findKey.getState(this.activeView.state)
    return { index: find?.current ?? -1, count: find?.matches.length ?? 0 }
  }

  private revealMatch(index: number): void {
    const match = findKey.getState(this.activeView.state)?.matches[index]
    if (!match) return
    this.activeView.dispatch(this.activeView.state.tr.setSelection(TextSelection.create(this.activeView.state.doc, match.from, match.to)).scrollIntoView())
  }

  replace(replacement: string, query: string, options: FindOptions = {}): boolean {
    if (this.readOnly) return false
    const find = findKey.getState(this.activeView.state)
    const match = find?.matches[find.current]
    if (!match) return false
    if (!validFindMatches(this.activeView.state.doc, [match], query, options).length) {
      this.find(query, options)
      return false
    }
    this.separateUndo(this.activeView)
    this.activeView.dispatch(replaceMatches(this.activeView.state, [match], replacement, query, options))
    this.separateUndo(this.activeView)
    this.find(query, options)
    return true
  }

  replaceAll(replacement: string, query: string, options: FindOptions = {}): number {
    if (this.readOnly) return 0
    const matches = findMatches(this.activeView.state.doc, query, options)
    if (!matches.length) return 0
    this.separateUndo(this.activeView)
    this.activeView.dispatch(replaceMatches(this.activeView.state, matches, replacement, query, options))
    this.separateUndo(this.activeView)
    this.clearFind()
    return matches.length
  }

  clearFind(): void {
    this.activeView.dispatch(this.activeView.state.tr.setMeta(findKey, { query: '', options: {}, matches: [], current: -1 }))
  }

  /** Words, characters, and paragraphs of the active story, or of the selection in it (zero when nothing is selected). */
  wordCount(scope: 'document' | 'selection' = 'document'): WordCount {
    const { state } = this.activeView
    return scope === 'selection' ? selectionWordCount(state) : wordCount(state.doc)
  }

  /**
   * The page the cursor is on, counting physical pages from 1 (`number` is what the page shows,
   * which can restart or be roman), and how many there are; undefined outside print layout.
   */
  currentPage(): { index: number; count: number; number: number } | undefined {
    const layout = this.lastLayout
    if (this.layoutMode !== 'print' || !layout?.pages.length) return undefined
    try {
      const canvas = this.canvas.getBoundingClientRect()
      const scale = this.zoomLevel || 1
      let top: number
      if (this.storyEditor) top = (this.storyEditor.element.getBoundingClientRect().top - canvas.top) / scale
      else {
        const flow = this.view.dom as HTMLElement
        const rect = flow.getBoundingClientRect()
        const flowScale = flow.offsetWidth ? rect.width / flow.offsetWidth : 1
        top = this.flowTop + (this.view.coordsAtPos(this.view.state.selection.head).top - rect.top) / flowScale
      }
      let index = 0
      for (const [at, page] of layout.pages.entries()) if (this.flowTop + page.contentTop - page.setup.top <= top + 1) index = at
      return { index: index + 1, count: layout.pages.length, number: layout.pages[index]!.number }
    } catch {
      return undefined
    }
  }

  // ── Context menus and clipboard ──────────────────────────────────────────

  /**
   * What is under a point (client coordinates), for a host's context menu: the position, table
   * cell, picture, link, comments, and tracked changes there. With `select`, a point outside the
   * selection moves the cursor there first (a picture is selected), as right-clicking does.
   * Null outside the editable text.
   */
  contextAt(clientX: number, clientY: number, options: { select?: boolean } = {}): DocxContextInfo | null {
    const owner = this.root.ownerDocument
    const target = typeof owner.elementFromPoint === 'function' ? owner.elementFromPoint(clientX, clientY) : null
    const story = this.storyEditor && target && this.storyEditor.view.dom.contains(target) ? this.storyEditor : null
    const view = story?.view ?? this.view
    if (target && !view.dom.contains(target)) return null
    let found: { pos: number } | null = null
    try {
      found = view.posAtCoords({ left: clientX, top: clientY })
    } catch {
      return null
    }
    if (!found) return null
    let pos = found.pos
    const pictureElement = target?.closest?.('.docx-drawing')
    let picture: DocxContextInfo['picture'] = null
    if (pictureElement && view.dom.contains(pictureElement)) {
      try {
        const at = view.posAtDOM(pictureElement, 0)
        const node = view.state.doc.nodeAt(at)
        const element = node?.type.name === 'drawing' ? jml(node.attrs.v) : undefined
        if (element) {
          pos = at
          picture = { pos: at, description: drawingInfo(element).description ?? '' }
        }
      } catch {
        // A picture leaving the document meanwhile.
      }
    }
    const { selection } = view.state
    const inSelection = !selection.empty && pos >= selection.from && pos <= selection.to
    if (options.select && !inSelection && view.editable) {
      const $pos = view.state.doc.resolve(pos)
      view.dispatch(view.state.tr.setSelection(picture ? NodeSelection.create(view.state.doc, picture.pos) : TextSelection.near($pos)))
    }
    const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size))
    let table = false
    for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'tableCell') table = true
    const link = linkAround(view.state.doc, pos, Boolean(target?.closest?.('a.docx-link')))
    const comments = target?.closest?.('.docx-comment-range')?.getAttribute('data-comments')?.split(' ').filter(Boolean) ?? []
    const storyId = story?.storyId ?? null
    const revisions = listRevisions(view.state.doc, storyId ?? undefined).filter((revision) => revision.from <= pos && revision.to >= pos)
    const linkInfo = link ? { from: link.from, to: link.to, href: link.href, anchor: link.anchor, text: link.text } : null
    return { pos, storyId, inSelection, editable: view.editable, table, picture, link: linkInfo, comments, revisions }
  }

  /**
   * Pastes clipboard contents a host read itself (a context menu's Paste, through the async
   * clipboard) through the same path as Ctrl+V: Pulpo's own copies come back exactly, other HTML
   * is cleaned, pictures are inserted. `plain` pastes the text only, as Ctrl+Shift+V does.
   */
  pasteData(data: { html?: string; text?: string; files?: Blob[] }, options: { plain?: boolean } = {}): boolean {
    if (this.readOnly) return false
    const view = this.activeView
    view.focus()
    const pictures = (data.files ?? []).filter((file) => IMAGE_FILE.test(file.type))
    if (!options.plain && pictures.length && !data.html) {
      void this.insertImages(pictures, view)
      return true
    }
    // ProseMirror makes a ClipboardEvent when given none, which not every environment has.
    const bare = typeof ClipboardEvent === 'undefined' ? (new Event('paste') as ClipboardEvent) : undefined
    if (options.plain || !data.html) {
      if (!data.text) return false
      view.pasteText(data.text, bare)
      return true
    }
    if (typeof DataTransfer !== 'undefined' && typeof ClipboardEvent !== 'undefined') {
      try {
        const transfer = new DataTransfer()
        transfer.setData('text/html', data.html)
        if (data.text) transfer.setData('text/plain', data.text)
        // A copied picture reads back as its file beside an <img> wrapper; the paste handler takes the file.
        for (const file of pictures) transfer.items.add(file instanceof File ? file : new File([file], 'image', { type: file.type }))
        const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
        // Browsers that drop clipboardData from constructed events fall back to parsing the HTML directly.
        if (event.clipboardData) {
          view.dom.dispatchEvent(event)
          return true
        }
      } catch {
        // Fall through to the direct path.
      }
    }
    view.pasteHTML(data.html, bare)
    return true
  }

  /** Turns AutoFormat As You Type, or parts of it, on or off. */
  setAutoformat(options: boolean | AutoformatOptions): void {
    this.autoformatOptions = autoformatSettings(options)
  }

  get autoformat(): Required<AutoformatOptions> {
    return { ...this.autoformatOptions }
  }

  outline(maxLevel = 9): OutlineEntry[] {
    return documentOutline(this.activeView.state.doc, this.context, maxLevel).map((entry) => this.editingStory ? { ...entry, storyId: this.editingStory } : entry)
  }

  goTo(pos: number, storyId?: string): void {
    if (storyId && this.storyEditor?.storyId !== storyId && !this.openStoryEditor(storyId)) return
    if (!storyId) this.closeStoryEditor()
    const view = storyId ? this.storyEditor!.view : this.view
    const $pos = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size))
    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView())
    view.focus()
    try {
      const coords = view.coordsAtPos($pos.pos)
      const scroller = this.scroller()
      if (scroller) scroller.scrollTop += coords.top - scroller.getBoundingClientRect().top - 80
    } catch {
      // Hidden positions keep the scroll where it is.
    }
  }

  /** Page (1-based, as displayed) a position is on, from the last layout. */
  pageOf(pos: number, storyId?: string): number | undefined {
    if (storyId) return undefined
    if (this.layoutMode !== 'print' || !this.lastLayout) return undefined
    try {
      const flow = this.view.dom as HTMLElement
      const rect = flow.getBoundingClientRect()
      const scale = flow.offsetWidth ? rect.width / flow.offsetWidth : 1
      const y = (this.view.coordsAtPos(Math.min(pos + 1, this.view.state.doc.content.size)).top - rect.top) / scale
      const pages = this.lastLayout.pages
      let page = pages[0]
      for (const candidate of pages) if (candidate.contentTop - candidate.setup.top <= y) page = candidate
      return page?.number
    } catch {
      return undefined
    }
  }

  /** Inserts a table of contents from the headings at the cursor, as a TOC field Word updates too. */
  insertTableOfContents(): boolean {
    if (this.readOnly || this.storyEditor) return false
    const state = this.view.state
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph) return false
    const { tr, paragraphs } = this.tocParagraphs(state)
    tr.insert(tr.mapping.map(paragraph.pos), paragraphs)
    this.view.dispatch(tr.scrollIntoView())
    this.view.focus()
    return true
  }

  /** Regenerates the entries of the first table of contents. */
  updateTableOfContents(): boolean {
    if (this.readOnly || this.storyEditor) return false
    const range = this.tocRange(this.view.state.doc)
    if (!range) return false
    const { tr, paragraphs } = this.tocParagraphs(this.view.state)
    // Regenerating entries replaces their text, while the last paragraph still owns the original end.
    const originalEnd = this.view.state.doc.resolve(range.to).nodeBefore!
    const last = paragraphs[paragraphs.length - 1]!
    paragraphs[paragraphs.length - 1] = last.type.create(splitParagraphAttrs(last.attrs, originalEnd.attrs)[1], last.content, last.marks)
    tr.replaceWith(tr.mapping.map(range.from), tr.mapping.map(range.to), paragraphs)
    this.view.dispatch(tr)
    return true
  }

  /** Top-level paragraphs from a TOC field's begin to its end. */
  private tocRange(doc: ProseMirrorNode): { from: number; to: number } | undefined {
    let from: number | undefined
    let to: number | undefined
    let depth = 0
    let inToc = false
    doc.forEach((node, offset) => {
      if (to !== undefined || node.type.name !== 'paragraph') return
      node.forEach((child) => {
        if (child.type.name === 'fieldChar') {
          if (child.attrs.charType === 'begin') depth++
          if (child.attrs.charType === 'end') {
            depth--
            if (inToc && depth === 0) to = offset + node.nodeSize
          }
        }
        if (child.type.name === 'fieldCode' && depth === 1 && !inToc && /^\s*TOC\b/.test(inlineFieldCode(child))) {
          inToc = true
          from = offset
        }
      })
    })
    return from !== undefined && to !== undefined ? { from, to } : undefined
  }

  private tocParagraphs(state: EditorState): { tr: Transaction; paragraphs: ProseMirrorNode[] } {
    const schema = state.schema
    const tr = state.tr
    const headings = documentOutline(state.doc, this.context, 3)
    // Headings get bookmarks the entries link to.
    const names = new Map<number, string>()
    for (const heading of [...headings].reverse()) {
      const node = state.doc.nodeAt(heading.pos)
      if (!node) continue
      let existing: string | undefined
      node.forEach((child) => {
        if (child.type.name === 'bookmark' && child.attrs.edge === 'start' && String(child.attrs.name).startsWith('_Toc')) existing = String(child.attrs.name)
      })
      if (existing) {
        names.set(heading.pos, existing)
        continue
      }
      const name = `_Toc${Math.floor(Math.random() * 1e9)}`
      const id = String(Math.floor(Math.random() * 1e8) + 1000)
      tr.insert(heading.pos + node.nodeSize - 1, schema.node('bookmark', { edge: 'end', id, v: packJml(['w:bookmarkEnd', { 'w:id': id }]) }))
      tr.insert(heading.pos + 1, schema.node('bookmark', { edge: 'start', id, name, v: packJml(['w:bookmarkStart', { 'w:id': id, 'w:name': name }]) }))
      names.set(heading.pos, name)
    }
    const width = Math.round(textAreaWidth(this.context.finalSectPr) * 20)
    const tabs = packJml(['w:tabs', {}, ['w:tab', { 'w:val': 'right', 'w:leader': 'dot', 'w:pos': String(width) }]])
    const fieldChar = (charType: string) => schema.node('fieldChar', { charType, v: packJml(['w:fldChar', { 'w:fldCharType': charType }]) })
    const begin = [fieldChar('begin'), schema.node('fieldCode', { v: packJml(['w:instrText', { 'xml:space': 'preserve' }, ' TOC \\o "1-3" \\h \\z \\u ']) }), fieldChar('separate')]
    const style = (level: number) => (this.context.styles.get(`TOC${level + 1}`) ? `TOC${level + 1}` : null)
    const paragraphs: ProseMirrorNode[] = headings.map((heading, index) => {
      const name = names.get(heading.pos)
      const link = schema.marks.link!.create({ v: packJml(['w:hyperlink', { 'w:anchor': name ?? '', 'w:history': '1' }, '\u0000']), href: null })
      const page = this.pageOf(heading.pos)
      const content: ProseMirrorNode[] = []
      if (index === 0) pushAll(content, begin)
      content.push(schema.text(heading.text, [link]), schema.node('tab', { v: packJml(['w:tab', {}]), marks: packMarks([link]) }))
      if (page !== undefined) content.push(schema.text(String(page), [link]))
      if (index === headings.length - 1) content.push(fieldChar('end'))
      return schema.node('paragraph', { pStyle: style(heading.level), tabs }, content)
    })
    if (!paragraphs.length) paragraphs.push(schema.node('paragraph', null, [...begin, schema.text('No table of contents entries found.'), fieldChar('end')]))
    return { tr, paragraphs }
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  setLayout(layout: DocxLayout): void {
    if (this.destroyed) return
    if (this.layoutMode === layout) return
    this.layoutMode = layout
    this.applyLayoutMode()
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, null).setMeta(decorationsKey, 'refresh'))
    this.scheduleLayout(true)
    this.emit('update')
  }

  setZoom(zoom: number): void {
    if (this.destroyed) return
    this.zoomLevel = Math.max(0.25, Math.min(4, zoom))
    this.canvas.style.zoom = String(this.zoomLevel)
    this.emit('update')
  }

  setReadOnly(readOnly: boolean): void {
    if (this.destroyed) return
    this.readOnlyValue = readOnly
    if (readOnly) this.modeValue = 'viewing'
    else if (this.modeValue === 'viewing') this.modeValue = 'editing'
    this.view.setProps({ editable: () => !this.readOnly })
    this.storyEditor?.view.setProps({ editable: () => !this.readOnly })
    if (readOnly) this.cancelFormatPainter()
    this.emit('update')
  }

  private applyLayoutMode(): void {
    const print = this.layoutMode === 'print'
    this.root.classList.toggle('docx-paginated', print)
    this.root.classList.toggle('docx-web', !print)
    this.canvas.style.zoom = String(this.zoomLevel)
    if (!print) {
      this.pagesLayer.replaceChildren()
      this.bandsLayer.replaceChildren()
      this.canvas.style.width = ''
      this.canvas.style.height = ''
      this.applyWebWidth()
      this.canvas.appendChild(this.notesHost)
    } else {
      this.notesHost.remove()
    }
  }

  /** Web layout's column is as wide as the final section's text, which page setup can change. */
  private applyWebWidth(): void {
    const width = textAreaWidth(this.context.finalSectPr) * PX_PER_PT
    this.flowHost.style.cssText = `width:${width}px;max-width:100%;box-sizing:content-box`
  }

  private renderStylesheet(): void {
    this.styleElement.textContent = DOCX_BASE_CSS + documentStylesheet(this.scope, this.context.styles, this.context.theme)
  }

  private scroller(): HTMLElement | null {
    for (let element = this.root.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element)
      if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element
    }
    return document.scrollingElement as HTMLElement | null
  }

  /** Lays pages out on the next frame (at most every 120 ms while typing). */
  scheduleLayout(immediate = false): void {
    if (this.destroyed || this.layoutFrame || this.layoutTimer) return
    const wait = immediate ? 0 : Math.max(0, 120 - (Date.now() - this.lastLayoutAt))
    const start = () => {
      this.layoutTimer = undefined
      this.layoutFrame = requestAnimationFrame(() => {
        this.layoutFrame = 0
        this.relayout()
      })
    }
    if (wait) this.layoutTimer = setTimeout(start, wait)
    else start()
  }

  /** Runs layout now (tests and hosts that need page numbers right away). */
  relayout(): void {
    if (this.destroyed) return
    this.lastLayoutAt = Date.now()
    if (this.layoutMode !== 'print') {
      this.view.dispatch(this.view.state.tr.setMeta(paginationKey, null).setMeta('addToHistory', false))
      const tabs = this.layoutTabs()
      this.view.dispatch(this.view.state.tr.setMeta(paginationKey, tabs).setMeta('addToHistory', false))
      this.renderWebNotes()
      this.placeStoryEditor()
      this.lastLayout = null
      this.emit('layout', null)
      return
    }
    const scroller = this.scroller()
    const scrollTop = scroller?.scrollTop
    const previousLabels = this.noteLabels()
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, null).setMeta(decorationsKey, 'refresh').setMeta('addToHistory', false))
    const { sections, sectionOfBlock } = documentSections(this.view.state.doc, this.context.finalSectPr)
    const widest = maxOf(sections.map((section) => sectionContentWidth(section.setup)))
    const maxLeft = maxOf(sections.map((section) => section.setup.left))
    const padding = 24
    const flowTop = padding + (sections[0]?.setup.top ?? 96)
    this.flowTop = flowTop
    const flowLeft = padding + maxLeft
    this.flowHost.style.cssText = `left:${flowLeft}px;top:${flowTop}px;width:${widest}px`
    this.measureNotes(sections)
    const tabs = this.layoutTabs()
    const storyHeight = this.storyHeights()
    const lastSetup = sections[sectionOfBlock.at(-1) ?? 0]!.setup
    const endnotesHeight = this.renderWebNotes(undefined, sectionContentWidth(lastSetup))
    this.endnotesHeight = endnotesHeight
    const result = paginate(this.view, this.context, (id) => this.noteHeights.get(id) ?? 0, (setup, index, all) => {
      // A header or footer taller than its margin pushes the text away, as in Word.
      const header = Math.max(0, maxOf((['default', 'first', 'even'] as const).map((type) => storyHeight(all, index, 'header', type))))
      const footer = Math.max(0, maxOf((['default', 'first', 'even'] as const).map((type) => storyHeight(all, index, 'footer', type))))
      return { ...setup, top: Math.max(setup.top, setup.header + header), bottom: Math.max(setup.bottom, setup.footer + footer) }
    }, endnotesHeight ? endnotesHeight + 16 : 0)
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, [...tabs, ...result.decorations]).setMeta('addToHistory', false))
    if (scroller && scrollTop !== undefined) scroller.scrollTop = scrollTop
    this.lastLayout = result.layout
    this.lastUnits = result.units
    this.lastSections = result.sections
    this.notePageDoc = this.view.state.doc
    this.notePageIndexes = new Map()
    const pageStarts = new Map(result.layout.breaks.map((entry) => [entry.unit, entry.page]))
    let pageIndex = 0
    for (const [index, unit] of result.units.entries()) {
      pageIndex = pageStarts.get(index) ?? pageIndex
      for (const key of unit.references ?? []) if (!this.notePageIndexes.has(key)) this.notePageIndexes.set(key, pageIndex)
    }
    this.refreshDecorations(this.view)
    if (this.storyEditor) this.refreshDecorations(this.storyEditor.view)
    // Page restarts can change marker wrapping; measure once more with the resolved labels.
    if (!this.measuringNotePages && [...this.noteLabels()].some(([key, label]) => previousLabels.get(key) !== label)) {
      this.measuringNotePages = true
      try { this.relayout() } finally { this.measuringNotePages = false }
      return
    }
    this.renderPages(result.layout, flowLeft, flowTop, padding)
    this.renderRepeatedHeaders(result.repeats, result.layout, flowLeft, flowTop)
    this.placeStoryEditor()
    this.emit('layout', result.layout)
    this.emit('update')
  }

  /** Sizes the column's tabs and keeps the sizes as decorations for later renders. */
  private layoutTabs(): Decoration[] {
    const view = this.view
    const sized = layoutTabs(view.dom as HTMLElement, (paragraph) => {
      try {
        const $pos = view.state.doc.resolve(view.posAtDOM(paragraph, 0))
        return $pos.parent.type.name === 'paragraph' ? paragraphTabs($pos.parent, this.context) : undefined
      } catch {
        return undefined
      }
    })
    const decorations: Decoration[] = []
    for (const [element, { width, leader }] of sized) {
      try {
        const pos = view.posAtDOM(element, 0)
        if (view.state.doc.nodeAt(pos)?.type.name !== 'tab') continue
        decorations.push(Decoration.node(pos, pos + 1, { style: `width:${width}px`, ...(leader ? { 'data-leader': leader } : {}) }))
      } catch {
        // A tab that left the document meanwhile.
      }
    }
    return decorations
  }

  /** Height of the header or footer a section shows on its default, first, or even pages. */
  private storyHeights(): (sections: Section[], index: number, kind: 'header' | 'footer', type: 'default' | 'first' | 'even') => number {
    const cache = new Map<string, number>()
    return (sections, index, kind, type) => {
      const page = { firstOfSection: type === 'first', number: type === 'even' ? 2 : 1 }
      if (type === 'first' && !sections[index]?.setup.titlePage) return 0
      if (type === 'even' && !this.context.evenAndOddHeaders) return 0
      const reference = storyReference(sections, index, kind, page, this.context.evenAndOddHeaders)
      const storyId = reference ? this.storyByRel(reference.relId) : undefined
      if (!storyId) return 0
      const setup = sections[index]!.setup
      const width = sectionContentWidth(setup)
      const cacheKey = `${storyId}:${width}`
      const known = cache.get(cacheKey)
      if (known !== undefined) return known
      const doc = this.storyDoc(storyId)
      let height = 0
      if (doc) {
        const measure = document.createElement('div')
        measure.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${width}px`
        measure.appendChild(renderStory(doc, { urls: this.urls, labels: this.labels, fields: { page: 1, pages: 1 }, context: this.context }))
        // This host is outside the zoomed canvas, so its height is already in layout pixels.
        this.root.appendChild(measure)
        height = measure.getBoundingClientRect().height
        measure.remove()
      }
      cache.set(cacheKey, height)
      return height
    }
  }

  private storyDoc(storyId: string): ProseMirrorNode | undefined {
    if (!this.options.doc.getMap('stories').has(storyId)) return undefined
    return fragmentToNode(this.options.doc.getXmlFragment(storyFragmentName(storyId)))
  }

  /** Header and footer stories by the main part's relationship id. */
  private storyByRel(relId: string): string | undefined {
    return storyByRelationship(this.options.doc, relId)
  }

  private noteLabels(body = this.view.state.doc): Map<string, string> {
    return resolveNoteLabels(body, this.context.noteDefaults, this.context.finalSectPr, body === this.notePageDoc ? this.notePageIndexes : undefined)
  }

  private measureNotes(sections: Section[]): void {
    const numbers = this.noteLabels()
    const measure = document.createElement('div')
    measure.style.cssText = 'position:absolute;visibility:hidden;left:-10000px;top:0'
    this.root.appendChild(measure)
    this.noteHeights = new Map()
    for (const [key, number] of numbers) {
      if (!key.startsWith('footnote:')) continue
      const doc = this.storyDoc(key)
      if (!doc) continue
      const setup = sections[noteInventory(this.view.state.doc).get(key)?.section ?? 0]!.setup
      measure.style.width = `${sectionContentWidth(setup)}px`
      const element = renderStory(doc, { urls: this.urls, labels: this.labels, noteNumber: number, noteNumbers: numbers, context: this.context })
      measure.appendChild(element)
      this.noteHeights.set(key, element.getBoundingClientRect().height)
    }
    measure.remove()
  }

  private renderPages(layout: LayoutResult, flowLeft: number, flowTop: number, padding: number): void {
    const pages = layout.pages
    const total = pages.length
    const sectionPages = new Map<number, number>()
    for (const page of pages) sectionPages.set(page.section, (sectionPages.get(page.section) ?? 0) + 1)
    const numbers = this.noteLabels()
    this.pagesLayer.replaceChildren()
    this.bandsLayer.replaceChildren()
    let bottom = 0
    let maxRight = 0
    for (const page of pages) {
      const { setup } = page
      const top = flowTop + page.contentTop - setup.top
      const left = flowLeft - setup.left
      bottom = top + setup.height
      maxRight = Math.max(maxRight, left + setup.width)
      const sheet = document.createElement('div')
      sheet.className = 'docx-page'
      sheet.style.cssText = `top:${top}px;left:${left}px;width:${setup.width}px;height:${setup.height}px`
      sheet.dataset.page = String(page.index + 1)
      this.pagesLayer.appendChild(sheet)
      // Bands over the margins keep anything that spills past the text area off the margins.
      const topBand = this.band(top, left, setup.width, setup.top)
      const bottomBand = this.band(top + setup.height - setup.bottom - page.notesHeight, left, setup.width, setup.bottom + page.notesHeight)
      const gap = document.createElement('div')
      gap.className = 'docx-band-gap'
      gap.style.cssText = `top:${top + setup.height}px;left:0;right:0;height:${PAGE_GAP}px`
      this.bandsLayer.append(topBand, bottomBand, gap)
      const fields = { page: page.number, pages: total, sectionPages: sectionPages.get(page.section), format: setup.numberFormat }
      for (const kind of ['header', 'footer'] as const) {
        const reference = storyReference(this.lastSections, page.section, kind, page, this.context.evenAndOddHeaders)
        const storyId = reference ? this.storyByRel(reference.relId) : undefined
        const doc = storyId ? this.storyDoc(storyId) : undefined
        if (!doc || !storyId) continue
        const element = renderStory(doc, { urls: this.urls, labels: this.labels, fields, noteNumbers: numbers, context: this.context })
        element.classList.add('docx-story')
        element.dataset.story = storyId
        element.title = `${kind === 'header' ? this.labels.header : this.labels.footer} · ${this.labels.editStoryHint}`
        element.style.left = `${setup.left}px`
        element.style.width = `${sectionContentWidth(setup)}px`
        if (kind === 'header') {
          element.style.top = `${setup.header}px`
          topBand.style.overflow = 'visible'
          topBand.appendChild(element)
        } else {
          element.style.bottom = `${setup.footer}px`
          bottomBand.appendChild(element)
        }
        element.addEventListener('dblclick', (event) => {
          event.preventDefault()
          this.openStoryEditor(storyId, element)
        })
      }
      if (page.notes.length) {
        const notes = document.createElement('div')
        notes.className = 'docx-footnotes docx-flow'
        notes.style.cssText = `left:${setup.left}px;width:${sectionContentWidth(setup)}px;top:0`
        for (const id of page.notes) {
          const doc = this.storyDoc(id)
          if (!doc) continue
          const element = renderStory(doc, { urls: this.urls, labels: this.labels, noteNumber: numbers.get(id), context: this.context })
          element.dataset.story = id
          element.classList.add('docx-note')
          element.addEventListener('dblclick', (event) => {
            event.preventDefault()
            this.openStoryEditor(id, element)
          })
          notes.appendChild(element)
        }
        bottomBand.appendChild(notes)
      }
    }
    for (const story of this.bandsLayer.querySelectorAll<HTMLElement>('.docx-story')) layoutStaticTabs(story)
    this.canvas.style.width = `${Math.max(maxRight + padding, flowLeft + padding)}px`
    this.canvas.style.height = `${bottom + padding}px`
    const lastSetup = pages.at(-1)!.setup
    this.renderWebNotes({ left: flowLeft, top: flowTop + layout.height - this.endnotesHeight, width: sectionContentWidth(lastSetup) })
  }

  /** Copies of header rows at the top of each page a table continues on, as Word repeats them. */
  private renderRepeatedHeaders(repeats: RepeatedHeader[], layout: LayoutResult, flowLeft: number, flowTop: number): void {
    const flowRect = this.view.dom.getBoundingClientRect()
    const scale = (this.view.dom as HTMLElement).offsetWidth ? flowRect.width / (this.view.dom as HTMLElement).offsetWidth : 1
    for (const repeat of repeats) {
      const table = this.view.nodeDOM(repeat.tablePos)
      const page = layout.pages[repeat.page]
      if (!(table instanceof HTMLTableElement) || !page) continue
      const copy = table.cloneNode(false) as HTMLTableElement
      const colgroup = table.querySelector(':scope > colgroup')
      if (colgroup) copy.appendChild(colgroup.cloneNode(true))
      const body = document.createElement('tbody')
      const rows = [...table.querySelectorAll(':scope > tbody > tr')].slice(0, repeat.rows)
      for (const row of rows) body.appendChild(row.cloneNode(true))
      copy.appendChild(body)
      copy.removeAttribute('contenteditable')
      const holder = document.createElement('div')
      holder.className = 'docx-flow docx-repeated-header'
      holder.setAttribute('aria-hidden', 'true')
      const left = (table.getBoundingClientRect().left - flowRect.left) / scale
      holder.style.cssText = `position:absolute;left:${flowLeft + left}px;top:${flowTop + page.contentTop}px;width:${table.offsetWidth}px;pointer-events:none`
      copy.style.margin = '0'
      copy.style.left = '0'
      holder.appendChild(copy)
      this.bandsLayer.appendChild(holder)
    }
  }

  private band(top: number, left: number, width: number, height: number): HTMLElement {
    const band = document.createElement('div')
    band.className = 'docx-band'
    band.style.cssText = `top:${top}px;left:${left}px;width:${width}px;height:${height}px`
    return band
  }

  /** Endnotes (and footnotes in web layout) after the text. */
  /** Draws endnotes (and footnotes in web layout) and returns their height. */
  private renderWebNotes(placement?: { left: number; top: number; width: number }, measureWidth?: number): number {
    const numbers = this.noteLabels()
    this.notesHost.replaceChildren()
    const kinds = this.layoutMode === 'print' ? ['endnote'] : ['footnote', 'endnote']
    let any = false
    for (const [key, number] of numbers) {
      if (!kinds.some((kind) => key.startsWith(`${kind}:`))) continue
      const doc = this.storyDoc(key)
      if (!doc) continue
      any = true
      const element = renderStory(doc, { urls: this.urls, labels: this.labels, noteNumber: number, context: this.context })
      element.dataset.story = key
      element.addEventListener('dblclick', (event) => {
        event.preventDefault()
        this.openStoryEditor(key, element)
      })
      this.notesHost.appendChild(element)
    }
    if (!any) {
      this.notesHost.remove()
      return 0
    }
    if (measureWidth !== undefined) {
      this.notesHost.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${measureWidth}px`
      this.root.appendChild(this.notesHost)
      const height = this.notesHost.getBoundingClientRect().height
      this.notesHost.remove()
      return height
    }
    if (this.layoutMode === 'print' && placement) {
      // Endnotes follow the text on its last page (they are not paginated themselves).
      this.notesHost.style.cssText = `position:absolute;left:${placement.left}px;top:${placement.top}px;width:${placement.width}px;z-index:3`
      this.bandsLayer.appendChild(this.notesHost)
      this.notesHost.style.pointerEvents = 'auto'
      layoutStaticTabs(this.notesHost)
    } else {
      this.notesHost.style.cssText = ''
      this.canvas.appendChild(this.notesHost)
    }
    return this.notesHost.offsetHeight
  }

  // ── Header, footer, and note editing ─────────────────────────────────────

  /** Edits a header, footer, or note in place; Escape or clicking elsewhere closes it. */
  openStoryEditor(storyId: string, over?: HTMLElement): boolean {
    if (this.readOnly) return false
    this.closeStoryEditor()
    const meta = parseJson<StoryMeta>(readDocxMap(this.options.doc, 'stories').get(storyId))
    if (!meta) return false
    const element = document.createElement('div')
    element.className = 'docx-story-editor'
    // Keep the live editor outside the page bands and notes host, which pagination rebuilds.
    // Moving its DOM during layout would interrupt focus and composition.
    this.canvas.appendChild(element)
    const dispatch = (view: EditorView, tr: Transaction) => this.dispatch(view, tr)
    const view = new EditorView({ mount: element }, {
      state: EditorState.create({ schema: docxSchema(), plugins: this.plugins(this.options.doc.getXmlFragment(storyFragmentName(storyId)), `cursor:${storyId}`, storyId) }),
      editable: () => !this.readOnly,
      nodeViews: this.nodeViews(),
      ...this.clipboardProps(storyId),
      attributes: { class: 'docx-flow', spellcheck: 'true', role: 'textbox', 'aria-label': meta.kind },
      dispatchTransaction: function (this: EditorView, tr: Transaction) { dispatch(this, tr) },
    })
    const close = (event: PointerEvent) => {
      // Toolbars, panels and dialogs outside this root still act on the open story.
      if (this.root.contains(event.target as Node) && !element.contains(event.target as Node)) this.closeStoryEditor()
    }
    const occurrence = over ? this.storyElements(storyId).indexOf(over) : 0
    this.storyEditor = { view, element, storyId, over, occurrence: Math.max(0, occurrence), stop: () => document.removeEventListener('pointerdown', close, true) }
    document.addEventListener('pointerdown', close, true)
    this.placeStoryEditor()
    view.focus()
    this.emit('update')
    return true
  }

  private storyElements(storyId: string): HTMLElement[] {
    return [...this.canvas.querySelectorAll<HTMLElement>('[data-story]')].filter((element) => element.dataset.story === storyId)
  }

  /** Anchor the live surface over the same occurrence after the static page content changes. */
  private placeStoryEditor(): void {
    if (!this.storyEditor) return
    const { element, storyId, occurrence } = this.storyEditor
    const candidates = this.storyElements(storyId)
    const over = candidates[Math.min(occurrence, candidates.length - 1)]
    if (this.storyEditor.over !== over && this.storyEditor.over) this.storyEditor.over.style.visibility = ''
    this.storyEditor.over = over
    if (!over) return
    const rect = over.getBoundingClientRect()
    const canvas = this.canvas.getBoundingClientRect()
    const scale = this.zoomLevel || 1
    element.style.cssText = `left:${(rect.left - canvas.left) / scale}px;top:${(rect.top - canvas.top) / scale}px;width:${rect.width / scale}px;min-height:${rect.height / scale}px`
    if (over.style.bottom) {
      element.style.top = ''
      element.style.bottom = `${this.canvas.offsetHeight - (rect.bottom - canvas.top) / scale}px`
    }
    over.style.visibility = 'hidden'
  }

  closeStoryEditor(): boolean {
    if (!this.storyEditor) return false
    const { view, element, over, stop } = this.storyEditor
    this.storyEditor = null
    stop()
    if (over) over.style.visibility = ''
    view.destroy()
    element.remove()
    this.scheduleLayout(true)
    this.view.focus()
    this.emit('update')
    return true
  }

  get editingStory(): string | null {
    return this.storyEditor?.storyId ?? null
  }

  /** Prints the pages (the browser's dialog also saves PDFs). */
  print(): void {
    if (this.printing) return
    this.printing = true
    const style = document.createElement('style')
    const first = this.lastSections[0]?.setup
    const width = first ? `${first.width / PX_PER_PT}pt` : '8.5in'
    const height = first ? `${first.height / PX_PER_PT}pt` : '11in'
    style.textContent = `@page{size:${width} ${height};margin:0}@media print{body *{visibility:hidden!important}.${this.scope},.${this.scope} *{visibility:visible!important}.${this.scope}{position:absolute;left:0;top:0}.${this.scope} .docx-canvas{zoom:1!important;margin:0!important}.${this.scope} .docx-band-gap,.${this.scope} .ProseMirror-yjs-cursor,.${this.scope} .docx-comment-range{background:none!important;border:none!important}.${this.scope} .docx-page{box-shadow:none!important}}`
    document.head.appendChild(style)
    const done = () => {
      style.remove()
      this.printing = false
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
  }

  /** The column's text (for tests and accessibility summaries). */
  text(): string {
    const parts: string[] = []
    this.view.state.doc.forEach((node) => { parts.push(inlineText(node)) })
    return parts.join('\n')
  }

  get hasFocus(): boolean {
    return this.activeView.hasFocus()
  }

  blur(): void {
    this.activeView.dom.blur()
  }

  focus(): void {
    this.activeView.focus()
  }

  destroy(): void {
    this.destroyed = true
    if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame)
    if (this.layoutTimer) clearTimeout(this.layoutTimer)
    this.closeStoryEditor()
    for (const stop of this.unsubscribe) stop()
    this.view.destroy()
    this.context.destroy()
    this.urls.destroy()
    this.root.remove()
    for (const set of Object.values(this.listeners)) set.clear()
  }
}

function inlineFieldCode(node: ProseMirrorNode): string {
  const element = unpackJml<JmlElement>(node.attrs.v as string)
  return element ? (element.slice(2) as unknown[]).filter((part): part is string => typeof part === 'string').join('') : ''
}

