import { baseKeymap } from '@tiptap/pm/commands'
import { dropCursor } from '@tiptap/pm/dropcursor'
import { gapCursor } from '@tiptap/pm/gapcursor'
import { keymap } from '@tiptap/pm/keymap'
import type { Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Transaction, type SelectionBookmark } from '@tiptap/pm/state'
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
import { copyRelatedParts, needsRelatedParts, receiveCopiedParts } from '../copy-relationships.js'
import { fontStack, isThemeFontVar, latinFont } from '../css.js'
import { DOCX_MAX_TABLE_DEPTH } from '../format.js'
import { newInlinePicture } from '../drawing.js'
import { jmlAttr, jmlChild, jmlNumber, jmlOn, packJml, unpackJml, type JmlElement } from '../jsonml.js'
import { BODY_FRAGMENT, fragmentToNode, parseJson, readDocxMap, storyFragmentName, writeFragment, type StoryMeta } from '../model.js'
import { effectiveNumPr, formatNumber } from '../numbering.js'
import { docxSchema, packMarks, textAreaWidth } from '../schema.js'
import { inlineText } from '../text.js'
import { AssetUrls } from './assets.js'
import { clipboardParser, clipboardSerializer, importCopiedNumbering, limitPastedTables, recallCopy, rememberCopy, sanitizePastedHtml, withoutForeignParts, withoutStoryReferences } from './clipboard.js'
import {
  changeIndent,
  clearFormatting,
  copyFormat,
  documentOutline,
  effectiveParagraphProperties,
  effectiveRunProperties,
  findMatches,
  freshId,
  insertInline,
  insertPageBreak,
  insertParagraphBreak,
  insertSectionBreak,
  insertSymbol,
  insertTable,
  listDefinition,
  listKind,
  paragraphStyleOptions,
  pasteFormat,
  replaceMatches,
  selectedParagraphs,
  setAlignment,
  setCellBorders,
  setCellShading,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineSpacing,
  setLink,
  setParagraphSpacing,
  setParagraphStyle,
  setTextColor,
  setUnderline,
  setVerticalAlign,
  splitParagraphAttrs,
  toggleList,
  toggleRunProperty,
  wordCount,
  type Alignment,
  type BorderPreset,
  type Command,
  type CopiedFormat,
  type EditResult,
  type FindOptions,
  type ListKind,
  type MapEdit,
  type OutlineEntry,
  type ToggleProperty,
} from './commands.js'
import { DocxViewContext } from './context.js'
import { computeDecorations, countNotes } from './decorations.js'
import { DEFAULT_DOCX_LABELS, type DocxLabels } from './labels.js'
import { PAGE_GAP, PX_PER_PT, type LayoutResult } from './layout.js'
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
import { listRevisions, resolveRevisions, revisionDate, trackTransaction, type Revision } from './track-changes.js'

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

/** Content that came in from outside: pasted, or dropped from another app. */
function pasted(tr: Transaction): boolean {
  const event = tr.getMeta('uiEvent')
  return event === 'paste' || event === 'drop'
}

/** The largest value, without spreading (a document can have a section per paragraph). */
function maxOf(values: number[]): number {
  let max = -Infinity
  for (const value of values) if (value > max) max = value
  return max
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
}

export type DocxRequest = 'link' | 'find' | 'replace' | 'comment' | 'image'

type Listener<T> = (value: T) => void

const decorationsKey = new PluginKey<{ set: DecorationSet; version: number }>('docx-decorations')
const paginationKey = new PluginKey<DecorationSet>('docx-pagination')
interface FindState { matches: { from: number; to: number }[]; current: number }
const findKey = new PluginKey<FindState>('docx-find')
const pendingPasteKey = new PluginKey<Map<object, SelectionBookmark>>('docx-pending-paste')

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
  private readonly listeners = { update: new Set<Listener<void>>(), layout: new Set<Listener<LayoutResult | null>>(), request: new Set<Listener<DocxRequest>>(), activeComment: new Set<Listener<string | null>>() }
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
  private lastSections: Section[] = []
  private layoutFrame = 0
  private layoutTimer: ReturnType<typeof setTimeout> | undefined
  private lastLayoutAt = 0
  private activeCommentId: string | null = null
  private copied: CopiedFormat | null = null
  private storyEditor: { view: EditorView; element: HTMLElement; storyId: string; over?: HTMLElement; occurrence: number; stop: () => void } | null = null
  private readonly unsubscribe: (() => void)[] = []
  private destroyed = false
  private noteHeights = new Map<string, number>()
  private printing = false
  private endnotesHeight = 0

  constructor(private readonly options: DocxEditorOptions) {
    this.labels = { ...DEFAULT_DOCX_LABELS, ...options.labels }
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
            // Numbering is shared, but its undo belongs to the fragment edited with it.
            manager.captureTransaction = (tr: Y.Transaction) => capture(tr) && scope instanceof Y.AbstractType && tr.changedParentTypes.has(scope)
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
      keymap(this.shortcuts()),
      keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) }),
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
          init: (): FindState => ({ matches: [], current: -1 }),
          apply: (tr, value) => {
            const meta = tr.getMeta(findKey) as { matches: { from: number; to: number }[]; current: number } | undefined
            if (meta) return meta
            if (!tr.docChanged || !value.matches.length) return value
            return { matches: value.matches.map((match) => ({ from: tr.mapping.map(match.from), to: tr.mapping.map(match.to) })).filter((match) => match.from < match.to), current: value.current }
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
    const numbers = countNotes(body)
    const set = computeDecorations(doc, {
      context: this.context,
      noteNumbers: numbers,
      noteNumber: storyId ? numbers.get(storyId) : undefined,
      activeComment: this.activeCommentId,
    })
    if (storyId !== undefined || this.layoutMode !== 'print') return set
    // Sections narrower than the widest are inset on the right.
    const { sections, sectionOfBlock } = documentSections(doc, this.context.finalSectPr)
    const widths = sections.map((section) => section.setup.width - section.setup.left - section.setup.right)
    const widest = maxOf(widths)
    if (widths.every((width) => Math.abs(width - widest) < 1)) return set
    const extra: Decoration[] = []
    let index = 0
    doc.forEach((node, offset) => {
      const inset = widest - (widths[sectionOfBlock[index++] ?? 0] ?? widest)
      if (inset > 1 && node.type.name !== 'table') extra.push(Decoration.node(offset, offset + node.nodeSize, { style: `--docx-sec-inset:${inset}px` }))
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
      'Mod-e': run(setAlignment('center')),
      'Mod-l': run(setAlignment('left')),
      'Mod-r': run(setAlignment('right')),
      'Mod-j': run(setAlignment('both')),
      'Mod-Shift-7': () => this.toggleList('decimal'),
      'Mod-Shift-8': () => this.toggleList('bullet'),
      'Mod-Shift-l': () => this.toggleList('bullet'),
      'Mod-]': () => this.stepFontSize(1),
      'Mod-[': () => this.stepFontSize(-1),
      'Mod-Shift-.': () => this.stepFontSize(1),
      'Mod-Shift-,': () => this.stepFontSize(-1),
      'Mod-Enter': run(insertPageBreak),
      'Mod-Alt-1': run(setParagraphStyle('Heading1')),
      'Mod-Alt-2': run(setParagraphStyle('Heading2')),
      'Mod-Alt-3': run(setParagraphStyle('Heading3')),
      'Mod-Alt-0': () => this.setStyle(this.context.styles.defaultStyle('paragraph')?.id ?? null),
      'Mod-Shift-n': () => this.setStyle(this.context.styles.defaultStyle('paragraph')?.id ?? null),
      'Mod-=': run(setVerticalAlign('subscript')),
      'Mod-Shift-=': run(setVerticalAlign('superscript')),
      'Mod-.': run(setVerticalAlign('superscript')),
      'Mod-,': run(setVerticalAlign('subscript')),
      'Mod-\\': run(clearFormatting),
      'Mod-Space': run(clearFormatting),
      'Mod-k': () => this.request('link'),
      'Mod-f': () => this.request('find'),
      'Mod-h': () => this.request('replace'),
      'Mod-Alt-m': () => this.request('comment'),
      'Mod-Alt-f': () => this.insertNote('footnote') !== null,
      'Mod-Alt-d': () => this.insertNote('endnote') !== null,
      Tab: () => this.listIndent(1),
      'Shift-Tab': () => this.listIndent(-1),
      Enter: () => this.enter(),
      Backspace: () => this.backspaceInList(),
      Escape: () => this.closeStoryEditor(),
    }
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
          const copy = recallCopy(event.clipboardData?.getData('text/html'), view.state.schema)
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

  private listIndent(direction: 1 | -1): boolean {
    const state = (this.activeView).state
    if (isInTable(state)) return false
    const paragraph = selectedParagraphs(state)[0]
    if (!paragraph) return false
    const inList = effectiveNumPr(jml(paragraph.node.attrs.numPr), paragraph.node.attrs.pStyle as string | null, this.context.styles)
    if (!inList) return direction > 0 && this.run((current) => insertInline(current, current.schema.node('tab', { v: packJml(['w:tab', {}]) })))
    return this.run(changeIndent(direction))
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
      formatPainter: this.copied !== null,
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
  on(event: keyof DocxEditor['listeners'], listener: Listener<never>): () => void {
    const set = this.listeners[event] as Set<Listener<never>>
    set.add(listener)
    return () => set.delete(listener)
  }

  private emit(event: 'update'): void
  private emit(event: 'layout', value: LayoutResult | null): void
  private emit(event: 'request', value: DocxRequest): void
  private emit(event: 'activeComment', value: string | null): void
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
    const done = undo(view.state)
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

  setLineSpacing(multiple: number): boolean {
    return this.run(setLineSpacing({ multiple }))
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

  /** Format painter: the first call copies the selection's format, the next applies it. */
  formatPainter(): boolean {
    const view = this.activeView
    if (!this.copied) {
      this.copied = copyFormat(view.state)
      this.emit('update')
      return true
    }
    const format = this.copied
    this.copied = null
    const applied = this.run(pasteFormat(format))
    this.emit('update')
    return applied
  }

  cancelFormatPainter(): void {
    this.copied = null
    this.emit('update')
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

  /** Inserts a picture from a file at the cursor, sized to fit the text width. */
  async insertImage(file: Blob, description = ''): Promise<boolean> {
    if (this.readOnly) return false
    const target = this.activeView
    const bytes = new Uint8Array(await file.arrayBuffer())
    // Formats Word shows as plain pictures (SVG would need a PNG fallback beside it).
    const mimeType = insertablePicture(bytes)
    if (!mimeType) return false
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
    const maxWidth = textAreaWidth(this.context.finalSectPr)
    if (width > maxWidth) {
      height = (height * maxWidth) / width
      width = maxWidth
    }
    if (this.destroyed || this.readOnly || target.isDestroyed) return false
    const view = target
    const node = view.state.schema.node('drawing', { v: packJml(newInlinePicture(width, height, description || 'Picture', description)), src: ref.hash })
    view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView())
    view.focus()
    return true
  }

  insertNote(kind: 'footnote' | 'endnote', text = ''): string | null {
    if (this.readOnly || this.storyEditor) return null
    const result = addNote(this.view.state, this.context, kind, text)
    this.applyStoryEdits(result)
    return result.id
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
      if (!meta || meta.kind === 'comment') continue
      revisions.push(...listRevisions(fragmentToNode(this.options.doc.getXmlFragment(storyFragmentName(id))), id))
    }
    return revisions
  }

  resolveRevisions(revisions: Revision[], action: 'accept' | 'reject'): boolean {
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
      const tr = resolveRevisions(state, group, action)
      if (!tr) continue
      if (view) view.dispatch(tr.setMeta('docx-untracked', true))
      else this.options.doc.transact(() => writeFragment(this.options.doc, this.options.doc.getXmlFragment(storyFragmentName(storyId!)), tr.doc))
      changed = true
    }
    if (changed) this.emit('update')
    return changed
  }

  acceptAll(): boolean {
    return this.resolveRevisions(this.revisions(), 'accept')
  }

  rejectAll(): boolean {
    return this.resolveRevisions(this.revisions(), 'reject')
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
    this.activeView.dispatch(this.activeView.state.tr.setMeta(findKey, { matches, current }))
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
    this.separateUndo(this.activeView)
    this.activeView.dispatch(replaceMatches(this.activeView.state, [match], replacement))
    this.separateUndo(this.activeView)
    this.find(query, options)
    return true
  }

  replaceAll(replacement: string, query: string, options: FindOptions = {}): number {
    if (this.readOnly) return 0
    const matches = findMatches(this.activeView.state.doc, query, options)
    if (!matches.length) return 0
    this.separateUndo(this.activeView)
    this.activeView.dispatch(replaceMatches(this.activeView.state, matches, replacement))
    this.separateUndo(this.activeView)
    this.clearFind()
    return matches.length
  }

  clearFind(): void {
    this.activeView.dispatch(this.activeView.state.tr.setMeta(findKey, { matches: [], current: -1 }))
  }

  wordCount() {
    return wordCount(this.activeView.state.doc)
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
    this.view.dispatch(tr)
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
      if (index === 0) content.push(...begin)
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
      const width = textAreaWidth(this.context.finalSectPr) * PX_PER_PT
      this.flowHost.style.cssText = `width:${width}px;max-width:100%;box-sizing:content-box`
      this.canvas.appendChild(this.notesHost)
    } else {
      this.notesHost.remove()
    }
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
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, null).setMeta('addToHistory', false))
    const sections = documentSections(this.view.state.doc, this.context.finalSectPr).sections
    const widest = maxOf(sections.map((section) => section.setup.width - section.setup.left - section.setup.right))
    const maxLeft = maxOf(sections.map((section) => section.setup.left))
    const padding = 24
    const flowTop = padding + (sections[0]?.setup.top ?? 96)
    const flowLeft = padding + maxLeft
    this.flowHost.style.cssText = `left:${flowLeft}px;top:${flowTop}px;width:${widest}px`
    this.measureNotes(widest)
    const tabs = this.layoutTabs()
    const storyHeight = this.storyHeights(widest)
    const endnotesHeight = this.renderWebNotes(undefined, widest)
    this.endnotesHeight = endnotesHeight
    const result = paginate(this.view, this.context, (id) => this.noteHeights.get(id) ?? 0, (setup, index, all) => {
      // A header or footer taller than its margin pushes the text away, as in Word.
      const header = Math.max(0, ...(['default', 'first', 'even'] as const).map((type) => storyHeight(all, index, 'header', type)))
      const footer = Math.max(0, ...(['default', 'first', 'even'] as const).map((type) => storyHeight(all, index, 'footer', type)))
      return { ...setup, top: Math.max(setup.top, setup.header + header), bottom: Math.max(setup.bottom, setup.footer + footer) }
    }, endnotesHeight ? endnotesHeight + 16 : 0)
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, [...tabs, ...result.decorations]).setMeta('addToHistory', false))
    if (scroller && scrollTop !== undefined) scroller.scrollTop = scrollTop
    this.lastLayout = result.layout
    this.lastUnits = result.units
    this.lastSections = result.sections
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
  private storyHeights(width: number): (sections: Section[], index: number, kind: 'header' | 'footer', type: 'default' | 'first' | 'even') => number {
    const cache = new Map<string, number>()
    return (sections, index, kind, type) => {
      const page = { firstOfSection: type === 'first', number: type === 'even' ? 2 : 1 }
      if (type === 'first' && !sections[index]?.setup.titlePage) return 0
      if (type === 'even' && !this.context.evenAndOddHeaders) return 0
      const reference = storyReference(sections, index, kind, page, this.context.evenAndOddHeaders)
      const storyId = reference ? this.storyByRel(reference.relId) : undefined
      if (!storyId) return 0
      const known = cache.get(storyId)
      if (known !== undefined) return known
      const doc = this.storyDoc(storyId)
      let height = 0
      if (doc) {
        const measure = document.createElement('div')
        measure.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${width}px`
        measure.appendChild(renderStory(doc, { urls: this.urls, labels: this.labels, fields: { page: 1, pages: 1 }, context: this.context }))
        this.root.appendChild(measure)
        height = measure.getBoundingClientRect().height / (this.zoomLevel || 1)
        measure.remove()
      }
      cache.set(storyId, height)
      return height
    }
  }

  private storyDoc(storyId: string): ProseMirrorNode | undefined {
    if (!this.options.doc.getMap('stories').has(storyId)) return undefined
    return fragmentToNode(this.options.doc.getXmlFragment(storyFragmentName(storyId)))
  }

  /** Header and footer stories by the main part's relationship id. */
  private storyByRel(relId: string): string | undefined {
    const rel = parseJson<{ type: string; target: string }>(readDocxMap(this.options.doc, 'rels').get(relId))
    if (!rel) return undefined
    const main = this.options.doc.getMap<string>('docx').get('mainPart') ?? 'word/document.xml'
    const folder = main.slice(0, main.lastIndexOf('/') + 1)
    const part = rel.target.startsWith('/') ? rel.target.slice(1) : folder + rel.target
    const kind = rel.type.endsWith('/header') ? 'header' : 'footer'
    return `${kind}:${part.replace(/\/\.\//g, '/')}`
  }

  private measureNotes(width: number): void {
    const numbers = countNotes(this.view.state.doc)
    const measure = document.createElement('div')
    measure.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${width}px`
    this.root.appendChild(measure)
    this.noteHeights = new Map()
    for (const [key, number] of numbers) {
      if (!key.startsWith('footnote:')) continue
      const doc = this.storyDoc(key)
      if (!doc) continue
      const element = renderStory(doc, { urls: this.urls, labels: this.labels, noteNumber: number, noteNumbers: numbers, context: this.context })
      measure.appendChild(element)
      this.noteHeights.set(key, element.getBoundingClientRect().height / (this.zoomLevel || 1))
    }
    measure.remove()
  }

  private renderPages(layout: LayoutResult, flowLeft: number, flowTop: number, padding: number): void {
    const pages = layout.pages
    const total = pages.length
    const numbers = countNotes(this.view.state.doc)
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
      const fields = { page: page.number, pages: total, format: setup.numberFormat }
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
        element.style.width = `${setup.width - setup.left - setup.right}px`
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
        notes.style.cssText = `left:${setup.left}px;width:${setup.width - setup.left - setup.right}px;top:0`
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
    this.renderWebNotes({ left: flowLeft, top: flowTop + layout.height - this.endnotesHeight, width: this.flowHost.offsetWidth })
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
    const numbers = countNotes(this.view.state.doc)
    this.notesHost.replaceChildren()
    const kinds = this.layoutMode === 'print' ? ['endnote'] : ['footnote', 'endnote']
    let any = false
    for (const [key, number] of numbers) {
      if (!kinds.some((kind) => key.startsWith(`${kind}:`))) continue
      const doc = this.storyDoc(key)
      if (!doc) continue
      any = true
      const format = key.startsWith('endnote') ? (jmlAttr(jmlChild(jmlChild(this.context.finalSectPr, 'w:endnotePr'), 'w:numFmt'), 'w:val') ?? 'lowerRoman') : 'decimal'
      const element = renderStory(doc, { urls: this.urls, labels: this.labels, noteNumber: formatNumber(number, format), context: this.context })
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
      const height = this.notesHost.getBoundingClientRect().height / (this.zoomLevel || 1)
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

