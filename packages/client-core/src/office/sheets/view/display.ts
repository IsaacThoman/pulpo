import { columnIntervalProps } from '../model/column-intervals.js'
import type { BorderEdge, HorizontalAlign, RichRun, StyleProps, VerticalAlign } from '../model/schema.js'
import { splitCellKey, type SheetModel } from '../model/workbook.js'
import { formatValue } from '../numfmt/index.js'
import type { ResolvedStyle, Stylesheet } from '../styles/stylesheet.js'
import { isErrorValue, type CellValue, type SheetValues } from '../values.js'
import { cssColor, type ThemeColors } from './colors.js'
import type { ConditionalFormatter, ConditionalOverlay } from './conditional.js'

/** Everything the renderer draws for one cell. */
export interface CellRender {
  value: CellValue
  text: string
  /** The value is a number (or date): aligned right under General, never overflows. */
  numeric: boolean
  style: ResolvedStyle
  /** Resolved CSS colors. */
  color: string
  fill?: string
  pattern?: { type: string; fg?: string; bg?: string }
  borders: { top?: CssBorder; bottom?: CssBorder; left?: CssBorder; right?: CssBorder; diagonalUp?: CssBorder; diagonalDown?: CssBorder }
  hAlign: Exclude<HorizontalAlign, 'general'>
  vAlign: VerticalAlign
  /** `*x` repeat fill from the number format. */
  repeat?: { char: string; position: number }
  overlay?: ConditionalOverlay
  /** Rich text runs, with their colors resolved. */
  runs?: { text: string; font?: RichRun['font']; color?: string }[]
}

export interface CssBorder {
  style: BorderEdge['style']
  color: string
}

const EMPTY_BORDERS: CellRender['borders'] = {}

/** Effective styles and display text of cells, cached until the sheet changes. */
export class CellDisplay {
  private styleCache = new Map<string, ResolvedStyle>()

  constructor(
    readonly sheet: SheetModel,
    private readonly styles: Stylesheet,
    private readonly values: SheetValues,
    private readonly theme: ThemeColors,
    private readonly conditional: ConditionalFormatter,
    private readonly date1904: boolean,
  ) {}

  invalidateStyles(): void {
    this.styleCache.clear()
  }

  /** A cell's style: its own format, else its row's, else its column's, with overrides on top. */
  style(row: number, col: number): ResolvedStyle {
    const key = this.sheet.keyAt(row, col)
    const cached = this.styleCache.get(key)
    if (cached) return cached
    const { row: rowId, col: colId } = splitCellKey(key)
    const sheet = this.sheet
    const base = sheet.xf.get(key) ?? (sheet.rowMeta.get(`${rowId}|xf`) as number | undefined) ?? (sheet.colMeta.get(`${colId}|xf`) as number | undefined) ?? columnIntervalProps(sheet, col).xf
    const overrides: Partial<StyleProps> = { ...sheet.axisOverrides('col', colId), ...sheet.axisOverrides('row', rowId), ...sheet.cellOverrides(key) }
    const resolved = this.styles.resolve(base)
    const style = Object.keys(overrides).length ? { ...resolved, ...overrides } : resolved
    this.styleCache.set(key, style)
    return style
  }

  render(row: number, col: number): CellRender {
    const style = this.style(row, col)
    const value = this.values.get(this.sheet, row, col)
    const overlay = this.conditional.overlay(row, col)
    const dxf = overlay?.style
    const numFmt = dxf?.numFmt ?? style.numFmt
    const data = this.sheet.cell(row, col)
    let text = ''
    let color: string | undefined
    let repeat: CellRender['repeat']
    if (value !== null) {
      if (isErrorValue(value)) text = value.e
      else if (typeof value === 'string' && data?.runs) text = value
      else {
        const formatted = formatValue(value, numFmt, { date1904: this.date1904 })
        text = formatted.text
        color = formatted.color
        if (formatted.fill) repeat = formatted.fill
      }
    }
    const numeric = typeof value === 'number'
    const effective: ResolvedStyle = dxf?.font ? { ...style, ...dxf.font } : style
    const fontColor = cssColor(effective.fontColor, this.theme)
    const fillColor = overlay?.scaleColor ?? (dxf && dxf.fill !== undefined ? cssColor(dxf.fill, this.theme) : cssColor(style.fill, this.theme))
    let hAlign = style.hAlign
    if (hAlign === 'general') {
      if (numeric) hAlign = 'right'
      else if (typeof value === 'boolean' || isErrorValue(value)) hAlign = 'center'
      else hAlign = 'left'
    }
    const border = (edge: BorderEdge | null | undefined): CssBorder | undefined =>
      edge ? { style: edge.style, color: cssColor(edge.color, this.theme) ?? '#000000' } : undefined
    const borderSource = dxf?.border ? { ...style, ...dxf.border } : style
    const borders =
      borderSource.borderTop || borderSource.borderBottom || borderSource.borderLeft || borderSource.borderRight || style.diagonalUp || style.diagonalDown
        ? {
            top: border(borderSource.borderTop),
            bottom: border(borderSource.borderBottom),
            left: border(borderSource.borderLeft),
            right: border(borderSource.borderRight),
            diagonalUp: border(style.diagonalUp),
            diagonalDown: border(style.diagonalDown),
          }
        : EMPTY_BORDERS
    const render: CellRender = {
      value,
      text,
      numeric,
      style: effective,
      color: color ?? fontColor ?? '#000000',
      borders,
      hAlign: hAlign as CellRender['hAlign'],
      vAlign: style.vAlign,
    }
    if (fillColor) render.fill = fillColor
    if (style.pattern && !overlay?.scaleColor && !(dxf && dxf.fill !== undefined)) {
      render.pattern = { type: style.pattern.type, ...(cssColor(style.pattern.fg, this.theme) ? { fg: cssColor(style.pattern.fg, this.theme)! } : {}), ...(cssColor(style.pattern.bg, this.theme) ? { bg: cssColor(style.pattern.bg, this.theme)! } : {}) }
    }
    if (style.gradient && !render.fill && style.gradient.stops.length) render.fill = cssColor(style.gradient.stops[0]!.color, this.theme)
    if (repeat) render.repeat = repeat
    if (data?.runs?.length && typeof value === 'string') {
      render.runs = data.runs.map((run) => {
        const runColor = run.font?.fontColor ? cssColor(run.font.fontColor, this.theme) : undefined
        return { text: run.text, ...(run.font ? { font: run.font } : {}), ...(runColor ? { color: runColor } : {}) }
      })
    }
    if (overlay) render.overlay = overlay
    return render
  }
}
