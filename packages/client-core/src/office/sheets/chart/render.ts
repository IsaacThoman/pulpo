import { DEFAULT_THEME, resolveThemeFont, type Theme } from '../../ooxml/theme.js'
import type { Scalar } from '../formula/types.js'
import { formatValue } from '../numfmt/index.js'
import { renderCartesian } from './cartesian.js'
import { renderPie, renderRadar } from './circular.js'
import { fillToCss, isDarkStyle } from './colors.js'
import { resolveSeries, type RangeResolver, type ResolvedSeries } from './data.js'
import type { ChartGroup, ChartModel, ChartText, TextRun } from './model.js'
import { markerSvg, seriesPaint, variesByPoint, type Paint } from './style.js'
import { escapeXml, n, safeFontFamily, truncateText, wrapText } from './text.js'
import { lineSegment, rect, resolveLine, resolveText, text, textWidth, type Rect, type RenderContext, type ResolvedText } from './svg.js'

export interface RenderChartOptions {
  /** Pixels. */
  width: number
  height: number
  /** The workbook theme; defaults to the Office 2013–2022 theme. */
  theme?: Theme
  /**
   * Live values for a series reference (`Sheet1!$B$2:$B$5`), row-major. Return undefined to use
   * the file's cached points. Called once per reference per render.
   */
  resolveRange?: (formula: string) => Scalar[][] | undefined
  /** Formats a number with an Excel format code. Defaults to the sheet number formatter. */
  formatNumber?: (value: number, formatCode: string) => string
  /** A CSS font family list to use instead of the chart/theme font. */
  fontFamily?: string
  /** Prefix for the SVG's internal ids (clip paths); unique per document. */
  idPrefix?: string
}

const FALLBACK_FONTS = ['Calibri', 'Carlito', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif']
const MAX_DIMENSION = 10_000

let renderCount = 0

/** Excel's General format, compacted for axis and data labels. */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e11 || abs < 1e-9) {
    const [mantissa, exponent] = value.toExponential(5).split('e') as [string, string]
    const trimmed = mantissa.replace(/\.?0+$/, '')
    const power = Number(exponent)
    return `${trimmed}E${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`
  }
  const precise = Number(value.toPrecision(10))
  if (Number.isInteger(precise)) return String(precise)
  return precise.toFixed(Math.min(9, Math.max(0, 9 - Math.floor(Math.log10(abs))))).replace(/\.?0+$/, '')
}

function makeFormatter(user: RenderChartOptions['formatNumber']): RenderContext['format'] {
  return (value, code) => {
    if (!Number.isFinite(value)) return ''
    const formatCode = code?.trim() || 'General'
    if (user) {
      try {
        return String(user(value, formatCode))
      } catch {
        // Fall through to the built-in formats.
      }
    }
    if (formatCode.toLowerCase() === 'general') return formatGeneral(value)
    try {
      return formatValue(value, formatCode).text
    } catch {
      return formatGeneral(value)
    }
  }
}

function createContext(model: ChartModel, options: RenderChartOptions): RenderContext {
  const width = Number.isFinite(options.width) ? Math.min(MAX_DIMENSION, Math.max(1, options.width)) : 480
  const height = Number.isFinite(options.height) ? Math.min(MAX_DIMENSION, Math.max(1, options.height)) : 288
  const theme = options.theme ?? DEFAULT_THEME
  const dark = isDarkStyle(model.style)
  const background = model.chartFormat.fill ? fillToCss(model.chartFormat.fill, theme, '#ffffff') : dark ? '#262626' : '#ffffff'
  const prefix = (options.idPrefix ?? `xlchart${(++renderCount).toString(36)}${Math.random().toString(36).slice(2, 6)}`).replace(/[^A-Za-z0-9_-]/g, '') || 'xlchart'
  return {
    model,
    theme,
    width,
    height,
    fontFamily: safeFontFamily([options.fontFamily, resolveThemeFont(model.textStyle.font, theme), theme.minorFont.latin, ...FALLBACK_FONTS]),
    idPrefix: prefix,
    format: makeFormatter(options.formatNumber),
    textColor: dark ? '#d9d9d9' : '#595959',
    baseSize: model.textStyle.size ?? 10,
    gridColor: dark ? '#595959' : '#d9d9d9',
    axisLineColor: dark ? '#7f7f7f' : '#d9d9d9',
    backgroundColor: background,
    parts: [],
  }
}

function svgOpen(ctx: RenderContext, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(ctx.width)}" height="${n(ctx.height)}" viewBox="0 0 ${n(ctx.width)} ${n(ctx.height)}"` +
    ` font-family="${escapeXml(ctx.fontFamily)}" role="img" aria-label="${escapeXml(label.slice(0, 200))}">`
  )
}

/** A gray box with a message, for unsupported or unreadable charts. */
export function renderChartPlaceholder(width: number, height: number, message: string, options: Pick<RenderChartOptions, 'fontFamily'> = {}): string {
  const model = { textStyle: {}, style: 2, chartFormat: {} } as unknown as ChartModel
  const ctx = createContext(model, { width, height, ...options, idPrefix: 'placeholder' })
  const style: ResolvedText = { px: Math.max(9, Math.min(14, ctx.height / 10)), bold: false, italic: false, underline: false, color: '#7f7f7f' }
  const lines = wrapText(message, ctx.width * 0.85, style.px, false, 3)
  const top = ctx.height / 2 - (lines.length * style.px * 1.2) / 2
  return (
    svgOpen(ctx, message) +
    rect(0.5, 0.5, ctx.width - 1, ctx.height - 1, '#f3f3f3', { color: '#d9d9d9', width: 1 }) +
    lines.map((line, i) => text(ctx, ctx.width / 2, top + style.px * 1.2 * (i + 0.5), line, style, { anchor: 'middle', baseline: 'middle' })).join('') +
    '</svg>'
  )
}

// ---------------------------------------------------------------------------------------------
// Titles

interface TitleLayout {
  lines: TextRun[][]
  styles: ResolvedText[][]
  height: number
}

function titleRuns(ctx: RenderContext, title: ChartText | undefined, resolver: RangeResolver | undefined, all: ResolvedSeries[]): TextRun[][] | undefined {
  const model = ctx.model
  const single = all.length === 1 ? all[0] : undefined
  if (!title) {
    if (model.autoTitleDeleted || !single) return undefined
    return [[{ text: single.name, style: {} }]]
  }
  if (title.paragraphs.some((line) => line.some((run) => run.text))) return title.paragraphs
  if (title.ref) {
    let content = title.ref.cache ?? ''
    if (title.ref.formula && resolver) {
      try {
        const live = resolver(title.ref.formula)
        if (live) content = live.flat().filter((cell) => cell !== null).map(String).join(' ')
      } catch {
        // Keep the cache.
      }
    }
    return [[{ text: content, style: {} }]]
  }
  return [[{ text: single ? single.name : 'Chart Title', style: {} }]]
}

function layoutTitle(ctx: RenderContext, runs: TextRun[][], title: ChartText | undefined, maxWidth: number): TitleLayout {
  const lines: TextRun[][] = []
  const styles: ResolvedText[][] = []
  const defaults = { size: Math.max(ctx.baseSize * 1.4, 14), bold: false }
  for (const paragraph of runs.slice(0, 10)) {
    const resolved = paragraph.map((run) => resolveText(ctx, [ctx.model.textStyle, title?.style, run.style], defaults))
    const width = paragraph.reduce((sum, run, i) => sum + textWidth(run.text, resolved[i]!), 0)
    if (width > maxWidth && paragraph.length) {
      // Wrap with the first run's style.
      const style = resolved[0]!
      for (const line of wrapText(paragraph.map((run) => run.text).join(''), maxWidth, style.px, style.bold, 3)) {
        lines.push([{ text: line, style: paragraph[0]!.style }])
        styles.push([style])
      }
    } else {
      lines.push(paragraph)
      styles.push(resolved.length ? resolved : [resolveText(ctx, [ctx.model.textStyle, title?.style], defaults)])
    }
  }
  const height = styles.reduce((sum, line) => sum + Math.max(...line.map((style) => style.px)) * 1.2, 0)
  return { lines, styles, height }
}

function drawTitle(ctx: RenderContext, layout: TitleLayout, centerX: number, top: number): string {
  const parts: string[] = []
  let y = top
  layout.lines.forEach((line, i) => {
    const styles = layout.styles[i]!
    const lineHeight = Math.max(...styles.map((style) => style.px)) * 1.2
    const widths = line.map((run, k) => textWidth(run.text, styles[k] ?? styles[0]!))
    let x = centerX - widths.reduce((sum, w) => sum + w, 0) / 2
    line.forEach((run, k) => {
      parts.push(text(ctx, x, y + lineHeight / 2, run.text, styles[k] ?? styles[0]!, { anchor: 'start', baseline: 'middle' }))
      x += widths[k]!
    })
    y += lineHeight
  })
  return parts.join('')
}

// ---------------------------------------------------------------------------------------------
// Legend

interface LegendEntry {
  /** `c:legendEntry` index: the series' idx, or the point index for per-point legends. */
  index: number
  label: string
  paint: Paint
  symbol: 'box' | 'line'
}

function legendEntries(ctx: RenderContext, all: ResolvedSeries[]): LegendEntry[] {
  const entries: LegendEntry[] = []
  const seriesCount = all.length
  for (const group of ctx.model.groups) {
    const series = all.filter((s) => s.group === group)
    const symbol: LegendEntry['symbol'] = group.type === 'line' || group.type === 'scatter' || (group.type === 'radar' && group.radarStyle !== 'filled') ? 'line' : 'box'
    if (variesByPoint(group) && series[0]) {
      const first = series[0]
      const count = Math.min(1000, first.values.length)
      for (let i = 0; i < count; i++) {
        const value = first.categories?.values[i]
        const label = value === null || value === undefined ? (first.categories ? '' : String(i + 1)) : typeof value === 'number' ? ctx.format(value, first.categories?.formatCode) : value
        entries.push({ index: i, label, paint: seriesPaint(ctx, first, seriesCount, i, count), symbol })
      }
      continue
    }
    const groupEntries = series.map((s): LegendEntry => ({ index: s.series.index, label: s.name, paint: seriesPaint(ctx, s, seriesCount), symbol }))
    // A side legend lists stacked columns and areas top-down, matching the stack.
    const side = ctx.model.legend?.position === 'r' || ctx.model.legend?.position === 'l' || ctx.model.legend?.position === 'tr'
    const stackedUp = (group.grouping === 'stacked' || group.grouping === 'percentStacked') && (group.type === 'area' || (group.type === 'bar' && group.barDirection === 'col'))
    entries.push(...(side && stackedUp ? groupEntries.reverse() : groupEntries))
  }
  const deleted = new Set(ctx.model.legend?.deletedEntries ?? [])
  return entries.filter((entry) => !deleted.has(entry.index)).slice(0, 500)
}

interface LegendLayout {
  rect: Rect
  rows: { entry: LegendEntry; x: number; y: number; label: string }[]
  style: ResolvedText
}

const SYMBOL_BOX = 7
const SYMBOL_LINE = 22

function symbolWidth(entry: LegendEntry): number {
  return entry.symbol === 'line' ? SYMBOL_LINE : SYMBOL_BOX
}

function layoutLegend(ctx: RenderContext, entries: LegendEntry[], area: Rect): LegendLayout | undefined {
  const legend = ctx.model.legend
  if (!legend || !entries.length) return undefined
  const style = resolveText(ctx, [ctx.model.textStyle, legend.style], { size: ctx.baseSize })
  const rowHeight = style.px * 1.3
  const gap = 4
  const vertical = legend.position === 'r' || legend.position === 'l' || legend.position === 'tr'
  const rows: LegendLayout['rows'] = []
  if (vertical) {
    const maxWidth = area.w * 0.4
    const width = Math.min(maxWidth, Math.max(...entries.map((entry) => symbolWidth(entry) + gap + textWidth(entry.label, style) + 1))) + 8
    const fit = Math.max(1, Math.floor((area.h - 8) / rowHeight))
    const shown = entries.slice(0, fit)
    const height = shown.length * rowHeight + 8
    const x = legend.position === 'l' ? area.x : area.x + area.w - width
    const y = legend.position === 'tr' ? area.y : area.y + (area.h - height) / 2
    shown.forEach((entry, i) => {
      rows.push({ entry, x: x + 4, y: y + 4 + rowHeight * (i + 0.5), label: truncateText(entry.label, width - 8 - symbolWidth(entry) - gap, style.px, style.bold) })
    })
    return { rect: { x, y, w: width, h: height }, rows, style }
  }
  // Top/bottom: flow into centered rows.
  const lines: { entry: LegendEntry; width: number; label: string }[][] = [[]]
  let lineWidth = 0
  const maxLine = area.w - 8
  for (const entry of entries) {
    const label = truncateText(entry.label, maxLine - symbolWidth(entry) - gap, style.px, style.bold)
    const width = symbolWidth(entry) + gap + textWidth(label, style) + 10
    if (lineWidth + width > maxLine && lines[lines.length - 1]!.length) {
      lines.push([])
      lineWidth = 0
    }
    lines[lines.length - 1]!.push({ entry, width, label })
    lineWidth += width
  }
  const maxLines = Math.max(1, Math.floor((area.h * 0.4) / rowHeight))
  const shownLines = lines.slice(0, maxLines)
  const height = shownLines.length * rowHeight + 6
  const y = legend.position === 't' ? area.y : area.y + area.h - height
  shownLines.forEach((line, row) => {
    const total = line.reduce((sum, item) => sum + item.width, 0) - 10
    let x = area.x + (area.w - total) / 2
    for (const item of line) {
      rows.push({ entry: item.entry, x, y: y + 3 + rowHeight * (row + 0.5), label: item.label })
      x += item.width
    }
  })
  const widest = Math.max(...shownLines.map((line) => line.reduce((sum, item) => sum + item.width, 0)))
  return { rect: { x: area.x + (area.w - widest) / 2, y, w: widest, h: height }, rows, style }
}

function drawLegend(ctx: RenderContext, layout: LegendLayout): string {
  const legend = ctx.model.legend!
  const parts: string[] = []
  const fill = legend.format.fill ? fillToCss(legend.format.fill, ctx.theme, 'none') : 'none'
  const border = resolveLine(ctx, legend.format.line, { color: 'none', width: 0.75 })
  parts.push(rect(layout.rect.x, layout.rect.y, layout.rect.w, layout.rect.h, fill, border))
  for (const row of layout.rows) {
    const { entry } = row
    const width = symbolWidth(entry)
    if (entry.symbol === 'line') {
      parts.push(lineSegment(row.x, row.y, row.x + width, row.y, { ...entry.paint.line, width: Math.min(entry.paint.line.width, 4) }))
      if (entry.paint.marker) parts.push(markerSvg({ ...entry.paint.marker, size: Math.min(entry.paint.marker.size, 9) }, row.x + width / 2, row.y))
    } else {
      const line = entry.paint.line.color === 'none' ? undefined : { ...entry.paint.line, width: Math.min(entry.paint.line.width, 1.5) }
      parts.push(rect(row.x, row.y - SYMBOL_BOX / 2, SYMBOL_BOX, SYMBOL_BOX, entry.paint.fill === 'none' ? entry.paint.color : entry.paint.fill, line))
    }
    parts.push(text(ctx, row.x + width + 4, row.y, row.label, layout.style, { anchor: 'start', baseline: 'middle' }))
  }
  return parts.join('')
}

// ---------------------------------------------------------------------------------------------

function draw(ctx: RenderContext, options: RenderChartOptions): string {
  const model = ctx.model
  const resolver = options.resolveRange ? memoize(options.resolveRange) : undefined
  const all: ResolvedSeries[] = []
  for (const group of model.groups) for (const series of group.series) all.push(resolveSeries(group, series, resolver))

  const parts: string[] = []
  const border = resolveLine(ctx, model.chartFormat.line, { color: isDarkStyle(model.style) ? '#595959' : '#d9d9d9', width: 0.75 })
  const radius = model.roundedCorners ? 6 : 0
  parts.push(rect(0.5, 0.5, ctx.width - 1, ctx.height - 1, ctx.backgroundColor, border, radius ? ` rx="${radius}" ry="${radius}"` : ''))

  const pad = Math.max(4, Math.min(10, Math.min(ctx.width, ctx.height) * 0.025))
  let area: Rect = { x: pad, y: pad, w: ctx.width - pad * 2, h: ctx.height - pad * 2 }

  const runs = titleRuns(ctx, model.title, resolver, all)
  const titleParts: string[] = []
  if (runs) {
    const layout = layoutTitle(ctx, runs, model.title, area.w * 0.85)
    const manual = model.title?.layout
    if (manual && manual.xMode === 'edge' && manual.yMode === 'edge' && manual.x !== undefined && manual.y !== undefined) {
      titleParts.push(drawTitle(ctx, layout, manual.x * ctx.width + Math.max(...layout.lines.map((line, i) => line.reduce((s, run, k) => s + textWidth(run.text, layout.styles[i]![k] ?? layout.styles[i]![0]!), 0))) / 2, manual.y * ctx.height))
    } else {
      titleParts.push(drawTitle(ctx, layout, ctx.width / 2, area.y))
      if (!model.title?.overlay) area = { ...area, y: area.y + layout.height + 4, h: area.h - layout.height - 4 }
    }
  }

  const entries = model.legend ? legendEntries(ctx, all) : []
  const legendLayout = layoutLegend(ctx, entries, area)
  if (legendLayout && !model.legend!.overlay) {
    const gap = 6
    const r = legendLayout.rect
    switch (model.legend!.position) {
      case 'r':
      case 'tr':
        area = { ...area, w: Math.max(10, r.x - area.x - gap) }
        break
      case 'l':
        area = { ...area, x: r.x + r.w + gap, w: Math.max(10, area.x + area.w - (r.x + r.w + gap)) }
        break
      case 't':
        area = { ...area, y: r.y + r.h + gap, h: Math.max(10, area.y + area.h - (r.y + r.h + gap)) }
        break
      case 'b':
        area = { ...area, h: Math.max(10, r.y - area.y - gap) }
        break
    }
  }

  const circular = model.groups.find((group) => group.type === 'pie' || group.type === 'doughnut')
  const radar = model.groups.find((group) => group.type === 'radar')
  const cartesian = model.groups.some((group: ChartGroup) => group.type !== 'pie' && group.type !== 'doughnut' && group.type !== 'radar')
  if (cartesian) parts.push(renderCartesian(ctx, area, all).svg)
  else if (circular) parts.push(renderPie(ctx, plotRect(ctx, area), circular, all))
  else if (radar) parts.push(renderRadar(ctx, plotRect(ctx, area), radar, all))

  parts.push(...titleParts)
  if (legendLayout) parts.push(drawLegend(ctx, legendLayout))
  const label = runs ? runs.map((line) => line.map((run) => run.text).join('')).join(' ') : 'Chart'
  return svgOpen(ctx, label || 'Chart') + parts.join('') + '</svg>'
}

function plotRect(ctx: RenderContext, area: Rect): Rect {
  const layout = ctx.model.plotAreaLayout
  if (layout && layout.xMode === 'edge' && layout.yMode === 'edge' && layout.w && layout.h) {
    return { x: (layout.x ?? 0) * ctx.width, y: (layout.y ?? 0) * ctx.height, w: layout.w * ctx.width, h: layout.h * ctx.height }
  }
  return area
}

function memoize(resolver: RangeResolver): RangeResolver {
  const cache = new Map<string, Scalar[][] | undefined>()
  return (formula) => {
    if (!cache.has(formula)) {
      let result: Scalar[][] | undefined
      try {
        result = resolver(formula)
      } catch {
        result = undefined
      }
      cache.set(formula, result)
    }
    return cache.get(formula)
  }
}

/**
 * Renders a chart as a standalone SVG string. The output contains only drawing elements and
 * escaped text (no scripts, event handlers, links, or external references), so it is safe to set
 * as innerHTML. Unsupported or unreadable charts render as a placeholder box.
 */
export function renderChartSvg(model: ChartModel, options: RenderChartOptions): string {
  const ctx = createContext(model, options)
  if (model.unsupported) return renderChartPlaceholder(ctx.width, ctx.height, model.unsupportedReason ?? 'This chart cannot be shown', options)
  try {
    return draw(ctx, options)
  } catch {
    return renderChartPlaceholder(ctx.width, ctx.height, 'This chart could not be drawn', options)
  }
}
