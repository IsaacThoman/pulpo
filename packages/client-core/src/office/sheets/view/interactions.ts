import { r1c1ToA1 } from '../formula/translate.js'
import { Stylesheet } from '../styles/stylesheet.js'
import { MAX_EXPANDED_CELLS } from '../limits.js'
import { randomId } from '../model/axis.js'
import { canWriteArrays, contains, intersects, offsetRange, pasteRules, placeRule, snapshotRules } from './clipboard-state.js'
import { moveCells } from '../model/move-cells.js'
import { maxOf, replaceChildrenWith } from '../../../collections.js'
import { cellName, MAX_COLS, MAX_ROWS, rangeContains, type CellRange } from '../address.js'
import type { AutoFilter, ConditionalFormat, DataValidation, DrawingObject, Note, SheetTable, StyleProps } from '../model/schema.js'
import type { CellValue } from '../values.js'
import { isErrorValue } from '../values.js'
import { parseHtml, parseTsv, toHtml, toTsv, cssToRgb, type ClipboardCell, type ClipboardPayload, type ClipboardRule } from './clipboard.js'
import * as commands from './commands.js'
import { fillSeries, fillStructuredFormula } from './fill.js'
import { applyCompletion, argumentHint, completions, partialFunctionName, type FunctionDoc } from './formula-assist.js'
import { POINTS_TO_PIXELS } from './layout.js'
import type { Scene } from './renderer.js'
import { cssFontFamily, EMU_PER_PIXEL, type SheetView } from './sheet-view.js'

/** Invisible content kept selected in the input while not editing, so copy and cut always fire. */
const IDLE_TEXT = '​'

type Drag =
  | { kind: 'select'; add: boolean }
  | { kind: 'rows' | 'cols'; from: number; add: boolean }
  | { kind: 'resize'; axis: 'row' | 'col'; index: number; start: number; size: number; guide: HTMLDivElement }
  | { kind: 'fill'; source: CellRange; target: CellRange }
  | { kind: 'point' }
  | { kind: 'drawing'; id: string; startX: number; startY: number; element: HTMLElement; left: number; top: number; resize: boolean; width: number; height: number }
  | { kind: 'handle'; corner: 'start' | 'end' }

export interface PasteMode {
  values?: boolean
  formats?: boolean
}

export class SheetInteractions {
  private drag: Drag | undefined
  private readonly disposers: (() => void)[] = []
  private composing = false
  private popup: HTMLDivElement | undefined
  private completionList: { element: HTMLDivElement; items: FunctionDoc[]; index: number; start: number; touched: boolean } | undefined
  private hint: HTMLDivElement | undefined
  private message: HTMLDivElement | undefined
  private notePopup: HTMLDivElement | undefined
  private noteTimer: ReturnType<typeof setTimeout> | undefined
  private readonly drawingElements = new Map<string, HTMLElement>()
  private readonly imageUrls = new Map<string, string>()
  private readonly imageLoads = new Map<string, Promise<string | undefined>>()
  private disposed = false
  private selectedDrawing: string | undefined
  private fillOutline: HTMLDivElement | undefined
  private handles: HTMLDivElement[] = []
  private touchMode = false
  private lastTap: { time: number; row: number; col: number } | undefined
  private touchStart: { x: number; y: number; time: number; id: number } | undefined
  private pinch: { distance: number; zoom: number; pointers: Map<number, { x: number; y: number }> } = { distance: 0, zoom: 1, pointers: new Map() }
  private cut: { token: string; sheet: string; range: CellRange; signature: string } | undefined

  constructor(private readonly view: SheetView) {
    const { scroller, input, root } = view
    this.listen(scroller, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent))
    this.listen(window, 'pointermove', (event) => this.onPointerMove(event as PointerEvent))
    this.listen(window, 'pointerup', (event) => this.onPointerUp(event as PointerEvent))
    this.listen(window, 'pointercancel', (event) => this.onPointerUp(event as PointerEvent))
    this.listen(scroller, 'dblclick', (event) => this.onDoubleClick(event as MouseEvent))
    this.listen(scroller, 'pointermove', (event) => this.onHover(event as PointerEvent))
    this.listen(scroller, 'pointerleave', () => this.hideNote())
    this.listen(scroller, 'wheel', (event) => this.onWheel(event as WheelEvent), { passive: false })
    this.listen(scroller, 'contextmenu', (event) => this.onContextMenu(event as MouseEvent))
    this.listen(input, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    this.listen(input, 'input', () => this.onInput())
    this.listen(input, 'compositionstart', () => this.onCompositionStart())
    this.listen(input, 'compositionend', () => {
      this.composing = false
      this.onInput()
    })
    this.listen(input, 'copy', (event) => this.onCopy(event as ClipboardEvent, false))
    this.listen(input, 'cut', (event) => this.onCopy(event as ClipboardEvent, true))
    this.listen(input, 'paste', (event) => this.onPaste(event as ClipboardEvent))
    this.listen(input, 'blur', () => this.closeCompletions())
    // Safari's pinch gestures (iOS and trackpads).
    this.listen(root, 'gesturestart', (event) => {
      event.preventDefault()
      this.pinch.zoom = view.zoom
    })
    this.listen(root, 'gesturechange', (event) => {
      event.preventDefault()
      view.setZoom(this.pinch.zoom * (event as unknown as { scale: number }).scale)
    })
    this.resetInput()
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options)
    this.disposers.push(() => target.removeEventListener(type, handler, options))
  }

  destroy(): void {
    this.disposed = true
    for (const dispose of this.disposers) dispose()
    for (const url of this.imageUrls.values()) URL.revokeObjectURL(url)
    this.imageUrls.clear()
    this.imageLoads.clear()
    clearTimeout(this.noteTimer)
  }

  private point(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.view.root.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  // ── Pointer ──────────────────────────────────────────────────────────────

  private onPointerDown(event: PointerEvent): void {
    const view = this.view
    const { x, y } = this.point(event)
    // Clicks on the scrollbars are the browser's.
    if (x > view.scroller.clientWidth || y > view.scroller.clientHeight) return
    this.closePopup()
    this.hideMessage()
    this.selectDrawing(undefined)
    if (event.pointerType === 'touch') {
      this.touchMode = true
      this.pinch.pointers.set(event.pointerId, { x, y })
      if (this.pinch.pointers.size === 2) {
        const [a, b] = [...this.pinch.pointers.values()]
        this.pinch.distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        this.pinch.zoom = view.zoom
        this.touchStart = undefined
        return
      }
      // Touch scrolls natively; a tap (decided on pointerup) selects.
      this.touchStart = { x, y, time: performance.now(), id: event.pointerId }
      return
    }
    if (event.button !== 0 && event.button !== 2) return
    this.touchMode = false
    this.layoutHandles()
    event.preventDefault()
    view.focus()
    const hit = view.hitTest(x, y)
    if (event.button === 2) {
      // Right-click inside the selection keeps it (for the context menu).
      const inside = view.selection.ranges.some((range) => hit.area === 'cell' && rangeContains(range, hit.row, hit.col))
      if (!inside && hit.area === 'cell') view.select({ top: hit.row, left: hit.col, bottom: hit.row, right: hit.col }, { scroll: false })
      return
    }
    const border = this.headerBorderAt(x, y)
    if (border && !view.readOnly) {
      const guide = document.createElement('div')
      guide.style.cssText = `position:absolute;background:${'#1A73E8'};pointer-events:none;z-index:4;${border.axis === 'col' ? 'top:0;bottom:0;width:1px;' : 'left:0;right:0;height:1px;'}`
      view.root.appendChild(guide)
      const size = border.axis === 'col' ? view.cols.size(border.index) : view.rows.size(border.index)
      this.drag = { kind: 'resize', axis: border.axis, index: border.index, start: border.axis === 'col' ? x : y, size, guide }
      this.updateResizeGuide(x, y)
      return
    }
    if (this.overFillHandle(x, y) && !view.readOnly) {
      const source = view.selection.ranges[0]!
      this.drag = { kind: 'fill', source, target: source }
      return
    }
    const add = event.ctrlKey || event.metaKey
    if (hit.area === 'corner') {
      view.select({ top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }, { active: { row: 0, col: 0 }, scroll: false })
      return
    }
    if (hit.area === 'colHeader') {
      const anchor = event.shiftKey ? view.selection.anchor.col : hit.col
      view.select({ top: 0, left: Math.min(anchor, hit.col), bottom: MAX_ROWS - 1, right: Math.max(anchor, hit.col) }, { add, active: { row: view.rows.step(-1, 1) === -1 ? 0 : 0, col: anchor }, scroll: false })
      this.drag = { kind: 'cols', from: anchor, add }
      return
    }
    if (hit.area === 'rowHeader') {
      const anchor = event.shiftKey ? view.selection.anchor.row : hit.row
      view.select({ top: Math.min(anchor, hit.row), left: 0, bottom: Math.max(anchor, hit.row), right: MAX_COLS - 1 }, { add, active: { row: anchor, col: 0 }, scroll: false })
      this.drag = { kind: 'rows', from: anchor, add }
      return
    }
    // Filter buttons and validation list arrows.
    if (this.onButton(x, y, hit.row, hit.col)) return
    if (view.editing) {
      if (view.pointAt({ top: hit.row, left: hit.col, bottom: hit.row, right: hit.col })) {
        this.drag = { kind: 'point' }
        return
      }
      if (!view.commitEdit()) return
    }
    // Ctrl/Cmd+click follows a link.
    if ((event.ctrlKey || event.metaKey) && this.followLink(hit.row, hit.col)) return
    if (event.shiftKey) view.extendTo(hit.row, hit.col)
    else view.select({ top: hit.row, left: hit.col, bottom: hit.row, right: hit.col }, { add, scroll: false })
    this.drag = { kind: 'select', add }
  }

  private onPointerMove(event: PointerEvent): void {
    const view = this.view
    const { x, y } = this.point(event)
    if (event.pointerType === 'touch' && this.pinch.pointers.has(event.pointerId)) {
      this.pinch.pointers.set(event.pointerId, { x, y })
      if (this.pinch.pointers.size === 2 && this.pinch.distance) {
        const [a, b] = [...this.pinch.pointers.values()]
        view.setZoom(this.pinch.zoom * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / this.pinch.distance))
        return
      }
    }
    const drag = this.drag
    if (!drag) {
      if (event.pointerType === 'mouse') view.scroller.style.cursor = this.headerBorderAt(x, y)?.axis === 'col' ? 'col-resize' : this.headerBorderAt(x, y) ? 'row-resize' : this.overFillHandle(x, y) ? 'crosshair' : 'cell'
      return
    }
    this.autoScroll(x, y)
    const hit = view.hitTest(Math.max(view.headerWidth + 1, x), Math.max(view.headerHeight + 1, y))
    switch (drag.kind) {
      case 'select':
        view.extendTo(hit.row, hit.col)
        break
      case 'cols':
        view.selection = { ...view.selection, ranges: [...view.selection.ranges.slice(0, -1), { top: 0, left: Math.min(drag.from, hit.col), bottom: MAX_ROWS - 1, right: Math.max(drag.from, hit.col) }] }
        view.afterSelectionChange()
        break
      case 'rows':
        view.selection = { ...view.selection, ranges: [...view.selection.ranges.slice(0, -1), { top: Math.min(drag.from, hit.row), left: 0, bottom: Math.max(drag.from, hit.row), right: MAX_COLS - 1 }] }
        view.afterSelectionChange()
        break
      case 'resize':
        this.updateResizeGuide(x, y)
        break
      case 'fill': {
        const { source } = drag
        // Fill extends along the axis the pointer moved furthest from the source.
        const down = hit.row - source.bottom
        const up = source.top - hit.row
        const right = hit.col - source.right
        const left = source.left - hit.col
        const vertical = Math.max(down, up) >= Math.max(right, left)
        let target = source
        if (vertical && down > 0) target = { ...source, bottom: hit.row }
        else if (vertical && up > 0) target = { ...source, top: hit.row }
        else if (!vertical && right > 0) target = { ...source, right: hit.col }
        else if (!vertical && left > 0) target = { ...source, left: hit.col }
        drag.target = target
        this.showFillOutline(target)
        break
      }
      case 'point': {
        const anchor = view.pointing?.anchor ?? { row: hit.row, col: hit.col }
        view.pointAt({ top: Math.min(anchor.row, hit.row), left: Math.min(anchor.col, hit.col), bottom: Math.max(anchor.row, hit.row), right: Math.max(anchor.col, hit.col) })
        break
      }
      case 'drawing': {
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (drag.resize) {
          drag.element.style.width = `${Math.max(10, drag.width + dx)}px`
          drag.element.style.height = `${Math.max(10, drag.height + dy)}px`
        } else drag.element.style.transform = `translate(${dx}px, ${dy}px)`
        break
      }
      case 'handle': {
        const range = view.selection.ranges[view.selection.ranges.length - 1]!
        const fixed = drag.corner === 'end' ? { row: range.top, col: range.left } : { row: range.bottom, col: range.right }
        view.selection = { ...view.selection, anchor: fixed }
        view.extendTo(hit.row, hit.col)
        break
      }
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const view = this.view
    if (event.pointerType === 'touch') {
      this.pinch.pointers.delete(event.pointerId)
      if (this.pinch.pointers.size < 2) this.pinch.distance = 0
      const start = this.touchStart
      this.touchStart = undefined
      if (start && start.id === event.pointerId && event.type === 'pointerup' && !this.drag) {
        const { x, y } = this.point(event)
        if (Math.hypot(x - start.x, y - start.y) < 10 && performance.now() - start.time < 500) this.onTap(x, y)
      }
    }
    const drag = this.drag
    this.drag = undefined
    if (!drag) return
    switch (drag.kind) {
      case 'resize': {
        const { x, y } = this.point(event)
        drag.guide.remove()
        const delta = ((drag.axis === 'col' ? x : y) - drag.start) / view.zoom
        const positions = view.selectedLines(drag.axis).includes(drag.index) && this.fullySelected(drag.axis) ? view.selectedLines(drag.axis) : [drag.index]
        if (Math.abs(delta) >= 1) view.resizeLines(drag.axis, Math.max(0, drag.size + delta), positions)
        break
      }
      case 'fill':
        this.fillOutline?.remove()
        this.fillOutline = undefined
        if (drag.target !== drag.source) this.fill(drag.source, drag.target)
        break
      case 'drawing':
        this.finishDrawingDrag(drag, event)
        break
    }
    view.focus()
  }

  private onTap(x: number, y: number): void {
    const view = this.view
    const hit = view.hitTest(x, y)
    view.focus()
    if (hit.area === 'colHeader') {
      view.select({ top: 0, left: hit.col, bottom: MAX_ROWS - 1, right: hit.col }, { active: { row: 0, col: hit.col }, scroll: false })
      return
    }
    if (hit.area === 'rowHeader') {
      view.select({ top: hit.row, left: 0, bottom: hit.row, right: MAX_COLS - 1 }, { active: { row: hit.row, col: 0 }, scroll: false })
      return
    }
    if (hit.area !== 'cell') return
    if (this.onButton(x, y, hit.row, hit.col)) return
    if (view.editing && view.pointAt({ top: hit.row, left: hit.col, bottom: hit.row, right: hit.col })) return
    if (view.editing && !view.commitEdit()) return
    const now = performance.now()
    const double = this.lastTap && now - this.lastTap.time < 400 && this.lastTap.row === hit.row && this.lastTap.col === hit.col
    this.lastTap = { time: now, row: hit.row, col: hit.col }
    view.select({ top: hit.row, left: hit.col, bottom: hit.row, right: hit.col }, { scroll: false })
    if (double) view.beginEdit(undefined, false)
  }

  private onDoubleClick(event: MouseEvent): void {
    const view = this.view
    const { x, y } = this.point(event)
    const border = this.headerBorderAt(x, y)
    if (border) {
      view.autoFit(border.axis, view.selectedLines(border.axis).includes(border.index) && this.fullySelected(border.axis) ? view.selectedLines(border.axis) : [border.index])
      return
    }
    if (this.overFillHandle(x, y)) {
      // Double-clicking the fill handle fills down as far as the data beside it goes.
      const source = view.selection.ranges[0]!
      let bottom = source.bottom
      const neighbor = source.left > 0 ? source.left - 1 : source.right + 1
      while (bottom + 1 < MAX_ROWS && view.valueAt(bottom + 1, neighbor) !== null) bottom++
      if (bottom > source.bottom) this.fill(source, { ...source, bottom })
      return
    }
    const hit = view.hitTest(x, y)
    if (hit.area === 'cell' && !view.editing) view.beginEdit(undefined, false)
  }

  private onWheel(event: WheelEvent): void {
    // Ctrl+wheel (and trackpad pinches, which arrive as Ctrl+wheel) zoom.
    if (!event.ctrlKey) return
    event.preventDefault()
    this.view.setZoom(this.view.zoom * Math.exp(-event.deltaY / 300))
  }

  private onContextMenu(event: MouseEvent): void {
    // The host shows its own menu (it listens for this on the container); keep the browser's away.
    const { x, y } = this.point(event)
    const hit = this.view.hitTest(x, y)
    this.view.root.dispatchEvent(new CustomEvent('sheetcontextmenu', { bubbles: true, detail: { x: event.clientX, y: event.clientY, area: hit.area, row: hit.row, col: hit.col } }))
    event.preventDefault()
  }

  private fullySelected(axis: 'row' | 'col'): boolean {
    return this.view.selection.ranges.every((range) => (axis === 'col' ? commands.isWholeColumns(range) : commands.isWholeRows(range)))
  }

  private headerBorderAt(x: number, y: number): { axis: 'row' | 'col'; index: number } | undefined {
    const view = this.view
    const tolerance = 4
    if (y < view.headerHeight && x > view.headerWidth) {
      const hit = view.hitTest(x, view.headerHeight + 1)
      const rect = view.cellRect(0, hit.col)
      if (Math.abs(x - (rect.x + rect.width)) <= tolerance) return { axis: 'col', index: hit.col }
      if (Math.abs(x - rect.x) <= tolerance && hit.col > 0) return { axis: 'col', index: view.cols.step(hit.col, -1) }
    }
    if (x < view.headerWidth && y > view.headerHeight) {
      const hit = view.hitTest(view.headerWidth + 1, y)
      const rect = view.cellRect(hit.row, 0)
      if (Math.abs(y - (rect.y + rect.height)) <= tolerance) return { axis: 'row', index: hit.row }
      if (Math.abs(y - rect.y) <= tolerance && hit.row > 0) return { axis: 'row', index: view.rows.step(hit.row, -1) }
    }
    return undefined
  }

  private updateResizeGuide(x: number, y: number): void {
    const drag = this.drag
    if (drag?.kind !== 'resize') return
    if (drag.axis === 'col') drag.guide.style.left = `${Math.max(this.view.headerWidth, x)}px`
    else drag.guide.style.top = `${Math.max(this.view.headerHeight, y)}px`
  }

  private overFillHandle(x: number, y: number): boolean {
    const view = this.view
    if (view.selection.ranges.length !== 1 || view.editing || view.readOnly) return false
    const range = view.selection.ranges[0]!
    const bottomRight = view.cellRect(Math.min(range.bottom, MAX_ROWS - 1), Math.min(range.right, MAX_COLS - 1))
    return Math.abs(x - (bottomRight.x + bottomRight.width)) <= 5 && Math.abs(y - (bottomRight.y + bottomRight.height)) <= 5
  }

  private autoScroll(x: number, y: number): void {
    const view = this.view
    const { width, height } = view.viewport
    const step = 20
    if (x > width - 10) view.scroller.scrollLeft += step
    else if (x < view.headerWidth) view.scroller.scrollLeft -= step
    if (y > height - 10) view.scroller.scrollTop += step
    else if (y < view.headerHeight) view.scroller.scrollTop -= step
  }

  private showFillOutline(range: CellRange): void {
    const view = this.view
    if (!this.fillOutline) {
      this.fillOutline = document.createElement('div')
      this.fillOutline.style.cssText = 'position:absolute;border:1px dashed #5F6368;pointer-events:none;z-index:4;'
      view.root.appendChild(this.fillOutline)
    }
    const start = view.cellRect(range.top, range.left)
    const end = view.cellRect(range.bottom, range.right)
    Object.assign(this.fillOutline.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${end.x + end.width - start.x}px`, height: `${end.y + end.height - start.y}px` })
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (this.composing || event.isComposing || event.keyCode === 229) return
    const view = this.view
    const mod = event.ctrlKey || event.metaKey
    if (view.editing) {
      this.onEditKey(event)
      return
    }
    if (this.selectedDrawing && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      const id = this.selectedDrawing
      this.selectDrawing(undefined)
      if (!view.readOnly) view.workbook.transact(() => view.sheet.drawings.delete(id))
      return
    }
    const { active } = view.selection
    const move = (dRow: number, dCol: number) => {
      event.preventDefault()
      const from = event.shiftKey ? this.extentCorner() : active
      const next = view.nextCell(from.row, from.col, dRow, dCol, mod)
      if (event.shiftKey) view.extendTo(next.row, next.col)
      else view.select({ top: next.row, left: next.col, bottom: next.row, right: next.col })
    }
    switch (event.key) {
      case 'ArrowUp':
        return move(-1, 0)
      case 'ArrowDown':
        return move(1, 0)
      case 'ArrowLeft':
        return move(0, -1)
      case 'ArrowRight':
        return move(0, 1)
      case 'Tab':
        event.preventDefault()
        return this.moveWithin(0, event.shiftKey ? -1 : 1)
      case 'Enter':
        event.preventDefault()
        if (mod) return
        return this.moveWithin(event.shiftKey ? -1 : 1, 0)
      case 'Home':
        event.preventDefault()
        return mod ? view.select({ top: 0, left: 0, bottom: 0, right: 0 }) : view.select({ top: active.row, left: 0, bottom: active.row, right: 0 })
      case 'End': {
        event.preventDefault()
        const used = view.sheet.usedRange()
        if (mod && used) view.select({ top: used.bottom, left: used.right, bottom: used.bottom, right: used.right })
        return
      }
      case 'PageDown':
      case 'PageUp': {
        event.preventDefault()
        const rows = Math.max(1, Math.floor(view.viewport.height / (view.rows.defaultSize * view.zoom)) - 1)
        const target = Math.max(0, Math.min(MAX_ROWS - 1, active.row + (event.key === 'PageDown' ? rows : -rows)))
        view.scroller.scrollTop += (event.key === 'PageDown' ? 1 : -1) * rows * view.rows.defaultSize * view.zoom
        return event.shiftKey ? view.extendTo(target, active.col) : view.select({ top: target, left: active.col, bottom: target, right: active.col })
      }
      case 'Delete':
        event.preventDefault()
        return view.clearContents()
      case 'Backspace':
        event.preventDefault()
        if (view.readOnly) return
        view.clearContents()
        view.beginEdit('', true)
        return
      case 'F2':
        event.preventDefault()
        view.beginEdit(undefined, false)
        return
      case 'Escape':
        if (this.cut || view.copyRange) {
          this.cut = undefined
          view.copyRange = undefined
          view.scheduleRender()
        }
        this.closePopup()
        return
      case ' ':
        if (event.shiftKey && !mod) {
          event.preventDefault()
          return view.select({ top: active.row, left: 0, bottom: active.row, right: MAX_COLS - 1 }, { active })
        }
        if (mod && !event.shiftKey) {
          event.preventDefault()
          return view.select({ top: 0, left: active.col, bottom: MAX_ROWS - 1, right: active.col }, { active })
        }
        break
    }
    if (mod) this.onShortcut(event)
  }

  private onShortcut(event: KeyboardEvent): void {
    const view = this.view
    const key = event.key.toLowerCase()
    const handled = () => event.preventDefault()
    if (key === 'z' && !event.shiftKey) return handled(), view.undo()
    if ((key === 'z' && event.shiftKey) || key === 'y') return handled(), view.redo()
    if (key === 'a') {
      handled()
      const region = view.currentRegion(view.selection.active.row, view.selection.active.col)
      const last = view.selection.ranges[view.selection.ranges.length - 1]!
      const same = last.top === region.top && last.left === region.left && last.bottom === region.bottom && last.right === region.right
      return same || (region.top === region.bottom && region.left === region.right) ? view.select({ top: 0, left: 0, bottom: MAX_ROWS - 1, right: MAX_COLS - 1 }, { active: view.selection.active }) : view.select(region, { active: view.selection.active })
    }
    if (view.readOnly) return
    if (key === 'b') return handled(), view.toggleStyle('bold')
    if (key === 'i') return handled(), view.toggleStyle('italic')
    if (key === 'u') return handled(), view.toggleUnderline()
    if (key === '5' && !event.shiftKey) return handled(), view.toggleStyle('strike')
    if (key === 'd') return handled(), this.fillFromEdge('down')
    if (key === 'r') return handled(), this.fillFromEdge('right')
    if (key === ';') {
      handled()
      const now = new Date()
      const text = event.shiftKey ? `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}` : `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`
      view.beginEdit(text, true)
      view.commitEdit()
    }
  }

  /** The corner of the selection opposite the anchor (what Shift+arrows move). */
  private extentCorner(): { row: number; col: number } {
    const { anchor } = this.view.selection
    const range = this.view.selection.ranges[this.view.selection.ranges.length - 1]!
    return { row: range.top === anchor.row ? range.bottom : range.top, col: range.left === anchor.col ? range.right : range.left }
  }

  /** Enter/Tab: move the active cell, within the selection when it has more than one cell. */
  moveWithin(dRow: number, dCol: number): void {
    const view = this.view
    const range = view.selection.ranges[view.selection.ranges.length - 1]!
    const { active } = view.selection
    if (range.top === range.bottom && range.left === range.right) {
      const next = view.nextCell(active.row, active.col, dRow, dCol, false)
      view.select({ top: next.row, left: next.col, bottom: next.row, right: next.col })
      return
    }
    let row = active.row + dRow
    let col = active.col + dCol
    if (col > range.right) {
      col = range.left
      row++
    } else if (col < range.left) {
      col = range.right
      row--
    }
    if (row > range.bottom) {
      row = range.top
      if (dRow) col = col + 1 > range.right ? range.left : col + 1
    } else if (row < range.top) {
      row = range.bottom
      if (dRow) col = col - 1 < range.left ? range.right : col - 1
    }
    view.selection = { ...view.selection, active: { row, col } }
    view.scrollIntoView(row, col)
    view.afterSelectionChange()
  }

  private onEditKey(event: KeyboardEvent): void {
    const view = this.view
    const edit = view.editing!
    const list = this.completionList
    if (list) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        list.index = (list.index + (event.key === 'ArrowDown' ? 1 : -1) + list.items.length) % list.items.length
        list.touched = true
        this.renderCompletions()
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && list.index >= 0 && list.touched)) {
        event.preventDefault()
        this.acceptCompletion(list.items[Math.max(0, list.index)]!)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.closeCompletions()
        return
      }
    }
    switch (event.key) {
      case 'Enter':
        if (event.altKey) {
          // Alt+Enter: a line break in the cell.
          event.preventDefault()
          const { input } = view
          const start = input.selectionStart
          input.setRangeText('\n', start, input.selectionEnd, 'end')
          this.onInput()
          return
        }
        event.preventDefault()
        if (!view.commitEdit({ fill: event.ctrlKey || event.metaKey })) return
        if (!(event.ctrlKey || event.metaKey)) this.moveWithin(event.shiftKey ? -1 : 1, 0)
        return
      case 'Tab':
        event.preventDefault()
        if (view.commitEdit()) this.moveWithin(0, event.shiftKey ? -1 : 1)
        return
      case 'Escape':
        event.preventDefault()
        view.cancelEdit()
        return
      case 'F2':
        event.preventDefault()
        view.editing = { ...edit, enterMode: !edit.enterMode }
        return
      case 'F4':
        // Cycles the reference at the caret through $A$1, A$1, $A1, A1.
        event.preventDefault()
        this.cycleAbsolute()
        return
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!edit.enterMode) return
        const dRow = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
        const dCol = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
        if (edit.text.startsWith('=') && (view.pointing || view.editing?.text.length === view.input.selectionStart)) {
          // Arrow keys point at cells while typing a formula.
          const from = view.pointing ? this.pointedCorner() : { row: edit.row, col: edit.col }
          const next = view.nextCell(from.row, from.col, dRow, dCol, event.ctrlKey || event.metaKey)
          if (event.shiftKey && view.pointing) {
            const anchor = view.pointing.anchor
            if (view.pointAt({ top: Math.min(anchor.row, next.row), left: Math.min(anchor.col, next.col), bottom: Math.max(anchor.row, next.row), right: Math.max(anchor.col, next.col) })) event.preventDefault()
          } else if (view.pointAt({ top: next.row, left: next.col, bottom: next.row, right: next.col })) {
            if (view.pointing) view.pointing = { ...view.pointing, anchor: next, corner: next }
            event.preventDefault()
          }
          if (event.defaultPrevented) return
        }
        event.preventDefault()
        if (view.commitEdit()) {
          const next = view.nextCell(edit.row, edit.col, dRow, dCol, false)
          view.select({ top: next.row, left: next.col, bottom: next.row, right: next.col })
        }
        return
      }
    }
  }

  private pointedCorner(): { row: number; col: number } {
    return this.view.pointing!.corner
  }

  private cycleAbsolute(): void {
    const view = this.view
    const edit = view.editing!
    const caret = view.input.selectionStart
    const pattern = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(edit.text))) {
      const start = match.index
      const end = start + match[0].length
      if (caret < start || caret > end) continue
      const state = (match[1] ? 2 : 0) + (match[3] ? 1 : 0)
      // A1 → $A$1 → A$1 → $A1 → A1
      const next = { 0: ['$', '$'], 3: ['', '$'], 1: ['$', ''], 2: ['', ''] }[state as 0 | 1 | 2 | 3]!
      const replacement = `${next[0]}${match[2]}${next[1]}${match[4]}`
      const text = edit.text.slice(0, start) + replacement + edit.text.slice(end)
      view.setEditText(text, start + replacement.length)
      this.syncInput()
      return
    }
  }

  private onInput(): void {
    if (this.composing) return
    const view = this.view
    const { input } = view
    if (!view.editing) {
      const typed = input.value.replace(IDLE_TEXT, '')
      if (!typed) return
      if (!view.beginEdit(typed, true)) {
        this.resetInput()
        return
      }
      return
    }
    view.setEditText(input.value, input.selectionStart)
  }

  private onCompositionStart(): void {
    this.composing = true
    const view = this.view
    if (!view.editing && !view.readOnly) {
      view.input.value = ''
      view.beginEdit('', true)
    }
  }

  /** Fills the selection from its first row (Ctrl+D) or column (Ctrl+R). */
  private fillFromEdge(direction: 'down' | 'right'): void {
    const view = this.view
    view.workbook.transact(() => {
      for (const range of view.selection.ranges) {
        if (direction === 'down' && range.bottom > range.top) this.fill({ ...range, bottom: range.top }, range, true)
        else if (direction === 'right' && range.right > range.left) this.fill({ ...range, right: range.left }, range, true)
        else if (direction === 'down' && range.top > 0) this.fill({ ...range, top: range.top - 1, bottom: range.top - 1 }, { ...range, top: range.top - 1 }, true)
        else if (direction === 'right' && range.left > 0) this.fill({ ...range, left: range.left - 1, right: range.left - 1 }, { ...range, left: range.left - 1 }, true)
      }
    })
  }

  /** Extends `source` to `target` with the fill handle's series (or copies, with `copy`). */
  fill(source: CellRange, target: CellRange, copy = false): void {
    const view = this.view
    const sheet = view.sheet
    if (view.readOnly) return
    const vertical = target.top !== source.top || target.bottom !== source.bottom
    const backward = vertical ? target.top < source.top : target.left < source.left
    if (!contains(target, source) || target.top < 0 || target.left < 0 || target.bottom >= MAX_ROWS || target.right >= MAX_COLS || (target.bottom - target.top + 1) * (target.right - target.left + 1) > MAX_EXPANDED_CELLS) return
    const extension = vertical ? backward ? { ...target, bottom: source.top - 1 } : { ...target, top: source.bottom + 1 } : backward ? { ...target, right: source.left - 1 } : { ...target, left: source.right + 1 }
    if (!canWriteArrays(sheet, extension, view.values)) return
    // These fill patterns need shape-aware repetition; reject them before any write.
    if (sheet.mergedRanges().some((m) => intersects(m.range, target))) return
    let arraySource = false
    const spillSources: CellRange[] = []
    sheet.forEachCell((row, col, data) => {
      if (row > source.bottom || col > source.right) return
      const size = data.array ?? view.values.spill?.(sheet, row, col)
      if (!size || size.rows * size.cols <= 1) return
      const range = { top: row, left: col, bottom: row + size.rows - 1, right: col + size.cols - 1 }
      if (!intersects(range, source)) return
      spillSources.push(range)
      if (data.array || rangeContains(source, row, col) && span(Math.max(row, source.top), Math.min(range.bottom, source.bottom)).some((r) => view.rows.isHidden(r))) arraySource = true
    })
    if (arraySource) return
    const jobs: {
      sourceCells: { row: number; col: number }[]
      targets: { row: number; col: number }[]
      snapshots: commands.CellSnapshot[]
      series: ReturnType<typeof fillSeries>
      metadata: { dv: ClipboardRule<DataValidation>[] }[]
    }[] = []
    const lines = vertical ? span(source.left, source.right) : span(source.top, source.bottom)
    for (const line of lines) {
      const sourceCells = (vertical ? span(source.top, source.bottom).map((row) => ({ row, col: line })) : span(source.left, source.right).map((col) => ({ row: line, col }))).filter((cell) => !view.rows.isHidden(cell.row))
      const targets = (vertical
        ? backward ? span(target.top, source.top - 1).reverse().map((row) => ({ row, col: line })) : span(source.bottom + 1, target.bottom).map((row) => ({ row, col: line }))
        : backward ? span(target.left, source.left - 1).reverse().map((col) => ({ row: line, col })) : span(source.right + 1, target.right).map((col) => ({ row: line, col }))).filter((cell) => !view.rows.isHidden(cell.row))
      if (!sourceCells.length) continue
      const snapshots = sourceCells.map((cell) => {
        const snapshot = commands.snapshotCell(sheet, cell.row, cell.col)
        snapshot.overrides = JSON.parse(JSON.stringify(view.styleAt(cell.row, cell.col))) as Partial<StyleProps>
        const spill = spillSources.find((r) => rangeContains(r, cell.row, cell.col))
        if (spill && !rangeContains(source, spill.top, spill.left)) snapshot.data = valueData(view.valueAt(cell.row, cell.col))
        return snapshot
      })
      const series = copy
        ? targets.map((_, index) => ({ kind: 'copy' as const, from: backward ? sourceCells.length - 1 - (index % sourceCells.length) : index % sourceCells.length }))
        : fillSeries(sourceCells.map((cell, index) => ({ value: view.valueAt(cell.row, cell.col), formula: snapshots[index]!.formula !== undefined, numFmt: view.styleAt(cell.row, cell.col).numFmt })), targets.length, backward, view.workbook.date1904)
      // Prepare every line before writing: a later line's formulas can depend on an earlier one.
      const metadata = sourceCells.map((cell) => ({ dv: snapshotRules<DataValidation>(sheet, sheet.dv.values(), [cell.row], [cell.col]) }))
      jobs.push({ sourceCells, targets, snapshots, series, metadata })
    }
    const tables = [...sheet.workbook.sheets()].flatMap((owner) => [...owner.tables.values()] as SheetTable[])
    const formats = snapshotRules<ConditionalFormat>(sheet, sheet.cf.values(), span(source.top, source.bottom), span(source.left, source.right))
    const formatTargets = formats.map(() => [] as CellRange[])
    view.workbook.transact(() => {
      for (const { sourceCells, targets, snapshots, series, metadata } of jobs) series.forEach((result, index) => {
        const to = targets[index]!
        const sourceIndex = result.kind === 'copy' ? result.from : backward ? 0 : snapshots.length - 1
        const from = sourceCells[sourceIndex]!
        let model = snapshots[sourceIndex]!
        if (!copy && !vertical && model.formula !== undefined) model = { ...model, formula: fillStructuredFormula(model.formula, to.col - from.col, tables) }
        commands.placeCell(sheet, model, from, to, result.kind === 'copy' ? undefined : { values: false, formats: true })
        if (result.kind === 'value') sheet.setCell(to.row, to.col, valueData(result.value))
        const destination = { top: to.row, bottom: to.row, left: to.col, right: to.col }
        pasteRules(sheet, 'dv', metadata[sourceIndex]!.dv, destination, [from.row], [from.col])
        pasteRules(sheet, 'cf', [], destination, [from.row], [from.col])
        formats.forEach((rule, i) => {
          if (rule.ranges.some((r) => rangeContains(r, from.row - source.top, from.col - source.left))) formatTargets[i]!.push(destination)
        })
      })
      formats.forEach((rule, i) => placeRule(sheet, 'cf', rule, formatTargets[i]!))
    })
    view.select(target, { active: view.selection.active, scroll: false })
  }

  // ── Clipboard ────────────────────────────────────────────────────────────

  /** The selection as clipboard data (text, HTML, and snapshots for pasting here). */
  copyPayload(cut = false): ClipboardPayload | undefined {
    const view = this.view
    if (view.selection.ranges.length !== 1) return undefined
    const sheet = view.sheet
    const range = commands.clampToUsed(sheet, view.selection.ranges[0]!)
    if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > MAX_EXPANDED_CELLS) return undefined
    const sourceRows = span(range.top, range.bottom).filter((row) => cut || !view.rows.isHidden(row))
    // Like Excel, hidden columns remain part of a normal copied rectangle.
    const sourceCols = span(range.left, range.right)
    if (!sourceRows.length || !sourceCols.length) return undefined
    const rows: ClipboardCell[][] = []
    const cells: commands.CellSnapshot[][] = []
    const values: CellValue[][] = []
    for (const row of sourceRows) {
      const line: ClipboardCell[] = []
      const snapshots: commands.CellSnapshot[] = []
      const lineValues: CellValue[] = []
      for (const col of sourceCols) {
        const render = view.cellRender(row, col)
        const snapshot = commands.snapshotCell(sheet, row, col)
        // Resolve inherited formats at copy time, without baking conditional formatting in.
        snapshot.overrides = { ...view.styleAt(row, col) }
        line.push({ text: render.text, ...(snapshot.formula !== undefined ? { formula: `=${snapshot.formula}` } : {}), style: { ...render.style }, css: { color: render.color, ...(render.fill ? { background: render.fill } : {}) } })
        snapshots.push(snapshot)
        lineValues.push(render.value)
      }
      rows.push(line)
      cells.push(snapshots)
      values.push(lineValues)
    }
    const merges: CellRange[] = []
    for (const merge of sheet.mergedRanges()) {
      if (!intersects(range, merge.range)) continue
      if (!contains(range, merge.range)) return undefined
      const top = sourceRows.indexOf(merge.range.top), bottom = sourceRows.indexOf(merge.range.bottom)
      if (top < 0 || bottom - top !== merge.range.bottom - merge.range.top) return undefined
      const rect = { top, bottom, left: merge.range.left - range.left, right: merge.range.right - range.left }
      merges.push(rect)
      for (let r = top; r <= bottom; r++) for (let c = rect.left; c <= rect.right; c++) {
        if (r === top && c === rect.left) Object.assign(rows[r]![c]!, { rowSpan: bottom - top + 1, colSpan: rect.right - rect.left + 1 })
        else rows[r]![c]!.covered = true
      }
    }
    // A spill member copied on its own becomes its displayed value. When its anchor is included,
    // leave members empty so the pasted formula can spill without artificial obstructions.
    sheet.forEachCell((row, col, data) => {
      const size = data.array ?? view.values.spill?.(sheet, row, col)
      if (!size) return
      let anchor = sourceRows.includes(row) && sourceCols.includes(col)
      const filtered = span(Math.max(row, range.top), Math.min(row + size.rows - 1, range.bottom)).some((r) => !sourceRows.includes(r))
      if (anchor && filtered && !data.array) {
        const r = sourceRows.indexOf(row), c = sourceCols.indexOf(col)
        cells[r]![c]!.data = valueData(values[r]![c]!)
        delete cells[r]![c]!.formula
        delete rows[r]![c]!.formula
        anchor = false
      }
      for (let r = 0; r < sourceRows.length; r++) for (let c = 0; c < sourceCols.length; c++) {
        const rr = sourceRows[r]!, cc = sourceCols[c]!
        if ((rr === row && cc === col) || rr < row || rr >= row + size.rows || cc < col || cc >= col + size.cols) continue
        cells[r]![c]!.data = anchor ? undefined : valueData(values[r]![c]!)
      }
    })
    const token = cut && !view.readOnly ? randomId() : undefined
    this.cut = token ? { token, sheet: sheet.id, range, signature: this.cutSignature(sheet.id, range) } : undefined
    const payload: ClipboardPayload = { rows, internal: { source: range, sheet: sheet.id, sourceRows, sourceCols, cells, values, merges, validations: snapshotRules<DataValidation>(sheet, sheet.dv.values(), sourceRows, sourceCols), conditionalFormats: snapshotRules<ConditionalFormat>(sheet, sheet.cf.values(), sourceRows, sourceCols), stylesXml: view.stylesheetFor.toXml(), ...(token ? { cut: token } : {}) } }
    // Detach nested JSON objects from Yjs and cached render/style objects as well.
    return JSON.parse(JSON.stringify(payload)) as ClipboardPayload
  }

  private cutSignature(id: string, range: CellRange): string {
    const sheet = this.view.workbook.sheet(id)
    if (!sheet) return ''
    return JSON.stringify({
      cells: span(range.top, range.bottom).map((row) => span(range.left, range.right).map((col) => [sheet.keyAt(row, col), commands.snapshotCell(sheet, row, col)])),
      metadata: [sheet.merges, sheet.tables, sheet.cf, sheet.dv, sheet.filter, sheet.drawings, sheet.raw].map((map) => [...map]),
    })
  }

  private onCopy(event: ClipboardEvent, cut: boolean): void {
    const view = this.view
    if (view.editing) return
    const payload = this.copyPayload(cut)
    if (!payload || !event.clipboardData) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', toTsv(payload.rows))
    event.clipboardData.setData('text/html', toHtml(payload))
    view.copyRange = payload.internal!.source
    view.scheduleRender()
  }

  private onPaste(event: ClipboardEvent): void {
    const view = this.view
    if (view.editing || view.readOnly || !event.clipboardData) return
    event.preventDefault()
    this.paste({ html: event.clipboardData.getData('text/html'), text: event.clipboardData.getData('text/plain') })
  }

  /** Pastes clipboard content at the selection (paste special: values or formats only). */
  paste(data: { html?: string; text?: string }, mode: PasteMode = {}): void {
    const view = this.view
    if (view.readOnly) return
    const sheet = view.sheet
    const target = view.selection.ranges[view.selection.ranges.length - 1]!
    const origin = { row: target.top, col: target.left }
    const parsed = data.html ? parseHtml(data.html) : undefined
    const internal = parsed?.internal
    const cells = parsed?.cells ?? parseTsv(data.text ?? '').map((row) => row.map((text) => ({ text })))
    const height = internal?.cells.length ?? cells.length
    const width = internal?.cells[0]?.length ?? maxOf(cells.map((row) => row.length))
    if (!height || !width) return
    const placeOptions: commands.PlaceOptions = { values: !mode.formats || !!mode.values, formats: !mode.values || !!mode.formats }
    const all = !mode.values && !mode.formats || !!mode.values && !!mode.formats
    const cut = internal?.cut && this.cut?.token === internal.cut && internal.sheet === this.cut.sheet && JSON.stringify(internal.source) === JSON.stringify(this.cut.range) ? this.cut : undefined
    const moving = !!cut && all
    // A changed source is copied from the immutable snapshot; never clear a remote edit.
    const relocate = moving && cut.signature === this.cutSignature(cut.sheet, cut.range)
    const selectedHeight = target.bottom - target.top + 1, selectedWidth = target.right - target.left + 1
    const tile = !moving && selectedHeight >= height && selectedWidth >= width && selectedHeight % height === 0 && selectedWidth % width === 0
    if (!moving && !tile && (selectedHeight > height || selectedWidth > width)) return
    const rows = tile ? selectedHeight : height, cols = tile ? selectedWidth : width
    const destination = { top: origin.row, left: origin.col, bottom: origin.row + rows - 1, right: origin.col + cols - 1 }
    // Preflight is outside the transaction: failures must not leave a partial paste behind.
    if (destination.bottom >= MAX_ROWS || destination.right >= MAX_COLS || rows * cols > MAX_EXPANDED_CELLS) return
    if (placeOptions.values && !canWriteArrays(sheet, destination, view.values)) return
    if (relocate) {
      const source = view.workbook.sheet(cut.sheet)!
      if (!canWriteArrays(source, cut.range, view.values)) return
      for (const owner of new Set([source, sheet])) for (const collection of [owner.tables, owner.merges]) for (const raw of collection.values()) {
        const rect = owner.resolveRange((raw as { range: import('../model/schema.js').RangeIds }).range)
        if (!rect) continue
        if (owner === source && intersects(rect, cut.range) && !contains(cut.range, rect)) return
        if (owner === sheet && intersects(rect, destination) && !(owner === source && contains(cut.range, rect))) return
      }
    } else {
      for (const merge of sheet.mergedRanges()) if (intersects(merge.range, destination) && !contains(destination, merge.range)) return
    }
    const merges = internal?.merges ?? parsed?.merges ?? []
    // Legacy array formulas must keep their entire original shape.
    if (internal && placeOptions.values && !mode.values) for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
      const size = internal.cells[r]![c]!.data?.array
      if (size && (r + size.rows > height || c + size.cols > width || internal.sourceRows[r + size.rows - 1]! - internal.sourceRows[r]! !== size.rows - 1)) return
    }
    view.workbook.transact(() => {
      if (relocate) {
        moveCells(view.workbook.sheet(cut.sheet)!, sheet, cut.range, origin)
        // A moved cell also keeps formats it inherited from its original row/column.
        for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
          const to = { row: origin.row + r, col: origin.col + c }
          commands.placeCell(sheet, internal!.cells[r]![c]!, to, to, { values: false, formats: true })
        }
      }
      else {
        let dxf: number[] | undefined
        if (internal?.stylesXml && placeOptions.formats) {
          const styles = new Stylesheet(view.workbook.metaValue('stylesXml'))
          const imported = styles.merge(new Stylesheet(internal.stylesXml))
          dxf = imported.dxf
          // Preserve original base formats, including properties not modeled as overrides.
          for (const row of internal.cells) for (const cell of row) if (cell.xf !== undefined) cell.xf = imported.xf[cell.xf]
          const xml = styles.toXml()
          if (xml !== view.workbook.metaValue('stylesXml')) view.workbook.setMeta('stylesXml', xml)
        }
        if (placeOptions.formats) commands.unmergeRanges(sheet, [destination])
        for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < cols; dc++) {
          const r = dr % height, c = dc % width
          const to = { row: origin.row + dr, col: origin.col + dc }
          if (internal) {
            const snapshot = internal.cells[r]![c]!
            const from = { row: internal.sourceRows[r]!, col: internal.sourceCols[c]! }
            commands.placeCell(sheet, snapshot, from, to, { ...placeOptions, ...(mode.values || view.valuesOnly ? { valueFor: () => internal.values[r]![c]! } : {}) })
            if (all) {
              const key = sheet.keyAt(to.row, to.col)
              if (snapshot.note) sheet.notes.set(key, snapshot.note); else sheet.notes.delete(key)
              if (snapshot.link) sheet.links.set(key, { ...snapshot.link, ...(snapshot.link.range ? { range: sheet.rangeIds({ top: to.row, bottom: to.row, left: to.col, right: to.col }) } : {}) }); else sheet.links.delete(key)
            }
          } else {
            const cell = cells[r]?.[c] ?? { text: '' }
            if (placeOptions.values) {
              const formula = !mode.values && 'formula' in cell && typeof cell.formula === 'string' ? r1c1ToA1(cell.formula, to.row, to.col) : undefined
              const literal = 'stringValue' in cell && cell.stringValue || mode.values && /^[=']/.test(cell.text)
              if (literal && !formula) sheet.setCell(to.row, to.col, { v: cell.text, t: 's' })
              else if (mode.values) {
                const { data: content } = commands.contentFromInput(sheet, cell.text, { valuesOnly: view.valuesOnly, date1904: view.workbook.date1904 })
                sheet.setCell(to.row, to.col, content)
              } else commands.setCellInput(sheet, to.row, to.col, formula ?? cell.text, { valuesOnly: view.valuesOnly, date1904: view.workbook.date1904, currentFormat: view.styleAt(to.row, to.col).numFmt })
            }
            if (placeOptions.formats && 'style' in cell) {
              const pasted = cell as { style?: Partial<StyleProps>; color?: string; background?: string }
              const patch: commands.StylePatch = { ...(pasted.style ?? {}) }
              const color = cssToRgb(pasted.color), background = cssToRgb(pasted.background)
              if (color) patch.fontColor = { rgb: color }
              if (background) patch.fill = { rgb: background }
              sheet.clearStyle({ top: to.row, bottom: to.row, left: to.col, right: to.col })
              if (Object.keys(patch).length) sheet.setStyle({ top: to.row, bottom: to.row, left: to.col, right: to.col }, patch)
            }
          }
        }
        if (internal) {
          if (all) pasteRules(sheet, 'dv', internal.validations, destination, internal.sourceRows, internal.sourceCols)
          if (placeOptions.formats) pasteRules(sheet, 'cf', internal.conditionalFormats, destination, internal.sourceRows, internal.sourceCols, dxf)
        }
        if (placeOptions.formats) for (let dr = 0; dr < rows; dr += height) for (let dc = 0; dc < cols; dc += width) for (const merge of merges) {
          sheet.merges.set(randomId(), { range: sheet.rangeIds(offsetRange(merge, origin.row + dr, origin.col + dc)) })
        }
      }
      if (cut && all) { this.cut = undefined; view.copyRange = undefined }
    })
    view.select(destination, { active: origin, scroll: false })
  }

  // ── Editor ───────────────────────────────────────────────────────────────

  private resetInput(): void {
    const { input } = this.view
    input.value = IDLE_TEXT
    input.select()
  }

  /** Keeps the textarea's text in step with the edit (the formula bar may have changed it). */
  private syncInput(): void {
    const view = this.view
    const edit = view.editing
    if (!edit) return
    if (view.input.value !== edit.text) {
      view.input.value = edit.text
      view.input.setSelectionRange(edit.caret, edit.caret)
    }
  }

  onEditStart(): void {
    const view = this.view
    const edit = view.editing!
    view.input.value = edit.text
    view.input.setSelectionRange(edit.caret, edit.caret)
    this.positionEditor()
    this.updateAssist()
  }

  onEditText(): void {
    this.syncInput()
    this.positionEditor()
    this.updateAssist()
  }

  onEditEnd(): void {
    const { input } = this.view
    input.style.opacity = '0'
    input.style.width = '1px'
    input.style.height = '1px'
    this.closeCompletions()
    this.hint?.remove()
    this.hint = undefined
    this.resetInput()
    this.positionIdleInput()
  }

  onSelectionChange(): void {
    this.closePopup()
    this.positionIdleInput()
    this.layoutHandles()
  }

  onScroll(): void {
    this.closePopup()
    this.hideNote()
    if (this.view.editing) this.positionEditor()
    else this.positionIdleInput()
  }

  onDocChange(): void {
    if (this.view.editing) this.positionEditor()
  }

  /** The idle input sits on the active cell so the IME and mobile keyboards appear there. */
  private positionIdleInput(): void {
    const view = this.view
    if (view.editing) return
    const rect = view.cellRect(view.selection.active.row, view.selection.active.col)
    Object.assign(view.input.style, { left: `${Math.max(0, rect.x)}px`, top: `${Math.max(0, rect.y)}px` })
  }

  private positionEditor(): void {
    const view = this.view
    const edit = view.editing
    if (!edit) return
    const { input } = view
    const rect = view.cellRect(edit.row, edit.col)
    const style = view.styleAt(edit.row, edit.col)
    const render = view.cellRender(edit.row, edit.col)
    const fontPx = style.fontSize * POINTS_TO_PIXELS * view.zoom
    const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${fontPx}px ${cssFontFamily(style.fontName)}`
    const measure = view.canvas.getContext('2d')!
    measure.font = font
    const lines = edit.text.split('\n')
    const textWidth = maxOf(lines.map((line) => measure.measureText(line).width)) + 12
    const maxWidth = Math.max(rect.width, view.viewport.width - rect.x - 4)
    const width = Math.min(maxWidth, Math.max(rect.width + 1, textWidth))
    const wrapLines = style.wrap || width >= maxWidth ? Math.ceil(textWidth / Math.max(1, width)) : 1
    const height = Math.max(rect.height + 1, (lines.length + Math.max(0, wrapLines - 1)) * fontPx * 1.25 + 6)
    const palette = view.options.appearance === 'dark'
    Object.assign(input.style, {
      opacity: '1',
      left: `${rect.x - 1}px`,
      top: `${rect.y - 1}px`,
      width: `${width}px`,
      height: `${height}px`,
      font,
      color: render.color === '#000000' ? (palette ? '#E3E3E3' : '#000000') : render.color,
      background: render.fill ?? (palette ? '#1E1F20' : '#FFFFFF'),
      padding: `${2 * view.zoom}px ${3 * view.zoom}px`,
      boxSizing: 'border-box',
      lineHeight: '1.25',
      textAlign: edit.text.startsWith('=') ? 'left' : render.hAlign === 'right' || render.hAlign === 'center' ? render.hAlign : 'left',
      border: '2px solid #1A73E8',
      boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    })
  }

  /** Autocomplete and argument hints for formulas. */
  private updateAssist(): void {
    const view = this.view
    const edit = view.editing
    const docs = view.functions
    if (!edit || !docs.length) return
    const caret = view.input.selectionStart ?? edit.caret
    const partial = partialFunctionName(edit.text, caret)
    const items = partial ? completions(partial.prefix, docs) : []
    if (partial && items.length && !(items.length === 1 && items[0]!.name === partial.prefix.toUpperCase())) {
      if (!this.completionList) {
        const element = document.createElement('div')
        element.className = 'pulpo-sheet-completions'
        element.setAttribute('role', 'listbox')
        element.style.cssText = this.popupCss()
        view.root.appendChild(element)
        this.completionList = { element, items, index: 0, start: partial.start, touched: false }
      }
      this.completionList!.items = items
      this.completionList!.start = partial.start
      this.completionList!.index = Math.min(this.completionList!.index, items.length - 1)
      this.renderCompletions()
    } else this.closeCompletions()
    const hint = argumentHint(edit.text, caret, docs)
    if (hint && !this.completionList) {
      if (!this.hint) {
        this.hint = document.createElement('div')
        this.hint.className = 'pulpo-sheet-hint'
        this.hint.style.cssText = `${this.popupCss()}padding:4px 8px;font:12px system-ui,sans-serif;`
        view.root.appendChild(this.hint)
      }
      replaceChildrenWith(this.hint, hint.parts.map((part) => {
        const span = document.createElement('span')
        span.textContent = part.text
        if (part.active) span.style.fontWeight = '600'
        return span
      }))
      this.placeBelowEditor(this.hint)
    } else {
      this.hint?.remove()
      this.hint = undefined
    }
  }

  private renderCompletions(): void {
    const list = this.completionList
    if (!list) return
    replaceChildrenWith(list.element, list.items.map((doc, index) => {
      const item = document.createElement('div')
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(index === list.index))
      item.style.cssText = `padding:4px 10px;cursor:pointer;font:12px system-ui,sans-serif;${index === list.index ? 'background:rgba(26,115,232,0.12);' : ''}`
      const name = document.createElement('div')
      name.textContent = doc.name
      name.style.fontWeight = '600'
      item.appendChild(name)
      if (doc.description && index === list.index) {
        const description = document.createElement('div')
        description.textContent = doc.description
        description.style.cssText = 'opacity:0.75;white-space:normal;max-width:320px;'
        item.appendChild(description)
      }
      item.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        this.acceptCompletion(doc)
      })
      return item
    }))
    this.placeBelowEditor(list.element)
  }

  private acceptCompletion(doc: FunctionDoc): void {
    const view = this.view
    const edit = view.editing
    const list = this.completionList
    if (!edit || !list) return
    const caret = view.input.selectionStart ?? edit.caret
    const result = applyCompletion(edit.text, caret, list.start, doc.name)
    this.closeCompletions()
    view.setEditText(result.text, result.caret)
    view.input.value = result.text
    view.input.setSelectionRange(result.caret, result.caret)
    this.updateAssist()
  }

  private closeCompletions(): void {
    this.completionList?.element.remove()
    this.completionList = undefined
  }

  private placeBelowEditor(element: HTMLElement): void {
    const input = this.view.input
    element.style.left = input.style.left
    element.style.top = `${parseFloat(input.style.top) + parseFloat(input.style.height) + 2}px`
  }

  private popupCss(): string {
    const dark = this.view.options.appearance === 'dark'
    return `position:absolute;z-index:6;background:${dark ? '#2D2E30' : '#FFFFFF'};color:${dark ? '#E3E3E3' : '#1F1F1F'};border:1px solid ${dark ? '#444746' : '#DADCE0'};border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);max-height:280px;overflow:auto;pointer-events:auto;`
  }

  // ── Popups: lists, filters, notes, messages ──────────────────────────────

  private closePopup(): void {
    this.popup?.remove()
    this.popup = undefined
  }

  private openPopup(x: number, y: number): HTMLDivElement {
    this.closePopup()
    const popup = document.createElement('div')
    popup.className = 'pulpo-sheet-popup'
    popup.style.cssText = `${this.popupCss()}left:${x}px;top:${y}px;min-width:160px;font:13px system-ui,sans-serif;`
    popup.addEventListener('pointerdown', (event) => event.stopPropagation())
    popup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closePopup()
        this.view.focus()
      }
    })
    this.view.root.appendChild(popup)
    this.popup = popup
    return popup
  }

  /** Handles clicks on filter buttons and list arrows; true when one was hit. */
  private onButton(x: number, y: number, row: number, col: number): boolean {
    const view = this.view
    const sheet = view.sheet
    const filter = sheet.filter.get('value') as AutoFilter | undefined
    const filterRange = filter && sheet.resolveRange(filter.range)
    const rect = view.cellRect(row, col)
    const size = Math.min(rect.height - 2, 16 * view.zoom)
    if (filterRange && row === filterRange.top && col >= filterRange.left && col <= filterRange.right && x >= rect.x + rect.width - size - 3 && y >= rect.y + rect.height - size - 2) {
      this.openFilterMenu(col, rect)
      return true
    }
    const active = view.selection.active
    const validation = commands.validationAt(sheet, active.row, active.col)
    if (validation?.type === 'list' && !validation.showDropDown && !view.readOnly) {
      const activeRect = view.cellRect(active.row, active.col)
      if (x >= activeRect.x + activeRect.width && x <= activeRect.x + activeRect.width + size + 2 && y >= activeRect.y && y <= activeRect.y + activeRect.height) {
        this.openList(active.row, active.col, activeRect)
        return true
      }
    }
    return false
  }

  /** The dropdown of a list validation. */
  openList(row: number, col: number, rect = this.view.cellRect(row, col)): void {
    const view = this.view
    const validation = commands.validationAt(view.sheet, row, col)
    const items = validation && view.listItems(validation)
    if (!items?.length) return
    const popup = this.openPopup(rect.x, rect.y + rect.height + 2)
    popup.setAttribute('role', 'listbox')
    const current = view.displayText(row, col)
    for (const item of items) {
      const option = document.createElement('div')
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(item === current))
      option.textContent = item
      option.style.cssText = `padding:6px 12px;cursor:pointer;${item === current ? 'background:rgba(26,115,232,0.12);' : ''}`
      option.addEventListener('click', () => {
        if (view.readOnly) return
        this.closePopup()
        commands.setCellInput(view.sheet, row, col, item, { valuesOnly: view.valuesOnly, currentFormat: view.styleAt(row, col).numFmt })
        view.focus()
      })
      popup.appendChild(option)
    }
  }

  /** The autofilter menu of a column: sort, search, and value checkboxes. */
  private openFilterMenu(col: number, rect: { x: number; y: number; width: number; height: number }): void {
    const view = this.view
    const sheet = view.sheet
    const filter = sheet.filter.get('value') as AutoFilter
    const range = sheet.resolveRange(filter.range)!
    const offset = col - range.left
    const labels = view.labels
    const popup = this.openPopup(Math.max(0, rect.x + rect.width - 240), rect.y + rect.height + 2)
    popup.style.width = '240px'
    popup.style.padding = '6px 0'
    const action = (text: string, run: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = text
      button.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 12px;background:none;border:0;color:inherit;font:inherit;cursor:pointer;'
      button.addEventListener('click', () => {
        if (view.readOnly) return
        this.closePopup()
        run()
        view.focus()
      })
      popup.appendChild(button)
    }
    const sortBy = (descending: boolean) => {
      view.sortArea({ ...range, top: range.top + 1 }, [{ col, descending }])
    }
    if (!view.readOnly) {
      action(labels.sortAscending, () => sortBy(false))
      action(labels.sortDescending, () => sortBy(true))
    }
    const current = filter.columns.find((entry) => entry.col === offset)
    if (current && !view.readOnly) action(labels.clearFilter, () => view.dataOperation(() => commands.filterColumn(sheet, offset, undefined, (r, c) => view.displayText(r, c))))
    // Values in the column (shown and hidden rows).
    const values = new Map<string, number>()
    for (let row = range.top + 1; row <= range.bottom; row++) {
      const text = view.displayText(row, col)
      values.set(text, (values.get(text) ?? 0) + 1)
    }
    const sorted = [...values.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    const chosen = new Set(current?.values ?? sorted)
    const search = document.createElement('input')
    search.type = 'search'
    search.placeholder = labels.search
    search.setAttribute('aria-label', labels.search)
    search.style.cssText = 'display:block;margin:6px 12px;width:calc(100% - 24px);box-sizing:border-box;padding:4px 8px;border:1px solid rgba(127,127,127,0.4);border-radius:6px;background:transparent;color:inherit;font:inherit;'
    popup.appendChild(search)
    const list = document.createElement('div')
    list.style.cssText = 'max-height:180px;overflow:auto;padding:0 6px;'
    popup.appendChild(list)
    const renderList = () => {
      const query = search.value.toLowerCase()
      const visible = sorted.filter((value) => (value || labels.blanks).toLowerCase().includes(query))
      const rows: HTMLElement[] = []
      const all = document.createElement('label')
      all.style.cssText = 'display:flex;gap:6px;align-items:center;padding:3px 6px;'
      const allBox = document.createElement('input')
      allBox.type = 'checkbox'
      allBox.checked = visible.every((value) => chosen.has(value))
      allBox.addEventListener('change', () => {
        for (const value of visible) {
          if (allBox.checked) chosen.add(value)
          else chosen.delete(value)
        }
        renderList()
      })
      all.append(allBox, document.createTextNode(labels.selectAll))
      rows.push(all)
      for (const value of visible.slice(0, 1000)) {
        const label = document.createElement('label')
        label.style.cssText = 'display:flex;gap:6px;align-items:center;padding:3px 6px;'
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.checked = chosen.has(value)
        box.addEventListener('change', () => {
          if (box.checked) chosen.add(value)
          else chosen.delete(value)
        })
        label.append(box, document.createTextNode(value || labels.blanks))
        rows.push(label)
      }
      replaceChildrenWith(list, rows)
    }
    search.addEventListener('input', renderList)
    renderList()
    const footer = document.createElement('div')
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:8px 12px 4px;'
    const button = (text: string, primary: boolean, run: () => void) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = text
      element.style.cssText = `padding:4px 12px;border-radius:999px;border:1px solid ${primary ? '#1A73E8' : 'rgba(127,127,127,0.4)'};background:${primary ? '#1A73E8' : 'transparent'};color:${primary ? '#FFFFFF' : 'inherit'};font:inherit;cursor:pointer;`
      element.addEventListener('click', run)
      footer.appendChild(element)
    }
    button(labels.cancel, false, () => {
      this.closePopup()
      view.focus()
    })
    if (!view.readOnly) {
      button(labels.ok, true, () => {
        if (view.readOnly) return
        this.closePopup()
        const everything = sorted.every((value) => chosen.has(value))
        view.dataOperation(() => commands.filterColumn(sheet, offset, everything ? undefined : [...chosen], (r, c) => view.displayText(r, c)))
        view.focus()
      })
    }
    popup.appendChild(footer)
    search.focus()
  }

  private onHover(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || this.drag) return
    const view = this.view
    const { x, y } = this.point(event)
    const hit = view.hitTest(x, y)
    clearTimeout(this.noteTimer)
    if (hit.area !== 'cell') return this.hideNote()
    const sheet = view.sheet
    const key = sheet.keyAt(hit.row, hit.col)
    const note = sheet.notes.get(key) as Note | undefined
    const link = sheet.links.get(key)
    if (!note && !link) return this.hideNote()
    this.noteTimer = setTimeout(() => this.showNote(hit.row, hit.col, note, !!link), 250)
  }

  private showNote(row: number, col: number, note: Note | undefined, link: boolean): void {
    this.hideNote()
    const view = this.view
    const rect = view.cellRect(row, col)
    const popup = document.createElement('div')
    popup.className = 'pulpo-sheet-note'
    popup.style.cssText = `${this.popupCss()}left:${rect.x + rect.width + 4}px;top:${rect.y}px;max-width:260px;padding:8px 10px;font:12px system-ui,sans-serif;white-space:pre-wrap;pointer-events:none;`
    if (note) {
      if (note.author) {
        const author = document.createElement('div')
        author.textContent = note.author
        author.style.fontWeight = '600'
        popup.appendChild(author)
      }
      const text = document.createElement('div')
      text.textContent = note.text.replace(new RegExp(`^${escapeRegExp(note.author)}:\\s*`), '')
      popup.appendChild(text)
    } else if (link) {
      popup.textContent = view.labels.linkHint
    }
    view.root.appendChild(popup)
    this.notePopup = popup
  }

  private hideNote(): void {
    clearTimeout(this.noteTimer)
    this.notePopup?.remove()
    this.notePopup = undefined
  }

  showMessage(text: string, row: number, col: number): void {
    this.hideMessage()
    const view = this.view
    const rect = view.cellRect(row, col)
    const message = document.createElement('div')
    message.setAttribute('role', 'alert')
    message.style.cssText = `${this.popupCss()}left:${rect.x}px;top:${rect.y + rect.height + 4}px;max-width:300px;padding:8px 10px;font:12px system-ui,sans-serif;border-color:#D93025;`
    message.textContent = text
    view.root.appendChild(message)
    this.message = message
    setTimeout(() => this.hideMessage(), 4000)
  }

  private hideMessage(): void {
    this.message?.remove()
    this.message = undefined
  }

  private followLink(row: number, col: number): boolean {
    const view = this.view
    const link = view.sheet.links.get(view.sheet.keyAt(row, col)) as { target?: string; location?: string } | undefined
    if (!link) return false
    if (link.location) return view.goTo(link.location)
    if (link.target && /^(https?:|mailto:)/i.test(link.target)) {
      if (view.options.openLink) view.options.openLink(link.target)
      else window.open(link.target, '_blank', 'noopener,noreferrer')
      return true
    }
    return false
  }

  // ── Drawings ─────────────────────────────────────────────────────────────

  /** Positions images and charts over the grid. */
  layoutOverlays(scene: Scene): void {
    const view = this.view
    const sheet = view.sheet
    const seen = new Set<string>()
    for (const [id, raw] of sheet.drawings) {
      const drawing = raw as DrawingObject
      if (drawing.kind !== 'image' && drawing.kind !== 'chart') continue
      const rect = this.drawingRect(drawing, scene)
      if (!rect) continue
      seen.add(id)
      let element = this.drawingElements.get(id)
      if (!element) {
        element = this.createDrawing(id, drawing)
        this.drawingElements.set(id, element)
        view.overlay.appendChild(element)
      }
      const visible = rect.x + rect.width > scene.headerWidth && rect.y + rect.height > scene.headerHeight && rect.x < scene.width && rect.y < scene.height
      element.style.display = visible ? 'block' : 'none'
      if (!visible || (this.drag?.kind === 'drawing' && this.drag.id === id)) continue
      Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: String(drawing.z) })
      if (drawing.kind === 'chart') this.renderChart(element, drawing, rect)
    }
    for (const [id, element] of this.drawingElements) {
      if (seen.has(id)) continue
      element.remove()
      this.drawingElements.delete(id)
    }
    // Content is clipped below the headers.
    view.overlay.style.clipPath = `inset(${scene.headerHeight}px 0 0 ${scene.headerWidth}px)`
    this.layoutHandles()
  }

  private drawingRect(drawing: DrawingObject, scene: Scene): { x: number; y: number; width: number; height: number } | undefined {
    const view = this.view
    const sheet = view.sheet
    const point = (anchor: NonNullable<DrawingObject['from']>) => {
      const row = sheet.rows.indexOf(anchor.row)
      const col = sheet.cols.indexOf(anchor.col)
      if (row < 0 || col < 0) return undefined
      const base = view.cellRect(row, col)
      return { x: base.x + (anchor.colOff / EMU_PER_PIXEL) * scene.zoom, y: base.y + (anchor.rowOff / EMU_PER_PIXEL) * scene.zoom }
    }
    if (drawing.anchor === 'absolute') {
      if (!drawing.pos || !drawing.ext) return undefined
      return {
        x: scene.headerWidth + (drawing.pos.x / EMU_PER_PIXEL - scene.scrollX) * scene.zoom,
        y: scene.headerHeight + (drawing.pos.y / EMU_PER_PIXEL - scene.scrollY) * scene.zoom,
        width: (drawing.ext.cx / EMU_PER_PIXEL) * scene.zoom,
        height: (drawing.ext.cy / EMU_PER_PIXEL) * scene.zoom,
      }
    }
    const from = drawing.from && point(drawing.from)
    if (!from) return undefined
    if (drawing.anchor === 'twoCell' && drawing.to) {
      const to = point(drawing.to)
      if (!to) return undefined
      return { x: from.x, y: from.y, width: Math.max(1, to.x - from.x), height: Math.max(1, to.y - from.y) }
    }
    if (!drawing.ext) return undefined
    return { x: from.x, y: from.y, width: (drawing.ext.cx / EMU_PER_PIXEL) * scene.zoom, height: (drawing.ext.cy / EMU_PER_PIXEL) * scene.zoom }
  }

  private createDrawing(id: string, drawing: DrawingObject): HTMLElement {
    const view = this.view
    const element = document.createElement('div')
    element.className = `pulpo-sheet-drawing pulpo-sheet-${drawing.kind}`
    element.dataset.drawingId = id
    element.style.cssText = 'position:absolute;pointer-events:auto;overflow:hidden;box-sizing:border-box;cursor:default;'
    if (drawing.name) element.setAttribute('aria-label', drawing.name)
    if (drawing.kind === 'image') {
      const image = document.createElement('img')
      image.alt = drawing.name ?? ''
      image.draggable = false
      image.style.cssText = 'width:100%;height:100%;display:block;object-fit:fill;'
      element.appendChild(image)
      if (drawing.image) {
        const cached = this.imageUrls.get(drawing.image.hash)
        if (cached) image.src = cached
        else {
          const ref = drawing.image
          let loading = this.imageLoads.get(ref.hash)
          if (!loading) {
            loading = view.options.assets.get(ref.hash).then((bytes) => {
              // Teardown owns URL cleanup, so late requests must never allocate one.
              if (this.disposed) return undefined
              const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ref.mimeType }))
              this.imageUrls.set(ref.hash, url)
              return url
            }).finally(() => this.imageLoads.delete(ref.hash))
            this.imageLoads.set(ref.hash, loading)
          }
          void loading.then((url) => {
            if (!this.disposed && url) image.src = url
          }).catch(() => {
            if (!this.disposed) element.textContent = view.labels.imageUnavailable
          })
        }
      }
    }
    element.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      event.preventDefault()
      view.focus()
      this.selectDrawing(id)
      if (view.readOnly) return
      const rect = element.getBoundingClientRect()
      const resize = event.clientX > rect.right - 12 && event.clientY > rect.bottom - 12
      this.drag = { kind: 'drawing', id, startX: event.clientX, startY: event.clientY, element, left: parseFloat(element.style.left), top: parseFloat(element.style.top), resize, width: rect.width, height: rect.height }
    })
    return element
  }

  private selectDrawing(id: string | undefined): void {
    if (this.selectedDrawing === id) return
    const previous = this.selectedDrawing && this.drawingElements.get(this.selectedDrawing)
    if (previous) previous.style.outline = ''
    this.selectedDrawing = id
    const element = id && this.drawingElements.get(id)
    if (element) element.style.outline = '2px solid #1A73E8'
  }

  private finishDrawingDrag(drag: Extract<Drag, { kind: 'drawing' }>, event: PointerEvent): void {
    const view = this.view
    const sheet = view.sheet
    const drawing = sheet.drawings.get(drag.id) as DrawingObject | undefined
    drag.element.style.transform = ''
    if (!drawing || view.readOnly) return
    const dx = (event.clientX - drag.startX) / view.zoom
    const dy = (event.clientY - drag.startY) / view.zoom
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    const root = view.root.getBoundingClientRect()
    const anchorAt = (screenX: number, screenY: number) => {
      const hit = view.hitTest(screenX, screenY)
      const cell = view.cellRect(hit.row, hit.col)
      sheet.ensure(hit.row, hit.col)
      return { row: sheet.rows.idAt(hit.row), col: sheet.cols.idAt(hit.col), rowOff: Math.max(0, Math.round(((screenY - cell.y) / view.zoom) * EMU_PER_PIXEL)), colOff: Math.max(0, Math.round(((screenX - cell.x) / view.zoom) * EMU_PER_PIXEL)) }
    }
    void root
    view.workbook.transact(() => {
      if (drag.resize) {
        const width = Math.max(10, drag.width + dx * view.zoom)
        const height = Math.max(10, drag.height + dy * view.zoom)
        if (drawing.anchor === 'twoCell') sheet.drawings.set(drag.id, { ...drawing, to: anchorAt(drag.left + width, drag.top + height) })
        else sheet.drawings.set(drag.id, { ...drawing, ext: { cx: Math.round((width / view.zoom) * EMU_PER_PIXEL), cy: Math.round((height / view.zoom) * EMU_PER_PIXEL) } })
        return
      }
      const left = drag.left + dx * view.zoom
      const top = drag.top + dy * view.zoom
      const from = anchorAt(left, top)
      if (drawing.anchor === 'twoCell') {
        sheet.drawings.set(drag.id, { ...drawing, from, to: anchorAt(left + drag.width, top + drag.height) })
      } else if (drawing.anchor === 'oneCell') sheet.drawings.set(drag.id, { ...drawing, from })
      else if (drawing.pos) sheet.drawings.set(drag.id, { ...drawing, pos: { x: Math.round(drawing.pos.x + dx * EMU_PER_PIXEL), y: Math.round(drawing.pos.y + dy * EMU_PER_PIXEL) } })
    })
  }

  private chartCache = new Map<string, { key: string; xml?: string }>()

  private renderChart(element: HTMLElement, drawing: DrawingObject, rect: { width: number; height: number }): void {
    const view = this.view
    const path = drawing.chart
    const part = path ? view.workbook.parts.get(path) : undefined
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    const key = `${part?.hash}|${width}x${height}|${view.zoom}|${view.valuesRevision}|${JSON.stringify(view.theme)}|${view.options.appearance}`
    const id = element.dataset.drawingId!
    const cached = this.chartCache.get(id)
    if (cached?.key === key && element.dataset.rendered === key) return
    const render = (xml: string | undefined) => {
      if (this.disposed) return
      const svg = xml ? view.renderChart(xml, { width, height }, (formula) => this.resolveChartRange(formula)) : undefined
      if (svg) element.innerHTML = svg
      else {
        element.replaceChildren()
        const placeholder = document.createElement('div')
        placeholder.textContent = view.labels.chartUnavailable
        placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:1px dashed #9AA0A6;color:#5F6368;font:12px system-ui,sans-serif;background:rgba(255,255,255,0.8);'
        element.appendChild(placeholder)
      }
      element.dataset.rendered = key
    }
    if (cached?.xml !== undefined && cached.key.split('|')[0] === key.split('|')[0]) {
      this.chartCache.set(id, { key, xml: cached.xml })
      render(cached.xml)
      return
    }
    this.chartCache.set(id, { key })
    if (!part) return render(undefined)
    void view.options.assets
      .get(part.hash)
      .then((bytes) => {
        if (this.disposed) return
        const xml = new TextDecoder().decode(bytes)
        this.chartCache.set(id, { key, xml })
        render(xml)
      })
      .catch(() => render(undefined))
  }

  /** Live values of a chart series formula (`Sheet1!$B$2:$B$9`). */
  private resolveChartRange(formula: string): CellValue[][] | undefined {
    const view = this.view
    const text = formula.replace(/^\(|\)$/g, '')
    const bang = text.lastIndexOf('!')
    if (bang < 0) return undefined
    const sheet = view.workbook.sheetByName(text.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'"))
    const reference = text.slice(bang + 1).replace(/\$/g, '')
    const [start, end] = reference.split(':')
    const parse = (name: string | undefined) => {
      const match = name && /^([A-Z]+)(\d+)$/i.exec(name)
      if (!match) return undefined
      let col = 0
      for (const char of match[1]!.toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64
      return { row: Number(match[2]) - 1, col: col - 1 }
    }
    const a = parse(start)
    const b = parse(end ?? start)
    if (!sheet || !a || !b) return undefined
    const rows: CellValue[][] = []
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row) && rows.length < 10_000; row++) {
      const line: CellValue[] = []
      for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) line.push(view.values.get(sheet, row, col))
      rows.push(line)
    }
    return rows
  }

  // ── Touch handles ────────────────────────────────────────────────────────

  /** Round handles at the selection's corners for touch, to extend it by dragging. */
  private layoutHandles(): void {
    const view = this.view
    if (!this.touchMode || view.editing) {
      for (const handle of this.handles) handle.remove()
      this.handles = []
      return
    }
    if (!this.handles.length) {
      this.handles = (['start', 'end'] as const).map((corner) => {
        const handle = document.createElement('div')
        handle.className = 'pulpo-sheet-handle'
        handle.style.cssText = 'position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;touch-action:none;z-index:5;display:flex;align-items:center;justify-content:center;pointer-events:auto;'
        const dot = document.createElement('div')
        dot.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#1A73E8;border:2px solid #FFFFFF;box-shadow:0 1px 3px rgba(0,0,0,0.3);'
        handle.appendChild(dot)
        handle.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
          event.preventDefault()
          this.drag = { kind: 'handle', corner }
        })
        view.root.appendChild(handle)
        return handle
      })
    }
    const range = view.selection.ranges[view.selection.ranges.length - 1]!
    const start = view.cellRect(range.top, range.left)
    const end = view.cellRect(Math.min(range.bottom, MAX_ROWS - 1), Math.min(range.right, MAX_COLS - 1))
    Object.assign(this.handles[0]!.style, { left: `${start.x}px`, top: `${start.y}px` })
    Object.assign(this.handles[1]!.style, { left: `${end.x + end.width}px`, top: `${end.y + end.height}px` })
  }
}

function span(from: number, to: number): number[] {
  const result: number[] = []
  for (let index = from; index <= to; index++) result.push(index)
  return result
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export { cellName }

function valueData(value: CellValue): import('../model/schema.js').CellData | undefined {
  return value === null ? undefined : isErrorValue(value) ? { v: value.e, t: 'e' } : { v: value }
}
