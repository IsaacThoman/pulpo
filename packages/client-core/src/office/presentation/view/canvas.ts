import { minOf, maxOf } from '../../../collections.js'
import * as Y from 'yjs'
import { cellFragment, ensureNotes, shapeFragment, slideMap } from '../commands.js'
import type { Xfrm } from '../model.js'
import { EMU_PER_PX } from '../render/env.js'
import { slideEnvironment } from '../render/slide.js'
import { bodyLayout, textFrameStyles } from '../render/text.js'
import { serializeNode, parseFragment } from '../xml.js'
import { LOCAL_ORIGIN, type ChangeSet, type EditingTarget, type PresentationController } from './controller.js'
import { readClipboard, writeClipboard } from './clipboard-io.js'
import { MediaPlayer } from './media.js'
import { ensureStyles } from './styles.js'
import { InlineTextEditor, type TextEditorStyle } from './text-editor.js'

/**
 * The single-slide editing canvas. The slide is drawn by the HTML renderer into a layer scaled to
 * the zoom; selection handles, guides, and collaborators' selections live in an unscaled overlay;
 * the inline text editor sits in its own scaled layer so redraws of the slide never disturb it.
 *
 * Gestures write to the model as they go (so collaborators see a shape move), grouped into one
 * undo step per gesture.
 */

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

interface Gesture {
  slide: string
  kind: 'move' | 'resize' | 'rotate' | 'marquee'
  pointerId: number
  startX: number
  startY: number
  handle?: Handle
  /** Transforms when the gesture started, by shape key. */
  start: Map<string, Xfrm>
  end: () => void
  moved: boolean
  marqueeAdd?: string[]
  /** A click (no drag) on the shape that was already selected alone edits its text, as in Google Slides. */
  clickToEdit?: string
}

/** Where the caret goes when an editor opens from a click (client coordinates). */
interface CaretPoint {
  x: number
  y: number
  /** Select the word there (a double click). */
  word: boolean
}

export interface SlideCanvasOptions {
  /** Called on right-click or long press, with the shape under the pointer (if any). */
  onContextMenu?(event: MouseEvent, shapeKey: string | undefined): void
  /** Opens a link the user clicked; the canvas only passes http(s) and mailto URLs. */
  onOpenLink?(url: string): void
}

const SNAP_PX = 6
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url)
}

export class SlideCanvas {
  readonly element: HTMLElement
  private readonly viewport: HTMLElement
  private readonly stage: HTMLElement
  private readonly host: HTMLElement
  private readonly slideLayer: HTMLElement
  private readonly editorLayer: HTMLElement
  private readonly overlay: HTMLElement
  private zoom = 1
  private fit = true
  private gesture?: Gesture
  private editor?: InlineTextEditor
  /** What the open editor edits (slide, shape, row, column), to notice a switch to another cell. */
  private editorTarget?: string
  private editorFrame?: HTMLElement
  private readonly unsubscribe: () => void
  private readonly resizeObserver?: ResizeObserver
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pinch?: { distance: number; zoom: number }
  private lastTap = { time: 0, key: '' as string | undefined }
  /** The caret position for the editor the next `startEditing` opens. */
  private pendingCaret?: CaretPoint
  /** When a click on a selected shape opened its editor: the double click that follows selects a word. */
  private clickEdit?: { time: number; x: number; y: number }
  /** A press and release on the selected shape, waiting for its click event (see onPointerUp). */
  private pendingClickEdit?: { key: string; target: Element | null; x: number; y: number }
  private renderedKey = ''
  private readonly media: MediaPlayer

  constructor(
    container: HTMLElement,
    private readonly controller: PresentationController,
    private readonly options: SlideCanvasOptions = {},
  ) {
    ensureStyles(container.ownerDocument)
    this.media = new MediaPlayer(controller)
    this.element = document.createElement('div')
    this.element.className = 'pp-canvas'
    this.element.tabIndex = 0
    this.element.setAttribute('role', 'application')
    this.viewport = div('pp-canvas-viewport')
    this.stage = div('pp-canvas-stage')
    this.host = div('pp-canvas-host')
    this.slideLayer = div('pp-canvas-slide')
    this.editorLayer = div('pp-canvas-editor')
    this.overlay = div('pp-canvas-overlay')
    this.host.append(this.slideLayer, this.editorLayer)
    this.stage.append(this.host, this.overlay)
    this.viewport.append(this.stage)
    this.element.append(this.viewport)
    container.append(this.element)

    this.unsubscribe = controller.subscribe((change) => this.onChange(change))
    this.element.addEventListener('pointerdown', this.onPointerDown)
    this.element.addEventListener('pointermove', this.onPointerMove)
    this.element.addEventListener('pointerup', this.onPointerUp)
    this.element.addEventListener('pointercancel', this.onPointerUp)
    this.element.addEventListener('dblclick', this.onDoubleClick)
    this.element.addEventListener('keydown', this.onKeyDown)
    this.element.addEventListener('contextmenu', this.onContextMenu)
    this.element.addEventListener('wheel', this.onWheel, { passive: false })
    this.element.addEventListener('copy', this.onCopy)
    this.element.addEventListener('cut', this.onCut)
    this.element.addEventListener('paste', this.onPaste)
    this.element.addEventListener('click', this.onClick)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.layout())
      this.resizeObserver.observe(this.element)
    }
    this.render()
  }

  destroy(): void {
    this.cancelGesture()
    this.stopEditing()
    this.unsubscribe()
    this.resizeObserver?.disconnect()
    this.media.stop()
    this.element.remove()
  }

  getZoom(): number {
    return this.zoom
  }

  /** Sets the zoom (1 = 100%); `fit` scales the slide to the available width and height. */
  setZoom(zoom: number | 'fit'): void {
    this.fit = zoom === 'fit'
    if (zoom !== 'fit') this.zoom = Math.min(8, Math.max(0.1, zoom))
    this.layout()
  }

  focus(): void {
    this.element.focus({ preventScroll: true })
  }

  // -------------------------------------------------------------------------------------------
  // Drawing

  private layout(): void {
    const size = this.controller.size()
    if (this.fit) {
      const available = { width: Math.max(100, this.element.clientWidth - 48), height: Math.max(100, this.element.clientHeight - 48) }
      this.zoom = Math.max(0.1, Math.min(available.width / size.width, available.height / size.height))
    }
    this.stage.style.width = `${size.width * this.zoom}px`
    this.stage.style.height = `${size.height * this.zoom}px`
    this.host.style.width = `${size.width}px`
    this.host.style.height = `${size.height}px`
    this.host.style.transform = `scale(${this.zoom})`
    this.drawOverlay()
  }

  private onChange(change: ChangeSet): void {
    this.editor?.setReadOnly(this.controller.readOnly)
    const slide = this.controller.state.slide
    if (this.gesture && (this.controller.readOnly || this.gesture.slide !== slide)) this.cancelGesture()
    const editing = this.controller.state.editing
    // Moving to another shape or table cell restarts the editor on that text.
    const target = editing ? `${editing.slide}\u0000${editing.shape}\u0000${editing.row ?? ''}\u0000${editing.column ?? ''}` : undefined
    if (this.editor && (!editing || editing.slide !== slide || target !== this.editorTarget)) this.stopEditing()
    if (editing && !this.editor && !this.controller.readOnly) {
      this.editorTarget = target
      this.startEditing(editing.shape, editing.row, editing.column)
    }
    if (change.parts || change.assets || change.order || change.selection || (slide && change.slides.has(slide))) this.render()
    else if (change.presence) this.drawOverlay()
    if (this.editor && this.controller.state.editing && slide && (change.slides.has(slide) || change.parts)) this.refreshEditorFrame()
  }

  private render(): void {
    const slide = this.controller.state.slide
    const hidden = this.controller.state.editing ? new Set([this.controller.state.editing.shape]) : undefined
    const key = slide ? `${slide}|${this.controller.slideVersion(slide)}|${[...(hidden ?? [])].join()}` : ''
    if (key !== this.renderedKey) {
      this.renderedKey = key
      // Media plays only on its own slide.
      if (this.media.slide && this.media.slide !== slide) this.media.stop()
      this.slideLayer.innerHTML = slide ? this.controller.slideHtml(slide, this.controller.readOnly ? 'view' : 'edit', 'canvas', hidden) : ''
    }
    this.layout()
  }

  /** Shape boxes in slide px, read back from the rendered DOM (placeholders inherit theirs). */
  private boxOf(key: string): { left: number; top: number; width: number; height: number; rot: number } | undefined {
    const element = this.slideLayer.querySelector<HTMLElement>(`.pp-slide > [data-key="${cssEscape(key)}"]`)
    if (!element) return undefined
    return { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight, rot: Number(element.dataset.rot ?? 0) }
  }

  private drawOverlay(): void {
    const { shapes, editing, slide } = this.controller.state
    const zoom = this.zoom
    const parts: string[] = []
    for (const remote of this.controller.remoteSelections()) {
      if (remote.slide !== slide) continue
      for (const key of remote.shapes) {
        const box = this.boxOf(key)
        if (!box) continue
        parts.push(
          `<div class="pp-remote" style="left:${box.left * zoom}px;top:${box.top * zoom}px;width:${box.width * zoom}px;height:${box.height * zoom}px;transform:rotate(${box.rot}deg);--pp-remote:${remote.color}"><span class="pp-remote-name">${escapeHtml(remote.name)}</span></div>`,
        )
      }
    }
    for (const key of shapes) {
      const box = this.boxOf(key)
      if (!box) continue
      const handles = shapes.length === 1 && !editing && !this.controller.readOnly
      parts.push(
        `<div class="pp-selection${editing?.shape === key ? ' pp-selection-editing' : ''}" data-selection="${escapeHtml(key)}" style="left:${box.left * zoom}px;top:${box.top * zoom}px;width:${Math.max(1, box.width * zoom)}px;height:${Math.max(1, box.height * zoom)}px;transform:rotate(${box.rot}deg)">${
          handles ? HANDLES.map((handle) => `<span class="pp-handle pp-handle-${handle}" data-handle="${handle}"></span>`).join('') + '<span class="pp-handle pp-handle-rotate" data-handle="rotate"></span>' : ''
        }</div>`,
      )
    }
    if (this.gesture?.kind === 'marquee' && this.gesture.moved) parts.push(this.marqueeHtml())
    parts.push(this.guides)
    this.overlay.innerHTML = parts.join('')
  }

  private guides = ''
  private marqueeRect = { left: 0, top: 0, width: 0, height: 0 }

  private marqueeHtml(): string {
    const rect = this.marqueeRect
    return `<div class="pp-marquee" style="left:${rect.left * this.zoom}px;top:${rect.top * this.zoom}px;width:${rect.width * this.zoom}px;height:${rect.height * this.zoom}px"></div>`
  }

  // -------------------------------------------------------------------------------------------
  // Pointer input

  /** A pointer position in slide px. */
  private slidePoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / this.zoom, y: (event.clientY - rect.top) / this.zoom }
  }

  private shapeAt(target: EventTarget | null): string | undefined {
    if (!(target instanceof Element)) return undefined
    const selection = target.closest<HTMLElement>('[data-selection]')
    if (selection) return selection.dataset.selection
    const shape = target.closest<HTMLElement>('.pp-slide > [data-key]')
    return shape?.dataset.key
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: this.zoom }
      this.cancelGesture()
      return
    }
    if (event.button !== 0 || this.controller.readOnly) return
    const target = event.target as Element
    // The editor frame handles clicks beside the text itself (see startEditing).
    if (target.closest('.pp-text-editor') || target.closest('.pp-editor-frame') || target.closest('.pp-media')) return
    const slide = this.controller.state.slide
    if (!slide) return
    this.focus()
    const handle = target instanceof HTMLElement ? (target.dataset.handle as Handle | undefined) : undefined
    const point = this.slidePoint(event)
    const key = this.shapeAt(target)
    if (this.controller.state.editing && key !== this.controller.state.editing.shape) this.controller.setState({ editing: undefined })
    // Touch: a second tap on a shape enters text editing, like a double click.
    if (event.pointerType === 'touch' && key && this.lastTap.key === key && Date.now() - this.lastTap.time < 350) {
      this.lastTap = { time: 0, key: undefined }
      this.beginEditing(key, event, { x: event.clientX, y: event.clientY, word: false })
      return
    }
    this.lastTap = { time: Date.now(), key }
    if (handle) {
      this.beginGesture(event, handle === 'rotate' ? 'rotate' : 'resize', this.controller.state.shapes, handle)
      return
    }
    if (!key) {
      this.controller.selectShapes(event.shiftKey ? this.controller.state.shapes : [])
      this.beginGesture(event, 'marquee', [], undefined, event.shiftKey ? this.controller.state.shapes : [])
      this.marqueeRect = { left: point.x, top: point.y, width: 0, height: 0 }
      return
    }
    let selection = this.controller.state.shapes
    const modified = event.shiftKey || event.metaKey || event.ctrlKey
    // While editing a table cell, a click on another cell of that table moves the editor there.
    const editing = this.controller.state.editing
    const alone = !modified && selection.length === 1 && selection[0] === key && (!editing || (editing.shape === key && editing.row !== undefined))
    if (modified) selection = selection.includes(key) ? selection.filter((entry) => entry !== key) : [...selection, key]
    else if (!selection.includes(key)) selection = [key]
    this.controller.selectShapes(selection)
    // Touch keeps its double tap: a single tap on a selected shape must not raise the keyboard.
    if (selection.includes(key)) this.beginGesture(event, 'move', selection, undefined, undefined, alone && event.pointerType !== 'touch' ? key : undefined)
  }

  private beginGesture(event: PointerEvent, kind: Gesture['kind'], keys: string[], handle?: Handle, marqueeAdd?: string[], clickToEdit?: string): void {
    const slide = this.controller.state.slide!
    const start = new Map<string, Xfrm>()
    for (const key of keys) {
      const xfrm = this.controller.shapeXfrm(slide, key)
      if (xfrm) start.set(key, xfrm)
    }
    this.element.setPointerCapture?.(event.pointerId)
    this.gesture = {
      slide,
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ...(handle ? { handle } : {}),
      start,
      end: kind === 'marquee' ? () => undefined : this.controller.beginGesture(),
      moved: false,
      ...(marqueeAdd ? { marqueeAdd } : {}),
      ...(clickToEdit ? { clickToEdit } : {}),
    }
  }

  private cancelGesture(): void {
    this.gesture?.end()
    this.gesture = undefined
    this.guides = ''
    this.drawOverlay()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.setZoom((this.pinch.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / Math.max(1, this.pinch.distance))
      return
    }
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (this.controller.readOnly || gesture.slide !== this.controller.state.slide) {
      this.cancelGesture()
      return
    }
    const dx = (event.clientX - gesture.startX) / this.zoom
    const dy = (event.clientY - gesture.startY) / this.zoom
    if (!gesture.moved && Math.hypot(dx, dy) * this.zoom < 3) return
    gesture.moved = true
    if (gesture.kind === 'marquee') this.updateMarquee(gesture, event)
    else if (gesture.kind === 'move') this.updateMove(gesture, dx, dy, event.shiftKey)
    else if (gesture.kind === 'resize') this.updateResize(gesture, dx, dy, event.shiftKey)
    else this.updateRotate(gesture, event, event.shiftKey)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId)
    if (this.pointers.size < 2) this.pinch = undefined
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    this.gesture = undefined
    gesture.end()
    this.guides = ''
    this.drawOverlay()
    this.pendingClickEdit = undefined
    if (event.type === 'pointerup' && gesture.kind === 'move' && !gesture.moved && gesture.clickToEdit && !this.controller.readOnly) {
      // Pointer capture retargets the event to the canvas; find what is under the pointer.
      const target = this.element.ownerDocument.elementFromPoint(event.clientX, event.clientY)
      // The editor opens on the click that follows: redrawing the slide now would remove the
      // pressed element, and the browser would then send no click or double click at all.
      if (this.shapeAt(target) === gesture.clickToEdit && this.clickEdits(gesture.clickToEdit)) this.pendingClickEdit = { key: gesture.clickToEdit, target, x: event.clientX, y: event.clientY }
    }
  }

  /**
   * Whether clicking the selected shape again edits its text: text boxes, placeholders, shapes
   * with text, and table cells. An empty rectangle stays selected, so a second press can drag it.
   */
  private clickEdits(key: string): boolean {
    const slide = this.controller.state.slide
    const shape = slide ? this.controller.shape(slide, key) : undefined
    if (!shape) return false
    if (shape.table) return true
    if (shape.kind !== 'sp') return false
    const text = shape.text?.content?.some((paragraph) => paragraph.content?.length) === true
    return text || /<p:cNvSpPr\b[^>]*\btxBox="(1|true)"|<p:ph\b/.test(shape.xml)
  }

  private updateMarquee(gesture: Gesture, event: PointerEvent): void {
    const start = this.slidePoint({ clientX: gesture.startX, clientY: gesture.startY })
    const now = this.slidePoint(event)
    this.marqueeRect = { left: Math.min(start.x, now.x), top: Math.min(start.y, now.y), width: Math.abs(now.x - start.x), height: Math.abs(now.y - start.y) }
    const rect = this.marqueeRect
    const inside: string[] = []
    this.slideLayer.querySelectorAll<HTMLElement>('.pp-slide > [data-key]').forEach((element) => {
      const left = element.offsetLeft
      const top = element.offsetTop
      if (left >= rect.left && top >= rect.top && left + element.offsetWidth <= rect.left + rect.width && top + element.offsetHeight <= rect.top + rect.height) inside.push(element.dataset.key!)
    })
    const merged = [...new Set([...(gesture.marqueeAdd ?? []), ...inside])]
    this.controller.state = { ...this.controller.state, shapes: merged }
    this.drawOverlay()
    if (event.type === 'pointermove') queueMicrotask(() => this.controller.selectShapes(merged))
  }

  /** Snaps a moving box to slide edges/center and other shapes; returns the offset and guide lines. */
  private snap(box: { x: number; y: number; w: number; h: number }, moving: Set<string>): { dx: number; dy: number; guides: string } {
    const size = this.controller.size()
    const xs = [0, size.width / 2, size.width]
    const ys = [0, size.height / 2, size.height]
    this.slideLayer.querySelectorAll<HTMLElement>('.pp-slide > [data-key]').forEach((element) => {
      if (moving.has(element.dataset.key!) || element.dataset.rot !== '0') return
      xs.push(element.offsetLeft, element.offsetLeft + element.offsetWidth / 2, element.offsetLeft + element.offsetWidth)
      ys.push(element.offsetTop, element.offsetTop + element.offsetHeight / 2, element.offsetTop + element.offsetHeight)
    })
    const threshold = SNAP_PX / this.zoom
    const best = (edges: number[], targets: number[]) => {
      let result: { delta: number; at: number } | undefined
      for (const edge of edges) {
        for (const target of targets) {
          const delta = target - edge
          if (Math.abs(delta) <= threshold && (!result || Math.abs(delta) < Math.abs(result.delta))) result = { delta, at: target }
        }
      }
      return result
    }
    const x = best([box.x, box.x + box.w / 2, box.x + box.w], xs)
    const y = best([box.y, box.y + box.h / 2, box.y + box.h], ys)
    let guides = ''
    if (x) guides += `<div class="pp-guide pp-guide-v" style="left:${x.at * this.zoom}px"></div>`
    if (y) guides += `<div class="pp-guide pp-guide-h" style="top:${y.at * this.zoom}px"></div>`
    return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides }
  }

  private updateMove(gesture: Gesture, dx: number, dy: number, constrain: boolean): void {
    if (constrain) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    const boxes = [...gesture.start.values()]
    if (!boxes.length) return
    const left = minOf(boxes.map((xfrm) => xfrm.x)) / EMU_PER_PX + dx
    const top = minOf(boxes.map((xfrm) => xfrm.y)) / EMU_PER_PX + dy
    const right = maxOf(boxes.map((xfrm) => xfrm.x + xfrm.cx)) / EMU_PER_PX + dx
    const bottom = maxOf(boxes.map((xfrm) => xfrm.y + xfrm.cy)) / EMU_PER_PX + dy
    const snapped = this.snap({ x: left, y: top, w: right - left, h: bottom - top }, new Set(gesture.start.keys()))
    this.guides = snapped.guides
    this.controller.doc.transact(() => {
      for (const [key, xfrm] of gesture.start) {
        const next = { x: xfrm.x + (dx + snapped.dx) * EMU_PER_PX, y: xfrm.y + (dy + snapped.dy) * EMU_PER_PX }
        this.controller.setXfrm(key, next)
      }
    }, LOCAL_ORIGIN)
  }

  private updateResize(gesture: Gesture, dx: number, dy: number, keepAspect: boolean): void {
    const [key, start] = [...gesture.start.entries()][0] ?? []
    if (!key || !start) return
    const handle = gesture.handle!
    // Work in the shape's own (unrotated) frame so rotated shapes resize along their axes.
    const angle = ((start.rot ?? 0) / 60000) * (Math.PI / 180)
    const localX = (dx * Math.cos(angle) + dy * Math.sin(angle)) * EMU_PER_PX
    const localY = (-dx * Math.sin(angle) + dy * Math.cos(angle)) * EMU_PER_PX
    let { cx, cy } = start
    const west = handle.includes('w')
    const north = handle.includes('n')
    if (handle.includes('e')) cx = start.cx + localX
    if (west) cx = start.cx - localX
    if (handle.includes('s')) cy = start.cy + localY
    if (north) cy = start.cy - localY
    const picture = this.controller.shape(this.controller.state.slide!, key)?.kind === 'pic'
    if ((keepAspect || (picture && handle.length === 2)) && start.cx > 0 && start.cy > 0) {
      const scale = handle.length === 2 ? Math.max(cx / start.cx, cy / start.cy) : handle === 'n' || handle === 's' ? cy / start.cy : cx / start.cx
      cx = start.cx * scale
      cy = start.cy * scale
    }
    const flipH = cx < 0 ? !start.flipH : start.flipH
    const flipV = cy < 0 ? !start.flipV : start.flipV
    // Keep the opposite edge fixed: move the center by half the growth along the rotated axes.
    // Signed sizes, so dragging past the opposite edge puts the shape on the pointer's side.
    const shiftX = (west ? -(cx - start.cx) : handle.includes('e') ? cx - start.cx : 0) / 2
    const shiftY = (north ? -(cy - start.cy) : handle.includes('s') ? cy - start.cy : 0) / 2
    cx = Math.abs(cx)
    cy = Math.abs(cy)
    const centerX = start.x + start.cx / 2 + shiftX * Math.cos(angle) - shiftY * Math.sin(angle)
    const centerY = start.y + start.cy / 2 + shiftX * Math.sin(angle) + shiftY * Math.cos(angle)
    this.controller.setXfrm(key, { x: centerX - cx / 2, y: centerY - cy / 2, cx, cy, flipH: flipH ?? false, flipV: flipV ?? false })
  }

  private updateRotate(gesture: Gesture, event: PointerEvent, snap: boolean): void {
    const [key, start] = [...gesture.start.entries()][0] ?? []
    if (!key || !start) return
    const center = { x: (start.x + start.cx / 2) / EMU_PER_PX, y: (start.y + start.cy / 2) / EMU_PER_PX }
    const point = this.slidePoint(event)
    let degrees = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90
    degrees = ((degrees % 360) + 360) % 360
    if (snap) degrees = Math.round(degrees / 15) * 15
    else if (Math.abs(degrees - Math.round(degrees / 90) * 90) < 3) degrees = Math.round(degrees / 90) * 90
    this.controller.setXfrm(key, { rot: Math.round((degrees % 360) * 60000) })
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (this.controller.readOnly) return
    const point = { x: event.clientX, y: event.clientY }
    // The click before this one opened the editor: the double click selects the word, as it
    // would have had the editor been open already.
    const clickEdit = this.clickEdit
    this.clickEdit = undefined
    if (this.editor && clickEdit && Date.now() - clickEdit.time < 1000 && Math.hypot(clickEdit.x - point.x, clickEdit.y - point.y) < 6) {
      this.editor.caretAt(point, true)
      return
    }
    // Pointer capture during the click retargets it to the canvas; find what is under the pointer.
    const target = this.element.ownerDocument.elementFromPoint(event.clientX, event.clientY)
    const key = this.shapeAt(target)
    if (key) this.beginEditing(key, { target }, { ...point, word: true })
  }

  /** Enters text editing in a shape (or the table cell under the pointer), with the caret at `caret` or the end. */
  private beginEditing(key: string, event?: { target: EventTarget | null }, caret?: CaretPoint): void {
    if (this.controller.readOnly) return
    const slide = this.controller.state.slide
    if (!slide) return
    const shape = this.controller.shape(slide, key)
    if (!shape) return
    this.pendingCaret = caret
    if (shape.table) {
      const cell = event?.target instanceof Element ? event.target.closest('td') : null
      const table = this.controller.shape(slide, key)!.table!
      if (!cell) return
      // The renderer writes each cell's grid position: merged-away cells are not in the HTML, so
      // counting cells (or their spans) misses those a row span from above covers.
      const rowIndex = Number((cell as HTMLElement).dataset.row)
      const column = Number((cell as HTMLElement).dataset.col)
      if (!Number.isInteger(rowIndex) || !Number.isInteger(column)) return
      const rowKey = table.rows[rowIndex]?.key
      const columnKey = table.columns[column]?.key
      if (rowKey && columnKey) this.edit({ slide, shape: key, row: rowKey, column: columnKey }, caret)
      return
    }
    if (shape.kind !== 'sp') return
    this.edit({ slide, shape: key }, caret)
  }

  private edit(target: EditingTarget, caret: CaretPoint | undefined): void {
    const current = this.controller.state.editing
    const same = current && current.slide === target.slide && current.shape === target.shape && current.row === target.row && current.column === target.column
    // Already editing that text: only the caret moves.
    if (same && this.editor) {
      this.pendingCaret = undefined
      if (caret) this.editor.caretAt(caret, caret.word)
      return
    }
    this.controller.setState({ shapes: [target.shape], editing: target })
  }

  // -------------------------------------------------------------------------------------------
  // Inline text editing

  private startEditing(shapeKey: string, rowKey?: string, columnKey?: string): void {
    const slide = this.controller.state.slide
    if (!slide) return
    const fragment = rowKey && columnKey ? cellFragment(this.controller.doc, slide, shapeKey, rowKey, columnKey) : shapeFragment(this.controller.doc, slide, shapeKey, LOCAL_ORIGIN)
    if (!(fragment instanceof Y.XmlFragment)) {
      this.controller.setState({ editing: undefined })
      return
    }
    const frame = div('pp-editor-frame')
    this.editorFrame = frame
    // The layer also holds a playing video, which stays.
    this.editorLayer.querySelectorAll('.pp-editor-frame').forEach((element) => element.remove())
    this.editorLayer.append(frame)
    const style = rowKey ? this.cellStyle(frame, shapeKey) : this.shapeStyle(frame, shapeKey)
    if (!style) {
      this.controller.setState({ editing: undefined })
      return
    }
    const mount = frame.querySelector<HTMLElement>('.pp-editor-inner') ?? frame
    // A press in the text box beside the text (padding, below the last line) moves the caret
    // there instead of leaving the editor; the default would also move focus to the canvas.
    frame.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || (event.target as Element).closest?.('.pp-text-editor')) return
      event.preventDefault()
      this.editor?.caretAt({ x: event.clientX, y: event.clientY })
    })
    this.editor = new InlineTextEditor({
      mount,
      fragment,
      ...(this.controller.awareness ? { awareness: this.controller.awareness } : {}),
      style,
      readOnly: this.controller.readOnly,
      onUndo: () => this.controller.undo(),
      onRedo: () => this.controller.redo(),
      onEscape: () => this.controller.setState({ editing: undefined }),
      ...(rowKey && columnKey ? { onTab: (backward: boolean) => this.moveToCell(shapeKey, rowKey, columnKey, backward) } : {}),
      onToggleMark: (mark) => this.controller.toggleMark(mark),
      onSelectionChange: () => {
        this.autofit()
        this.controller.setState({})
      },
    })
    this.controller.activeEditor = this.editor
    const caret = this.pendingCaret
    this.pendingCaret = undefined
    if (!caret || !this.editor.caretAt(caret, caret.word)) this.editor.focus()
    this.autofit()
  }

  /** Tab in a table cell: the next (or previous) cell that is not merged away, as in PowerPoint. */
  private moveToCell(shapeKey: string, rowKey: string, columnKey: string, backward: boolean): boolean {
    const slide = this.controller.state.slide
    const table = slide ? this.controller.shape(slide, shapeKey)?.table : undefined
    if (!slide || !table) return false
    const cells = table.rows.flatMap((row) => table.columns.filter((column) => row.cells[column.key] && !row.cells[column.key]!.hMerge && !row.cells[column.key]!.vMerge).map((column) => ({ row: row.key, column: column.key })))
    const index = cells.findIndex((cell) => cell.row === rowKey && cell.column === columnKey)
    const next = cells[index + (backward ? -1 : 1)]
    if (index < 0 || !next) return true
    this.controller.setState({ editing: { slide, shape: shapeKey, row: next.row, column: next.column } })
    return true
  }

  /** Lays out the editor frame over a shape exactly where the renderer puts its text. */
  private shapeStyle(frame: HTMLElement, shapeKey: string): TextEditorStyle | undefined {
    const layout = this.controller.textLayout(this.controller.state.slide!, shapeKey)
    if (!layout) return undefined
    const { box, transform } = layout
    frame.setAttribute('style', `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;${transform.rot ? `transform:rotate(${transform.rot}deg);` : ''}`)
    const styles = textFrameStyles(layout.body, layout.rect, { upsideDown: layout.upsideDown })
    frame.innerHTML = `<div class="pp-editor-text" style="${styles.outer}"><div class="pp-editor-inner" style="${styles.inner}" data-placeholder="${escapeHtml(layout.prompt ?? '')}"></div></div>`
    return { context: layout.context, body: layout.body, env: layout.env }
  }

  private cellStyle(frame: HTMLElement, shapeKey: string): TextEditorStyle | undefined {
    const editing = this.controller.state.editing!
    const table = this.controller.shape(editing.slide, shapeKey)?.table
    const shapeElement = this.slideLayer.querySelector<HTMLElement>(`.pp-slide > [data-key="${cssEscape(shapeKey)}"]`)
    const rowIndex = table?.rows.findIndex((row) => row.key === editing.row) ?? -1
    const columnIndex = table?.columns.findIndex((column) => column.key === editing.column) ?? -1
    const cell = shapeElement?.querySelector<HTMLTableCellElement>(`td[data-row="${rowIndex}"][data-col="${columnIndex}"]`) ?? undefined
    const slide = this.controller.slide(editing.slide)
    if (!cell || !shapeElement || !slide) return undefined
    const { env } = slideEnvironment(slide, this.controller.renderOptions('edit', 'editor', editing.slide))
    const left = shapeElement.offsetLeft + cell.offsetLeft
    const top = shapeElement.offsetTop + cell.offsetTop
    const computed = getComputedStyle(cell)
    frame.setAttribute('style', `position:absolute;left:${left}px;top:${top}px;width:${cell.offsetWidth}px;min-height:${cell.offsetHeight}px;background:${computed.backgroundColor};padding:${computed.padding};box-sizing:border-box;white-space:pre-wrap;--pp-fs:1`)
    frame.innerHTML = '<div class="pp-editor-inner"></div>'
    const deck = this.controller.deck()
    return {
      context: { chain: [deck.defaultTextStyle()], theme: env.theme, colors: env.colors },
      body: bodyLayout([]),
      env,
    }
  }

  private refreshEditorFrame(): void {
    const editing = this.controller.state.editing
    if (!editing || !this.editor || !this.editorFrame) return
    if (editing.row) return
    const layout = this.controller.textLayout(editing.slide, editing.shape)
    if (!layout) return
    const { box, transform } = layout
    Object.assign(this.editorFrame.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, transform: transform.rot ? `rotate(${transform.rot}deg)` : '' })
    const text = this.editorFrame.querySelector<HTMLElement>('.pp-editor-text')
    const styles = textFrameStyles(layout.body, layout.rect, { upsideDown: layout.upsideDown })
    if (text && text.dataset.style !== styles.outer) {
      text.setAttribute('style', styles.outer)
      text.dataset.style = styles.outer
    }
    this.editor.setStyle({ context: layout.context, body: layout.body, env: layout.env })
  }

  /**
   * PowerPoint's autofit while typing: "shrink text on overflow" lowers the font scale in 10%
   * steps; "resize shape to fit text" grows the shape. Both are written to the model so everyone
   * (and the saved file) sees the same layout.
   */
  private autofit(): void {
    const editing = this.controller.state.editing
    const text = this.editorFrame?.querySelector<HTMLElement>('.pp-editor-text')
    const inner = this.editorFrame?.querySelector<HTMLElement>('.pp-editor-inner')
    if (!editing || editing.row || !text || !inner) return
    const shape = this.controller.shape(editing.slide, editing.shape)
    const layout = this.controller.textLayout(editing.slide, editing.shape)
    if (!shape || !layout) return
    if (layout.body.autofit === 'shape') {
      const overflow = inner.scrollHeight - text.clientHeight
      if (Math.abs(overflow) > 1) {
        const xfrm = this.controller.shapeXfrm(editing.slide, editing.shape)
        if (xfrm) this.controller.setXfrm(editing.shape, { cy: Math.max(EMU_PER_PX * 10, xfrm.cy + overflow * EMU_PER_PX) })
      }
      return
    }
    if (layout.body.autofit !== 'norm') return
    let scale = 1
    text.style.setProperty('--pp-fs', '1')
    while (inner.scrollHeight > text.clientHeight + 1 && scale > 0.25) {
      scale = Math.round((scale - 0.1) * 100) / 100
      text.style.setProperty('--pp-fs', String(scale))
    }
    if (Math.abs(scale - layout.body.fontScale) < 0.001) return
    const bodyPr = shape.bodyPr ? parseFragment(shape.bodyPr) : parseFragment('<a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>')
    for (const child of Array.from(bodyPr.childNodes)) if ((child as { localName?: string }).localName === 'normAutofit' || (child as { localName?: string }).localName === 'spAutoFit' || (child as { localName?: string }).localName === 'noAutofit') bodyPr.removeChild(child)
    const norm = bodyPr.ownerDocument!.createElementNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'a:normAutofit')
    if (scale < 1) {
      norm.setAttribute('fontScale', String(Math.round(scale * 100000)))
      norm.setAttribute('lnSpcReduction', scale < 0.9 ? '20000' : '10000')
    }
    bodyPr.insertBefore(norm, bodyPr.firstChild)
    this.controller.setShapeProperty('bodyPr', serializeNode(bodyPr))
  }

  private stopEditing(): void {
    if (!this.editor) return
    this.editor.destroy()
    this.editor = undefined
    this.controller.activeEditor = undefined
    this.editorFrame?.remove()
    this.editorFrame = undefined
    this.focus()
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard, clipboard, and other events

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Handled by the text editor already (Escape closing it must not also deselect the shape).
    if (event.defaultPrevented) return
    if (this.editor && (event.target as Element).closest?.('.pp-text-editor')) return
    const controller = this.controller
    const mod = event.metaKey || event.ctrlKey
    const key = event.key
    if (controller.readOnly) return
    if (mod && key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) controller.redo()
      else controller.undo()
      return
    }
    if (mod && key.toLowerCase() === 'y') {
      event.preventDefault()
      controller.redo()
      return
    }
    const shapes = controller.state.shapes
    if ((key === 'Delete' || key === 'Backspace') && shapes.length) {
      event.preventDefault()
      controller.deleteSelection()
    } else if (key.startsWith('Arrow') && shapes.length) {
      event.preventDefault()
      const step = (event.shiftKey ? 10 : event.altKey ? 0.5 : 2) * EMU_PER_PX
      controller.nudge(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0)
    } else if (mod && key.toLowerCase() === 'd') {
      event.preventDefault()
      controller.duplicateSelection()
    } else if (mod && key.toLowerCase() === 'g') {
      event.preventDefault()
      if (event.shiftKey) controller.ungroup()
      else controller.group()
    } else if (mod && key.toLowerCase() === 'a') {
      event.preventDefault()
      controller.selectShapes(controller.slide(controller.state.slide ?? '')?.shapes.map((shape) => shape.key) ?? [])
    } else if (key === 'Escape') {
      controller.selectShapes([])
    } else if ((key === 'Enter' || key === 'F2') && shapes.length === 1) {
      event.preventDefault()
      this.beginEditing(shapes[0]!)
    } else if (key === 'Tab' && !mod) {
      event.preventDefault()
      const all = controller.slide(controller.state.slide ?? '')?.shapes.map((shape) => shape.key) ?? []
      const index = shapes.length ? all.indexOf(shapes[0]!) : -1
      const next = all[(index + (event.shiftKey ? -1 : 1) + all.length) % Math.max(1, all.length)]
      if (next) controller.selectShapes([next])
    } else if ((event.isComposing || key === 'Process') && shapes.length === 1 && controller.shape(controller.state.slide ?? '', shapes[0]!)?.kind === 'sp') {
      // An IME composition starting on a selected shape: open its text so the composition lands there.
      this.beginEditing(shapes[0]!)
      queueMicrotask(() => this.editor?.selectAll())
    } else if (key.length === 1 && !mod && !event.altKey && shapes.length === 1) {
      // Typing into a selected shape replaces its text, as in PowerPoint.
      const shape = controller.shape(controller.state.slide ?? '', shapes[0]!)
      if (shape?.kind !== 'sp') return
      event.preventDefault()
      this.beginEditing(shapes[0]!)
      queueMicrotask(() => {
        if (this.controller.readOnly) return
        this.editor?.selectAll()
        this.editor?.view.dispatch(this.editor.view.state.tr.insertText(key))
      })
    }
  }

  private readonly onCopy = (event: ClipboardEvent): void => {
    if (this.editor || !event.clipboardData) return
    event.preventDefault()
    void this.copyTo().catch(() => {})
  }

  private async copyTo(): Promise<boolean> {
    const copied = await this.controller.copy()
    if (!copied) return false
    await writeClipboard(copied)
    return true
  }

  private readonly onCut = (event: ClipboardEvent): void => {
    if (this.editor || !event.clipboardData || this.controller.readOnly) return
    event.preventDefault()
    void this.copyTo().then((copied) => {
      if (copied) this.controller.deleteSelection()
    }).catch(() => {})
  }

  private readonly onPaste = (event: ClipboardEvent): void => {
    if (this.editor || this.controller.readOnly) return
    event.preventDefault()
    const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'))
    if (image) {
      void image.arrayBuffer().then((buffer) => this.controller.insertImage(new Uint8Array(buffer), image.type))
      return
    }
    const text = event.clipboardData?.getData('text/plain') ?? ''
    void readClipboard(text).then((payload) => {
      if (payload) void this.controller.paste(payload)
      else if (text) this.pasteText(text)
    })
  }

  private pasteText(text: string): void {
    const key = this.controller.insertTextBox()
    if (!key) return
    queueMicrotask(() => { if (!this.controller.readOnly) this.editor?.view.dispatch(this.editor.view.state.tr.insertText(text)) })
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.options.onContextMenu) return
    event.preventDefault()
    const key = this.shapeAt(event.target)
    if (key && !this.controller.state.shapes.includes(key)) this.controller.selectShapes([key])
    this.options.onContextMenu(event, key)
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
  }

  private readonly onClick = (event: MouseEvent): void => {
    const pending = this.pendingClickEdit
    this.pendingClickEdit = undefined
    if (pending && !this.controller.readOnly && Math.hypot(pending.x - event.clientX, pending.y - event.clientY) < 4) {
      this.clickEdit = { time: Date.now(), x: event.clientX, y: event.clientY }
      this.beginEditing(pending.key, { target: pending.target }, { x: event.clientX, y: event.clientY, word: false })
      return
    }
    const target = (this.element.ownerDocument.elementFromPoint(event.clientX, event.clientY) ?? event.target) as Element
    const media = target.closest<HTMLElement>('.pp-media')
    if (media) {
      event.preventDefault()
      const slide = this.controller.state.slide
      if (slide) void this.media.play(media, () => this.controller.state.slide === slide ? this.editorLayer : undefined, slide)
      return
    }
    const link = target.closest<HTMLElement>('[data-href]')
    const href = link?.dataset.href
    if (href && isSafeUrl(href) && (this.controller.readOnly || event.metaKey || event.ctrlKey)) this.options.onOpenLink?.(href)
  }

}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}

/** Notes text fragment for the notes editor. */
export function notesFragment(controller: PresentationController, slideKey: string): Y.XmlFragment | undefined {
  if (controller.readOnly) {
    const notes = slideMap(controller.doc, slideKey)?.get('notes')
    const text = notes instanceof Y.Map ? notes.get('text') : undefined
    return text instanceof Y.XmlFragment ? text : undefined
  }
  return ensureNotes(controller.doc, slideKey, LOCAL_ORIGIN)
}

