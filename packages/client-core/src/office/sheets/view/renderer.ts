import { columnName, rangeContains, type CellRange } from '../address.js'
import type { BorderStyle } from '../model/schema.js'
import { formatValue } from '../numfmt/index.js'
import type { CellRender, CssBorder } from './display.js'
import type { AxisLayout } from './layout.js'
import { POINTS_TO_PIXELS } from './layout.js'

/** Colors of the grid chrome (not of cell content) for light and dark appearances. */
export interface GridPalette {
  background: string
  /** Text color for "automatic" font colors. */
  text: string
  grid: string
  headerBackground: string
  headerText: string
  headerBorder: string
  headerSelectedBackground: string
  headerSelectedText: string
  selectionFill: string
  selectionBorder: string
  frozenLine: string
}

export const LIGHT_PALETTE: GridPalette = {
  background: '#FFFFFF',
  text: '#000000',
  grid: '#E1E1E1',
  headerBackground: '#F8F9FA',
  headerText: '#5F6368',
  headerBorder: '#C4C7C5',
  headerSelectedBackground: '#D3E3FD',
  headerSelectedText: '#0B57D0',
  selectionFill: 'rgba(14, 101, 235, 0.10)',
  selectionBorder: '#1A73E8',
  frozenLine: '#BDC1C6',
}

export const DARK_PALETTE: GridPalette = {
  background: '#1E1F20',
  text: '#E3E3E3',
  grid: '#3C4043',
  headerBackground: '#28292A',
  headerText: '#A8ABAF',
  headerBorder: '#444746',
  headerSelectedBackground: '#2B3E5C',
  headerSelectedText: '#A8C7FA',
  selectionFill: 'rgba(138, 180, 248, 0.16)',
  selectionBorder: '#8AB4F8',
  frozenLine: '#5F6368',
}

export interface RemoteSelection {
  name: string
  color: string
  ranges: CellRange[]
  active: { row: number; col: number }
}

export interface Scene {
  width: number
  height: number
  zoom: number
  headerWidth: number
  headerHeight: number
  rows: AxisLayout
  cols: AxisLayout
  /** Scroll of the unfrozen pane, in unzoomed grid pixels past the frozen area. */
  scrollX: number
  scrollY: number
  frozenRows: number
  frozenCols: number
  palette: GridPalette
  showGridLines: boolean
  showHeadings: boolean
  cell: (row: number, col: number) => CellRender
  /** Whether a cell has content (text overflowing into it must stop). */
  occupied: (row: number, col: number) => boolean
  merges: CellRange[]
  selection: { ranges: CellRange[]; active: { row: number; col: number } }
  remote: RemoteSelection[]
  /** The cell being edited (its text is hidden under the editor). */
  editing?: { row: number; col: number }
  notes: Set<string>
  filter?: { range: CellRange; active: Set<number> }
  /** Cells showing a validation list arrow (the active cell when it has a list). */
  listCell?: { row: number; col: number }
  copyRange?: CellRange
  /** References of the formula being edited, colored. */
  referenceHighlights: { range: CellRange; color: string }[]
  fontFamily: (name: string) => string
  /** Pixels per character of the default font, for General number widths. */
  digitWidth: number
  fillHandle: boolean
}

interface Pane {
  /** Screen rectangle. */
  x: number
  y: number
  width: number
  height: number
  rows: [number, number]
  cols: [number, number]
}

const PADDING = 3

export class GridRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** Screen x of a column's left edge. */
  static x(scene: Scene, col: number): number {
    const offset = scene.cols.offset(col)
    return scene.headerWidth + (col < scene.frozenCols ? offset : offset - scene.scrollX) * scene.zoom
  }

  static y(scene: Scene, row: number): number {
    const offset = scene.rows.offset(row)
    return scene.headerHeight + (row < scene.frozenRows ? offset : offset - scene.scrollY) * scene.zoom
  }

  /** The panes: frozen corner, frozen rows, frozen columns, and the scrolled area. */
  static panes(scene: Scene): Pane[] {
    const frozenWidth = scene.cols.offset(scene.frozenCols) * scene.zoom
    const frozenHeight = scene.rows.offset(scene.frozenRows) * scene.zoom
    const left = scene.headerWidth
    const top = scene.headerHeight
    const mainX = left + frozenWidth
    const mainY = top + frozenHeight
    const visibleCols = (start: number, width: number): [number, number] => {
      const first = scene.cols.indexAt(start)
      const last = scene.cols.indexAt(start + width / scene.zoom)
      return [first, Math.min(scene.cols.count - 1, last)]
    }
    const visibleRows = (start: number, height: number): [number, number] => {
      const first = scene.rows.indexAt(start)
      const last = scene.rows.indexAt(start + height / scene.zoom)
      return [first, Math.min(scene.rows.count - 1, last)]
    }
    const scrolledCols = visibleCols(scene.cols.offset(scene.frozenCols) + scene.scrollX, scene.width - mainX)
    const scrolledRows = visibleRows(scene.rows.offset(scene.frozenRows) + scene.scrollY, scene.height - mainY)
    const panes: Pane[] = [{ x: mainX, y: mainY, width: scene.width - mainX, height: scene.height - mainY, rows: scrolledRows, cols: scrolledCols }]
    if (scene.frozenRows) panes.push({ x: mainX, y: top, width: scene.width - mainX, height: frozenHeight, rows: [0, scene.frozenRows - 1], cols: scrolledCols })
    if (scene.frozenCols) panes.push({ x: left, y: mainY, width: frozenWidth, height: scene.height - mainY, rows: scrolledRows, cols: [0, scene.frozenCols - 1] })
    if (scene.frozenRows && scene.frozenCols) panes.push({ x: left, y: top, width: frozenWidth, height: frozenHeight, rows: [0, scene.frozenRows - 1], cols: [0, scene.frozenCols - 1] })
    return panes
  }

  draw(scene: Scene): void {
    const { ctx } = this
    ctx.save()
    ctx.fillStyle = scene.palette.background
    ctx.fillRect(0, 0, scene.width, scene.height)
    const panes = GridRenderer.panes(scene)
    for (const pane of panes) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(pane.x, pane.y, pane.width, pane.height)
      ctx.clip()
      this.drawPane(scene, pane)
      ctx.restore()
    }
    this.drawFrozenLines(scene)
    if (scene.showHeadings) this.drawHeaders(scene, panes)
    ctx.restore()
  }

  private cellRect(scene: Scene, row: number, col: number): { x: number; y: number; width: number; height: number } {
    return {
      x: GridRenderer.x(scene, col),
      y: GridRenderer.y(scene, row),
      width: scene.cols.size(col) * scene.zoom,
      height: scene.rows.size(row) * scene.zoom,
    }
  }

  private rangeRect(scene: Scene, range: CellRange): { x: number; y: number; width: number; height: number } {
    const x = GridRenderer.x(scene, range.left)
    const y = GridRenderer.y(scene, range.top)
    return {
      x,
      y,
      width: GridRenderer.x(scene, range.right) + scene.cols.size(range.right) * scene.zoom - x,
      height: GridRenderer.y(scene, range.bottom) + scene.rows.size(range.bottom) * scene.zoom - y,
    }
  }

  private drawPane(scene: Scene, pane: Pane): void {
    const { ctx } = this
    const [top, bottom] = pane.rows
    const [left, right] = pane.cols
    // Text can overflow in from cells just outside the pane.
    const reachLeft = Math.max(0, left - 30)
    const reachRight = Math.min(scene.cols.count - 1, right + 30)
    const merges = scene.merges.filter((merge) => merge.bottom >= top && merge.top <= bottom && merge.right >= reachLeft && merge.left <= reachRight)
    const mergeAt = (row: number, col: number) => merges.find((merge) => rangeContains(merge, row, col))
    const renders = new Map<string, CellRender>()
    const get = (row: number, col: number) => {
      const key = `${row},${col}`
      let render = renders.get(key)
      if (!render) {
        render = scene.cell(row, col)
        renders.set(key, render)
      }
      return render
    }

    // Gridlines.
    if (scene.showGridLines) {
      ctx.strokeStyle = scene.palette.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let row = top; row <= bottom + 1; row++) {
        if (scene.rows.isHidden(row)) continue
        const y = Math.round(GridRenderer.y(scene, row)) - 0.5
        ctx.moveTo(pane.x, y)
        ctx.lineTo(pane.x + pane.width, y)
      }
      for (let col = left; col <= right + 1; col++) {
        if (scene.cols.isHidden(col)) continue
        const x = Math.round(GridRenderer.x(scene, col)) - 0.5
        ctx.moveTo(x, pane.y)
        ctx.lineTo(x, pane.y + pane.height)
      }
      ctx.stroke()
    }

    // Fills (they hide the gridlines around them), then merged areas.
    for (let row = top; row <= bottom; row++) {
      if (scene.rows.isHidden(row)) continue
      for (let col = left; col <= right; col++) {
        if (scene.cols.isHidden(col) || mergeAt(row, col)) continue
        const render = get(row, col)
        this.drawFill(scene, render, this.cellRect(scene, row, col))
      }
    }
    for (const merge of merges) {
      const render = get(merge.top, merge.left)
      const rect = this.rangeRect(scene, merge)
      ctx.fillStyle = render.fill ?? scene.palette.background
      ctx.fillRect(rect.x, rect.y, rect.width - 1, rect.height - 1)
      if (render.fill || render.pattern || render.overlay) this.drawFill(scene, render, rect)
    }

    // Borders.
    for (let row = top; row <= bottom; row++) {
      if (scene.rows.isHidden(row)) continue
      for (let col = left; col <= right; col++) {
        if (scene.cols.isHidden(col)) continue
        const render = get(row, col)
        if (render.borders.top || render.borders.bottom || render.borders.left || render.borders.right || render.borders.diagonalUp || render.borders.diagonalDown) {
          this.drawBorders(render, this.cellRect(scene, row, col), scene.zoom)
        }
      }
    }

    // Text.
    for (let row = top; row <= bottom; row++) {
      if (scene.rows.isHidden(row)) continue
      for (let col = reachLeft; col <= reachRight; col++) {
        if (scene.cols.isHidden(col)) continue
        const merge = mergeAt(row, col)
        if (merge && (merge.left !== col || merge.top !== row)) continue
        if (!merge && (col < left - 30 || col > right + 30)) continue
        const render = merge ? get(merge.top, merge.left) : get(row, col)
        if (!render.text && !render.overlay?.icon) continue
        if (scene.editing && scene.editing.row === row && scene.editing.col === col) continue
        const rect = merge ? this.rangeRect(scene, merge) : this.cellRect(scene, row, col)
        if (!merge && (col < left || col > right) && !this.overflows(scene, render, rect)) continue
        this.drawText(scene, render, rect, merge ? undefined : { row, col }, mergeAt)
      }
    }

    // Indicators: notes, filter buttons, list arrows.
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        if (scene.notes.has(`${row},${col}`)) {
          const rect = this.cellRect(scene, row, col)
          ctx.fillStyle = '#E8453C'
          ctx.beginPath()
          const size = 6 * Math.min(1.5, scene.zoom)
          ctx.moveTo(rect.x + rect.width - size - 1, rect.y)
          ctx.lineTo(rect.x + rect.width - 1, rect.y)
          ctx.lineTo(rect.x + rect.width - 1, rect.y + size)
          ctx.fill()
        }
      }
    }
    if (scene.filter && scene.filter.range.top >= top && scene.filter.range.top <= bottom) {
      for (let col = Math.max(left, scene.filter.range.left); col <= Math.min(right, scene.filter.range.right); col++) {
        this.drawDropButton(scene, this.cellRect(scene, scene.filter.range.top, col), scene.filter.active.has(col - scene.filter.range.left))
      }
    }
    if (scene.listCell) this.drawDropButton(scene, this.cellRect(scene, scene.listCell.row, scene.listCell.col), false, true)

    this.drawHighlights(scene)
    for (const remote of scene.remote) this.drawRemote(scene, remote)
    this.drawSelection(scene)
  }

  private overflows(scene: Scene, render: CellRender, rect: { width: number }): boolean {
    if (render.numeric || render.style.wrap) return false
    this.setFont(scene, render)
    return this.ctx.measureText(render.text).width + PADDING * 2 > rect.width
  }

  private drawFill(scene: Scene, render: CellRender, rect: { x: number; y: number; width: number; height: number }): void {
    const { ctx } = this
    if (render.fill) {
      ctx.fillStyle = render.fill
      // Cover the gridlines on the cell's edges too, as Excel does.
      ctx.fillRect(rect.x - 1, rect.y - 1, rect.width + 1, rect.height + 1)
    }
    if (render.pattern) {
      ctx.fillStyle = render.pattern.bg ?? scene.palette.background
      if (render.pattern.bg) ctx.fillRect(rect.x - 1, rect.y - 1, rect.width + 1, rect.height + 1)
      ctx.fillStyle = patternStyle(ctx, render.pattern.type, render.pattern.fg ?? '#000000') ?? render.pattern.fg ?? '#000000'
      ctx.fillRect(rect.x, rect.y, rect.width - 1, rect.height - 1)
    }
    const bar = render.overlay?.dataBar
    if (bar) {
      const width = (rect.width - 4) * bar.fraction
      const gradient = ctx.createLinearGradient(rect.x + 2, 0, rect.x + 2 + width, 0)
      gradient.addColorStop(0, bar.negative ? '#FF0000' : bar.color)
      gradient.addColorStop(1, scene.palette.background)
      ctx.fillStyle = gradient
      ctx.fillRect(rect.x + 2, rect.y + 2, width, rect.height - 5)
      ctx.strokeStyle = bar.negative ? '#FF0000' : bar.color
      ctx.lineWidth = 1
      ctx.strokeRect(rect.x + 2.5, rect.y + 2.5, Math.max(0, width - 1), rect.height - 6)
    }
  }

  private drawBorders(render: CellRender, rect: { x: number; y: number; width: number; height: number }, zoom: number): void {
    const { x, y, width, height } = rect
    const right = x + width - 1
    const bottom = y + height - 1
    const { borders } = render
    if (borders.top) this.line(borders.top, x - 1, y - 1, right, y - 1, zoom)
    if (borders.bottom) this.line(borders.bottom, x - 1, bottom, right, bottom, zoom)
    if (borders.left) this.line(borders.left, x - 1, y - 1, x - 1, bottom, zoom)
    if (borders.right) this.line(borders.right, right, y - 1, right, bottom, zoom)
    if (borders.diagonalDown) this.line(borders.diagonalDown, x, y, right, bottom, zoom)
    if (borders.diagonalUp) this.line(borders.diagonalUp, x, bottom, right, y, zoom)
  }

  private line(border: CssBorder, x1: number, y1: number, x2: number, y2: number, zoom: number): void {
    const { ctx } = this
    const { width, dash, double } = borderGeometry(border.style)
    ctx.save()
    ctx.strokeStyle = border.color
    ctx.lineWidth = Math.max(1, Math.round(width * Math.min(zoom, 2)))
    ctx.setLineDash(dash.map((part) => part * Math.max(1, zoom)))
    const offset = ctx.lineWidth % 2 ? 0.5 : 0
    const horizontal = y1 === y2
    const draw = (shift: number) => {
      ctx.beginPath()
      if (horizontal) {
        ctx.moveTo(x1, Math.round(y1) + offset + shift)
        ctx.lineTo(x2 + 1, Math.round(y2) + offset + shift)
      } else if (x1 === x2) {
        ctx.moveTo(Math.round(x1) + offset + shift, y1)
        ctx.lineTo(Math.round(x2) + offset + shift, y2 + 1)
      } else {
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
      }
      ctx.stroke()
    }
    if (double) {
      draw(-1)
      draw(1)
    } else draw(0)
    ctx.restore()
  }

  private setFont(scene: Scene, render: CellRender, run?: NonNullable<CellRender['style']>): void {
    const style = run ?? render.style
    const size = style.fontSize * POINTS_TO_PIXELS * scene.zoom
    this.ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size.toFixed(2)}px ${scene.fontFamily(style.fontName)}`
  }

  private drawText(
    scene: Scene,
    render: CellRender,
    rect: { x: number; y: number; width: number; height: number },
    position: { row: number; col: number } | undefined,
    mergeAt: (row: number, col: number) => CellRange | undefined,
  ): void {
    const { ctx } = this
    const style = render.style
    this.setFont(scene, render)
    const padding = PADDING * scene.zoom
    const indent = style.indent * 3 * scene.digitWidth * scene.zoom
    let text = render.text
    const available = rect.width - padding * 2 - indent
    // Numbers that don't fit: General shows fewer digits, other formats show ####.
    if (render.numeric && !style.wrap && typeof render.value === 'number') {
      if (ctx.measureText(text).width > available) {
        if (style.numFmt === 'General') {
          const chars = Math.max(1, Math.floor(available / (scene.digitWidth * scene.zoom * (style.fontSize / 11))))
          text = formatValue(render.value, 'General', { generalWidth: chars }).text
        }
        if (ctx.measureText(text).width > available) {
          const hashWidth = ctx.measureText('#').width || 1
          text = '#'.repeat(Math.max(1, Math.floor(available / hashWidth)))
        }
      }
    }
    // A `*x` fill repeats its character to fill the cell.
    if (render.repeat && !style.wrap) {
      const charWidth = ctx.measureText(render.repeat.char).width || 1
      const missing = Math.floor((available - ctx.measureText(text).width) / charWidth)
      if (missing > 0) text = text.slice(0, render.repeat.position) + render.repeat.char.repeat(missing) + text.slice(render.repeat.position)
    }
    const icon = render.overlay?.icon
    const showText = (!icon || icon.showValue) && (!render.overlay?.dataBar || render.overlay.dataBar.showValue)
    let clip = { ...rect }
    // Overflow into empty neighbors for unwrapped text.
    if (position && !style.wrap && !render.numeric && style.rotation === 0) {
      const width = ctx.measureText(text).width + padding * 2 + indent
      if (width > rect.width) {
        const spread = (direction: 1 | -1, need: number) => {
          let extra = 0
          let col = position.col + direction
          while (extra < need && col >= 0 && col < scene.cols.count && !scene.occupied(position.row, col) && !mergeAt(position.row, col)) {
            extra += scene.cols.size(col) * scene.zoom
            col += direction
          }
          return extra
        }
        if (render.hAlign === 'left') clip = { ...clip, width: clip.width + spread(1, width - rect.width) }
        else if (render.hAlign === 'right') {
          const extra = spread(-1, width - rect.width)
          clip = { ...clip, x: clip.x - extra, width: clip.width + extra }
        } else if (render.hAlign === 'center') {
          const half = (width - rect.width) / 2
          const leftExtra = spread(-1, half)
          const rightExtra = spread(1, half)
          clip = { x: clip.x - leftExtra, y: clip.y, width: clip.width + leftExtra + rightExtra, height: clip.height }
        }
      }
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(clip.x, clip.y, clip.width - 1, clip.height - 1)
    ctx.clip()
    ctx.fillStyle = render.color === '#000000' ? scene.palette.text : render.color
    let iconSpace = 0
    if (icon) {
      const size = Math.min(rect.height - 4, 16 * scene.zoom)
      drawIcon(ctx, icon.set, icon.index, rect.x + padding, rect.y + (rect.height - size) / 2, size)
      iconSpace = size + 2
      ctx.fillStyle = render.color === '#000000' ? scene.palette.text : render.color
    }
    if (showText && text) {
      if (style.rotation && style.rotation !== 0) this.drawRotated(scene, render, text, rect)
      else if (style.wrap || /\n/.test(text)) this.drawWrapped(scene, render, text, { ...rect, x: rect.x + iconSpace, width: rect.width - iconSpace }, padding, indent)
      else this.drawLine(scene, render, text, rect, clip, padding + iconSpace, indent)
    }
    ctx.restore()
  }

  private textY(render: CellRender, rect: { y: number; height: number }, lineHeight: number, lines: number, zoom: number): number {
    const block = lineHeight * lines
    switch (render.vAlign) {
      case 'top':
        return rect.y + 2 * zoom
      case 'center':
      case 'justify':
      case 'distributed':
        return rect.y + (rect.height - block) / 2
      default:
        return rect.y + rect.height - block - 2 * zoom
    }
  }

  private drawLine(scene: Scene, render: CellRender, text: string, rect: { x: number; y: number; width: number; height: number }, clip: { x: number; width: number }, padding: number, indent: number): void {
    const { ctx } = this
    const fontPx = render.style.fontSize * POINTS_TO_PIXELS * scene.zoom
    const lineHeight = fontPx * 1.25
    const top = this.textY(render, rect, lineHeight, 1, scene.zoom)
    ctx.textBaseline = 'middle'
    const width = ctx.measureText(text).width
    let x: number
    if (render.hAlign === 'right') x = rect.x + rect.width - padding - indent - width - 1
    else if (render.hAlign === 'center' || render.hAlign === 'centerContinuous') x = rect.x + (rect.width - width) / 2
    else x = rect.x + padding + indent
    // Text that overflows to the left of a right-aligned cell starts in the neighbor.
    if (render.hAlign === 'right' && x < clip.x + padding) x = Math.max(x, clip.x + padding - (width - (rect.width - padding * 2)))
    const y = top + lineHeight / 2
    if (render.runs?.length && text === render.text) {
      this.drawRuns(scene, render, x, y)
      return
    }
    ctx.fillText(text, x, y)
    this.decorate(render, x, y, width, fontPx)
  }

  /** Rich text: each run in its own font and color, on one line. */
  private drawRuns(scene: Scene, render: CellRender, x: number, y: number): void {
    const { ctx } = this
    let cursor = x
    for (const run of render.runs ?? []) {
      const style = { ...render.style, ...run.font }
      const runRender: CellRender = { ...render, style }
      this.setFont(scene, runRender)
      const color = run.color ?? render.color
      ctx.fillStyle = color === '#000000' ? scene.palette.text : color
      const width = ctx.measureText(run.text).width
      const fontPx = style.fontSize * POINTS_TO_PIXELS * scene.zoom
      const shift = run.font?.vertAlign === 'superscript' ? -fontPx * 0.3 : run.font?.vertAlign === 'subscript' ? fontPx * 0.2 : 0
      ctx.fillText(run.text, cursor, y + shift)
      this.decorate(runRender, cursor, y + shift, width, fontPx)
      cursor += width
    }
    this.setFont(scene, render)
  }

  private decorate(render: CellRender, x: number, y: number, width: number, fontPx: number): void {
    const { ctx } = this
    const style = render.style
    if (!style.underline && !style.strike) return
    ctx.save()
    ctx.strokeStyle = ctx.fillStyle as string
    ctx.lineWidth = Math.max(1, fontPx / 14)
    if (style.underline) {
      const base = y + fontPx * 0.42
      ctx.beginPath()
      ctx.moveTo(x, base)
      ctx.lineTo(x + width, base)
      if (style.underline === 'double' || style.underline === 'doubleAccounting') {
        ctx.moveTo(x, base + 2)
        ctx.lineTo(x + width, base + 2)
      }
      ctx.stroke()
    }
    if (style.strike) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + width, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawWrapped(scene: Scene, render: CellRender, text: string, rect: { x: number; y: number; width: number; height: number }, padding: number, indent: number): void {
    const { ctx } = this
    const fontPx = render.style.fontSize * POINTS_TO_PIXELS * scene.zoom
    const lineHeight = fontPx * 1.25
    const maxWidth = Math.max(1, rect.width - padding * 2 - indent)
    const lines = render.style.wrap ? wrapText(ctx, text, maxWidth) : text.split('\n')
    let y = this.textY(render, rect, lineHeight, lines.length, scene.zoom) + lineHeight / 2
    ctx.textBaseline = 'middle'
    for (const line of lines) {
      const width = ctx.measureText(line).width
      let x = rect.x + padding + indent
      if (render.hAlign === 'right') x = rect.x + rect.width - padding - indent - width - 1
      else if (render.hAlign === 'center') x = rect.x + (rect.width - width) / 2
      ctx.fillText(line, x, y)
      this.decorate(render, x, y, width, fontPx)
      y += lineHeight
    }
  }

  private drawRotated(scene: Scene, render: CellRender, text: string, rect: { x: number; y: number; width: number; height: number }): void {
    const { ctx } = this
    const rotation = render.style.rotation
    ctx.textBaseline = 'middle'
    if (rotation === 255) {
      // Stacked: one character per line.
      const fontPx = render.style.fontSize * POINTS_TO_PIXELS * scene.zoom
      let y = rect.y + fontPx * 0.8
      for (const char of text) {
        const width = ctx.measureText(char).width
        ctx.fillText(char, rect.x + (rect.width - width) / 2, y)
        y += fontPx * 1.1
      }
      return
    }
    // 1–90: counterclockwise; 91–180: clockwise by (rotation - 90).
    const degrees = rotation <= 90 ? rotation : -(rotation - 90)
    const width = ctx.measureText(text).width
    ctx.save()
    ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
    ctx.rotate((-degrees * Math.PI) / 180)
    ctx.fillText(text, -width / 2, 0)
    ctx.restore()
  }

  private drawDropButton(scene: Scene, rect: { x: number; y: number; width: number; height: number }, active: boolean, list = false): void {
    const { ctx } = this
    const size = Math.min(rect.height - 2, 16 * scene.zoom)
    const x = list ? rect.x + rect.width + 1 : rect.x + rect.width - size - 2
    const y = rect.y + rect.height - size - 1
    ctx.save()
    ctx.fillStyle = active ? '#D3E3FD' : scene.palette.headerBackground
    ctx.strokeStyle = scene.palette.headerBorder
    ctx.lineWidth = 1
    ctx.fillRect(x, y, size, size)
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
    ctx.fillStyle = active ? '#0B57D0' : scene.palette.headerText
    ctx.beginPath()
    if (active) {
      // A funnel: a filter is on.
      ctx.moveTo(x + size * 0.25, y + size * 0.3)
      ctx.lineTo(x + size * 0.75, y + size * 0.3)
      ctx.lineTo(x + size * 0.55, y + size * 0.55)
      ctx.lineTo(x + size * 0.55, y + size * 0.75)
      ctx.lineTo(x + size * 0.45, y + size * 0.7)
      ctx.lineTo(x + size * 0.45, y + size * 0.55)
    } else {
      ctx.moveTo(x + size * 0.3, y + size * 0.4)
      ctx.lineTo(x + size * 0.7, y + size * 0.4)
      ctx.lineTo(x + size * 0.5, y + size * 0.65)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private drawHighlights(scene: Scene): void {
    const { ctx } = this
    for (const highlight of scene.referenceHighlights) {
      const rect = this.rangeRect(scene, highlight.range)
      ctx.save()
      ctx.globalAlpha = 0.12
      ctx.fillStyle = highlight.color
      ctx.fillRect(rect.x, rect.y, rect.width - 1, rect.height - 1)
      ctx.globalAlpha = 1
      ctx.strokeStyle = highlight.color
      ctx.lineWidth = 2
      ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.width, rect.height)
      ctx.restore()
    }
    if (scene.copyRange) {
      const rect = this.rangeRect(scene, scene.copyRange)
      ctx.save()
      ctx.strokeStyle = scene.palette.selectionBorder
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.width, rect.height)
      ctx.restore()
    }
  }

  private drawRemote(scene: Scene, remote: RemoteSelection): void {
    const { ctx } = this
    ctx.save()
    for (const range of remote.ranges) {
      const rect = this.rangeRect(scene, range)
      ctx.globalAlpha = 0.1
      ctx.fillStyle = remote.color
      ctx.fillRect(rect.x, rect.y, rect.width - 1, rect.height - 1)
    }
    ctx.globalAlpha = 1
    const active = this.cellRect(scene, remote.active.row, remote.active.col)
    ctx.strokeStyle = remote.color
    ctx.lineWidth = 2
    ctx.strokeRect(active.x - 0.5, active.y - 0.5, active.width, active.height)
    // A name tag above the cell.
    ctx.font = `${Math.round(11 * Math.min(scene.zoom, 1.4))}px system-ui, sans-serif`
    const width = ctx.measureText(remote.name).width + 8
    const height = 16 * Math.min(scene.zoom, 1.4)
    ctx.fillStyle = remote.color
    ctx.fillRect(active.x - 1, active.y - height, width, height)
    ctx.fillStyle = '#FFFFFF'
    ctx.textBaseline = 'middle'
    ctx.fillText(remote.name, active.x + 3, active.y - height / 2)
    ctx.restore()
  }

  private drawSelection(scene: Scene): void {
    const { ctx } = this
    const { ranges, active } = scene.selection
    ctx.save()
    ctx.fillStyle = scene.palette.selectionFill
    for (const range of ranges) {
      if (range.top === range.bottom && range.left === range.right && ranges.length === 1) continue
      const rect = this.rangeRect(scene, range)
      ctx.fillRect(rect.x, rect.y, rect.width - 1, rect.height - 1)
    }
    const last = ranges[ranges.length - 1]
    if (last) {
      const rect = this.rangeRect(scene, last)
      ctx.strokeStyle = scene.palette.selectionBorder
      ctx.lineWidth = 2
      ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.width, rect.height)
      // The active cell stays clear inside a larger selection.
      const cell = this.cellRect(scene, active.row, active.col)
      ctx.lineWidth = 1
      if (ranges.length > 1 || last.top !== last.bottom || last.left !== last.right) ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 2, cell.height - 2)
      if (scene.fillHandle) {
        const size = 7
        ctx.fillStyle = scene.palette.selectionBorder
        ctx.fillRect(rect.x + rect.width - size / 2 - 1, rect.y + rect.height - size / 2 - 1, size, size)
        ctx.strokeStyle = scene.palette.background
        ctx.strokeRect(rect.x + rect.width - size / 2 - 1.5, rect.y + rect.height - size / 2 - 1.5, size + 1, size + 1)
      }
    }
    ctx.restore()
  }

  private drawFrozenLines(scene: Scene): void {
    const { ctx } = this
    ctx.save()
    ctx.strokeStyle = scene.palette.frozenLine
    ctx.lineWidth = 2
    if (scene.frozenRows) {
      const y = scene.headerHeight + scene.rows.offset(scene.frozenRows) * scene.zoom - 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(scene.width, y)
      ctx.stroke()
    }
    if (scene.frozenCols) {
      const x = scene.headerWidth + scene.cols.offset(scene.frozenCols) * scene.zoom - 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, scene.height)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawHeaders(scene: Scene, panes: Pane[]): void {
    const { ctx } = this
    const { palette } = scene
    const selectedRows = (row: number) => scene.selection.ranges.some((range) => row >= range.top && row <= range.bottom)
    const selectedCols = (col: number) => scene.selection.ranges.some((range) => col >= range.left && col <= range.right)
    const fullRow = (row: number) => scene.selection.ranges.some((range) => row >= range.top && row <= range.bottom && range.left === 0 && range.right >= scene.cols.count - 1)
    const fullCol = (col: number) => scene.selection.ranges.some((range) => col >= range.left && col <= range.right && range.top === 0 && range.bottom >= scene.rows.count - 1)
    ctx.save()
    ctx.fillStyle = palette.headerBackground
    ctx.fillRect(0, 0, scene.width, scene.headerHeight)
    ctx.fillRect(0, 0, scene.headerWidth, scene.height)
    ctx.font = `${Math.round(11 * scene.zoom * 10) / 10}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    const seenCols = new Set<number>()
    const seenRows = new Set<number>()
    for (const pane of panes) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(pane.x, 0, pane.width, scene.headerHeight)
      ctx.clip()
      for (let col = pane.cols[0]; col <= pane.cols[1]; col++) {
        if (seenCols.has(col) || scene.cols.isHidden(col)) continue
        seenCols.add(col)
        const x = GridRenderer.x(scene, col)
        const width = scene.cols.size(col) * scene.zoom
        const selected = selectedCols(col)
        if (selected) {
          ctx.fillStyle = fullCol(col) ? palette.selectionBorder : palette.headerSelectedBackground
          ctx.fillRect(x, 0, width, scene.headerHeight)
        }
        ctx.fillStyle = fullCol(col) ? '#FFFFFF' : selected ? palette.headerSelectedText : palette.headerText
        ctx.fillText(columnName(col), x + width / 2, scene.headerHeight / 2)
        ctx.fillStyle = palette.headerBorder
        ctx.fillRect(Math.round(x + width) - 1, 0, 1, scene.headerHeight)
      }
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, pane.y, scene.headerWidth, pane.height)
      ctx.clip()
      for (let row = pane.rows[0]; row <= pane.rows[1]; row++) {
        if (seenRows.has(row) || scene.rows.isHidden(row)) continue
        seenRows.add(row)
        const y = GridRenderer.y(scene, row)
        const height = scene.rows.size(row) * scene.zoom
        const selected = selectedRows(row)
        if (selected) {
          ctx.fillStyle = fullRow(row) ? palette.selectionBorder : palette.headerSelectedBackground
          ctx.fillRect(0, y, scene.headerWidth, height)
        }
        ctx.fillStyle = fullRow(row) ? '#FFFFFF' : selected ? palette.headerSelectedText : palette.headerText
        ctx.fillText(String(row + 1), scene.headerWidth / 2, y + height / 2)
        ctx.fillStyle = palette.headerBorder
        ctx.fillRect(0, Math.round(y + height) - 1, scene.headerWidth, 1)
      }
      ctx.restore()
    }
    ctx.fillStyle = palette.headerBorder
    ctx.fillRect(0, scene.headerHeight - 1, scene.width, 1)
    ctx.fillRect(scene.headerWidth - 1, 0, 1, scene.height)
    // The select-all corner.
    ctx.fillStyle = palette.headerBackground
    ctx.fillRect(0, 0, scene.headerWidth - 1, scene.headerHeight - 1)
    ctx.fillStyle = palette.headerBorder
    ctx.beginPath()
    ctx.moveTo(scene.headerWidth - 4, scene.headerHeight - 14)
    ctx.lineTo(scene.headerWidth - 4, scene.headerHeight - 4)
    ctx.lineTo(scene.headerWidth - 14, scene.headerHeight - 4)
    ctx.fill()
    ctx.restore()
  }
}

function borderGeometry(style: BorderStyle): { width: number; dash: number[]; double: boolean } {
  switch (style) {
    case 'medium':
      return { width: 2, dash: [], double: false }
    case 'thick':
      return { width: 3, dash: [], double: false }
    case 'double':
      return { width: 1, dash: [], double: true }
    case 'dashed':
      return { width: 1, dash: [3, 1], double: false }
    case 'mediumDashed':
      return { width: 2, dash: [9, 3], double: false }
    case 'dotted':
      return { width: 1, dash: [1, 1], double: false }
    case 'hair':
      return { width: 1, dash: [1, 1], double: false }
    case 'dashDot':
      return { width: 1, dash: [9, 3, 3, 3], double: false }
    case 'mediumDashDot':
    case 'slantDashDot':
      return { width: 2, dash: [9, 3, 3, 3], double: false }
    case 'dashDotDot':
      return { width: 1, dash: [9, 3, 3, 3, 3, 3], double: false }
    case 'mediumDashDotDot':
      return { width: 2, dash: [9, 3, 3, 3, 3, 3], double: false }
    default:
      return { width: 1, dash: [], double: false }
  }
}

const patternCache = new Map<string, CanvasPattern | null>()

/** Excel's pattern fills as small canvas patterns. */
function patternStyle(ctx: CanvasRenderingContext2D, type: string, color: string): CanvasPattern | undefined {
  const key = `${type}|${color}`
  if (patternCache.has(key)) return patternCache.get(key) ?? undefined
  const masks: Record<string, string[]> = {
    gray125: ['1000', '0000', '0010', '0000'],
    gray0625: ['10000000', '00000000', '00001000', '00000000'],
    lightGray: ['1000', '0010', '1000', '0010'],
    mediumGray: ['1010', '0101', '1010', '0101'],
    darkGray: ['1110', '1011', '1110', '1011'],
    darkHorizontal: ['1111', '1111', '0000', '0000'],
    lightHorizontal: ['1111', '0000', '0000', '0000'],
    darkVertical: ['1100', '1100', '1100', '1100'],
    lightVertical: ['1000', '1000', '1000', '1000'],
    darkDown: ['1100', '0110', '0011', '1001'],
    lightDown: ['1000', '0100', '0010', '0001'],
    darkUp: ['0011', '0110', '1100', '1001'],
    lightUp: ['0001', '0010', '0100', '1000'],
    darkGrid: ['1111', '1100', '1100', '1111'],
    lightGrid: ['1111', '1000', '1000', '1000'],
    darkTrellis: ['1110', '0111', '1110', '0111'],
    lightTrellis: ['1010', '0100', '1010', '0001'],
  }
  const mask = masks[type]
  if (!mask || typeof document === 'undefined') {
    patternCache.set(key, null)
    return undefined
  }
  const tile = document.createElement('canvas')
  tile.width = mask[0]!.length
  tile.height = mask.length
  const tileCtx = tile.getContext('2d')!
  tileCtx.fillStyle = color
  mask.forEach((line, y) => [...line].forEach((bit, x) => bit === '1' && tileCtx.fillRect(x, y, 1, 1)))
  const pattern = ctx.createPattern(tile, 'repeat')
  patternCache.set(key, pattern)
  return pattern ?? undefined
}

/** Breaks text into lines that fit `width`, at spaces where possible. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/)
    let line = ''
    for (const word of words) {
      const candidate = line + word
      if (!line || ctx.measureText(candidate).width <= width) {
        line = candidate
        continue
      }
      lines.push(line.trimEnd())
      line = word.trimStart()
      // A single word wider than the cell is broken by characters.
      while (line && ctx.measureText(line).width > width && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line)
  }
  return lines
}

const ICON_COLORS = { red: '#E8453C', yellow: '#F9BB2D', green: '#4CA853', gray: '#7F7F7F', black: '#3C3C3C', blue: '#4A89DC' }

/** Draws an icon from one of Excel's icon sets. */
export function drawIcon(ctx: CanvasRenderingContext2D, set: string, index: number, x: number, y: number, size: number): void {
  const count = Number(set[0]) || 3
  const level = index / Math.max(1, count - 1)
  const trafficColor = level >= 0.99 ? ICON_COLORS.green : level <= 0.01 ? ICON_COLORS.red : ICON_COLORS.yellow
  ctx.save()
  const cx = x + size / 2
  const cy = y + size / 2
  const r = size * 0.42
  if (/Arrows/.test(set)) {
    const gray = /Gray/.test(set)
    const angle = count === 3 ? [Math.PI / 2, 0, -Math.PI / 2][index]! : -Math.PI / 2 + (Math.PI * index) / (count - 1)
    ctx.fillStyle = gray ? ICON_COLORS.gray : level >= 0.99 ? ICON_COLORS.green : level <= 0.01 ? ICON_COLORS.red : ICON_COLORS.yellow
    ctx.translate(cx, cy)
    ctx.rotate(-angle)
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(0, -r)
    ctx.lineTo(0, -r * 0.4)
    ctx.lineTo(-r, -r * 0.4)
    ctx.lineTo(-r, r * 0.4)
    ctx.lineTo(0, r * 0.4)
    ctx.lineTo(0, r)
    ctx.closePath()
    ctx.fill()
  } else if (/Flags/.test(set)) {
    ctx.fillStyle = trafficColor
    ctx.fillRect(x + size * 0.25, y + size * 0.15, size * 0.5, size * 0.35)
    ctx.fillStyle = ICON_COLORS.black
    ctx.fillRect(x + size * 0.22, y + size * 0.15, size * 0.06, size * 0.75)
  } else if (/Stars/.test(set)) {
    ctx.fillStyle = index === 0 ? '#D9D9D9' : ICON_COLORS.yellow
    star(ctx, cx, cy, r)
  } else if (/Rating|Quarters|Boxes/.test(set)) {
    ctx.strokeStyle = ICON_COLORS.gray
    ctx.fillStyle = ICON_COLORS.gray
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * level)
    ctx.closePath()
    ctx.fill()
  } else if (/Symbols/.test(set)) {
    ctx.fillStyle = trafficColor
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = Math.max(1, size / 8)
    ctx.beginPath()
    if (level >= 0.99) {
      ctx.moveTo(cx - r * 0.5, cy)
      ctx.lineTo(cx - r * 0.1, cy + r * 0.4)
      ctx.lineTo(cx + r * 0.5, cy - r * 0.4)
    } else if (level <= 0.01) {
      ctx.moveTo(cx - r * 0.4, cy - r * 0.4)
      ctx.lineTo(cx + r * 0.4, cy + r * 0.4)
      ctx.moveTo(cx + r * 0.4, cy - r * 0.4)
      ctx.lineTo(cx - r * 0.4, cy + r * 0.4)
    } else {
      ctx.moveTo(cx, cy - r * 0.5)
      ctx.lineTo(cx, cy + r * 0.1)
      ctx.moveTo(cx, cy + r * 0.35)
      ctx.lineTo(cx, cy + r * 0.45)
    }
    ctx.stroke()
  } else if (/Signs/.test(set)) {
    ctx.fillStyle = trafficColor
    ctx.beginPath()
    if (level <= 0.01) ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6)
    else if (level >= 0.99) ctx.arc(cx, cy, r, 0, Math.PI * 2)
    else {
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy + r * 0.8)
      ctx.lineTo(cx - r, cy + r * 0.8)
    }
    ctx.fill()
  } else {
    // Traffic lights and anything else: a colored disc.
    ctx.fillStyle = count === 4 && index === 0 ? ICON_COLORS.black : trafficColor
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let point = 0; point < 10; point++) {
    const radius = point % 2 ? r * 0.45 : r
    const angle = -Math.PI / 2 + (point * Math.PI) / 5
    ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
  }
  ctx.closePath()
  ctx.fill()
}
