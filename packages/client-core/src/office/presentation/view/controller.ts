import { ySyncPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { LiveAssetStore } from '../../live-format.js'
import { copyContent, pasteShapes, pasteSlides, parseClipboard, type PresentationClipboard } from '../clipboard.js'
import * as commands from '../commands.js'
import { editAllParagraphs, markAll, markValueAt, markValueIn, paragraphAt, paragraphCommand, paragraphEdits, setMarkCommand, type MarkValue, type ParagraphEdit, type RunMark } from '../formatting.js'
import type { PartSnapshot, ShapeSnapshot, SlideSnapshot, Xfrm } from '../model.js'
import { DeckResources } from '../render/deck.js'
import { mergeBag, resolveLevel } from '../render/props.js'
import { assetObjectUrl, DEFAULT_RENDER_LABELS, displayableMediaType, EMU_PER_PX, type RenderLabels } from '../render/env.js'
import { renderSlide, slideShapeText, slideShapeXfrm, type SlideRenderOptions } from '../render/slide.js'
import { textToPlain } from '../text.js'
import { orderedKeys, presentationRoot, readSlideMap } from '../ydoc.js'
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
  fontSize?: number
  fontFamily?: string
  align?: string
  bullets: 'none' | 'char' | 'number'
  canFormatText: boolean
}

const emptyChange = (): ChangeSet => ({ slides: new Set(), order: false, parts: false, selection: false, assets: false, presence: false, local: false })

export class PresentationController {
  readonly doc: Y.Doc
  readonly awareness?: Awareness
  readonly assets: LiveAssetStore
  readonly readOnly: boolean
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
    this.destroyed = true
    presentationRoot(this.doc).unobserveDeep(this.onModelChange)
    this.awareness?.off('change', this.onAwarenessChange)
    this.awareness?.setLocalStateField('presentation', null)
    this.undoManager.destroy()
    for (const url of this.urls.values()) if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    this.listeners.clear()
  }

  subscribe(listener: (change: ChangeSet) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
          if (key === 'parts' || key === 'slides') change.parts = true
          if (key === 'slideOrder' || key === 'slides' || key === 'sectionOrder' || key === 'sections') change.order = true
        }
        continue
      }
      if (path[0] === 'parts') change.parts = true
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
    if (shapes.length !== this.state.shapes.length) this.setState({ shapes })
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
    const parts = presentationRoot(this.doc).get('parts') as Y.Map<PartSnapshot> | undefined
    return Object.fromEntries(parts ? [...parts.entries()] : [])
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
    return keys.map((key) => ({ key, name: sections!.get(key)!.name, firstSlide: this.slideKeys().find((slide) => this.slide(slide)?.section === key) }))
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

  /** An object URL for an image or media part; loads it in the background and redraws when ready. */
  assetUrl(partPath: string): string | undefined {
    const cached = this.urls.get(partPath)
    if (cached !== undefined) return cached ?? undefined
    const part = (presentationRoot(this.doc).get('parts') as Y.Map<PartSnapshot>).get(partPath)
    const asset = part?.asset
    if (!asset || !displayableMediaType(asset.mimeType)) {
      this.urls.set(partPath, null)
      return undefined
    }
    this.urls.set(partPath, null)
    void this.assets.get(asset.hash).then(
      (bytes) => {
        if (this.destroyed) return
        this.urls.set(partPath, assetObjectUrl(bytes, asset.mimeType) ?? null)
        this.assetVersion++
        this.emit({ assets: true })
      },
      () => undefined,
    )
    return undefined
  }

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
    this.undoManager.undo()
  }

  redo(): void {
    this.undoManager.redo()
  }

  canUndo(): boolean {
    return this.undoManager.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.undoManager.redoStack.length > 0
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
    return !this.readOnly && this.slideKey !== undefined
  }

  private nextName(base: string): string {
    const slide = this.slideKey ? this.slide(this.slideKey) : undefined
    let count = 1
    const walk = (shapes: ShapeSnapshot[]) => shapes.forEach((shape) => ((count = Math.max(count, (shape.nvId ?? 0) + 1)), walk(shape.children ?? [])))
    walk(slide?.shapes ?? [])
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

  insertShape(preset: string, xfrm?: Xfrm): string | undefined {
    if (!this.guard()) return undefined
    const line = /line|Connector/.test(preset)
    const [key] = commands.insertShapes(this.doc, this.slideKey!, [commands.presetShape(preset, xfrm ?? this.centered(line ? 2_286_000 : 1_828_800, line ? 0 : 1_371_600), this.nextName(this.labels.shapeNames.shape))], LOCAL_ORIGIN)
    if (key) this.selectShapes([key])
    return key
  }

  async insertImage(bytes: Uint8Array, mimeType: string, size?: { width: number; height: number }, description = ''): Promise<string | undefined> {
    if (!this.guard()) return undefined
    const slide = this.slideKey!
    const asset = await this.assets.put(bytes, mimeType)
    const slideSize = this.size()
    const maxWidth = slideSize.width * 0.6
    const maxHeight = slideSize.height * 0.6
    const width = size?.width ?? 400
    const height = size?.height ?? 300
    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    const xfrm = this.centered(Math.round(width * scale * EMU_PER_PX), Math.round(height * scale * EMU_PER_PX))
    const part = commands.addImagePart(this.doc, asset, LOCAL_ORIGIN)
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
    const index = Math.min(...keys.map((key) => order.indexOf(key)))
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

  setLayout(layoutPath: string, keys = this.state.slides): void {
    if (this.readOnly) return
    for (const key of keys) commands.setSlideLayout(this.doc, this.deck(), key, layoutPath, LOCAL_ORIGIN)
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
    if (current) commands.setXfrm(this.doc, this.slideKey!, shapeKey, xfrm, LOCAL_ORIGIN)
    else {
      // Placeholders inherit their transform; the first move gives them their own.
      const inherited = this.shapeXfrm(this.slideKey!, shapeKey)
      commands.setXfrm(this.doc, this.slideKey!, shapeKey, { ...inherited, ...xfrm }, LOCAL_ORIGIN)
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

  /** Aligns selected shapes to each other (or to the slide when one is selected). */
  align(edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
    if (!this.guard() || !this.state.shapes.length) return
    const xfrms = this.state.shapes.map((key) => [key, this.shapeXfrm(this.slideKey!, key)] as const).filter((entry): entry is readonly [string, Xfrm] => entry[1] !== undefined)
    const size = this.size()
    const bounds = xfrms.length > 1 ? commands.boundsOf(xfrms.map(([, xfrm]) => xfrm)) : { x: 0, y: 0, cx: size.width * EMU_PER_PX, cy: size.height * EMU_PER_PX }
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

  /** Spaces three or more shapes evenly between the outermost ones. */
  distribute(axis: 'horizontal' | 'vertical'): void {
    if (!this.guard() || this.state.shapes.length < 3) return
    const horizontal = axis === 'horizontal'
    const xfrms = this.state.shapes
      .map((key) => [key, this.shapeXfrm(this.slideKey!, key)] as const)
      .filter((entry): entry is readonly [string, Xfrm] => entry[1] !== undefined)
      .sort((a, b) => (horizontal ? a[1].x - b[1].x : a[1].y - b[1].y))
    const start = horizontal ? xfrms[0]![1].x : xfrms[0]![1].y
    const last = xfrms[xfrms.length - 1]![1]
    const end = horizontal ? last.x + last.cx : last.y + last.cy
    const total = xfrms.reduce((sum, [, xfrm]) => sum + (horizontal ? xfrm.cx : xfrm.cy), 0)
    const gap = (end - start - total) / (xfrms.length - 1)
    let position = start
    this.doc.transact(() => {
      for (const [key, xfrm] of xfrms) {
        this.setXfrm(key, horizontal ? { x: position } : { y: position })
        position += (horizontal ? xfrm.cx : xfrm.cy) + gap
      }
    }, LOCAL_ORIGIN)
  }

  // Text formatting: the live editor's selection while editing, else all text of selected shapes.

  setMark(type: RunMark, value: MarkValue): void {
    if (this.readOnly) return
    if (this.activeEditor && this.state.editing) {
      this.activeEditor.run(setMarkCommand(type, value))
      return
    }
    this.editSelectedText((json) => markAll(json, type, value))
  }

  editParagraphs(edit: ParagraphEdit): void {
    if (this.readOnly) return
    if (this.activeEditor && this.state.editing) {
      this.activeEditor.run(paragraphCommand(edit))
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

  private inheritedBullet(): boolean {
    const target = this.state.editing?.shape ?? this.state.shapes[0]
    if (!this.slideKey || !target) return false
    const layout = this.textLayout(this.slideKey, target)
    if (!layout) return false
    const bullet = resolveLevel([...layout.context.chain, layout.context.own], 0).paragraph.children.bullet
    return bullet !== undefined && bullet.localName !== 'buNone'
  }

  private editSelectedText(edit: (json: NonNullable<ShapeSnapshot['text']>) => NonNullable<ShapeSnapshot['text']>): void {
    if (!this.guard()) return
    this.doc.transact(() => {
      for (const key of this.state.shapes) {
        const shape = this.shape(this.slideKey!, key)
        if (shape?.text) commands.setShapeText(this.doc, this.slideKey!, key, edit(shape.text), LOCAL_ORIGIN)
      }
    }, LOCAL_ORIGIN)
  }

  formatState(): FormatState {
    const editor = this.state.editing ? this.activeEditor : undefined
    const shape = !editor && this.slideKey && this.state.shapes[0] ? this.shape(this.slideKey, this.state.shapes[0]) : undefined
    const layout = this.slideKey && (this.state.editing?.shape ?? this.state.shapes[0]) ? this.textLayout(this.slideKey, this.state.editing?.shape ?? this.state.shapes[0]!) : undefined
    const value = (type: RunMark): MarkValue => (editor ? markValueAt(editor.view.state, type) : shape?.text ? markValueIn(shape.text, type) : undefined)
    const paragraph = editor ? paragraphAt(editor.view.state) : undefined
    const pPr = (paragraph?.attrs.pPr ?? shape?.text?.content?.[0]?.attrs?.pPr) as string | null | undefined
    const inheritedRun = layout ? paragraphStyleRun(layout, pPr) : undefined
    const truthy = (mark: MarkValue, inherited: string | undefined) => (mark === undefined ? inherited === '1' || inherited === 'true' : mark === true || mark === '1')
    const underline = value('u')
    const strike = value('strike')
    const size = value('sz') ?? inheritedRun?.attrs.sz
    return {
      bold: truthy(value('b'), inheritedRun?.attrs.b),
      italic: truthy(value('i'), inheritedRun?.attrs.i),
      underline: underline === undefined ? (inheritedRun?.attrs.u ?? 'none') !== 'none' : underline !== 'none',
      strike: strike === undefined ? (inheritedRun?.attrs.strike ?? 'noStrike') !== 'noStrike' : strike !== 'noStrike',
      ...(size !== undefined ? { fontSize: Number(size) / 100 } : {}),
      ...(typeof value('font') === 'string' ? { fontFamily: value('font') as string } : {}),
      ...(pPr && /algn="(\w+)"/.exec(pPr) ? { align: /algn="(\w+)"/.exec(pPr)![1] } : {}),
      bullets: pPr && /buAutoNum/.test(pPr) ? 'number' : pPr && /buNone/.test(pPr) ? 'none' : pPr && /buChar/.test(pPr) ? 'char' : this.inheritedBullet() ? 'char' : 'none',
      canFormatText: !!editor || !!shape?.text,
    }
  }

  // Clipboard

  async copy(): Promise<{ json: string; text: string } | undefined> {
    if (!this.slideKey) return undefined
    if (this.state.shapes.length) {
      const shapes = commands.readShapes(this.doc, this.slideKey, this.state.shapes)
      const text = shapes.map((shape) => (shape.text ? textToPlain(shape.text) : '')).filter(Boolean).join('\n')
      return { json: JSON.stringify(await copyContent(this.doc, this.assets, { shapes }, text)), text }
    }
    const slides = this.state.slides.map((key) => this.slide(key)).filter((slide): slide is SlideSnapshot => slide !== undefined)
    const text = slides.map((slide) => slide.shapes.map((shape) => (shape.text ? textToPlain(shape.text) : '')).filter(Boolean).join('\n')).join('\n\n')
    return { json: JSON.stringify(await copyContent(this.doc, this.assets, { slides }, text)), text }
  }

  async paste(json: string, target: 'auto' | 'slides' = 'auto'): Promise<boolean> {
    if (this.readOnly) return false
    const clipboard: PresentationClipboard | undefined = parseClipboard(json)
    if (!clipboard) return false
    if (clipboard.kind === 'slides' || target === 'slides') {
      const index = this.slideKey ? this.slideKeys().indexOf(this.slideKey) + 1 : this.slideKeys().length
      const keys = await pasteSlides(this.doc, this.assets, clipboard, index, LOCAL_ORIGIN)
      if (keys[0]) this.setState({ slide: keys[0], slides: keys, shapes: [] })
      return true
    }
    if (!this.slideKey) return false
    const sameSlide = (clipboard.shapes ?? []).every((shape) => commands.shapeMap(this.doc, this.slideKey!, shape.key))
    const keys = await pasteShapes(this.doc, this.assets, clipboard, this.slideKey, sameSlide ? 182_880 : 0, LOCAL_ORIGIN)
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
