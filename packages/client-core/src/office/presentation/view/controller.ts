import { minOf } from '../../../collections.js'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import { copyContent, pasteShapes, pasteSlides, parseClipboard, type PresentationClipboard } from '../clipboard.js'
import { findMatches, replaceAll, replaceMatch, type FindMatch, type FindOptions } from '../find.js'
import { slideSections } from '../sections.js'
import * as commands from '../commands.js'
import {
  BASELINE,
  bodyEdits,
  CLEARABLE_MARKS,
  clearMarksAll,
  clearMarksCommand,
  editAllParagraphs,
  editBodyProperties,
  editLineProperties,
  highlightXml,
  insertFieldCommand,
  linkAll,
  linkAt,
  linkIn,
  lineEdits,
  markAll,
  markValueAt,
  markValueIn,
  paragraphAt,
  paragraphCommand,
  paragraphEdits,
  setLinkCommand,
  setMarkCommand,
  stepFontSizeCommand,
  stepFontSizesAll,
  type Arrowhead,
  type BodyEdit,
  type LineEdit,
  type MarkValue,
  type ParagraphEdit,
  type RunMark,
} from '../formatting.js'
import type { PartSnapshot, ShapeSnapshot, SlideSnapshot, Xfrm } from '../model.js'
import { DeckResources, type Theme } from '../render/deck.js'
import { mergeBag, resolveLevel } from '../render/props.js'
import { assetObjectUrl, DEFAULT_RENDER_LABELS, displayableMediaType, EMU_PER_PX, type RenderLabels } from '../render/env.js'
import { renderSlide, slideShapeText, slideShapeXfrm, type SlideRenderOptions } from '../render/slide.js'
import { computedFieldText, resolveTypeface } from '../render/text.js'
import { textToPlain } from '../text.js'
import { orderedKeys, presentationRoot, readPart, readParts, readSlideMap } from '../ydoc.js'
import { NS } from '../xml.js'
import { readClipboardContents, writeClipboard } from './clipboard-io.js'
import { imageSize } from './images.js'
import type { InlineTextEditor } from './text-editor.js'

/**
 * The state every presentation view shares: the model (read through per-slide caches), the
 * selection, per-user undo, presence, image URLs, and the command API toolbars call. Views
 * (canvas, thumbnails, notes, present mode) subscribe to it and redraw what changed.
 */

/** Origin of this user's edits: tracked by undo, and how other views tell local from remote. */
export const LOCAL_ORIGIN = { source: 'pulpo-presentation-view' }

export interface PresentationLabels extends RenderLabels {
  notesPlaceholder: string
  /** "Slide {n}" for thumbnails' accessible names. */
  slideNumber: string
  hiddenSlide: string
  nextSlide: string
  notes: string
  noNotes: string
  endOfShow: string
  elapsed: string
  shapeNames: { rectangle: string; textBox: string; picture: string; table: string; group: string; shape: string }
}

export const DEFAULT_PRESENTATION_LABELS: PresentationLabels = {
  ...DEFAULT_RENDER_LABELS,
  notesPlaceholder: 'Click to add speaker notes',
  slideNumber: 'Slide {n}',
  hiddenSlide: 'Hidden',
  nextSlide: 'Next slide',
  notes: 'Notes',
  noNotes: 'No notes',
  endOfShow: 'End of slide show. Click to exit.',
  elapsed: 'Elapsed time',
  shapeNames: { rectangle: 'Rectangle', textBox: 'TextBox', picture: 'Picture', table: 'Table', group: 'Group', shape: 'Shape' },
}

/** Where `revealMatch` selects text once the editor for it is open. */
type PendingReveal = { paragraph: number; from: number; to: number; focus: boolean } & ({ notes: true; slide: string } | { target: EditingTarget })

/** UI a host draws for the view core: the find bar (`find`, `replace`) and the link box (`link`). */
export type PresentationRequest = 'find' | 'replace' | 'link'

export interface PresentationUser {
  name: string
  color: string
}

export interface PresentationViewOptions {
  doc: Y.Doc
  awareness?: Awareness
  readOnly: boolean
  assets: LiveAssetStore
  user: PresentationUser
  labels?: Partial<PresentationLabels>
}

export interface EditingTarget {
  slide: string
  shape: string
  /** Table cell, when editing inside a table. */
  row?: string
  column?: string
}

export interface ViewState {
  slide?: string
  /** Selected shapes on the current slide. */
  shapes: string[]
  /** Selected slides in the thumbnail strip (at least the current one). */
  slides: string[]
  editing?: EditingTarget
}

export interface ChangeSet {
  /** Slides whose content changed. */
  slides: Set<string>
  order: boolean
  parts: boolean
  selection: boolean
  assets: boolean
  presence: boolean
  /** Whether a local edit caused it. */
  local: boolean
}

export interface RemoteSelection {
  clientId: number
  name: string
  color: string
  slide?: string
  shapes: string[]
  editing?: string
}

export interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** Points, explicit or inherited. */
  fontSize?: number
  /** The font set on the text itself, as written (theme fonts as `+mj-lt`, `+mn-lt`). */
  fontFamily?: string
  /** The font the text is drawn in: its own or the inherited one, with theme fonts resolved. */
  resolvedFontFamily?: string
  /** Paragraph alignment, explicit or inherited (`l`, `ctr`, `r`, `just`, …). */
  align?: string
  bullets: 'none' | 'char' | 'number'
  baseline: 'sup' | 'sub' | 'none'
  /** The text's `a:highlight` XML, when it has one. */
  highlight?: string
  /** The link target of the selected text, when it is one link. */
  link?: string
  canFormatText: boolean
  /** Formatting goes to the speaker notes. */
  notes: boolean
  /** Text box properties of the shape whose text is formatted (not for notes or table cells); insets in EMU. */
  textBox?: { anchor: 't' | 'ctr' | 'b'; autofit: 'none' | 'norm' | 'shape'; wrap: boolean; insets: { l: number; t: number; r: number; b: number } }
}

/**
 * A link as typed into a link box: http(s) and mailto URLs as they are, bare addresses and
 * domains completed (`example.com` → `https://example.com`). Other schemes are refused.
 */
export function normalizeLink(input: string): string | undefined {
  const value = input.trim()
  if (!value || /\s/.test(value)) return undefined
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value
  if (/^[^@/:]+@[^@/:]+\.[^@/:]+$/.test(value)) return `mailto:${value}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined
  if (/^([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d+)?([/?#].*)?$/u.test(value)) return `https://${value}`
  return undefined
}

/** A typeface as drawn: theme font references resolved. */
function themeFont(typeface: string, theme: Theme): string {
  if (typeface === '+mj-lt') return theme.major.latin
  if (typeface === '+mn-lt') return theme.minor.latin
  if (typeface === '+mj-ea') return theme.major.ea || theme.major.latin
  if (typeface === '+mn-ea') return theme.minor.ea || theme.minor.latin
  return typeface
}

/** A table the table commands can act on, and the cell being edited in it. */
export interface TableSelection {
  slide: string
  shape: string
  rows: number
  columns: number
  /** Absent when the whole table is selected rather than a cell being edited. */
  cell?: { row: string; column: string; rowIndex: number; columnIndex: number; rowSpan: number; columnSpan: number }
}

const emptyChange = (): ChangeSet => ({ slides: new Set(), order: false, parts: false, selection: false, assets: false, presence: false, local: false })

export class PresentationController {
  readonly doc: Y.Doc
  readonly awareness?: Awareness
  readonly assets: LiveAssetStore
  readOnly: boolean
  readonly user: PresentationUser
  readonly labels: PresentationLabels
  readonly undoManager: Y.UndoManager
  state: ViewState = { shapes: [], slides: [] }
  activeEditor?: InlineTextEditor
  private readonly listeners = new Set<(change: ChangeSet) => void>()
  private readonly slideCache = new Map<string, { version: number; snapshot: SlideSnapshot }>()
  private readonly versions = new Map<string, number>()
  private readonly htmlCache = new Map<string, { key: string; html: string }>()
  private readonly urls = new Map<string, string | null>()
  private orderCache?: string[]
  private deckCache?: DeckResources
  private globalVersion = 0
  private assetVersion = 0
  private pending = emptyChange()
  private scheduled = false
  private destroyed = false

  constructor(options: PresentationViewOptions) {
    this.doc = options.doc
    this.awareness = options.awareness
    this.assets = options.assets
    this.readOnly = options.readOnly
    this.user = options.user
    this.labels = { ...DEFAULT_PRESENTATION_LABELS, ...options.labels, shapeNames: { ...DEFAULT_PRESENTATION_LABELS.shapeNames, ...options.labels?.shapeNames } }
    this.undoManager = new Y.UndoManager(presentationRoot(this.doc), { trackedOrigins: new Set([LOCAL_ORIGIN, ySyncPluginKey]), captureTimeout: 400 })
    presentationRoot(this.doc).observeDeep(this.onModelChange)
    this.awareness?.on('change', this.onAwarenessChange)
    this.awareness?.setLocalStateField('user', { name: options.user.name, color: options.user.color })
    const first = this.slideKeys()[0]
    if (first) this.state = { slide: first, shapes: [], slides: [first] }
    this.publishPresence()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.readOnly = true
    presentationRoot(this.doc).unobserveDeep(this.onModelChange)
    this.awareness?.off('change', this.onAwarenessChange)
    this.awareness?.setLocalStateField('presentation', null)
    this.undoManager.destroy()
    for (const url of this.urls.values()) if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    this.listeners.clear()
    this.requestListeners.clear()
  }

  subscribe(listener: (change: ChangeSet) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private readonly requestListeners = new Set<(request: PresentationRequest) => void>()

  /**
   * Listens for what the views ask the host to show: Mod+F (`find`), Ctrl+H or Cmd+Shift+H
   * (`replace`), Mod+K on text (`link`, prefill it from `formatState().link`). While nothing
   * listens, those keys keep their browser meaning.
   */
  onRequest(listener: (request: PresentationRequest) => void): () => void {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  /** Asks the host for its UI; false when no host listens. */
  request(request: PresentationRequest): boolean {
    if (this.destroyed || !this.requestListeners.size) return false
    for (const listener of this.requestListeners) listener(request)
    return true
  }

  private emit(change: Partial<ChangeSet>): void {
    const pending = this.pending
    for (const slide of change.slides ?? []) pending.slides.add(slide)
    pending.order ||= change.order ?? false
    pending.parts ||= change.parts ?? false
    pending.selection ||= change.selection ?? false
    pending.assets ||= change.assets ?? false
    pending.presence ||= change.presence ?? false
    pending.local ||= change.local ?? false
    if (this.scheduled) return
    this.scheduled = true
    // Batch bursts (a drag writes every frame; a sync can carry many updates) into one redraw.
    queueMicrotask(() => {
      this.scheduled = false
      if (this.destroyed) return
      const flushed = this.pending
      this.pending = emptyChange()
      for (const listener of this.listeners) listener(flushed)
    })
  }

  private readonly onModelChange = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction): void => {
    const change: Partial<ChangeSet> = { slides: new Set(), local: transaction.origin === LOCAL_ORIGIN || transaction.origin === ySyncPluginKey }
    for (const event of events) {
      const path = event.path
      if (path.length === 0) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) {
          if (key === 'parts' || key === 'partBytes' || key === 'slides') change.parts = true
          if (key === 'slideOrder' || key === 'slides' || key === 'sectionOrder' || key === 'sections') change.order = true
        }
        continue
      }
      if (path[0] === 'parts' || path[0] === 'partBytes') change.parts = true
      else if (path[0] === 'slideOrder' || path[0] === 'sectionOrder' || path[0] === 'sections') change.order = true
      else if (path[0] === 'slides') {
        if (path.length === 1) {
          for (const key of (event as Y.YMapEvent<unknown>).keysChanged) change.slides!.add(key)
          change.order = true
        } else change.slides!.add(String(path[1]))
      }
    }
    if (change.parts) {
      this.deckCache = undefined
      this.globalVersion++
    }
    if (change.order) this.orderCache = undefined
    for (const slide of change.slides!) this.versions.set(slide, (this.versions.get(slide) ?? 0) + 1)
    this.repairState()
    this.emit(change)
  }

  private readonly onAwarenessChange = (): void => this.emit({ presence: true })

  /** Keeps the selection pointing at things that exist after remote deletes. */
  private repairState(): void {
    const keys = this.slideKeys()
    const { slide } = this.state
    if (!slide || !keys.includes(slide)) {
      const index = slide ? Math.min(this.lastIndex, keys.length - 1) : 0
      this.state = { slide: keys[Math.max(0, index)], shapes: [], slides: keys[Math.max(0, index)] ? [keys[Math.max(0, index)]!] : [] }
      this.emit({ selection: true })
      return
    }
    const shapes = this.state.shapes.filter((key) => commands.shapeMap(this.doc, slide, key))
    // An editor on text someone else deleted would swallow every keystroke: close it.
    const editing = this.state.editing
    const editingGone = editing && (editing.row && editing.column ? !commands.cellFragment(this.doc, editing.slide, editing.shape, editing.row, editing.column) : !commands.shapeMap(this.doc, editing.slide, editing.shape))
    if (editingGone) this.setState({ shapes, editing: undefined })
    else if (shapes.length !== this.state.shapes.length) this.setState({ shapes })
  }

  private lastIndex = 0

  // -------------------------------------------------------------------------------------------
  // Reading the model

  slideKeys(): string[] {
    this.orderCache ??= orderedKeys(presentationRoot(this.doc).get('slideOrder') as Y.Array<string>, presentationRoot(this.doc).get('slides') as Y.Map<unknown>)
    return this.orderCache
  }

  slide(key: string): SlideSnapshot | undefined {
    const version = this.versions.get(key) ?? 0
    const cached = this.slideCache.get(key)
    if (cached && cached.version === version) return cached.snapshot
    const map = commands.slideMap(this.doc, key)
    if (!map) return undefined
    const snapshot = readSlideMap(key, map)
    this.slideCache.set(key, { version, snapshot })
    return snapshot
  }

  /** A number that changes whenever how `key` looks may have changed. */
  slideVersion(key: string): string {
    return `${this.globalVersion}.${this.versions.get(key) ?? 0}.${this.assetVersion}.${this.slideKeys().indexOf(key)}`
  }

  parts(): Record<string, PartSnapshot> {
    return readParts(presentationRoot(this.doc))
  }

  deck(): DeckResources {
    this.deckCache ??= new DeckResources(this.parts(), (presentationRoot(this.doc).get('mainPart') as string) ?? 'ppt/presentation.xml')
    return this.deckCache
  }

  /** Slide size in px at 100% zoom. */
  size(): { width: number; height: number } {
    const root = presentationRoot(this.doc)
    return { width: ((root.get('slideWidth') as number) ?? 12_192_000) / EMU_PER_PX, height: ((root.get('slideHeight') as number) ?? 6_858_000) / EMU_PER_PX }
  }

  sections(): { key: string; name: string; firstSlide?: string }[] {
    const root = presentationRoot(this.doc)
    const sections = root.get('sections') as Y.Map<{ name: string; id: string }> | undefined
    const keys = orderedKeys(root.get('sectionOrder') as Y.Array<string>, sections)
    const slides = this.slideKeys()
    const assigned = slideSections(keys, slides.map((slide) => ({ section: this.slide(slide)?.section })))
    return keys.map((key) => ({ key, name: sections!.get(key)!.name, firstSlide: slides[assigned.indexOf(key)] }))
  }

  renderOptions(mode: 'edit' | 'view', idPrefix: string, slideKey: string, hideTextOf?: ReadonlySet<string>): SlideRenderOptions {
    return {
      deck: this.deck(),
      slideNumber: this.slideKeys().indexOf(slideKey) + 1,
      mode,
      labels: this.labels,
      assetUrl: (part) => this.assetUrl(part),
      idPrefix,
      ...(hideTextOf ? { hideTextOf } : {}),
    }
  }

  /** A slide as HTML, cached until the slide, the deck, or a loaded image changes. */
  slideHtml(key: string, mode: 'edit' | 'view', idPrefix: string, hideTextOf?: ReadonlySet<string>): string {
    const slide = this.slide(key)
    if (!slide) return ''
    const cacheKey = `${this.slideVersion(key)}|${[...(hideTextOf ?? [])].join(',')}`
    const cacheName = `${mode}:${idPrefix}:${key}`
    const cached = this.htmlCache.get(cacheName)
    if (cached?.key === cacheKey) return cached.html
    const root = presentationRoot(this.doc)
    const html = renderSlide(slide, { slideWidth: root.get('slideWidth') as number, slideHeight: root.get('slideHeight') as number }, this.renderOptions(mode, idPrefix, key, hideTextOf))
    this.htmlCache.set(cacheName, { key: cacheKey, html })
    return html
  }

  /** Loads every image the given slides render, including inherited and nested content. */
  async loadSlideAssets(keys: readonly string[]): Promise<string[]> {
    const paths = new Set<string>()
    const root = presentationRoot(this.doc)
    for (const key of keys) {
      const slide = this.slide(key)
      if (!slide) continue
      // Use the renderer to include inherited backgrounds, picture fills and SmartArt images.
      renderSlide(slide, { slideWidth: root.get('slideWidth') as number, slideHeight: root.get('slideHeight') as number }, {
        ...this.renderOptions('view', 'preload', key),
        assetUrl: (path) => { paths.add(path); return undefined },
      })
    }
    return Promise.all([...paths].map(async (path) => {
      // Printing can be retried after a transient download failure.
      if (this.urls.get(path) === null && !this.loadingUrls.has(path)) this.urls.delete(path)
      const url = await this.loadAssetUrl(path)
      if (!url) throw new Error('A slide image could not be loaded')
      return url
    }))
  }

  /** An object URL for an image or media part; loads it in the background and redraws when ready. */
  assetUrl(partPath: string): string | undefined {
    const cached = this.urls.get(partPath)
    if (cached !== undefined) return cached ?? undefined
    void this.loadAssetUrl(partPath)
    return undefined
  }

  /** The object URL for an image or media part, once it has loaded (undefined if it cannot be shown). */
  loadAssetUrl(partPath: string): Promise<string | undefined> {
    const cached = this.urls.get(partPath)
    if (cached) return Promise.resolve(cached)
    const pending = this.loadingUrls.get(partPath)
    if (pending) return pending
    if (cached === null) return Promise.resolve(undefined)
    const part = readPart(presentationRoot(this.doc), partPath)
    const asset = part?.asset
    this.urls.set(partPath, null)
    if (!asset || !displayableMediaType(asset.mimeType)) return Promise.resolve(undefined)
    const loading = this.assets
      .get(asset.hash)
      .then((bytes) => {
        if (this.destroyed) return undefined
        const url = assetObjectUrl(bytes, asset.mimeType)
        this.urls.set(partPath, url ?? null)
        this.assetVersion++
        this.emit({ assets: true })
        return url
      })
      // A picture that cannot be loaded stays a gray box.
      .catch(() => undefined)
      .finally(() => this.loadingUrls.delete(partPath))
    this.loadingUrls.set(partPath, loading)
    return loading
  }

  private readonly loadingUrls = new Map<string, Promise<string | undefined>>()

  /** A shape's transform, inherited from its layout placeholder when it has none. */
  shapeXfrm(slideKey: string, shapeKey: string): Xfrm | undefined {
    const slide = this.slide(slideKey)
    return slide ? slideShapeXfrm(slide, shapeKey, this.renderOptions('edit', 'measure', slideKey)) : undefined
  }

  shape(slideKey: string, shapeKey: string): ShapeSnapshot | undefined {
    const find = (shapes: ShapeSnapshot[]): ShapeSnapshot | undefined => {
      for (const shape of shapes) {
        if (shape.key === shapeKey) return shape
        const member = find(shape.children ?? [])
        if (member) return member
      }
      return undefined
    }
    return find(this.slide(slideKey)?.shapes ?? [])
  }

  textLayout(slideKey: string, shapeKey: string) {
    const slide = this.slide(slideKey)
    return slide ? slideShapeText(slide, shapeKey, this.renderOptions('edit', 'editor', slideKey)) : undefined
  }

  // -------------------------------------------------------------------------------------------
  // Selection and presence

  setState(patch: Partial<ViewState>): void {
    // A selection on the slide (a click on the canvas or a thumbnail) takes formatting back from the notes.
    if (patch.shapes !== undefined || patch.editing !== undefined || (patch.slide !== undefined && patch.slide !== this.state.slide)) this.notesTarget = undefined
    this.state = { ...this.state, ...patch }
    if (patch.slide) this.lastIndex = Math.max(0, this.slideKeys().indexOf(patch.slide))
    this.publishPresence()
    this.emit({ selection: true })
  }

  goToSlide(key: string, extend: 'replace' | 'toggle' | 'range' = 'replace'): void {
    if (!this.slideKeys().includes(key)) return
    let slides = [key]
    if (extend === 'toggle') slides = this.state.slides.includes(key) ? this.state.slides.filter((entry) => entry !== key) : [...this.state.slides, key]
    else if (extend === 'range' && this.state.slide) {
      const keys = this.slideKeys()
      const [from, to] = [keys.indexOf(this.state.slide), keys.indexOf(key)].sort((a, b) => a - b)
      slides = keys.slice(from, to! + 1)
    }
    if (!slides.length) slides = [key]
    this.setState({ slide: key, slides, shapes: [], editing: undefined })
  }

  selectShapes(shapes: string[]): void {
    this.setState({ shapes, editing: this.state.editing && shapes.includes(this.state.editing.shape) ? this.state.editing : undefined })
  }

  private publishPresence(): void {
    this.awareness?.setLocalStateField('presentation', { slide: this.state.slide ?? null, shapes: this.state.shapes, editing: this.state.editing?.shape ?? null })
  }

  remoteSelections(): RemoteSelection[] {
    if (!this.awareness) return []
    const selections: RemoteSelection[] = []
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue
      const user = state.user as { name?: string; color?: string } | undefined
      const presence = state.presentation as { slide?: string; shapes?: string[]; editing?: string } | null | undefined
      if (!presence) continue
      selections.push({
        clientId,
        name: String(user?.name ?? ''),
        color: /^#[0-9a-fA-F]{3,8}$/.test(String(user?.color ?? '')) ? String(user!.color) : '#888888',
        ...(presence.slide ? { slide: presence.slide } : {}),
        shapes: Array.isArray(presence.shapes) ? presence.shapes.filter((key) => typeof key === 'string') : [],
        ...(typeof presence.editing === 'string' ? { editing: presence.editing } : {}),
      })
    }
    return selections
  }

  // -------------------------------------------------------------------------------------------
  // Undo

  undo(): void {
    if (this.readOnly || this.destroyed) return
    this.undoManager.undo()
  }

  redo(): void {
    if (this.readOnly || this.destroyed) return
    this.undoManager.redo()
  }

  canUndo(): boolean {
    return !this.readOnly && !this.destroyed && this.undoManager.undoStack.length > 0
  }

  canRedo(): boolean {
    return !this.readOnly && !this.destroyed && this.undoManager.redoStack.length > 0
  }

  /** Switches between viewing and editing (access changed, or the connection allows edits again). */
  setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) return
    this.readOnly = readOnly
    this.activeEditor?.setReadOnly(readOnly)
    if (readOnly) this.state = { ...this.state, editing: undefined }
    this.globalVersion++
    this.emit({ selection: true, order: true })
  }

  /** Groups everything until `end()` into one undo step (a drag, a resize). */
  beginGesture(): () => void {
    this.undoManager.stopCapturing()
    const previous = this.undoManager.captureTimeout
    this.undoManager.captureTimeout = Number.POSITIVE_INFINITY
    return () => {
      this.undoManager.captureTimeout = previous
      this.undoManager.stopCapturing()
    }
  }

  // -------------------------------------------------------------------------------------------
  // Commands for toolbars and menus

  private get slideKey(): string | undefined {
    return this.state.slide
  }

  private guard(): boolean {
    return !this.readOnly && !this.destroyed && this.slideKey !== undefined
  }

  private nextName(base: string): string {
    const slide = this.slideKey ? this.slide(this.slideKey) : undefined
    let count = 1
    const names = new Set<string>()
    const walk = (shapes: ShapeSnapshot[]) => shapes.forEach((shape) => { count++; if (shape.name) names.add(shape.name); walk(shape.children ?? []) })
    walk(slide?.shapes ?? [])
    while (names.has(`${base} ${count}`)) count++
    return `${base} ${count}`
  }

  /** Where new content goes: centered, with a default size in EMU. */
  private centered(cx: number, cy: number): Xfrm {
    const size = this.size()
    return { x: Math.round((size.width * EMU_PER_PX - cx) / 2), y: Math.round((size.height * EMU_PER_PX - cy) / 2), cx, cy }
  }

  insertTextBox(xfrm?: Xfrm): string | undefined {
    if (!this.guard()) return undefined
    const [key] = commands.insertShapes(this.doc, this.slideKey!, [commands.textBox(xfrm ?? this.centered(3_048_000, 457_200), this.nextName(this.labels.shapeNames.textBox))], LOCAL_ORIGIN)
    if (key) this.setState({ shapes: [key], editing: { slide: this.slideKey!, shape: key } })
    return key
  }

  /**
   * Inserts a preset shape, or a line for line and connector presets; `arrows` puts arrowheads
   * on a line (Arrow: `{ tail: 'triangle' }`, Double Arrow: both), in the same undo step.
   */
  insertShape(preset: string, xfrm?: Xfrm, arrows?: { head?: Arrowhead; tail?: Arrowhead }): string | undefined {
    if (!this.guard()) return undefined
    const line = /line|Connector/.test(preset)
    const shape = commands.presetShape(preset, xfrm ?? this.centered(line ? 2_286_000 : 1_828_800, line ? 0 : 1_371_600), this.nextName(this.labels.shapeNames.shape))
    if (arrows?.head || arrows?.tail) shape.line = editLineProperties(shape.line, lineEdits.headEnd(arrows.head), lineEdits.tailEnd(arrows.tail))
    const [key] = commands.insertShapes(this.doc, this.slideKey!, [shape], LOCAL_ORIGIN)
    if (key) this.selectShapes([key])
    return key
  }

  /**
   * Inserts a picture at its natural aspect ratio (`size` in px; see `imageSize`), scaled down to
   * fit the slide, centered on `at` (slide EMU, kept on the slide) or on the slide.
   */
  async insertImage(bytes: Uint8Array, mimeType: string, size?: { width: number; height: number }, description = '', at?: { x: number; y: number }): Promise<string | undefined> {
    if (!this.guard()) return undefined
    const slide = this.slideKey!
    const asset = await this.assets.put(bytes, mimeType)
    if (this.readOnly || this.destroyed || !commands.slideMap(this.doc, slide)) return undefined
    const slideSize = this.size()
    const maxWidth = slideSize.width * 0.6
    const maxHeight = slideSize.height * 0.6
    const known = size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    const width = known ? size.width : 400
    const height = known ? size.height : 300
    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    const cx = Math.max(1, Math.round(width * scale * EMU_PER_PX))
    const cy = Math.max(1, Math.round(height * scale * EMU_PER_PX))
    const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(0, value), Math.max(0, max)))
    const xfrm = at && Number.isFinite(at.x) && Number.isFinite(at.y)
      ? { x: clamp(at.x - cx / 2, slideSize.width * EMU_PER_PX - cx), y: clamp(at.y - cy / 2, slideSize.height * EMU_PER_PX - cy), cx, cy }
      : this.centered(cx, cy)
    const part = commands.addImagePart(this.doc, asset)
    const [key] = commands.insertShapes(this.doc, slide, [commands.pictureShape(part, xfrm, this.nextName(this.labels.shapeNames.picture), description)], LOCAL_ORIGIN)
    if (key) this.selectShapes([key])
    return key
  }

  insertTable(rows: number, columns: number): string | undefined {
    if (!this.guard()) return undefined
    const size = this.size()
    const width = Math.round(size.width * EMU_PER_PX * 0.8)
    const [key] = commands.insertShapes(this.doc, this.slideKey!, [commands.tableShape(Math.max(1, Math.min(rows, 50)), Math.max(1, Math.min(columns, 30)), this.centered(width, 370_840 * rows), this.nextName(this.labels.shapeNames.table))], LOCAL_ORIGIN)
    if (key) this.selectShapes([key])
    return key
  }

  /** Runs a structural edit as an undo step of its own, never merged with typing before or after it. */
  private step<T>(edit: () => T): T {
    this.undoManager.stopCapturing()
    try {
      return edit()
    } finally {
      this.undoManager.stopCapturing()
    }
  }

  // Tables: a cell a context menu names, else the cell being edited, else the selected table as a whole.

  /**
   * The table that table commands act on, and the cell they act around (grid indexes and spans):
   * `at` (the cell `onContextMenu` reported) or the cell being edited. Undefined when `at` is no
   * longer in the table, as after a collaborator deleted its row.
   */
  tableSelection(at?: { row: string; column: string }): TableSelection | undefined {
    const slide = this.slideKey
    const editing = this.state.editing
    const key = editing?.row && editing.column ? editing.shape : this.state.shapes.length === 1 ? this.state.shapes[0] : undefined
    const table = slide && key ? this.shape(slide, key)?.table : undefined
    if (!slide || !key || !table) return undefined
    const base = { slide, shape: key, rows: table.rows.length, columns: table.columns.length }
    const edited = editing?.row && editing.column && editing.shape === key && editing.slide === slide ? { row: editing.row, column: editing.column } : undefined
    const keys = at ?? edited
    if (!keys) return base
    const rowIndex = table.rows.findIndex((row) => row.key === keys.row)
    const columnIndex = table.columns.findIndex((column) => column.key === keys.column)
    const cell = table.rows[rowIndex]?.cells[keys.column]
    if (rowIndex < 0 || columnIndex < 0 || !cell) return at ? undefined : base
    return { ...base, cell: { row: keys.row, column: keys.column, rowIndex, columnIndex, rowSpan: Math.max(1, cell.rowSpan ?? 1), columnSpan: Math.max(1, cell.gridSpan ?? 1) } }
  }

  /** Inserts a row above or below the cell (below a merged cell's last row), or at the table's top or bottom. */
  insertTableRow(where: 'above' | 'below', at?: { row: string; column: string }): string | undefined {
    const target = this.tableSelection(at)
    if (!this.guard() || !target) return undefined
    const index = target.cell ? (where === 'above' ? target.cell.rowIndex : target.cell.rowIndex + target.cell.rowSpan) : where === 'above' ? 0 : target.rows
    return this.step(() => commands.insertTableRow(this.doc, target.slide, target.shape, Math.min(index, target.rows), LOCAL_ORIGIN))
  }

  /** Inserts a column left or right of the cell, or at the table's left or right edge. */
  insertTableColumn(where: 'left' | 'right', at?: { row: string; column: string }): string | undefined {
    const target = this.tableSelection(at)
    if (!this.guard() || !target) return undefined
    const index = target.cell ? (where === 'left' ? target.cell.columnIndex : target.cell.columnIndex + target.cell.columnSpan) : where === 'left' ? 0 : target.columns
    return this.step(() => commands.insertTableColumn(this.doc, target.slide, target.shape, Math.min(index, target.columns), LOCAL_ORIGIN))
  }

  /** Deletes the rows the cell spans; deleting every row deletes the table, as in PowerPoint. */
  deleteTableRows(at?: { row: string; column: string }): void {
    const target = this.tableSelection(at)
    const table = target ? this.shape(target.slide, target.shape)?.table : undefined
    if (!this.guard() || !target?.cell || !table) return
    const { rowIndex, rowSpan, column } = target.cell
    const keys = table.rows.slice(rowIndex, rowIndex + rowSpan).map((row) => row.key)
    if (keys.length >= table.rows.length) return this.deleteTable()
    const editing = this.state.editing
    this.step(() => commands.deleteTableRows(this.doc, target.slide, target.shape, keys, LOCAL_ORIGIN))
    this.afterTableDelete(target, editing, Math.min(rowIndex, table.rows.length - keys.length - 1), table.columns.findIndex((entry) => entry.key === column))
  }

  /** Deletes the columns the cell spans; deleting every column deletes the table. */
  deleteTableColumns(at?: { row: string; column: string }): void {
    const target = this.tableSelection(at)
    const table = target ? this.shape(target.slide, target.shape)?.table : undefined
    if (!this.guard() || !target?.cell || !table) return
    const { columnIndex, columnSpan, rowIndex } = target.cell
    const keys = table.columns.slice(columnIndex, columnIndex + columnSpan).map((column) => column.key)
    if (keys.length >= table.columns.length) return this.deleteTable()
    const editing = this.state.editing
    this.step(() => commands.deleteTableColumns(this.doc, target.slide, target.shape, keys, LOCAL_ORIGIN))
    this.afterTableDelete(target, editing, rowIndex, Math.min(columnIndex, table.columns.length - keys.length - 1))
  }

  deleteTable(): void {
    const target = this.tableSelection()
    if (!this.guard() || !target) return
    this.step(() => commands.deleteShapes(this.doc, target.slide, [target.shape], LOCAL_ORIGIN))
    this.setState({ shapes: [], editing: undefined })
  }

  /**
   * After a delete, the cell that was being edited stays when it is still there; else editing
   * moves to the cell that took the deleted one's place. A table not being edited stays selected.
   */
  private afterTableDelete(target: TableSelection, editing: EditingTarget | undefined, rowIndex: number, columnIndex: number): void {
    if (!editing?.row || !editing.column || editing.shape !== target.shape || editing.slide !== target.slide) return
    const table = this.shape(target.slide, target.shape)?.table
    const kept = table?.rows.find((row) => row.key === editing.row)?.cells[editing.column]
    if (kept && !kept.hMerge && !kept.vMerge) return
    const row = table?.rows[Math.max(0, rowIndex)]
    const column = table?.columns[Math.max(0, columnIndex)]
    const cell = row && column ? row.cells[column.key] : undefined
    if (row && column && cell && !cell.hMerge && !cell.vMerge) this.setState({ shapes: [target.shape], editing: { slide: target.slide, shape: target.shape, row: row.key, column: column.key } })
    else this.setState({ shapes: [target.shape], editing: undefined })
  }

  /** Layouts of the deck's masters, for the new-slide and layout pickers. */
  layouts(): { path: string; name: string; master: string }[] {
    const deck = this.deck()
    return deck.masterPaths().flatMap((master) => (deck.master(master)?.layouts ?? []).map((path) => ({ path, name: deck.layout(path)?.name ?? '', master })))
  }

  addSlide(layoutPath?: string): string | undefined {
    if (this.readOnly) return undefined
    const keys = this.slideKeys()
    const current = this.slideKey ? this.slide(this.slideKey) : undefined
    const layouts = this.layouts()
    // Like PowerPoint: after a title slide comes "Title and Content"; otherwise the current slide's layout.
    const currentLayout = current?.layout ? this.deck().layout(current.layout) : undefined
    const layout =
      layoutPath ??
      (currentLayout?.type === 'title' ? layouts.find((entry) => this.deck().layout(entry.path)?.type === 'obj')?.path : undefined) ??
      current?.layout ??
      layouts[0]?.path
    if (!layout) return undefined
    const index = this.slideKey ? keys.indexOf(this.slideKey) + 1 : keys.length
    const key = commands.addSlide(this.doc, this.deck(), layout, index, LOCAL_ORIGIN)
    this.goToSlide(key)
    return key
  }

  duplicateSlides(keys = this.state.slides): void {
    if (this.readOnly) return
    const created = commands.duplicateSlides(this.doc, keys, LOCAL_ORIGIN)
    if (created[0]) this.setState({ slide: created[0], slides: created, shapes: [] })
  }

  deleteSlides(keys = this.state.slides): void {
    if (this.readOnly) return
    const order = this.slideKeys()
    if (keys.length >= order.length) return
    const index = minOf(keys.map((key) => order.indexOf(key)))
    commands.deleteSlides(this.doc, keys, LOCAL_ORIGIN)
    const remaining = this.slideKeys()
    const next = remaining[Math.min(index, remaining.length - 1)]
    if (next) this.goToSlide(next)
  }

  moveSlides(keys: string[], toIndex: number): void {
    if (!this.readOnly) commands.moveSlides(this.doc, keys, toIndex, LOCAL_ORIGIN)
  }

  setSlidesHidden(hidden: boolean, keys = this.state.slides): void {
    if (!this.readOnly) commands.setSlideHidden(this.doc, keys, hidden, LOCAL_ORIGIN)
  }

  /** Starts a section named `name` at a slide (the current one); the slides up to the next section join it. */
  addSection(name: string, firstSlide = this.state.slide): string | undefined {
    if (this.readOnly || !firstSlide || !this.slideKeys().includes(firstSlide)) return undefined
    return this.step(() => commands.addSection(this.doc, name, firstSlide, LOCAL_ORIGIN))
  }

  renameSection(key: string, name: string): void {
    if (!this.readOnly) commands.renameSection(this.doc, key, name, LOCAL_ORIGIN)
  }

  /** Removes a section (not its slides, which join the section before). */
  removeSection(key: string): void {
    if (!this.readOnly) this.step(() => commands.removeSection(this.doc, key, LOCAL_ORIGIN))
  }

  /** Selects every slide (the current one stays current). */
  selectAllSlides(): void {
    const keys = this.slideKeys()
    if (keys.length) this.setState({ slides: [...keys], slide: this.state.slide ?? keys[0], shapes: [], editing: undefined })
  }

  /** Applies a layout to the slides, adding the placeholders it has and they lack (one undo step). */
  setLayout(layoutPath: string, keys = this.state.slides): void {
    if (this.readOnly) return
    this.step(() => this.doc.transact(() => {
      for (const key of keys) commands.setSlideLayout(this.doc, this.deck(), key, layoutPath, LOCAL_ORIGIN)
    }, LOCAL_ORIGIN))
  }

  /** PowerPoint's Reset: placeholders back to the layout's position and look, missing ones restored; text stays. */
  resetSlides(keys = this.state.slides): void {
    if (this.readOnly) return
    this.step(() => this.doc.transact(() => {
      for (const key of keys) commands.resetSlide(this.doc, this.deck(), key, LOCAL_ORIGIN)
    }, LOCAL_ORIGIN))
  }

  /** Sets the selected slides' background to a DrawingML fill, or back to the layout's with undefined. */
  setBackground(fill: string | undefined, keys = this.state.slides): void {
    if (this.readOnly) return
    this.doc.transact(() => {
      for (const key of keys) commands.setSlideBackground(this.doc, key, fill ? commands.backgroundXml(fill) : undefined, LOCAL_ORIGIN)
    }, LOCAL_ORIGIN)
  }

  deleteSelection(): void {
    if (!this.guard() || !this.state.shapes.length) return
    commands.deleteShapes(this.doc, this.slideKey!, this.state.shapes, LOCAL_ORIGIN)
    this.selectShapes([])
  }

  duplicateSelection(): void {
    if (!this.guard() || !this.state.shapes.length) return
    const keys = commands.duplicateShapes(this.doc, this.slideKey!, this.state.shapes, 182_880, LOCAL_ORIGIN)
    this.selectShapes(keys)
  }

  /** Moves or resizes shapes; values are absolute EMU. */
  setXfrm(shapeKey: string, xfrm: Partial<Xfrm>): void {
    if (!this.guard()) return
    const current = commands.readXfrm(this.doc, this.slideKey!, shapeKey)
    if (current) commands.transformShape(this.doc, this.slideKey!, shapeKey, xfrm, LOCAL_ORIGIN)
    else {
      // Placeholders inherit their transform; the first move gives them their own.
      const inherited = this.shapeXfrm(this.slideKey!, shapeKey)
      commands.transformShape(this.doc, this.slideKey!, shapeKey, { ...inherited, ...xfrm }, LOCAL_ORIGIN)
    }
  }

  nudge(dx: number, dy: number): void {
    if (!this.guard()) return
    this.doc.transact(() => {
      for (const key of this.state.shapes) {
        const xfrm = this.shapeXfrm(this.slideKey!, key)
        if (xfrm) this.setXfrm(key, { x: xfrm.x + dx, y: xfrm.y + dy })
      }
    }, LOCAL_ORIGIN)
  }

  setShapeProperty(property: commands.ShapeProperty, value: string | boolean | undefined): void {
    if (!this.guard() || !this.state.shapes.length) return
    commands.setShapeProperty(this.doc, this.slideKey!, this.state.shapes, property, value, LOCAL_ORIGIN)
  }

  reorder(where: commands.ZOrder): void {
    if (this.guard() && this.state.shapes.length) commands.reorderShapes(this.doc, this.slideKey!, this.state.shapes, where, LOCAL_ORIGIN)
  }

  group(): void {
    if (!this.guard() || this.state.shapes.length < 2) return
    const xfrms = new Map(this.state.shapes.map((key) => [key, this.shapeXfrm(this.slideKey!, key)!] as const).filter(([, xfrm]) => xfrm))
    const key = commands.groupShapes(this.doc, this.slideKey!, this.state.shapes, xfrms, this.nextName(this.labels.shapeNames.group), LOCAL_ORIGIN)
    if (key) this.selectShapes([key])
  }

  ungroup(): void {
    if (!this.guard()) return
    const members = this.state.shapes.flatMap((key) => (this.shape(this.slideKey!, key)?.kind === 'grpSp' ? commands.ungroupShape(this.doc, this.slideKey!, key, LOCAL_ORIGIN) : [key]))
    this.selectShapes(members)
  }

  /**
   * Aligns selected shapes to each other, or to the slide (PowerPoint's Align to Slide). `auto`
   * aligns one shape to the slide and several to each other.
   */
  align(edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', relativeTo: 'auto' | 'slide' | 'selection' = 'auto'): void {
    if (!this.guard() || !this.state.shapes.length) return
    const xfrms = this.state.shapes.map((key) => [key, this.shapeXfrm(this.slideKey!, key)] as const).filter((entry): entry is readonly [string, Xfrm] => entry[1] !== undefined)
    const size = this.size()
    const toSlide = relativeTo === 'slide' || (relativeTo === 'auto' && xfrms.length < 2)
    const bounds = toSlide ? { x: 0, y: 0, cx: size.width * EMU_PER_PX, cy: size.height * EMU_PER_PX } : commands.boundsOf(xfrms.map(([, xfrm]) => xfrm))
    this.doc.transact(() => {
      for (const [key, xfrm] of xfrms) {
        if (edge === 'left') this.setXfrm(key, { x: bounds.x })
        else if (edge === 'center') this.setXfrm(key, { x: bounds.x + (bounds.cx - xfrm.cx) / 2 })
        else if (edge === 'right') this.setXfrm(key, { x: bounds.x + bounds.cx - xfrm.cx })
        else if (edge === 'top') this.setXfrm(key, { y: bounds.y })
        else if (edge === 'middle') this.setXfrm(key, { y: bounds.y + (bounds.cy - xfrm.cy) / 2 })
        else this.setXfrm(key, { y: bounds.y + bounds.cy - xfrm.cy })
      }
    }, LOCAL_ORIGIN)
  }

  /**
   * Spaces shapes evenly: three or more between the outermost ones, or (`slide`) any number
   * across the slide, the outermost at its edges and a single shape centered.
   */
  distribute(axis: 'horizontal' | 'vertical', relativeTo: 'selection' | 'slide' = 'selection'): void {
    const toSlide = relativeTo === 'slide'
    if (!this.guard() || this.state.shapes.length < (toSlide ? 1 : 3)) return
    const horizontal = axis === 'horizontal'
    const xfrms = this.state.shapes
      .map((key) => [key, this.shapeXfrm(this.slideKey!, key)] as const)
      .filter((entry): entry is readonly [string, Xfrm] => entry[1] !== undefined)
      .sort((a, b) => (horizontal ? a[1].x - b[1].x : a[1].y - b[1].y))
    if (!xfrms.length) return
    const extent = (horizontal ? this.size().width : this.size().height) * EMU_PER_PX
    const last = xfrms[xfrms.length - 1]![1]
    const start = toSlide ? 0 : horizontal ? xfrms[0]![1].x : xfrms[0]![1].y
    const end = toSlide ? extent : horizontal ? last.x + last.cx : last.y + last.cy
    const total = xfrms.reduce((sum, [, xfrm]) => sum + (horizontal ? xfrm.cx : xfrm.cy), 0)
    const gap = xfrms.length > 1 ? (end - start - total) / (xfrms.length - 1) : 0
    let position = xfrms.length > 1 ? start : (extent - total) / 2
    this.doc.transact(() => {
      for (const [key, xfrm] of xfrms) {
        this.setXfrm(key, horizontal ? { x: position } : { y: position })
        position += (horizontal ? xfrm.cx : xfrm.cy) + gap
      }
    }, LOCAL_ORIGIN)
  }

  /** Selected shapes that flip and rotate: tables, charts, and other graphic frames stay upright, as in PowerPoint. */
  private turnableShapes(): string[] {
    return this.state.shapes.filter((key) => {
      const kind = this.shape(this.slideKey!, key)?.kind
      return kind !== undefined && kind !== 'graphicFrame' && kind !== 'opaque'
    })
  }

  /**
   * Flip Horizontal or Flip Vertical: each selected shape mirrors in place. A rotated shape's
   * angle mirrors too, so it looks reflected rather than turned (one undo step).
   */
  flip(axis: 'horizontal' | 'vertical'): void {
    if (!this.guard()) return
    const keys = this.turnableShapes()
    this.doc.transact(() => {
      for (const key of keys) {
        const xfrm = this.shapeXfrm(this.slideKey!, key)
        if (!xfrm) continue
        const rot = xfrm.rot ? (21_600_000 - (((xfrm.rot % 21_600_000) + 21_600_000) % 21_600_000)) % 21_600_000 : 0
        this.setXfrm(key, axis === 'horizontal' ? { flipH: !xfrm.flipH, rot } : { flipV: !xfrm.flipV, rot })
      }
    }, LOCAL_ORIGIN)
  }

  /** Rotates each selected shape by `degrees` (90 is Rotate Right 90°, -90 Rotate Left 90°). */
  rotateBy(degrees: number): void {
    if (!this.guard() || !Number.isFinite(degrees)) return
    const keys = this.turnableShapes()
    this.doc.transact(() => {
      for (const key of keys) {
        const xfrm = this.shapeXfrm(this.slideKey!, key)
        if (!xfrm) continue
        this.setXfrm(key, { rot: ((((xfrm.rot ?? 0) + Math.round(degrees * 60_000)) % 21_600_000) + 21_600_000) % 21_600_000 })
      }
    }, LOCAL_ORIGIN)
  }

  /** Change Shape: the selected shapes take a preset geometry (`ellipse`, `roundRect`, …) and keep their text and look. */
  changeShape(preset: string): void {
    if (!this.guard() || !/^[A-Za-z0-9]+$/.test(preset)) return
    const keys = this.state.shapes.filter((key) => this.shape(this.slideKey!, key)?.kind === 'sp')
    if (keys.length) commands.setShapeProperty(this.doc, this.slideKey!, keys, 'geom', `<a:prstGeom xmlns:a="${NS.a}" prst="${preset}"><a:avLst/></a:prstGeom>`, LOCAL_ORIGIN)
  }

  /**
   * Edits the selected shapes' outlines (see `lineEdits`): only what an edit names changes, so
   * arrowheads, caps, and gradient lines stay. Each shape keeps its other line properties.
   */
  editLine(...edits: LineEdit[]): void {
    if (!this.guard() || !edits.length) return
    const keys = this.state.shapes.filter((key) => {
      const kind = this.shape(this.slideKey!, key)?.kind
      return kind === 'sp' || kind === 'cxnSp' || kind === 'pic'
    })
    this.doc.transact(() => {
      for (const key of keys) commands.setShapeProperty(this.doc, this.slideKey!, [key], 'line', editLineProperties(this.shape(this.slideKey!, key)?.line, ...edits), LOCAL_ORIGIN)
    }, LOCAL_ORIGIN)
  }

  /** Text box options (`bodyEdits`) for the text being edited on the slide, else the selected shapes. */
  editTextBox(...edits: BodyEdit[]): void {
    if (!this.guard() || !edits.length) return
    const editing = this.state.editing
    const keys = editing ? (editing.row ? [] : [editing.shape]) : this.state.shapes
    this.doc.transact(() => {
      for (const key of keys) {
        const shape = this.shape(this.slideKey!, key)
        if (shape?.kind === 'sp') commands.setShapeProperty(this.doc, this.slideKey!, [key], 'bodyPr', editBodyProperties(shape.bodyPr, ...edits), LOCAL_ORIGIN)
      }
    }, LOCAL_ORIGIN)
  }

  /** Vertical alignment of text in its box (Align Text: top, middle, bottom). */
  setTextAnchor(anchor: 't' | 'ctr' | 'b'): void {
    this.editTextBox(bodyEdits.anchor(anchor))
  }

  /**
   * Do not Autofit, Shrink text on overflow, or Resize shape to fit text. Shrinking and
   * resizing are measured while the text is edited, as PowerPoint files are.
   */
  setAutofit(mode: 'none' | 'norm' | 'shape'): void {
    this.editTextBox(bodyEdits.autofit(mode))
  }

  /** Text box margins in EMU (any of left, top, right, bottom). */
  setTextInsets(insets: Partial<Record<'l' | 't' | 'r' | 'b', number>>): void {
    this.editTextBox(bodyEdits.insets(insets))
  }

  setTextWrap(wrap: boolean): void {
    this.editTextBox(bodyEdits.wrap(wrap))
  }

  // Text formatting goes to the speaker notes while they are the target, else to the live
  // editor's selection while editing, else to all text of the selected shapes (and groups).

  private notesTarget?: InlineTextEditor

  /**
   * Makes the speaker notes the target of text formatting (NotesEditor calls this when it gets
   * focus), until the slide selection changes. As in PowerPoint, the text being edited on the
   * slide closes.
   */
  setNotesTarget(editor: InlineTextEditor | undefined): void {
    if (this.notesTarget === editor) return
    this.notesTarget = editor
    if (editor && this.state.editing) this.setState({ editing: undefined })
    else this.emit({ selection: true })
  }

  /** Stops formatting going to a notes editor that is going away. */
  releaseNotesTarget(editor: InlineTextEditor): void {
    if (this.notesTarget === editor) this.setNotesTarget(undefined)
  }

  /** Whether text formatting currently goes to the speaker notes. */
  get notesFocused(): boolean {
    return this.notesTarget !== undefined && !this.notesTarget.view.isDestroyed
  }

  /** The editor formatting applies to, if any. */
  private textEditor(): InlineTextEditor | undefined {
    if (this.notesFocused) return this.notesTarget
    return this.state.editing ? this.activeEditor : undefined
  }

  setMark(type: RunMark, value: MarkValue): void {
    if (this.readOnly) return
    const editor = this.textEditor()
    if (editor) {
      editor.run(setMarkCommand(type, value))
      return
    }
    this.editSelectedText((json) => markAll(json, type, value))
  }

  editParagraphs(edit: ParagraphEdit): void {
    if (this.readOnly) return
    const editor = this.textEditor()
    if (editor) {
      editor.run(paragraphCommand(edit))
      return
    }
    this.editSelectedText((json) => editAllParagraphs(json, edit))
  }

  toggleMark(type: 'b' | 'i' | 'u' | 'strike'): void {
    const state = this.formatState()
    const on = type === 'b' ? state.bold : type === 'i' ? state.italic : type === 'u' ? state.underline : state.strike
    const value = type === 'u' ? (on ? 'none' : 'sng') : type === 'strike' ? (on ? 'noStrike' : 'sngStrike') : !on
    this.setMark(type, value)
  }

  /** Sets the font size in points (1–4000, as PowerPoint allows). */
  setFontSize(points: number): void {
    if (!Number.isFinite(points)) return
    this.setMark('sz', Math.round(Math.min(4000, Math.max(1, points)) * 100))
  }

  /** Increase or Decrease Font Size: each run steps along PowerPoint's size ladder from its own size. */
  stepFontSize(delta: 1 | -1): void {
    if (this.readOnly) return
    const editor = this.textEditor()
    if (editor) {
      const shape = editor === this.notesTarget ? undefined : this.state.editing?.shape
      editor.run(stepFontSizeCommand(delta, (pPr) => this.inheritedSize(shape, pPr)))
      return
    }
    this.editSelectedText((json, key) => stepFontSizesAll(json, delta, (pPr) => this.inheritedSize(key, pPr)))
  }

  /** Clear Formatting: run formatting back to what the text inherits; links stay. */
  clearFormatting(): void {
    if (this.readOnly) return
    const editor = this.textEditor()
    if (editor) {
      editor.run(clearMarksCommand(CLEARABLE_MARKS))
      return
    }
    this.editSelectedText((json) => clearMarksAll(json, CLEARABLE_MARKS))
  }

  /** Highlights text with a color (a fill like `<a:solidFill>…</a:solidFill>`, or a color element); undefined removes it. */
  setHighlight(color: string | undefined): void {
    let value: string | undefined
    try {
      value = color === undefined ? undefined : highlightXml(color)
    } catch {
      return
    }
    this.setMark('highlight', value)
  }

  setBaseline(baseline: 'sup' | 'sub' | 'none'): void {
    this.setMark('baseline', baseline === 'none' ? undefined : BASELINE[baseline])
  }

  /** Superscript or subscript on, or off when the text already has it. */
  toggleBaseline(baseline: 'sup' | 'sub'): void {
    this.setBaseline(this.formatState().baseline === baseline ? 'none' : baseline)
  }

  setAlign(algn: 'l' | 'ctr' | 'r' | 'just'): void {
    this.editParagraphs(paragraphEdits.align(algn))
  }

  setBullets(kind: 'none' | 'char' | 'number'): void {
    const inherited = this.inheritedBullet()
    this.editParagraphs(paragraphEdits.bullets(this.formatState().bullets === kind ? 'none' : kind, inherited))
  }

  changeLevel(delta: number): void {
    this.editParagraphs(paragraphEdits.level(delta))
  }

  setLineSpacing(multiple: number): void {
    this.editParagraphs(paragraphEdits.lineSpacing(multiple))
  }

  /**
   * Links the selected text, or all text of the selected shapes, to a URL (see `normalizeLink`;
   * other schemes are refused); undefined removes links. At a caret outside a link, `text` (or
   * the URL) is inserted as a new link.
   */
  setLink(href: string | undefined, text?: string): boolean {
    if (this.readOnly) return false
    const url = href === undefined ? undefined : normalizeLink(href)
    if (href !== undefined && !url) return false
    const editor = this.textEditor()
    if (editor) {
      editor.run(setLinkCommand(url, text))
      return true
    }
    if (!this.textShapeKeys().length) return false
    this.editSelectedText((json) => linkAll(json, url))
    return true
  }

  /** Inserts a slide number, date, or time field at the caret of the text being edited on the slide. */
  insertField(kind: 'slideNumber' | 'date' | 'time'): boolean {
    const editing = this.state.editing
    if (this.readOnly || !editing || !this.activeEditor || this.notesFocused) return false
    const type = kind === 'slideNumber' ? 'slidenum' : kind === 'date' ? 'datetime1' : 'datetime10'
    const text = computedFieldText(type, this.slideKeys().indexOf(editing.slide) + 1, new Date()) ?? ''
    this.activeEditor.run(insertFieldCommand(type, text, commands.newGuid()))
    return true
  }

  /** Types text (a symbol, say) at the caret of the text being edited, on the slide or in the notes. */
  insertText(text: string): boolean {
    const editor = this.textEditor()
    if (this.readOnly || !editor || !text) return false
    editor.run((state, dispatch) => {
      dispatch?.(state.tr.insertText(text).scrollIntoView())
      return true
    })
    return true
  }

  /** The deck's theme fonts for the current slide: headings (`+mj-lt`) and body (`+mn-lt`). */
  themeFonts(): { major: string; minor: string } {
    const slide = this.slideKey ? this.slide(this.slideKey) : undefined
    const deck = this.deck()
    const theme = (slide?.layout ? deck.layout(slide.layout)?.master?.theme : undefined) ?? deck.theme(undefined)
    return { major: theme.major.latin, minor: theme.minor.latin }
  }

  private inheritedBullet(): boolean {
    if (this.notesFocused) return false
    const target = this.state.editing?.shape ?? this.textShapeKeys()[0]
    if (!this.slideKey || !target) return false
    const layout = this.textLayout(this.slideKey, target)
    if (!layout) return false
    const bullet = resolveLevel([...layout.context.chain, layout.context.own], 0).paragraph.children.bullet
    return bullet !== undefined && bullet.localName !== 'buNone'
  }

  /** A paragraph's inherited font size in hundredths of a point (notes are 12 pt; default 18 pt). */
  private inheritedSize(shapeKey: string | undefined, pPr: unknown): number {
    if (!shapeKey) return this.notesFocused ? 1200 : 1800
    const layout = this.slideKey ? this.textLayout(this.slideKey, shapeKey) : undefined
    const size = Number(layout ? paragraphStyleRun(layout, typeof pPr === 'string' ? pPr : null).attrs.sz : undefined)
    return Number.isFinite(size) && size > 0 ? size : 1800
  }

  /** Selected shapes whose text whole-shape formatting changes: text shapes, and those inside selected groups. */
  private textShapeKeys(): string[] {
    if (!this.slideKey) return []
    const keys: string[] = []
    const visit = (shape: ShapeSnapshot | undefined) => {
      if (!shape) return
      if (shape.kind === 'grpSp') shape.children?.forEach(visit)
      else if (shape.text && shape.kind === 'sp') keys.push(shape.key)
    }
    for (const key of this.state.shapes) visit(this.shape(this.slideKey, key))
    return keys
  }

  private editSelectedText(edit: (json: NonNullable<ShapeSnapshot['text']>, shapeKey: string) => NonNullable<ShapeSnapshot['text']>): void {
    if (!this.guard()) return
    this.doc.transact(() => {
      for (const key of this.textShapeKeys()) {
        const shape = this.shape(this.slideKey!, key)
        if (shape?.text) commands.setShapeText(this.doc, this.slideKey!, key, edit(shape.text, key), LOCAL_ORIGIN)
      }
    }, LOCAL_ORIGIN)
  }

  formatState(): FormatState {
    const editor = this.textEditor()
    const notes = editor !== undefined && editor === this.notesTarget
    const targetKey = notes ? undefined : (this.state.editing?.shape ?? this.textShapeKeys()[0])
    const shape = !editor && this.slideKey && targetKey ? this.shape(this.slideKey, targetKey) : undefined
    const cell = !notes && this.state.editing?.row !== undefined
    const layout = !notes && this.slideKey && targetKey ? this.textLayout(this.slideKey, targetKey) : undefined
    const value = (type: RunMark): MarkValue => (editor ? markValueAt(editor.view.state, type) : shape?.text ? markValueIn(shape.text, type) : undefined)
    const paragraph = editor ? paragraphAt(editor.view.state) : undefined
    const pPr = (paragraph?.attrs.pPr ?? shape?.text?.content?.[0]?.attrs?.pPr) as string | null | undefined
    const inheritedRun = layout && !cell ? paragraphStyleRun(layout, pPr) : undefined
    const truthy = (mark: MarkValue, inherited: string | undefined) => (mark === undefined ? inherited === '1' || inherited === 'true' : mark === true || mark === '1')
    const underline = value('u')
    const strike = value('strike')
    const size = value('sz') ?? inheritedRun?.attrs.sz ?? (notes ? 1200 : undefined)
    const font = value('font')
    const theme = layout?.context.theme ?? this.deck().theme(undefined)
    const resolvedFont = typeof font === 'string' ? themeFont(font, theme) : inheritedRun ? resolveTypeface(inheritedRun, theme) : undefined
    const level = pPr ? Number(/lvl="(\d)"/.exec(pPr)?.[1] ?? 0) : 0
    const align = (pPr && /algn="(\w+)"/.exec(pPr)?.[1]) || (layout && !cell ? resolveLevel([...layout.context.chain, layout.context.own], level).paragraph.attrs.algn : undefined) || 'l'
    const baseline = Number(value('baseline') ?? inheritedRun?.attrs.baseline ?? 0)
    const highlight = value('highlight')
    const link = editor ? linkAt(editor.view.state) : shape?.text ? linkIn(shape.text) : undefined
    const body = layout && !cell ? layout.body : undefined
    const inset = (name: string, fallback: number) => {
      const number = Number(body?.bag.attrs[name])
      return Number.isFinite(number) && body?.bag.attrs[name] !== undefined ? number : fallback
    }
    return {
      bold: truthy(value('b'), inheritedRun?.attrs.b),
      italic: truthy(value('i'), inheritedRun?.attrs.i),
      underline: underline === undefined ? (inheritedRun?.attrs.u ?? 'none') !== 'none' : underline !== 'none',
      strike: strike === undefined ? (inheritedRun?.attrs.strike ?? 'noStrike') !== 'noStrike' : strike !== 'noStrike',
      ...(size !== undefined ? { fontSize: Number(size) / 100 } : {}),
      ...(typeof font === 'string' ? { fontFamily: font } : {}),
      ...(resolvedFont ? { resolvedFontFamily: resolvedFont } : {}),
      align,
      bullets: pPr && /buAutoNum/.test(pPr) ? 'number' : pPr && /buNone/.test(pPr) ? 'none' : pPr && /buChar/.test(pPr) ? 'char' : this.inheritedBullet() ? 'char' : 'none',
      baseline: baseline > 0 ? 'sup' : baseline < 0 ? 'sub' : 'none',
      ...(typeof highlight === 'string' ? { highlight } : {}),
      ...(link ? { link } : {}),
      canFormatText: !!editor || !!shape?.text,
      notes,
      ...(body
        ? {
            textBox: {
              anchor: body.bag.attrs.anchor === 'ctr' || body.bag.attrs.anchor === 'b' ? body.bag.attrs.anchor : 't',
              autofit: body.autofit,
              wrap: body.bag.attrs.wrap !== 'none',
              insets: { l: inset('lIns', 91440), t: inset('tIns', 45720), r: inset('rIns', 91440), b: inset('bIns', 45720) },
            },
          }
        : {}),
    }
  }

  // Clipboard

  /** Copies the selected shapes, or the selected slides (always the slides with `'slides'`). */
  async copy(what: 'auto' | 'slides' = 'auto'): Promise<{ json: string; text: string } | undefined> {
    try {
      if (!this.slideKey) return undefined
      if (what === 'auto' && this.state.shapes.length) {
        const shapes = commands.readShapes(this.doc, this.slideKey, this.state.shapes)
        const text = shapes.map((shape) => (shape.text ? textToPlain(shape.text) : '')).filter(Boolean).join('\n')
        return { json: JSON.stringify(await copyContent(this.doc, this.assets, { shapes, slideKey: this.slideKey }, text)), text }
      }
      const slides = this.state.slides.map((key) => this.slide(key)).filter((slide): slide is SlideSnapshot => slide !== undefined)
      const text = slides.map((slide) => slide.shapes.map((shape) => (shape.text ? textToPlain(shape.text) : '')).filter(Boolean).join('\n')).join('\n\n')
      return { json: JSON.stringify(await copyContent(this.doc, this.assets, { slides }, text)), text }
    } catch {
      return undefined
    }
  }

  // Find and replace

  /** Every match in the deck, in order: slides, their shapes in drawing order (tables cell by cell), then their notes. */
  find(query: string, options: FindOptions = {}): FindMatch[] {
    return findMatches(this.doc, query, options)
  }

  /** Replaces one match, when its text is still there; formatting stays (one undo step). */
  replaceMatch(match: FindMatch, replacement: string): boolean {
    if (this.readOnly || this.destroyed) return false
    return this.step(() => replaceMatch(this.doc, match, replacement, LOCAL_ORIGIN))
  }

  /** Replaces every match as one undo step; returns how many. */
  replaceAll(query: string, replacement: string, options: FindOptions = {}): number {
    if (this.readOnly || this.destroyed) return 0
    return this.step(() => replaceAll(this.doc, query, replacement, options, LOCAL_ORIGIN))
  }

  private pendingReveal?: PendingReveal

  /**
   * Shows a match: goes to its slide, selects its shape, and selects the text in the slide's
   * or the notes' editor, highlighted while focus stays in the find bar (`focus` moves focus to
   * the text). A match inside a group selects the group; its text cannot be edited in place.
   */
  revealMatch(match: FindMatch, options: { focus?: boolean } = {}): void {
    if (this.destroyed || !this.slideKeys().includes(match.slide)) return
    const range = { paragraph: match.paragraph, from: match.from, to: match.to, focus: options.focus === true }
    if (this.state.slide !== match.slide) this.goToSlide(match.slide)
    if (match.notes) {
      this.pendingReveal = { notes: true, slide: match.slide, ...range }
      if (this.state.editing) this.setState({ editing: undefined })
      else this.emit({ selection: true })
      return
    }
    const shape = match.shape
    if (!shape || match.root !== shape || this.readOnly) {
      this.pendingReveal = undefined
      this.setState({ shapes: match.root ? [match.root] : [], editing: undefined })
      return
    }
    const target: EditingTarget = { slide: match.slide, shape, ...(match.row && match.column ? { row: match.row, column: match.column } : {}) }
    this.pendingReveal = { target, ...range }
    this.setState({ shapes: [shape], editing: target })
  }

  /** For views opening an editor: the range `revealMatch` wants selected in it, if any (taken once). */
  takeReveal(where: { notes: true; slide: string } | EditingTarget): { paragraph: number; from: number; to: number; focus: boolean } | undefined {
    const pending = this.pendingReveal
    if (!pending) return undefined
    const matches = 'notes' in pending
      ? 'notes' in where && where.slide === pending.slide
      : !('notes' in where) && where.slide === pending.target.slide && where.shape === pending.target.shape && where.row === pending.target.row && where.column === pending.target.column
    if (!matches) return undefined
    this.pendingReveal = undefined
    return { paragraph: pending.paragraph, from: pending.from, to: pending.to, focus: pending.focus }
  }

  /** Copies the selected shapes (else the selected slides; always the slides with `'slides'`) to the system clipboard. */
  async copyToClipboard(what: 'auto' | 'slides' = 'auto'): Promise<boolean> {
    const copied = await this.copy(what)
    if (!copied) return false
    await writeClipboard(copied)
    return true
  }

  /**
   * Copies the selected shapes (or slides with `'slides'`) and deletes them once the clipboard
   * has them; a failed copy deletes nothing.
   */
  async cutToClipboard(what: 'auto' | 'slides' = 'auto'): Promise<boolean> {
    if (this.readOnly || !this.slideKey) return false
    const slide = this.slideKey
    const shapes = what === 'auto' ? [...this.state.shapes] : []
    const slides = [...this.state.slides]
    if (what === 'auto' && !shapes.length) return false
    if (!(await this.copyToClipboard(what).catch(() => false)) || this.readOnly || this.destroyed) return false
    if (shapes.length) {
      commands.deleteShapes(this.doc, slide, shapes, LOCAL_ORIGIN)
      if (this.state.slide === slide) this.selectShapes(this.state.shapes.filter((key) => !shapes.includes(key)))
    } else this.deleteSlides(slides)
    return true
  }

  /**
   * A menu's Paste: copied shapes or slides from the system clipboard, else (not for `'slides'`)
   * an image at its aspect ratio, else text as a new text box. False when nothing was pasted.
   */
  async pasteFromClipboard(target: 'auto' | 'slides' = 'auto'): Promise<boolean> {
    if (this.readOnly || this.destroyed) return false
    const contents = await readClipboardContents()
    if (contents.payload) return this.paste(contents.payload, target)
    if (target === 'slides' || !this.guard()) return false
    if (contents.image) {
      const bytes = new Uint8Array(await contents.image.arrayBuffer())
      const size = await imageSize(contents.image)
      return (await this.insertImage(bytes, contents.image.type || 'image/png', size).catch(() => undefined)) !== undefined
    }
    if (!contents.text) return false
    const [key] = commands.insertShapes(this.doc, this.slideKey!, [commands.textBox(this.centered(3_048_000, 457_200), this.nextName(this.labels.shapeNames.textBox), contents.text)], LOCAL_ORIGIN)
    if (key) this.selectShapes([key])
    return key !== undefined
  }

  async paste(json: string, target: 'auto' | 'slides' = 'auto'): Promise<boolean> {
    const canApply = () => !this.readOnly && !this.destroyed
    if (!canApply()) return false
    const clipboard: PresentationClipboard | undefined = parseClipboard(json)
    if (!clipboard) return false
    if (clipboard.kind === 'slides' || target === 'slides') {
      const index = this.slideKey ? this.slideKeys().indexOf(this.slideKey) + 1 : this.slideKeys().length
      const keys = await pasteSlides(this.doc, this.assets, clipboard, index, LOCAL_ORIGIN, canApply)
      if (!canApply() || !keys.length) return false
      if (keys[0]) this.setState({ slide: keys[0], slides: keys, shapes: [] })
      return true
    }
    if (!this.slideKey) return false
    const sameSlide = (clipboard.shapes ?? []).every((shape) => commands.shapeMap(this.doc, this.slideKey!, shape.key))
    const keys = await pasteShapes(this.doc, this.assets, clipboard, this.slideKey, sameSlide ? 182_880 : 0, LOCAL_ORIGIN, canApply)
    if (!canApply() || !keys.length) return false
    this.selectShapes(keys)
    return true
  }
}

/** The level's default run (inherited formatting), for toolbar state of text without explicit formatting. */
function paragraphStyleRun(layout: NonNullable<ReturnType<PresentationController['textLayout']>>, pPr: string | null | undefined) {
  const level = pPr ? Number(/lvl="(\d)"/.exec(pPr)?.[1] ?? 0) : 0
  const run = resolveLevel(layout.context.chain, level).run
  mergeBag(run, layout.context.baseRun)
  return mergeBag(run, resolveLevel([layout.context.own], level).run)
}
