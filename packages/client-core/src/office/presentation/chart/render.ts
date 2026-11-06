import { maxOf, minOf } from '../../../collections.js'
import type { Element } from '@xmldom/xmldom'
import { automaticColor } from './color.js'
import { formatGeneral, formatNumber } from './format.js'
import {
  effectiveDataLabels,
  mergeTextStyles,
  parseChart,
  type AxisModel,
  type CategoryData,
  type ChartFill,
  type ChartLine,
  type ChartModel,
  type DataLabelPosition,
  type DataLabelsModel,
  type ManualLayout,
  type MarkerSymbol,
  type PlotModel,
  type SeriesModel,
  type SupportedChartModel,
  type TextStyle,
} from './model.js'
import { computeScale, crossingValue, scaleFraction, type ValueScale } from './scale.js'
import {
  automaticMarker,
  dashArray,
  escapeXml,
  estimateTextWidth,
  hashString,
  isOpenMarker,
  linePath,
  markerPath,
  num,
  truncateText,
  wrapText,
  type Box,
  type Point,
} from './svg.js'

/**
 * Draws a chart part as a self-contained SVG string, styled like Office 2013+ charts where the
 * file leaves things automatic: light gray gridlines, no chart border, gray labels, theme accent
 * series colors. DOM-free, so it runs on the server for thumbnails as well as in clients.
 */

export interface ChartRenderOptions {
  /** The frame size in px. */
  width: number
  height: number
  /**
   * Resolves a DrawingML color-bearing element (a:solidFill, or a color child like
   * a:schemeClr/a:srgbClr with lumMod etc.) to a CSS color, using the deck's theme. Return
   * undefined if unknown.
   */
  resolveColor(colorParent: Element): string | undefined
  /** Theme accent1..accent6 as CSS colors, for automatic series colors. */
  accents: readonly string[]
  /** Theme text color (tx1) and fonts. */
  textColor: string
  fontFamily: string
  /**
   * Pixels per typographic point, so chart text scales with the frame. Defaults to 96/72 (the
   * frame drawn at 100% zoom); pass frame width in px / frame width in points otherwise.
   */
  pxPerPoint?: number
}

/** Office's chart text default when the file sets no size. */
const DEFAULT_TEXT_PT = 10
/** Gray levels Office 2013+ derives from the text color (tx1 with lumMod/lumOff). */
const LABEL_OPACITY = 0.65
const DATA_LABEL_OPACITY = 0.75
const GRIDLINE_OPACITY = 0.15
const AXIS_LINE_OPACITY = 0.25
const MAX_DATA_LABELS = 2000

type Side = 'left' | 'right' | 'top' | 'bottom'
type Anchor = 'start' | 'middle' | 'end'

interface Font {
  sizePx: number
  bold: boolean
  italic: boolean
  family?: string
  color: string
  opacity: number
}

interface Stroke {
  color: string
  widthPx: number
  dash?: string
}

interface Context {
  model: SupportedChartModel
  options: ChartRenderOptions
  width: number
  height: number
  pt: number
  idPrefix: string
  nextId: number
  defs: string[]
  layers: { background: string[]; grid: string[]; series: string[]; axes: string[]; labels: string[] }
  labelCount: number
}

// ---------------------------------------------------------------------------------------------
// Entry points

export function renderChartSvg(xml: string, options: ChartRenderOptions): string {
  const width = positiveSize(options.width)
  const height = positiveSize(options.height)
  let model: ChartModel
  try {
    model = parseChart(xml)
  } catch {
    return placeholderSvg(width, height, options, "This chart couldn't be drawn")
  }
  if (model.unsupported) return placeholderSvg(width, height, options, `${describeType(model.typeName)} charts can't be shown here`)
  try {
    return drawChart(model, options, width, height, hashString(xml))
  } catch {
    return placeholderSvg(width, height, options, "This chart couldn't be drawn")
  }
}

/** Title, series names, and values as plain text, for exporting decks to agents and search. */
export function chartTextSummary(xml: string): string {
  let model: ChartModel
  try {
    model = parseChart(xml)
  } catch {
    return '[Chart]'
  }
  if (model.unsupported) return `[${describeType(model.typeName)} chart]`
  const lines: string[] = []
  const title = model.title?.lines?.join(' ').trim()
  lines.push(title ? `Chart: ${title}` : 'Chart')
  const formatOptions = { date1904: model.date1904 }
  for (const plot of model.plots) {
    const categories = plotCategories(plot)
    for (const series of plot.series) {
      const values: string[] = []
      const count = Math.min(series.values.values.length, 200)
      for (let index = 0; index < count; index++) {
        const value = series.values.values[index]
        const shown = value === undefined ? '' : formatNumber(value, series.values.formatCode, formatOptions)
        if (plot.type === 'scatter' || plot.type === 'bubble') {
          const x = series.xValues?.values[index]
          const xText = x === undefined ? (series.xLabels?.labels[index] ?? String(index + 1)) : formatNumber(x, series.xValues?.formatCode, formatOptions)
          values.push(`(${xText}, ${shown})`)
        } else {
          const category = categories ? categoryLabel(categories, index, undefined, formatOptions) : ''
          values.push(category ? `${category} ${shown}` : shown)
        }
      }
      const more = series.values.values.length > count ? ', …' : ''
      lines.push(`${series.name}: ${values.join(', ')}${more}`)
    }
  }
  return lines.join('\n')
}

function describeType(typeName: string): string {
  const words = typeName.replace(/Chart$/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2')
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'These'
}

function positiveSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100_000) : 1
}

function placeholderSvg(width: number, height: number, options: ChartRenderOptions, message: string): string {
  const size = Math.max(8, Math.min(14, Math.min(width, height) / 8))
  const text = truncateText(message, width * 0.9, size)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" font-family="${escapeXml(options.fontFamily)}">` +
    `<rect x="0.5" y="0.5" width="${num(Math.max(0, width - 1))}" height="${num(Math.max(0, height - 1))}" fill="none" stroke="${escapeXml(options.textColor)}" stroke-opacity="0.25" stroke-dasharray="4 3"/>` +
    `<text x="${num(width / 2)}" y="${num(height / 2 + size * 0.35)}" font-size="${num(size)}" text-anchor="middle" fill="${escapeXml(options.textColor)}" fill-opacity="0.6">${escapeXml(text)}</text>` +
    `</svg>`
  )
}

function drawChart(model: SupportedChartModel, options: ChartRenderOptions, width: number, height: number, hash: string): string {
  const pt = Number.isFinite(options.pxPerPoint) && options.pxPerPoint! > 0 ? options.pxPerPoint! : 96 / 72
  const ctx: Context = {
    model,
    options,
    width,
    height,
    pt,
    idPrefix: `chart-${hash}-`,
    nextId: 0,
    defs: [],
    layers: { background: [], grid: [], series: [], axes: [], labels: [] },
    labelCount: 0,
  }
  drawChartBackground(ctx)
  const padding = Math.max(2, Math.min(width, height) * 0.025)
  let area: Box = { x: padding, y: padding, w: width - padding * 2, h: height - padding * 2 }
  const title = layoutTitle(ctx, area)
  area = title.remaining
  const legend = layoutLegend(ctx, area)
  area = legend.remaining
  drawPlots(ctx, area)
  legend.draw()
  title.draw()

  const { background, grid, series, axes, labels } = ctx.layers
  const titleText = model.title?.lines?.join(' ').trim()
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" font-family="${escapeXml(options.fontFamily)}" role="img"${titleText ? ` aria-label="${escapeXml(titleText)}"` : ''}>` +
    (ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '') +
    background.join('') +
    grid.join('') +
    series.join('') +
    axes.join('') +
    labels.join('') +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------------------------
// Paint

function resolveColor(ctx: Context, colorParent: Element): string | undefined {
  try {
    return ctx.options.resolveColor(colorParent) || undefined
  } catch {
    return undefined
  }
}

/** A CSS paint for a fill, or `auto` when the fill is absent or names no color. */
function fillPaint(ctx: Context, fill: ChartFill | undefined, auto: string | undefined): string {
  if (!fill) return auto ?? 'none'
  switch (fill.kind) {
    case 'none':
      return 'none'
    case 'solid':
    case 'pattern':
      return resolveColor(ctx, fill.color) ?? auto ?? 'none'
    case 'gradient': {
      const stops = fill.stops.map((stop) => `<stop offset="${num(stop.position)}" stop-color="${escapeXml(resolveColor(ctx, stop.color) ?? auto ?? '#808080')}"/>`)
      const id = `${ctx.idPrefix}g${ctx.nextId++}`
      const radians = (fill.angleDeg * Math.PI) / 180
      const dx = Math.cos(radians) / 2
      const dy = Math.sin(radians) / 2
      ctx.defs.push(`<linearGradient id="${id}" x1="${num(0.5 - dx)}" y1="${num(0.5 - dy)}" x2="${num(0.5 + dx)}" y2="${num(0.5 + dy)}">${stops.join('')}</linearGradient>`)
      return `url(#${id})`
    }
  }
}

function strokeFor(ctx: Context, line: ChartLine | undefined, auto: { color?: string; widthPt: number }): Stroke | undefined {
  if (line?.fill?.kind === 'none') return undefined
  const color = line?.fill ? fillPaint(ctx, line.fill, auto.color) : auto.color
  if (!color || color === 'none') return undefined
  const widthPx = Math.max(0.5, (line?.widthPt ?? auto.widthPt) * ctx.pt)
  const dash = dashArray(line?.dash, widthPx)
  return { color, widthPx, ...(dash ? { dash } : {}) }
}

function strokeAttributes(stroke: Stroke | undefined, opacity?: number): string {
  if (!stroke) return ' stroke="none"'
  return (
    ` stroke="${escapeXml(stroke.color)}" stroke-width="${num(stroke.widthPx)}"` +
    (stroke.dash ? ` stroke-dasharray="${stroke.dash}"` : '') +
    (opacity !== undefined && opacity < 1 ? ` stroke-opacity="${num(opacity)}"` : '')
  )
}

/** A gray line derived from the text color, for automatic axis lines and gridlines. */
function themeLine(ctx: Context, line: ChartLine | undefined, opacity: number): { stroke?: Stroke; opacity: number } {
  const explicit = line?.fill !== undefined
  const stroke = strokeFor(ctx, line, { color: ctx.options.textColor, widthPt: 0.75 })
  return stroke ? { stroke, opacity: explicit ? 1 : opacity } : { opacity }
}

function seriesColor(ctx: Context, series: SeriesModel): string {
  return automaticColor(ctx.options.accents, series.index)
}

/** The automatic color of one point: its own with varied colors, else its series'. */
function pointColor(ctx: Context, plot: PlotModel, series: SeriesModel, pointIndex: number): string {
  const vary = plot.varyColors && (plot.type === 'pie' || plot.series.length === 1)
  return vary ? automaticColor(ctx.options.accents, pointIndex) : seriesColor(ctx, series)
}

// ---------------------------------------------------------------------------------------------
// Text

function fontFor(ctx: Context, style: TextStyle, defaults: { sizePt?: number; bold?: boolean; opacity: number }): Font {
  const explicitColor = style.color ? resolveColor(ctx, style.color) : undefined
  const sizePt = style.sizePt ?? defaults.sizePt ?? ctx.model.textStyle.sizePt ?? DEFAULT_TEXT_PT
  const family = style.typeface && !style.typeface.startsWith('+') ? `"${style.typeface.replace(/["\\]/g, '')}", ${ctx.options.fontFamily}` : undefined
  return {
    sizePx: sizePt * ctx.pt,
    bold: style.bold ?? defaults.bold ?? false,
    italic: style.italic ?? false,
    ...(family ? { family } : {}),
    color: explicitColor ?? ctx.options.textColor,
    opacity: explicitColor ? 1 : defaults.opacity,
  }
}

function lineHeight(font: Font): number {
  return font.sizePx * 1.2
}

function textWidth(text: string, font: Font): number {
  return estimateTextWidth(text, font.sizePx, font.bold)
}

/** One line of text; `y` is the vertical center of the line. */
function textSvg(text: string, x: number, y: number, font: Font, anchor: Anchor, rotateDeg = 0): string {
  if (!text) return ''
  const baseline = y + font.sizePx * 0.35
  return (
    `<text x="${num(x)}" y="${num(baseline)}" font-size="${num(font.sizePx)}"` +
    (font.bold ? ' font-weight="bold"' : '') +
    (font.italic ? ' font-style="italic"' : '') +
    (font.family ? ` font-family="${escapeXml(font.family)}"` : '') +
    ` fill="${escapeXml(font.color)}"` +
    (font.opacity < 1 ? ` fill-opacity="${num(font.opacity)}"` : '') +
    (anchor === 'start' ? '' : ` text-anchor="${anchor}"`) +
    (rotateDeg ? ` transform="rotate(${num(rotateDeg)} ${num(x)} ${num(y)})"` : '') +
    `>${escapeXml(text)}</text>`
  )
}

/** Several lines centered vertically on `y`. */
function textBlockSvg(lines: readonly string[], x: number, y: number, font: Font, anchor: Anchor, rotateDeg = 0): string {
  const height = lineHeight(font)
  const top = y - ((lines.length - 1) * height) / 2
  if (!rotateDeg) return lines.map((line, index) => textSvg(line, x, top + index * height, font, anchor)).join('')
  // Rotated blocks turn as a whole around their center.
  const inner = lines.map((line, index) => textSvg(line, x, top + index * height, font, anchor)).join('')
  return `<g transform="rotate(${num(rotateDeg)} ${num(x)} ${num(y)})">${inner}</g>`
}

// ---------------------------------------------------------------------------------------------
// Chart area, title, legend

function drawChartBackground(ctx: Context): void {
  const shape = ctx.model.chartShape
  const fill = fillPaint(ctx, shape.fill, undefined)
  const stroke = strokeFor(ctx, shape.line, { widthPt: 0.75 })
  if (fill === 'none' && !stroke) return
  const inset = stroke ? stroke.widthPx / 2 : 0
  const radius = ctx.model.roundedCorners && stroke ? Math.min(ctx.width, ctx.height) * 0.03 : 0
  ctx.layers.background.push(
    `<rect x="${num(inset)}" y="${num(inset)}" width="${num(ctx.width - inset * 2)}" height="${num(ctx.height - inset * 2)}"${radius ? ` rx="${num(radius)}"` : ''} fill="${escapeXml(fill)}"${strokeAttributes(stroke)}/>`,
  )
}

function layoutBox(ctx: Context, layout: ManualLayout, fallback: Box): Box {
  return {
    x: layout.x * ctx.width,
    y: layout.y * ctx.height,
    w: layout.w !== undefined ? layout.w * ctx.width : fallback.w,
    h: layout.h !== undefined ? layout.h * ctx.height : fallback.h,
  }
}

function totalSeriesCount(model: SupportedChartModel): number {
  return model.plots.reduce((sum, plot) => sum + plot.series.length, 0)
}

/** The title's lines, including Office's automatic title for single-series charts. */
function titleLines(model: SupportedChartModel): string[] | undefined {
  if (model.title) {
    if (model.title.lines) return model.title.lines
    const only = model.plots[0]?.series[0]
    return [totalSeriesCount(model) === 1 && only ? only.name : 'Chart Title']
  }
  // With no title element, Office still titles a single-series chart after its series
  // unless the author deleted the automatic title.
  if (!model.autoTitleDeleted && totalSeriesCount(model) === 1) {
    const name = model.plots[0]?.series[0]?.name
    return name ? [name] : undefined
  }
  return undefined
}

function layoutTitle(ctx: Context, area: Box): { remaining: Box; draw: () => void } {
  const lines = titleLines(ctx.model)?.filter((line, index, all) => line.trim() || all.length > 1)
  if (!lines?.length || !lines.some((line) => line.trim())) return { remaining: area, draw: () => {} }
  const title = ctx.model.title
  const base = ctx.model.textStyle.sizePt ?? DEFAULT_TEXT_PT
  // Titles default to 1.2 times the chart's text size, bold, as in Office.
  const font = fontFor(ctx, mergeTextStyles(ctx.model.textStyle, title?.style, { sizePt: title?.style.sizePt ?? base * 1.2 }), { bold: true, opacity: LABEL_OPACITY })
  const fitted = lines.flatMap((line) => wrapText(line, area.w * 0.9, font.sizePx, font.bold)).slice(0, 4).map((line) => truncateText(line, area.w, font.sizePx, font.bold))
  const height = fitted.length * lineHeight(font)
  const gap = font.sizePx * 0.4
  const manual = title?.layout
  const draw = (): void => {
    if (manual) {
      const x = manual.x * ctx.width
      const y = manual.y * ctx.height + lineHeight(font) / 2
      fitted.forEach((line, index) => ctx.layers.labels.push(textSvg(line, x, y + index * lineHeight(font), font, 'start')))
      return
    }
    ctx.layers.labels.push(textBlockSvg(fitted, area.x + area.w / 2, area.y + height / 2, font, 'middle'))
  }
  if (title?.overlay || manual || height > area.h * 0.4) return { remaining: area, draw }
  return { remaining: { x: area.x, y: area.y + height + gap, w: area.w, h: Math.max(0, area.h - height - gap) }, draw }
}

interface MarkerSpec {
  symbol: MarkerSymbol
  sizePx: number
  fill: string
  stroke?: Stroke
}

type Swatch = { kind: 'box'; fill: string; stroke?: Stroke } | { kind: 'line'; stroke?: Stroke; marker?: MarkerSpec }

interface LegendEntry {
  index: number
  label: string
  swatch: Swatch
}

function legendEntries(ctx: Context): LegendEntry[] {
  const { plots } = ctx.model
  const first = plots[0]
  // A single varied-color series (every pie) lists its categories rather than itself.
  if (first && plots.length === 1 && first.series.length >= 1 && first.varyColors && (first.type === 'pie' || first.series.length === 1)) {
    const series = first.series[0]!
    const categories = plotCategories(first)
    const count = Math.min(Math.max(categories?.count ?? 0, series.values.values.length), 200)
    const entries: LegendEntry[] = []
    for (let index = 0; index < count; index++) {
      const label = categories ? categoryLabel(categories, index, undefined, { date1904: ctx.model.date1904 }) : String(index + 1)
      entries.push({ index, label, swatch: seriesSwatch(ctx, first, series, index) })
    }
    return entries
  }
  return plots.flatMap((plot) => plot.series.map((series) => ({ index: series.index, label: series.name, swatch: seriesSwatch(ctx, plot, series) })))
}

function seriesSwatch(ctx: Context, plot: PlotModel, series: SeriesModel, pointIndex?: number): Swatch {
  const point = pointIndex === undefined ? undefined : series.points.get(pointIndex)
  const color = pointIndex === undefined ? seriesColor(ctx, series) : pointColor(ctx, plot, series, pointIndex)
  if (plot.type === 'line' || plot.type === 'scatter' || (plot.type === 'radar' && plot.style !== 'filled')) {
    const stroke = seriesLineStroke(ctx, plot, series, color)
    const marker = markerFor(ctx, plot, series, undefined, color)
    return { kind: 'line', ...(stroke ? { stroke } : {}), ...(marker ? { marker } : {}) }
  }
  const style = point?.style.fill ? point.style : series.style
  const stroke = strokeFor(ctx, (point?.style.line ?? series.style.line), { widthPt: 0.75 })
  return { kind: 'box', fill: fillPaint(ctx, style.fill, color), ...(stroke ? { stroke } : {}) }
}

function layoutLegend(ctx: Context, area: Box): { remaining: Box; draw: () => void } {
  const legend = ctx.model.legend
  if (!legend) return { remaining: area, draw: () => {} }
  const entries = legendEntries(ctx).filter((entry) => !legend.deletedEntries.has(entry.index))
  if (!entries.length) return { remaining: area, draw: () => {} }
  const font = fontFor(ctx, legend.textStyle, { opacity: LABEL_OPACITY })
  const rowHeight = lineHeight(font) * 1.1
  const keyWidth = (entry: LegendEntry): number => (entry.swatch.kind === 'line' ? font.sizePx * 1.9 : font.sizePx * 0.65)
  const keyGap = font.sizePx * 0.35
  const entryGap = font.sizePx * 0.9
  const vertical = legend.position === 'r' || legend.position === 'l' || legend.position === 'tr'
  const maxLabelWidth = vertical ? area.w * 0.3 : area.w * 0.8
  const labels = entries.map((entry) => truncateText(entry.label, maxLabelWidth, font.sizePx, font.bold))
  const widths = entries.map((entry, index) => keyWidth(entry) + keyGap + textWidth(labels[index]!, font))

  // Rows of entries: one per row in a vertical legend, wrapped to the width in a horizontal one.
  const rows: number[][] = []
  if (vertical) {
    const fits = Math.max(1, Math.floor(area.h / rowHeight))
    entries.slice(0, fits).forEach((_, index) => rows.push([index]))
  } else {
    let current: number[] = []
    let used = 0
    widths.forEach((width, index) => {
      if (current.length && used + entryGap + width > area.w) {
        rows.push(current)
        current = []
        used = 0
      }
      used += (current.length ? entryGap : 0) + width
      current.push(index)
    })
    if (current.length) rows.push(current)
    rows.splice(Math.max(1, Math.floor((area.h * 0.4) / rowHeight)))
  }
  const rowWidth = (row: number[]): number => row.reduce((sum, index, position) => sum + widths[index]! + (position ? entryGap : 0), 0)
  const boxWidth = Math.min(area.w, maxOf(rows.map(rowWidth)))
  const boxHeight = rows.length * rowHeight
  const gap = font.sizePx * 0.6

  let box: Box
  let remaining = area
  if (legend.layout) {
    box = layoutBox(ctx, legend.layout, { x: 0, y: 0, w: boxWidth, h: boxHeight })
  } else {
    switch (legend.position) {
      case 'b':
        box = { x: area.x + (area.w - boxWidth) / 2, y: area.y + area.h - boxHeight, w: boxWidth, h: boxHeight }
        remaining = { ...area, h: Math.max(0, area.h - boxHeight - gap) }
        break
      case 't':
        box = { x: area.x + (area.w - boxWidth) / 2, y: area.y, w: boxWidth, h: boxHeight }
        remaining = { ...area, y: area.y + boxHeight + gap, h: Math.max(0, area.h - boxHeight - gap) }
        break
      case 'l':
        box = { x: area.x, y: area.y + (area.h - boxHeight) / 2, w: boxWidth, h: boxHeight }
        remaining = { ...area, x: area.x + boxWidth + gap, w: Math.max(0, area.w - boxWidth - gap) }
        break
      case 'tr':
        box = { x: area.x + area.w - boxWidth, y: area.y, w: boxWidth, h: boxHeight }
        remaining = { ...area, w: Math.max(0, area.w - boxWidth - gap) }
        break
      default:
        box = { x: area.x + area.w - boxWidth, y: area.y + (area.h - boxHeight) / 2, w: boxWidth, h: boxHeight }
        remaining = { ...area, w: Math.max(0, area.w - boxWidth - gap) }
    }
    if (legend.overlay) remaining = area
  }

  const draw = (): void => {
    const out = ctx.layers.labels
    const fill = fillPaint(ctx, legend.shape.fill, undefined)
    const border = strokeFor(ctx, legend.shape.line, { widthPt: 0.75 })
    if (fill !== 'none' || border) {
      const pad = font.sizePx * 0.3
      out.push(`<rect x="${num(box.x - pad)}" y="${num(box.y - pad)}" width="${num(box.w + pad * 2)}" height="${num(box.h + pad * 2)}" fill="${escapeXml(fill)}"${strokeAttributes(border)}/>`)
    }
    rows.forEach((row, rowIndex) => {
      const centerY = box.y + rowIndex * rowHeight + rowHeight / 2
      let x = vertical ? box.x : box.x + (box.w - rowWidth(row)) / 2
      for (const index of row) {
        const entry = entries[index]!
        const width = keyWidth(entry)
        out.push(swatchSvg(entry.swatch, x, centerY, width, font.sizePx * 0.65))
        out.push(textSvg(labels[index]!, x + width + keyGap, centerY, font, 'start'))
        x += widths[index]! + entryGap
      }
    })
  }
  return { remaining, draw }
}

function swatchSvg(swatch: Swatch, x: number, centerY: number, width: number, boxSize: number): string {
  if (swatch.kind === 'box') {
    return `<rect x="${num(x)}" y="${num(centerY - boxSize / 2)}" width="${num(boxSize)}" height="${num(boxSize)}" fill="${escapeXml(swatch.fill)}"${strokeAttributes(swatch.stroke)}/>`
  }
  let svg = swatch.stroke ? `<path d="M${num(x)} ${num(centerY)}H${num(x + width)}" fill="none"${strokeAttributes(swatch.stroke)}/>` : ''
  if (swatch.marker) svg += markerSvg({ ...swatch.marker, sizePx: Math.min(swatch.marker.sizePx, boxSize * 1.2) }, x + width / 2, centerY)
  return svg
}

// ---------------------------------------------------------------------------------------------
// Series helpers

function plotCategories(plot: PlotModel): CategoryData | undefined {
  return plot.series.find((series) => series.categories)?.categories
}

function categoryLabel(categories: CategoryData, index: number, formatCode: string | undefined, options: { date1904: boolean }): string {
  const number = categories.numbers?.[index]
  if (number !== undefined) return formatNumber(number, formatCode ?? categories.formatCode, options)
  return categories.labels[index] ?? ''
}

function markerFor(ctx: Context, plot: PlotModel, series: SeriesModel, pointIndex: number | undefined, color: string): MarkerSpec | undefined {
  const pointMarker = pointIndex === undefined ? undefined : series.points.get(pointIndex)?.marker
  const marker = pointMarker ?? series.marker
  const shownByDefault =
    plot.type === 'line'
      ? plot.markers
      : plot.type === 'scatter'
        ? plot.style === 'lineMarker' || plot.style === 'marker' || plot.style === 'smoothMarker'
        : plot.type === 'radar'
          ? plot.style === 'marker'
          : false
  let symbol = pointMarker?.symbol ?? series.marker?.symbol ?? (shownByDefault ? 'auto' : 'none')
  if (symbol === 'auto') symbol = automaticMarker(series.index)
  if (symbol === 'none' || symbol === 'picture') return undefined
  const sizePt = pointMarker?.size ?? series.marker?.size ?? 5
  const style = { ...series.marker?.style, ...pointMarker?.style }
  const open = isOpenMarker(symbol)
  const stroke = strokeFor(ctx, style.line, { color: open ? fillPaint(ctx, style.fill, color) : color, widthPt: 0.75 })
  return { symbol, sizePx: sizePt * ctx.pt, fill: open ? 'none' : fillPaint(ctx, marker?.style.fill, color), ...(stroke ? { stroke } : {}) }
}

function markerSvg(marker: MarkerSpec, x: number, y: number): string {
  const path = markerPath(marker.symbol, x, y, marker.sizePx)
  return path ? `<path d="${path}" fill="${escapeXml(marker.fill)}"${strokeAttributes(marker.stroke)}/>` : ''
}

function seriesLineStroke(ctx: Context, plot: PlotModel, series: SeriesModel, color: string): Stroke | undefined {
  if (plot.type === 'scatter' && (plot.style === 'marker' || plot.style === 'none') && !series.style.line?.fill) return undefined
  return strokeFor(ctx, series.style.line, { color, widthPt: 2.25 })
}

interface LabelContent {
  value?: number
  percent?: number
  category?: string
  bubbleSize?: number
  valueFormat?: string
}

/** The data label lines of one point, or undefined when it shows nothing. */
function dataLabelLines(ctx: Context, labels: DataLabelsModel | undefined, series: SeriesModel, pointIndex: number, content: LabelContent): { lines: string[]; style: TextStyle; position?: DataLabelPosition } | undefined {
  if (!labels || labels.deleted || ctx.labelCount >= MAX_DATA_LABELS) return undefined
  const point = labels.points.get(pointIndex)
  if (point?.deleted) return undefined
  const settings = { ...labels, ...Object.fromEntries(Object.entries(point ?? {}).filter(([, value]) => value !== undefined)) } as DataLabelsModel & { lines?: string[] }
  const style = point?.style ?? labels.style
  if (point?.lines) return { lines: point.lines, style, ...(settings.position ? { position: settings.position } : {}) }
  const parts: string[] = []
  const formatOptions = { date1904: ctx.model.date1904 }
  if (settings.showSeriesName) parts.push(series.name)
  if (settings.showCategory && content.category !== undefined) parts.push(content.category)
  if (settings.showValue && content.value !== undefined) parts.push(formatNumber(content.value, settings.numberFormat ?? content.valueFormat, formatOptions))
  if (settings.showPercent && content.percent !== undefined) parts.push(formatNumber(content.percent, settings.showValue ? '0%' : (settings.numberFormat ?? '0%'), formatOptions))
  if (settings.showBubbleSize && content.bubbleSize !== undefined) parts.push(formatGeneral(content.bubbleSize))
  if (!parts.length) return undefined
  ctx.labelCount++
  const separator = settings.separator ?? ', '
  const lines = parts.join(separator).split(/\r?\n/)
  return { lines, style, ...(settings.position ? { position: settings.position } : {}) }
}

function drawDataLabel(ctx: Context, lines: string[], style: TextStyle, x: number, y: number, anchor: Anchor): void {
  const font = fontFor(ctx, style, { opacity: DATA_LABEL_OPACITY })
  ctx.layers.labels.push(textBlockSvg(lines, x, y, font, anchor))
}

function dataLabelFont(ctx: Context, style: TextStyle): Font {
  return fontFor(ctx, style, { opacity: DATA_LABEL_OPACITY })
}

// ---------------------------------------------------------------------------------------------
// Plot dispatch

function drawPlots(ctx: Context, area: Box): void {
  const plotBox = ctx.model.plotLayout ? layoutBox(ctx, ctx.model.plotLayout, area) : area
  if (plotBox.w < 4 || plotBox.h < 4) return
  const axisPlots = ctx.model.plots.filter((plot) => plot.type !== 'pie' && plot.type !== 'radar')
  if (axisPlots.length) {
    drawAxisChart(ctx, area, axisPlots)
    return
  }
  const radar = ctx.model.plots.find((plot) => plot.type === 'radar')
  if (radar?.type === 'radar') {
    drawPlotAreaFill(ctx, plotBox)
    drawRadarChart(ctx, plotBox, radar)
    return
  }
  const pie = ctx.model.plots.find((plot) => plot.type === 'pie')
  if (pie?.type === 'pie') {
    drawPlotAreaFill(ctx, plotBox)
    drawPieChart(ctx, plotBox, pie)
  }
}

function drawPlotAreaFill(ctx: Context, box: Box): void {
  const shape = ctx.model.plotShape
  const fill = fillPaint(ctx, shape.fill, undefined)
  const stroke = strokeFor(ctx, shape.line, { widthPt: 0.75 })
  if (fill === 'none' && !stroke) return
  ctx.layers.background.push(`<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="${escapeXml(fill)}"${strokeAttributes(stroke)}/>`)
}

// ---------------------------------------------------------------------------------------------
// Axis charts: bar, line, area, scatter, bubble

type CategoryPlot = Extract<PlotModel, { type: 'bar' | 'line' | 'area' }>
type XyPlot = Extract<PlotModel, { type: 'scatter' | 'bubble' }>

interface PlacedAxis {
  axis: AxisModel
  /** Categories (slots) or a numeric scale. */
  role: 'category' | 'value'
  /** Whether the axis runs up the plot (its labels sit to the left or right). */
  vertical: boolean
  side: Side
  visible: boolean
  scale?: ValueScale
  format?: string
  labels?: CategoryLabels
}

interface CategoryLabels {
  /** Per category: the wrapped lines to show, or [] for skipped labels. */
  lines: string[][]
  rotation: number
  outerLevels: (string | undefined)[][]
  levelThickness: number
  leafThickness: number
}

interface AxisGroup {
  plots: PlotModel[]
  xy: boolean
  horizontal: boolean
  secondary: boolean
  /** The category axis, or the X axis of scatter and bubble plots. */
  base: PlacedAxis
  /** The value axis, or the Y axis. */
  measure: PlacedAxis
  categoryCount: number
  categories?: CategoryData
  between: boolean
  valueRange: { min: number; max: number; exact: boolean }
  xRange?: { min: number; max: number }
}

function syntheticAxis(id: string, kind: AxisModel['kind'], position: AxisModel['position'], gridlines: boolean): AxisModel {
  return {
    id,
    kind,
    deleted: false,
    reversed: false,
    position,
    majorTickMark: 'none',
    tickLabelPosition: 'nextTo',
    crosses: 'autoZero',
    textStyle: {},
    ...(gridlines ? { majorGridlines: {} } : {}),
  }
}

function buildAxisGroups(ctx: Context, plots: PlotModel[]): AxisGroup[] {
  const byKey = new Map<string, PlotModel[]>()
  for (const plot of plots) {
    const key = plot.axisIds.slice(0, 2).join('|')
    const list = byKey.get(key)
    if (list) list.push(plot)
    else byKey.set(key, [plot])
  }
  const groups: AxisGroup[] = []
  for (const groupPlots of byKey.values()) {
    const first = groupPlots[0]!
    const xy = first.type === 'scatter' || first.type === 'bubble'
    const horizontal = first.type === 'bar' && first.direction === 'bar'
    const [baseId = '', measureId = ''] = first.axisIds
    const baseAxis = ctx.model.axes.find((axis) => axis.id === baseId) ?? syntheticAxis(baseId, xy ? 'val' : 'cat', horizontal ? 'l' : 'b', false)
    const measureAxis = ctx.model.axes.find((axis) => axis.id === measureId) ?? syntheticAxis(measureId, 'val', horizontal ? 'b' : 'l', true)
    const categoryPlots = groupPlots.filter((plot): plot is CategoryPlot => plot.type === 'bar' || plot.type === 'line' || plot.type === 'area')
    const categories = categoryPlots.map(plotCategories).find(Boolean)
    const categoryCount = Math.max(1, categories?.count ?? 0, maxOf(categoryPlots.flatMap((plot) => plot.series.map((series) => series.values.values.length))))
    const hasBars = categoryPlots.some((plot) => plot.type === 'bar')
    const onlyArea = categoryPlots.length > 0 && categoryPlots.every((plot) => plot.type === 'area')
    const crossBetween = measureAxis.crossBetween ?? (onlyArea ? 'midCat' : 'between')
    groups.push({
      plots: groupPlots,
      xy,
      horizontal,
      secondary: groups.length > 0,
      base: placedAxis(baseAxis, xy ? 'value' : 'category', horizontal),
      measure: placedAxis(measureAxis, 'value', xy || !horizontal),
      categoryCount: xy ? 0 : categoryCount,
      ...(categories ? { categories } : {}),
      between: hasBars || crossBetween === 'between',
      valueRange: valueRange(groupPlots),
      ...(xy ? { xRange: xRange(groupPlots.filter((plot): plot is XyPlot => plot.type === 'scatter' || plot.type === 'bubble')) } : {}),
    })
  }
  return groups
}

function placedAxis(axis: AxisModel, role: PlacedAxis['role'], vertical: boolean): PlacedAxis {
  return { axis, role, vertical, side: vertical ? 'left' : 'bottom', visible: !axis.deleted && axis.tickLabelPosition !== 'none' }
}

function isStacked(plot: PlotModel): boolean {
  return (plot.type === 'bar' || plot.type === 'line' || plot.type === 'area') && (plot.grouping === 'stacked' || plot.grouping === 'percentStacked')
}

function isPercent(plot: PlotModel): boolean {
  return (plot.type === 'bar' || plot.type === 'line' || plot.type === 'area') && plot.grouping === 'percentStacked'
}

/**
 * The value each series reaches at each category once stacked: bars stack positives up and
 * negatives down separately, lines and areas keep a running sum. Percent stacking divides by the
 * category's total magnitude.
 */
function stackedValues(plot: CategoryPlot, dispBlanksAs: SupportedChartModel['dispBlanksAs']): { from: number; to: number; raw: number }[][] {
  const count = Math.max(0, maxOf(plot.series.map((series) => series.values.values.length)))
  const stacked = isStacked(plot)
  const percent = isPercent(plot)
  const totals = new Array<number>(count).fill(0)
  if (percent) {
    for (const series of plot.series) series.values.values.forEach((value, index) => (totals[index] = totals[index]! + Math.abs(value ?? 0)))
  }
  const positive = new Array<number>(count).fill(0)
  const negative = new Array<number>(count).fill(0)
  return plot.series.map((series) => {
    const result: { from: number; to: number; raw: number }[] = []
    for (let index = 0; index < count; index++) {
      const raw = series.values.values[index]
      const value = raw ?? (dispBlanksAs === 'zero' || (stacked && plot.type === 'area') ? 0 : undefined)
      if (value === undefined) {
        result.push({ from: Number.NaN, to: Number.NaN, raw: Number.NaN })
        continue
      }
      const scaled = percent ? (totals[index] ? value / totals[index]! : 0) : value
      if (!stacked) {
        result.push({ from: 0, to: scaled, raw: value })
      } else if (plot.type === 'bar') {
        const sums = scaled >= 0 ? positive : negative
        const from = sums[index]!
        sums[index] = from + scaled
        result.push({ from, to: from + scaled, raw: value })
      } else {
        const from = positive[index]!
        positive[index] = from + scaled
        result.push({ from, to: from + scaled, raw: value })
      }
    }
    return result
  })
}

function valueRange(plots: PlotModel[]): AxisGroup['valueRange'] {
  let min = Infinity
  let max = -Infinity
  const include = (value: number): void => {
    if (!Number.isFinite(value)) return
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  let exact = false
  for (const plot of plots) {
    if (plot.type === 'bar' || plot.type === 'line' || plot.type === 'area') {
      exact ||= isPercent(plot)
      for (const series of stackedValues(plot, 'gap')) {
        for (const point of series) {
          include(point.to)
          if (isStacked(plot)) include(point.from)
        }
      }
    } else {
      for (const series of plot.series) series.values.values.forEach((value) => value !== undefined && include(value))
    }
  }
  if (min > max) return { min: 0, max: 1, exact }
  return { min, max, exact }
}

function xValue(series: SeriesModel, index: number): number | undefined {
  if (series.xValues) return series.xValues.values[index]
  return index + 1
}

function xRange(plots: XyPlot[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const plot of plots) {
    for (const series of plot.series) {
      series.values.values.forEach((_, index) => {
        const x = xValue(series, index)
        if (x === undefined || !Number.isFinite(x)) return
        min = Math.min(min, x)
        max = Math.max(max, x)
      })
    }
  }
  return min > max ? { min: 0, max: 1 } : { min, max }
}

/** The number format for a value axis: its own, else percentages for 100% stacks, else the data's. */
function axisFormat(axis: AxisModel, series: SeriesModel | undefined, percentStacked: boolean, role: 'x' | 'y'): string | undefined {
  if (axis.numberFormat && !axis.numberFormat.sourceLinked) return axis.numberFormat.code
  if (role === 'y' && percentStacked) return '0%'
  const linked = role === 'x' ? series?.xValues?.formatCode : series?.values.formatCode
  return linked ?? axis.numberFormat?.code
}

function computeAxisScale(ctx: Context, group: AxisGroup, placed: PlacedAxis, length: number, font: Font): ValueScale {
  const isX = group.xy && placed === group.base
  const range = isX ? group.xRange! : group.valueRange
  let { min, max } = range
  if (group.plots.some((plot) => plot.type === 'bubble')) {
    // Leave room for bubbles at the edges, as Excel does.
    const pad = (max - min || Math.abs(max) || 1) * 0.12
    min -= pad
    max += pad
  }
  const format = placed.format
  const sample = Math.max(textWidth(formatNumber(min, format), font), textWidth(formatNumber(max, format), font))
  const spacing = placed.vertical ? font.sizePx * 2.2 : sample + font.sizePx * 1.5
  const axis = placed.axis
  return computeScale({
    dataMin: min,
    dataMax: max,
    maxIntervals: Math.max(1, Math.min(10, Math.floor(length / spacing))),
    ...(axis.min !== undefined ? { min: axis.min } : {}),
    ...(axis.max !== undefined ? { max: axis.max } : {}),
    ...(axis.majorUnit !== undefined ? { majorUnit: axis.majorUnit } : {}),
    ...(axis.logBase !== undefined ? { logBase: axis.logBase } : {}),
    exact: !isX && range === group.valueRange && group.valueRange.exact,
  })
}

function axisFont(ctx: Context, axis: AxisModel): Font {
  return fontFor(ctx, axis.textStyle, { opacity: LABEL_OPACITY })
}

function categoryTexts(ctx: Context, group: AxisGroup): string[] {
  const format = group.base.axis.numberFormat && !group.base.axis.numberFormat.sourceLinked ? group.base.axis.numberFormat.code : undefined
  const texts: string[] = []
  for (let index = 0; index < group.categoryCount; index++) {
    texts.push(group.categories ? categoryLabel(group.categories, index, format, { date1904: ctx.model.date1904 }) : String(index + 1))
  }
  return texts
}

/** Fits category labels into their slots: as is, wrapped, or turned 45° and thinned out. */
function arrangeCategoryLabels(ctx: Context, group: AxisGroup, length: number, maxThickness: number): CategoryLabels {
  const placed = group.base
  const font = axisFont(ctx, placed.axis)
  const texts = categoryTexts(ctx, group)
  const count = Math.max(1, texts.length)
  const slot = length / (group.between ? count : Math.max(1, count - 1))
  const height = lineHeight(font)
  const outerLevels = placed.axis.kind === 'cat' ? (group.categories?.outerLevels ?? []) : []
  const levelThickness = outerLevels.length * height * 1.3
  const explicitSkip = placed.axis.tickLabelSkip
  const thin = (skip: number, lines: string[][]): string[][] => lines.map((line, index) => (index % skip === 0 ? line : []))

  if (placed.vertical) {
    const maxWidth = Math.max(font.sizePx * 2, maxThickness - levelThickness)
    const skip = explicitSkip ?? Math.max(1, Math.ceil(height / Math.max(1, slot)))
    const lines = thin(skip, texts.map((text) => [truncateText(text, maxWidth, font.sizePx, font.bold)]))
    const leafThickness = Math.max(0, maxOf(lines.flat().map((line) => textWidth(line, font))))
    return { lines, rotation: 0, outerLevels, levelThickness: outerLevels.length * Math.min(maxWidth, font.sizePx * 6), leafThickness }
  }

  const explicitRotation = placed.axis.textStyle.rotationDeg
  const widest = Math.max(0, maxOf(texts.map((text) => textWidth(text, font))))
  if (!explicitRotation && widest <= slot * 0.92) {
    const skip = explicitSkip ?? 1
    return { lines: thin(skip, texts.map((text) => [text])), rotation: 0, outerLevels, levelThickness, leafThickness: height }
  }
  if (!explicitRotation) {
    const wrapped = texts.map((text) => wrapText(text, slot * 0.92, font.sizePx, font.bold))
    const fits = wrapped.every((lines) => lines.length <= 3 && lines.every((line) => textWidth(line, font) <= slot * 0.92))
    if (fits) {
      const rows = maxOf(wrapped.map((lines) => lines.length))
      return { lines: thin(explicitSkip ?? 1, wrapped), rotation: 0, outerLevels, levelThickness, leafThickness: rows * height }
    }
  }
  const rotation = explicitRotation ?? -45
  const radians = (Math.abs(rotation) * Math.PI) / 180
  const sin = Math.sin(radians) || 1
  const cos = Math.cos(radians)
  // Rotated labels need `height / sin` of axis length each.
  const skip = explicitSkip ?? Math.max(1, Math.ceil(height / sin / Math.max(1, slot)))
  const maxLength = Math.max(font.sizePx * 3, (maxThickness - levelThickness - height * cos) / sin)
  const lines = thin(skip, texts.map((text) => [truncateText(text, maxLength, font.sizePx, font.bold)]))
  const longest = Math.max(0, maxOf(lines.flat().map((line) => textWidth(line, font))))
  return { lines, rotation, outerLevels, levelThickness, leafThickness: longest * sin + height * cos }
}

function axisTitleThickness(ctx: Context, axis: AxisModel): number {
  if (!axis.title || axis.deleted) return 0
  const font = axisTitleFont(ctx, axis)
  return (axis.title.lines?.length ?? 1) * lineHeight(font) + font.sizePx * 0.4
}

function axisTitleFont(ctx: Context, axis: AxisModel): Font {
  return fontFor(ctx, mergeTextStyles(ctx.model.textStyle, axis.title?.style), { bold: true, opacity: LABEL_OPACITY })
}

/** The space an axis's labels and title take beside the plot. */
function measureAxis(ctx: Context, group: AxisGroup, placed: PlacedAxis, length: number, maxThickness: number): number {
  if (placed.visible) {
    if (placed.role === 'category') placed.labels = arrangeCategoryLabels(ctx, group, length, maxThickness)
    else placed.scale = computeAxisScale(ctx, group, placed, length, axisFont(ctx, placed.axis))
  }
  return labelSpace(ctx, placed) + axisTitleThickness(ctx, placed.axis)
}

function tickLength(ctx: Context, axis: AxisModel): number {
  return axis.majorTickMark === 'out' || axis.majorTickMark === 'cross' ? 3 * ctx.pt : 0
}

/** Distance from the plot edge to the outside of the axis labels. */
function labelSpace(ctx: Context, placed: PlacedAxis): number {
  if (!placed.visible) return 0
  const font = axisFont(ctx, placed.axis)
  const gap = font.sizePx * 0.45 + tickLength(ctx, placed.axis)
  if (placed.labels) return placed.labels.leafThickness + placed.labels.levelThickness + gap
  if (!placed.vertical || !placed.scale) return lineHeight(font) + gap
  const widest = Math.max(0, maxOf(placed.scale.ticks.map((value) => textWidth(formatNumber(value, placed.format, { date1904: ctx.model.date1904 }), font))))
  return widest + gap
}

/** Which side of the plot an axis's labels go: where the crossing axis puts it, or forced high/low. */
function axisSide(placed: PlacedAxis, crossing: PlacedAxis): Side {
  const crossingReversed = crossing.axis.reversed
  const lowSide: Side = placed.vertical ? (crossingReversed ? 'right' : 'left') : crossingReversed ? 'top' : 'bottom'
  const highSide: Side = lowSide === 'left' ? 'right' : lowSide === 'right' ? 'left' : lowSide === 'top' ? 'bottom' : 'top'
  if (placed.axis.tickLabelPosition === 'low') return lowSide
  if (placed.axis.tickLabelPosition === 'high') return highSide
  const crosses = placed.axis.crosses
  if (crosses === 'max') return highSide
  if (typeof crosses === 'number' && crossing.scale && crosses >= crossing.scale.max) return highSide
  return lowSide
}

function layoutAxes(ctx: Context, groups: AxisGroup[], area: Box): Box {
  const manual = ctx.model.plotLayout
  const outer = manual ? layoutBox(ctx, manual, area) : area
  const placedAxes = groups.flatMap((group) => [
    { group, placed: group.base, crossing: group.measure },
    { group, placed: group.measure, crossing: group.base },
  ])
  for (const group of groups) {
    const firstSeries = group.plots[0]?.series[0]
    group.base.format = group.xy ? axisFormat(group.base.axis, firstSeries, false, 'x') : undefined
    group.measure.format = axisFormat(group.measure.axis, firstSeries, group.valueRange.exact, 'y')
  }
  // Rough scales first, so crossings at "max" and label widths are known.
  for (const { group, placed } of placedAxes) {
    if (placed.role === 'value') placed.scale = computeAxisScale(ctx, group, placed, placed.vertical ? outer.h : outer.w, axisFont(ctx, placed.axis))
  }
  for (const { placed, crossing } of placedAxes) placed.side = axisSide(placed, crossing)

  const margins: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
  if (manual?.target !== 'inner') {
    // Axes running up the plot first: the widths they take decide how long the horizontal ones are.
    for (const { group, placed } of placedAxes.filter((entry) => entry.placed.vertical)) {
      margins[placed.side] += measureAxis(ctx, group, placed, outer.h * 0.85, outer.w * 0.35)
    }
    const width = Math.max(1, outer.w - margins.left - margins.right)
    for (const { group, placed } of placedAxes.filter((entry) => !entry.placed.vertical)) {
      margins[placed.side] += measureAxis(ctx, group, placed, width, outer.h * 0.4)
    }
    // Labels centered on the plot's edge ticks overhang it by half a line or half a label.
    const anyFont = axisFont(ctx, groups[0]!.measure.axis)
    const verticalValues = placedAxes.some((entry) => entry.placed.vertical && entry.placed.role === 'value' && entry.placed.visible)
    const horizontalValues = placedAxes.some((entry) => !entry.placed.vertical && entry.placed.role === 'value' && entry.placed.visible)
    if (verticalValues) {
      margins.top = Math.max(margins.top, anyFont.sizePx * 0.6)
      margins.bottom = Math.max(margins.bottom, anyFont.sizePx * 0.6)
    }
    if (horizontalValues) margins.right = Math.max(margins.right, anyFont.sizePx * 1.5)
    // Category labels on the plot's edges (areas, midCat lines) overhang it by half their width.
    for (const { group, placed } of placedAxes) {
      if (placed.role !== 'category' || placed.vertical || group.between || !placed.labels || placed.labels.rotation) continue
      const font = axisFont(ctx, placed.axis)
      const widths = placed.labels.lines.map((lines) => Math.max(0, maxOf(lines.map((line) => textWidth(line, font)))))
      const [startSide, endSide]: [Side, Side] = placed.axis.reversed ? ['right', 'left'] : ['left', 'right']
      margins[startSide] = Math.max(margins[startSide], (widths[0] ?? 0) / 2)
      margins[endSide] = Math.max(margins[endSide], (widths[widths.length - 1] ?? 0) / 2)
    }
    // Never let labels squeeze the plot to nothing.
    for (const [first, second, total] of [['left', 'right', outer.w], ['top', 'bottom', outer.h]] as const) {
      const used = margins[first] + margins[second]
      if (used > total * 0.6) {
        margins[first] *= (total * 0.6) / used
        margins[second] *= (total * 0.6) / used
      }
    }
  }
  const inner: Box = {
    x: outer.x + margins.left,
    y: outer.y + margins.top,
    w: Math.max(1, outer.w - margins.left - margins.right),
    h: Math.max(1, outer.h - margins.top - margins.bottom),
  }
  // Final scales and labels for the real plot size.
  for (const { group, placed } of placedAxes) {
    const length = placed.vertical ? inner.h : inner.w
    if (placed.role === 'value') placed.scale = computeAxisScale(ctx, group, placed, length, axisFont(ctx, placed.axis))
    else if (placed.visible) placed.labels = arrangeCategoryLabels(ctx, group, length, placed.vertical ? outer.w * 0.35 : outer.h * 0.4)
  }
  return inner
}

/** Pixel position of `fraction` (0 at the axis start) along an axis inside the plot. */
function axisPosition(placed: PlacedAxis, inner: Box, fraction: number): number {
  const along = placed.axis.reversed ? 1 - fraction : fraction
  return placed.vertical ? inner.y + inner.h - along * inner.h : inner.x + along * inner.w
}

function valuePosition(placed: PlacedAxis, inner: Box, value: number, clampToPlot = true): number {
  const fraction = scaleFraction(placed.scale!, value)
  return axisPosition(placed, inner, clampToPlot ? Math.min(1.02, Math.max(-0.02, fraction)) : fraction)
}

/** Fraction along the category axis of category `index`'s center (or tick, for midCat). */
function categoryFraction(group: AxisGroup, index: number): number {
  const count = Math.max(1, group.categoryCount)
  if (group.between) return (index + 0.5) / count
  return count === 1 ? 0.5 : index / (count - 1)
}

function drawAxisChart(ctx: Context, area: Box, plots: PlotModel[]): void {
  const groups = buildAxisGroups(ctx, plots)
  const inner = layoutAxes(ctx, groups, area)
  drawPlotAreaFill(ctx, inner)
  const primary = groups[0]!
  drawGridlines(ctx, primary, inner)
  const clipId = `${ctx.idPrefix}clip${ctx.nextId++}`
  // Series may run past a fixed axis range; Office clips them to the plot.
  ctx.defs.push(`<clipPath id="${clipId}"><rect x="${num(inner.x - 1)}" y="${num(inner.y - 1)}" width="${num(inner.w + 2)}" height="${num(inner.h + 2)}"/></clipPath>`)
  ctx.layers.series.push(`<g clip-path="url(#${clipId})">`)
  // Areas go behind bars, and bars behind lines and markers, as in Office combination charts.
  const order: PlotModel['type'][] = ['area', 'bar', 'bubble', 'line', 'scatter']
  for (const type of order) {
    for (const group of groups) {
      for (const plot of group.plots) {
        if (plot.type !== type) continue
        if (plot.type === 'bar') drawBarPlot(ctx, group, plot, inner)
        else if (plot.type === 'line') drawLinePlot(ctx, group, plot, inner)
        else if (plot.type === 'area') drawAreaPlot(ctx, group, plot, inner)
        else if (plot.type === 'scatter') drawScatterPlot(ctx, group, plot, inner)
        else if (plot.type === 'bubble') drawBubblePlot(ctx, group, plot, inner)
      }
    }
  }
  ctx.layers.series.push('</g>')
  for (const group of groups) {
    drawAxis(ctx, group, group.base, group.measure, inner)
    drawAxis(ctx, group, group.measure, group.base, inner)
  }
}

function drawGridlines(ctx: Context, group: AxisGroup, inner: Box): void {
  for (const placed of [group.base, group.measure]) {
    const out = ctx.layers.grid
    const perpendicular = (position: number): string =>
      placed.vertical ? `M${num(inner.x)} ${num(position)}H${num(inner.x + inner.w)}` : `M${num(position)} ${num(inner.y)}V${num(inner.y + inner.h)}`
    const positions = (minor: boolean): number[] => {
      if (placed.role === 'category') {
        if (minor) return []
        const count = Math.max(1, group.categoryCount)
        const edges = group.between ? count + 1 : count
        return Array.from({ length: edges }, (_, index) => axisPosition(placed, inner, group.between ? index / count : categoryFraction(group, index)))
      }
      const scale = placed.scale!
      if (!minor) return scale.ticks.map((tick) => valuePosition(placed, inner, tick, false))
      const result: number[] = []
      if (scale.logBase) return result
      const step = scale.majorUnit / 5
      for (let value = scale.min + step, index = 0; value < scale.max - step / 2 && index < 1000; value += step, index++) result.push(valuePosition(placed, inner, value, false))
      return result
    }
    for (const [lines, minor] of [[placed.axis.minorGridlines, true], [placed.axis.majorGridlines, false]] as const) {
      if (!lines) continue
      const { stroke, opacity } = themeLine(ctx, lines.line, minor ? GRIDLINE_OPACITY * 0.6 : GRIDLINE_OPACITY)
      if (!stroke) continue
      const path = positions(minor).map(perpendicular).join('')
      if (path) out.push(`<path d="${path}" fill="none"${strokeAttributes(stroke, opacity)}/>`)
    }
  }
}

function drawAxis(ctx: Context, group: AxisGroup, placed: PlacedAxis, crossing: PlacedAxis, inner: Box): void {
  const axis = placed.axis
  if (axis.deleted) return
  const out = ctx.layers.axes
  const font = axisFont(ctx, axis)
  // The axis line sits where it crosses the other axis: a category axis at zero, a value axis at
  // the first (or last) category.
  const linePosition = crossing.role === 'value' && crossing.scale
    ? valuePosition(crossing, inner, crossingValue(crossing.scale, axis.crosses))
    : placed.side === 'left' ? inner.x : placed.side === 'right' ? inner.x + inner.w : placed.side === 'top' ? inner.y : inner.y + inner.h
  const autoLine = placed.role === 'category' || (group.xy && placed === group.base)
  const { stroke, opacity } = themeLine(ctx, axis.line ?? (autoLine ? undefined : { fill: { kind: 'none' } }), AXIS_LINE_OPACITY)
  if (stroke) {
    const path = placed.vertical ? `M${num(linePosition)} ${num(inner.y)}V${num(inner.y + inner.h)}` : `M${num(inner.x)} ${num(linePosition)}H${num(inner.x + inner.w)}`
    out.push(`<path d="${path}" fill="none"${strokeAttributes(stroke, opacity)}/>`)
    drawTickMarks(ctx, group, placed, inner, linePosition, stroke, opacity)
  }
  const gap = font.sizePx * 0.45 + tickLength(ctx, axis)
  const edge = placed.side === 'left' ? inner.x - gap : placed.side === 'right' ? inner.x + inner.w + gap : placed.side === 'top' ? inner.y - gap : inner.y + inner.h + gap
  if (placed.visible) {
    if (placed.role === 'value') drawValueLabels(ctx, placed, inner, edge, font)
    else if (placed.labels) drawCategoryLabels(ctx, group, placed, inner, edge, font)
  }
  drawAxisTitle(ctx, placed, inner)
}

function drawTickMarks(ctx: Context, group: AxisGroup, placed: PlacedAxis, inner: Box, linePosition: number, stroke: Stroke, opacity: number): void {
  const mark = placed.axis.majorTickMark
  if (mark === 'none') return
  const length = 3 * ctx.pt
  const outward = placed.side === 'left' || placed.side === 'top' ? -1 : 1
  const [from, to] = mark === 'out' ? [0, length * outward] : mark === 'in' ? [-length * outward, 0] : [-length, length]
  const fractions =
    placed.role === 'category'
      ? Array.from({ length: (group.between ? group.categoryCount + 1 : group.categoryCount) }, (_, index) => (group.between ? index / Math.max(1, group.categoryCount) : categoryFraction(group, index)))
      : placed.scale!.ticks.map((value) => scaleFraction(placed.scale!, value))
  const path = fractions
    .map((fraction) => {
      const along = axisPosition(placed, inner, fraction)
      return placed.vertical ? `M${num(linePosition + from)} ${num(along)}H${num(linePosition + to)}` : `M${num(along)} ${num(linePosition + from)}V${num(linePosition + to)}`
    })
    .join('')
  if (path) ctx.layers.axes.push(`<path d="${path}" fill="none"${strokeAttributes(stroke, opacity)}/>`)
}

function drawValueLabels(ctx: Context, placed: PlacedAxis, inner: Box, edge: number, font: Font): void {
  const scale = placed.scale!
  for (const tick of scale.ticks) {
    const text = formatNumber(tick, placed.format, { date1904: ctx.model.date1904 })
    const along = valuePosition(placed, inner, tick, false)
    if (placed.vertical) {
      ctx.layers.axes.push(textSvg(text, edge, along, font, placed.side === 'left' ? 'end' : 'start'))
    } else {
      const y = placed.side === 'top' ? edge - lineHeight(font) / 2 : edge + lineHeight(font) / 2
      ctx.layers.axes.push(textSvg(text, along, y, font, 'middle'))
    }
  }
}

function drawCategoryLabels(ctx: Context, group: AxisGroup, placed: PlacedAxis, inner: Box, edge: number, font: Font): void {
  const labels = placed.labels!
  const height = lineHeight(font)
  const out = ctx.layers.axes
  labels.lines.forEach((lines, index) => {
    if (!lines.length) return
    const along = axisPosition(placed, inner, categoryFraction(group, index))
    if (placed.vertical) {
      out.push(textBlockSvg(lines, edge, along, font, placed.side === 'left' ? 'end' : 'start'))
    } else if (labels.rotation) {
      // Rotated labels hang from their end at the tick, like Office's slanted labels.
      const y = placed.side === 'top' ? edge - height / 2 : edge + height / 2
      const anchor: Anchor = (labels.rotation < 0) === (placed.side === 'bottom') ? 'end' : 'start'
      out.push(textSvg(lines[0] ?? '', along, y, font, anchor, labels.rotation))
    } else {
      const blockHeight = lines.length * height
      const y = placed.side === 'top' ? edge - blockHeight / 2 : edge + blockHeight / 2
      out.push(textBlockSvg(lines, along, y, font, 'middle'))
    }
  })
  drawOuterCategoryLevels(ctx, group, placed, inner, edge, font)
}

/** Group labels of multi-level categories, each centered under the span it covers. */
function drawOuterCategoryLevels(ctx: Context, group: AxisGroup, placed: PlacedAxis, inner: Box, edge: number, font: Font): void {
  const labels = placed.labels!
  if (!labels.outerLevels.length) return
  const out = ctx.layers.axes
  const { stroke, opacity } = themeLine(ctx, placed.axis.line, AXIS_LINE_OPACITY)
  const count = Math.max(1, group.categoryCount)
  const levelSize = labels.outerLevels.length ? labels.levelThickness / labels.outerLevels.length : 0
  const direction = placed.side === 'left' || placed.side === 'top' ? -1 : 1
  labels.outerLevels.forEach((level, levelIndex) => {
    const start = edge + direction * (labels.leafThickness + levelIndex * levelSize)
    const starts = level.flatMap((label, index) => (label !== undefined ? [index] : []))
    if (!starts.length) starts.push(0)
    starts.forEach((first, position) => {
      const next = starts[position + 1] ?? count
      const from = axisPosition(placed, inner, first / count)
      const to = axisPosition(placed, inner, next / count)
      const text = truncateText(level[first] ?? '', Math.abs(to - from) * (placed.vertical ? 4 : 0.95), font.sizePx, font.bold)
      const center = start + (direction * levelSize) / 2
      if (placed.vertical) out.push(textSvg(text, center, (from + to) / 2, font, 'middle', -90))
      else out.push(textSvg(text, (from + to) / 2, center, font, 'middle'))
      if (stroke) {
        // Separators between groups run across this level and the leaf labels.
        const outerEdge = start + direction * levelSize
        const separator = placed.vertical ? `M${num(edge)} ${num(from)}H${num(outerEdge)}` : `M${num(from)} ${num(edge - direction * 2)}V${num(outerEdge)}`
        out.push(`<path d="${separator}" fill="none"${strokeAttributes(stroke, opacity)}/>`)
      }
    })
  })
}

function drawAxisTitle(ctx: Context, placed: PlacedAxis, inner: Box): void {
  const title = placed.axis.title
  if (!title) return
  const font = axisTitleFont(ctx, placed.axis)
  const lines = title.lines ?? ['Axis Title']
  const offset = labelSpace(ctx, placed) + axisTitleThickness(ctx, placed.axis) / 2
  const out = ctx.layers.labels
  switch (placed.side) {
    case 'left':
      out.push(textBlockSvg(lines, inner.x - offset, inner.y + inner.h / 2, font, 'middle', -90))
      break
    case 'right':
      out.push(textBlockSvg(lines, inner.x + inner.w + offset, inner.y + inner.h / 2, font, 'middle', 90))
      break
    case 'top':
      out.push(textBlockSvg(lines, inner.x + inner.w / 2, inner.y - offset, font, 'middle'))
      break
    case 'bottom':
      out.push(textBlockSvg(lines, inner.x + inner.w / 2, inner.y + inner.h + offset, font, 'middle'))
  }
}

// --- Bars --------------------------------------------------------------------------------------

function drawBarPlot(ctx: Context, group: AxisGroup, plot: Extract<PlotModel, { type: 'bar' }>, inner: Box): void {
  const stacks = stackedValues(plot, 'gap')
  const count = Math.max(1, group.categoryCount)
  const clusters = isStacked(plot) ? 1 : Math.max(1, plot.series.length)
  const overlap = plot.overlap / 100
  const gap = plot.gapWidth / 100
  // In slot-width units: bars of width w, each shifted w(1 - overlap), plus a gap of w × gapWidth.
  const barWidth = 1 / count / (clusters - (clusters - 1) * overlap + gap)
  const step = barWidth * (1 - overlap)
  const clusterWidth = barWidth + step * (clusters - 1)
  const crossValue = crossingValue(group.measure.scale!, group.base.axis.crosses)
  const percent = isPercent(plot)
  const labelPosition: DataLabelPosition = isStacked(plot) ? 'ctr' : 'outEnd'
  plot.series.forEach((series, seriesIndex) => {
    const cluster = isStacked(plot) ? 0 : seriesIndex
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    const values = stacks[seriesIndex] ?? []
    values.forEach((point, index) => {
      if (!Number.isFinite(point.to) || index >= count) return
      const slotStart = index / count + (1 / count - clusterWidth) / 2 + cluster * step
      const a = axisPosition(group.base, inner, slotStart)
      const b = axisPosition(group.base, inner, slotStart + barWidth)
      const from = isStacked(plot) ? point.from : crossValue
      const v0 = valuePosition(group.measure, inner, from)
      const v1 = valuePosition(group.measure, inner, point.to)
      const box: Box = group.horizontal
        ? { x: Math.min(v0, v1), y: Math.min(a, b), w: Math.abs(v1 - v0), h: Math.abs(b - a) }
        : { x: Math.min(a, b), y: Math.min(v0, v1), w: Math.abs(b - a), h: Math.abs(v1 - v0) }
      const pointStyle = series.points.get(index)?.style
      const fill = fillPaint(ctx, pointStyle?.fill ?? series.style.fill, pointColor(ctx, plot, series, index))
      const stroke = strokeFor(ctx, pointStyle?.line ?? series.style.line, { widthPt: 0.75 })
      ctx.layers.series.push(`<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="${escapeXml(fill)}"${strokeAttributes(stroke)}/>`)
      const content: LabelContent = {
        value: point.raw,
        ...(group.categories ? { category: categoryLabel(group.categories, index, undefined, { date1904: ctx.model.date1904 }) } : {}),
        ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}),
        ...(percent ? { percent: point.to - point.from } : {}),
      }
      const label = dataLabelLines(ctx, labels, series, index, content)
      if (label) placeBarLabel(ctx, group, box, v0, v1, label.lines, label.style, label.position ?? labelPosition)
    })
  })
}

function placeBarLabel(ctx: Context, group: AxisGroup, box: Box, base: number, end: number, lines: string[], style: TextStyle, position: DataLabelPosition): void {
  const font = dataLabelFont(ctx, style)
  const blockHeight = lines.length * lineHeight(font)
  const blockWidth = maxOf(lines.map((line) => textWidth(line, font)))
  const direction = end >= base ? 1 : -1
  const pad = font.sizePx * 0.3
  if (group.horizontal) {
    const y = box.y + box.h / 2
    const half = blockWidth / 2
    const x =
      position === 'inBase' ? base + direction * (pad + half)
      : position === 'inEnd' ? end - direction * (pad + half)
      : position === 'ctr' ? (base + end) / 2
      : end + direction * (pad + half)
    drawDataLabel(ctx, lines, style, x, y, 'middle')
    return
  }
  // Pixel y grows downward, so "towards the end" is the sign of end - base.
  const x = box.x + box.w / 2
  const half = blockHeight / 2
  const y =
    position === 'inBase' ? base + direction * (pad + half)
    : position === 'inEnd' ? end - direction * (pad + half)
    : position === 'ctr' ? (base + end) / 2
    : end + direction * (pad + half)
  drawDataLabel(ctx, lines, style, x, y, 'middle')
}

// --- Lines -------------------------------------------------------------------------------------

/** Splits points into drawable runs at missing values (unless blanks are spanned). */
function segmentsOf(points: (Point | undefined)[], span: boolean): Point[][] {
  const segments: Point[][] = []
  let current: Point[] = []
  for (const point of points) {
    if (point) current.push(point)
    else if (!span && current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

function drawLinePlot(ctx: Context, group: AxisGroup, plot: Extract<PlotModel, { type: 'line' }>, inner: Box): void {
  const stacks = stackedValues(plot, ctx.model.dispBlanksAs)
  const percent = isPercent(plot)
  plot.series.forEach((series, seriesIndex) => {
    const color = seriesColor(ctx, series)
    const values = stacks[seriesIndex] ?? []
    const points = values.map((point, index) =>
      Number.isFinite(point.to) && index < group.categoryCount
        ? group.horizontal
          ? { x: valuePosition(group.measure, inner, point.to), y: axisPosition(group.base, inner, categoryFraction(group, index)) }
          : { x: axisPosition(group.base, inner, categoryFraction(group, index)), y: valuePosition(group.measure, inner, point.to) }
        : undefined,
    )
    const stroke = seriesLineStroke(ctx, plot, series, color)
    if (stroke) {
      const path = segmentsOf(points, ctx.model.dispBlanksAs === 'span').map((segment) => linePath(segment, series.smooth)).join('')
      if (path) ctx.layers.series.push(`<path d="${path}" fill="none" stroke-linejoin="round" stroke-linecap="round"${strokeAttributes(stroke)}/>`)
    }
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    points.forEach((point, index) => {
      if (!point) return
      const marker = markerFor(ctx, plot, series, index, color)
      if (marker) ctx.layers.series.push(markerSvg(marker, point.x, point.y))
      const value = values[index]!
      const label = dataLabelLines(ctx, labels, series, index, {
        value: value.raw,
        ...(group.categories ? { category: categoryLabel(group.categories, index, undefined, { date1904: ctx.model.date1904 }) } : {}),
        ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}),
        ...(percent ? { percent: value.to - value.from } : {}),
      })
      if (label) placePointLabel(ctx, point, marker?.sizePx ?? 0, label.lines, label.style, label.position ?? 'r')
    })
  })
}

function placePointLabel(ctx: Context, point: Point, markerSize: number, lines: string[], style: TextStyle, position: DataLabelPosition): void {
  const font = dataLabelFont(ctx, style)
  const offset = markerSize / 2 + font.sizePx * 0.3
  const blockHeight = lines.length * lineHeight(font)
  switch (position) {
    case 't':
    case 'outEnd':
      drawDataLabel(ctx, lines, style, point.x, point.y - offset - blockHeight / 2, 'middle')
      break
    case 'b':
    case 'inBase':
      drawDataLabel(ctx, lines, style, point.x, point.y + offset + blockHeight / 2, 'middle')
      break
    case 'l':
      drawDataLabel(ctx, lines, style, point.x - offset, point.y, 'end')
      break
    case 'ctr':
    case 'bestFit':
    case 'inEnd':
      drawDataLabel(ctx, lines, style, point.x, point.y, 'middle')
      break
    default:
      drawDataLabel(ctx, lines, style, point.x + offset, point.y, 'start')
  }
}

// --- Areas -------------------------------------------------------------------------------------

function drawAreaPlot(ctx: Context, group: AxisGroup, plot: Extract<PlotModel, { type: 'area' }>, inner: Box): void {
  const stacks = stackedValues(plot, 'zero')
  const crossValue = crossingValue(group.measure.scale!, group.base.axis.crosses)
  const stacked = isStacked(plot)
  const toPoint = (index: number, value: number): Point => {
    const along = axisPosition(group.base, inner, categoryFraction(group, index))
    const across = valuePosition(group.measure, inner, value)
    return group.horizontal ? { x: across, y: along } : { x: along, y: across }
  }
  plot.series.forEach((series, seriesIndex) => {
    const values = (stacks[seriesIndex] ?? []).slice(0, group.categoryCount)
    if (!values.length) return
    const top = values.map((point, index) => toPoint(index, Number.isFinite(point.to) ? point.to : stacked ? point.from : crossValue))
    const bottom = values.map((point, index) => toPoint(index, stacked && Number.isFinite(point.from) ? point.from : crossValue)).reverse()
    const outline = [...top, ...bottom]
    const path = linePath(outline, false) + 'Z'
    const fill = fillPaint(ctx, series.style.fill, seriesColor(ctx, series))
    const stroke = strokeFor(ctx, series.style.line, { widthPt: 0.75 })
    ctx.layers.series.push(`<path d="${path}" fill="${escapeXml(fill)}"${strokeAttributes(stroke)}/>`)
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    values.forEach((point, index) => {
      const label = dataLabelLines(ctx, labels, series, index, {
        value: point.raw,
        ...(group.categories ? { category: categoryLabel(group.categories, index, undefined, { date1904: ctx.model.date1904 }) } : {}),
        ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}),
      })
      if (!label || !Number.isFinite(point.to)) return
      const middle = toPoint(index, stacked ? (point.from + point.to) / 2 : (crossValue + point.to) / 2)
      drawDataLabel(ctx, label.lines, label.style, middle.x, middle.y, 'middle')
    })
  })
}

// --- Scatter and bubble ------------------------------------------------------------------------

function xyPoint(group: AxisGroup, inner: Box, x: number, y: number): Point {
  return { x: valuePosition(group.base, inner, x), y: valuePosition(group.measure, inner, y) }
}

function drawScatterPlot(ctx: Context, group: AxisGroup, plot: Extract<PlotModel, { type: 'scatter' }>, inner: Box): void {
  plot.series.forEach((series) => {
    const color = seriesColor(ctx, series)
    const points = series.values.values.map((y, index) => {
      const x = xValue(series, index)
      return y === undefined || x === undefined ? undefined : xyPoint(group, inner, x, y)
    })
    const stroke = seriesLineStroke(ctx, plot, series, color)
    if (stroke) {
      const smooth = series.smooth || plot.style === 'smooth' || plot.style === 'smoothMarker'
      const path = segmentsOf(points, ctx.model.dispBlanksAs === 'span').map((segment) => linePath(segment, smooth)).join('')
      if (path) ctx.layers.series.push(`<path d="${path}" fill="none" stroke-linejoin="round" stroke-linecap="round"${strokeAttributes(stroke)}/>`)
    }
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    points.forEach((point, index) => {
      if (!point) return
      const marker = markerFor(ctx, plot, series, index, color)
      if (marker) ctx.layers.series.push(markerSvg(marker, point.x, point.y))
      const label = dataLabelLines(ctx, labels, series, index, {
        value: series.values.values[index]!,
        ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}),
        category: series.xValues ? formatNumber(xValue(series, index)!, series.xValues.formatCode) : (series.xLabels?.labels[index] ?? String(index + 1)),
      })
      if (label) placePointLabel(ctx, point, marker?.sizePx ?? 0, label.lines, label.style, label.position ?? 'r')
    })
  })
}

function drawBubblePlot(ctx: Context, group: AxisGroup, plot: Extract<PlotModel, { type: 'bubble' }>, inner: Box): void {
  const sizes = plot.series.flatMap((series) => (series.bubbleSizes?.values ?? []).map((size) => Math.abs(size ?? 0)))
  const largest = Math.max(0, maxOf(sizes))
  // Office draws the largest bubble at a quarter of the plot's smaller side by default.
  const maxRadius = (Math.min(inner.w, inner.h) * 0.25 * (plot.bubbleScale / 100)) / 2
  const bubbles: { x: number; y: number; r: number; fill: string; stroke?: Stroke; label?: () => void }[] = []
  plot.series.forEach((series) => {
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    series.values.values.forEach((y, index) => {
      const x = xValue(series, index)
      const size = series.bubbleSizes?.values[index] ?? 1
      if (y === undefined || x === undefined || (size < 0 && !plot.showNegativeBubbles) || size === 0) return
      const ratio = largest ? Math.abs(size) / largest : 1
      const r = maxRadius * (plot.sizeRepresents === 'w' ? ratio : Math.sqrt(ratio))
      const point = xyPoint(group, inner, x, y)
      const pointStyle = series.points.get(index)?.style
      const fill = size < 0 ? 'none' : fillPaint(ctx, pointStyle?.fill ?? series.style.fill, pointColor(ctx, plot, series, index))
      const stroke = strokeFor(ctx, pointStyle?.line ?? series.style.line, { color: size < 0 ? pointColor(ctx, plot, series, index) : '#ffffff', widthPt: 0.75 })
      const label = dataLabelLines(ctx, labels, series, index, { value: y, bubbleSize: size, ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}) })
      bubbles.push({
        ...point,
        r,
        fill,
        ...(stroke ? { stroke } : {}),
        ...(label ? { label: () => drawDataLabel(ctx, label.lines, label.style, point.x, point.y, 'middle') } : {}),
      })
    })
  })
  // Big bubbles first, so small ones stay visible on top.
  bubbles.sort((a, b) => b.r - a.r)
  for (const bubble of bubbles) {
    ctx.layers.series.push(`<circle cx="${num(bubble.x)}" cy="${num(bubble.y)}" r="${num(bubble.r)}" fill="${escapeXml(bubble.fill)}"${strokeAttributes(bubble.stroke)}/>`)
    bubble.label?.()
  }
}

// ---------------------------------------------------------------------------------------------
// Pie and doughnut

function polar(cx: number, cy: number, radius: number, angleDeg: number): Point {
  const radians = (angleDeg * Math.PI) / 180
  return { x: cx + radius * Math.sin(radians), y: cy - radius * Math.cos(radians) }
}

function slicePath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = end - start
  if (sweep >= 359.999) {
    // A full circle cannot be one arc; draw two halves (and the hole the other way round).
    const ring = (r: number, clockwise: boolean): string =>
      `M${num(cx)} ${num(cy - r)}A${num(r)} ${num(r)} 0 1 ${clockwise ? 1 : 0} ${num(cx)} ${num(cy + r)}A${num(r)} ${num(r)} 0 1 ${clockwise ? 1 : 0} ${num(cx)} ${num(cy - r)}Z`
    return ring(outer, true) + (inner > 0 ? ring(inner, false) : '')
  }
  const large = sweep > 180 ? 1 : 0
  const o1 = polar(cx, cy, outer, start)
  const o2 = polar(cx, cy, outer, end)
  if (inner <= 0) return `M${num(cx)} ${num(cy)}L${num(o1.x)} ${num(o1.y)}A${num(outer)} ${num(outer)} 0 ${large} 1 ${num(o2.x)} ${num(o2.y)}Z`
  const i1 = polar(cx, cy, inner, end)
  const i2 = polar(cx, cy, inner, start)
  return `M${num(o1.x)} ${num(o1.y)}A${num(outer)} ${num(outer)} 0 ${large} 1 ${num(o2.x)} ${num(o2.y)}L${num(i1.x)} ${num(i1.y)}A${num(inner)} ${num(inner)} 0 ${large} 0 ${num(i2.x)} ${num(i2.y)}Z`
}

function drawPieChart(ctx: Context, box: Box, plot: Extract<PlotModel, { type: 'pie' }>): void {
  // A pie shows only its first series; a doughnut draws each series as a ring, first innermost.
  const rings = plot.holeSize > 0 ? plot.series : plot.series.slice(0, 1)
  if (!rings.length) return
  const categories = plotCategories(plot)
  const explosion = Math.max(0, maxOf(rings.flatMap((series) => [series.explosion, ...[...series.points.values()].map((point) => point.explosion ?? 0)])))
  const anyOutside = rings.some((series) => {
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    return !!labels && !labels.deleted && plot.holeSize === 0 && (labels.position === 'outEnd' || labels.position === 'bestFit' || labels.position === undefined) && (labels.showValue || labels.showPercent || labels.showCategory || labels.showSeriesName)
  })
  const labelFont = fontFor(ctx, plot.dataLabels?.style ?? ctx.model.textStyle, { opacity: DATA_LABEL_OPACITY })
  const labelRoom = anyOutside ? labelFont.sizePx * 3.2 : 0
  const radius = Math.max(4, (Math.min(box.w - labelRoom * 2, box.h - labelFont.sizePx * 2.4 * (anyOutside ? 1 : 0)) / 2) * 0.96 / (1 + explosion / 100))
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const hole = (plot.holeSize / 100) * radius
  const ringWidth = (radius - hole) / rings.length
  rings.forEach((series, ringIndex) => {
    const values = series.values.values.map((value) => Math.abs(value ?? 0))
    const total = values.reduce((sum, value) => sum + value, 0)
    if (!total) return
    const innerRadius = hole + ringIndex * ringWidth
    const outerRadius = innerRadius + ringWidth
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    let angle = plot.firstSliceAngle
    values.forEach((value, index) => {
      if (!value) return
      const sweep = (value / total) * 360
      const start = angle
      angle += sweep
      const point = series.points.get(index)
      const exploded = ((point?.explosion ?? series.explosion) / 100) * radius
      const offset = polar(0, 0, exploded, start + sweep / 2)
      const fill = fillPaint(ctx, point?.style.fill ?? series.style.fill, pointColor(ctx, plot, series, index))
      const stroke = strokeFor(ctx, point?.style.line ?? series.style.line, { color: '#ffffff', widthPt: 1 })
      const path = slicePath(cx + offset.x, cy + offset.y, outerRadius, innerRadius, start, start + sweep)
      ctx.layers.series.push(`<path d="${path}" fill="${escapeXml(fill)}" stroke-linejoin="round"${strokeAttributes(stroke)}/>`)
      const label = dataLabelLines(ctx, labels, series, index, {
        value: series.values.values[index]!,
        percent: value / total,
        ...(categories ? { category: categoryLabel(categories, index, undefined, { date1904: ctx.model.date1904 }) } : {}),
        ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}),
      })
      if (!label) return
      placePieLabel(ctx, { cx: cx + offset.x, cy: cy + offset.y, inner: innerRadius, outer: outerRadius, mid: start + sweep / 2, sweep }, plot.holeSize > 0, label)
    })
  })
}

function placePieLabel(
  ctx: Context,
  slice: { cx: number; cy: number; inner: number; outer: number; mid: number; sweep: number },
  doughnut: boolean,
  label: { lines: string[]; style: TextStyle; position?: DataLabelPosition },
): void {
  const font = dataLabelFont(ctx, label.style)
  const width = maxOf(label.lines.map((line) => textWidth(line, font)))
  const height = label.lines.length * lineHeight(font)
  let position = doughnut ? 'ctr' : (label.position ?? 'bestFit')
  if (position === 'bestFit') {
    // Inside when the label fits in the slice at two thirds of the radius, else outside.
    const arc = ((slice.sweep * Math.PI) / 180) * slice.outer * 0.65
    position = arc > Math.min(width, height * 2) && slice.outer * 0.6 > width / 2 ? 'inEnd' : 'outEnd'
  }
  if (position === 'outEnd') {
    const anchorPoint = polar(slice.cx, slice.cy, slice.outer + font.sizePx * 0.5, slice.mid)
    const sin = Math.sin((slice.mid * Math.PI) / 180)
    const anchor: Anchor = sin > 0.15 ? 'start' : sin < -0.15 ? 'end' : 'middle'
    const cos = Math.cos((slice.mid * Math.PI) / 180)
    const y = anchorPoint.y - (anchor === 'middle' ? (cos > 0 ? height / 2 : -height / 2) : 0)
    drawDataLabel(ctx, label.lines, label.style, anchorPoint.x, y, anchor)
    return
  }
  const fraction = position === 'ctr' ? 0.5 : position === 'inBase' ? 0.25 : 0.68
  const radius = slice.inner + (slice.outer - slice.inner) * (doughnut ? 0.5 : fraction)
  const point = polar(slice.cx, slice.cy, radius, slice.mid)
  drawDataLabel(ctx, label.lines, label.style, point.x, point.y, 'middle')
}

// ---------------------------------------------------------------------------------------------
// Radar

function drawRadarChart(ctx: Context, box: Box, plot: Extract<PlotModel, { type: 'radar' }>): void {
  const categories = plotCategories(plot)
  const count = Math.max(3, categories?.count ?? 0, maxOf(plot.series.map((series) => series.values.values.length)))
  const [catId = '', valId = ''] = plot.axisIds
  const catAxis = ctx.model.axes.find((axis) => axis.id === catId) ?? syntheticAxis(catId, 'cat', 'b', true)
  const valAxis = ctx.model.axes.find((axis) => axis.id === valId) ?? syntheticAxis(valId, 'val', 'l', true)
  const catFont = axisFont(ctx, catAxis)
  const texts = Array.from({ length: count }, (_, index) => (categories ? categoryLabel(categories, index, undefined, { date1904: ctx.model.date1904 }) : String(index + 1)))
  const showCategories = !catAxis.deleted && catAxis.tickLabelPosition !== 'none'
  const labelWidth = showCategories ? Math.min(box.w * 0.25, Math.max(0, maxOf(texts.map((text) => textWidth(text, catFont))))) : 0
  const radius = Math.max(4, Math.min((box.w - labelWidth * 2) / 2 - catFont.sizePx, box.h / 2 - lineHeight(catFont) * 1.4))
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const values = plot.series.flatMap((series) => series.values.values.filter((value): value is number => value !== undefined))
  const min = values.length ? minOf(values) : 0
  const max = values.length ? maxOf(values) : 1
  const valFont = axisFont(ctx, valAxis)
  const format = axisFormat(valAxis, plot.series[0], false, 'y')
  const scale = computeScale({
    dataMin: Math.min(0, min),
    dataMax: max,
    maxIntervals: Math.max(2, Math.min(8, Math.floor(radius / (valFont.sizePx * 2)))),
    ...(valAxis.min !== undefined ? { min: valAxis.min } : {}),
    ...(valAxis.max !== undefined ? { max: valAxis.max } : {}),
    ...(valAxis.majorUnit !== undefined ? { majorUnit: valAxis.majorUnit } : {}),
  })
  const angleOf = (index: number): number => (index / count) * 360
  const radiusOf = (value: number): number => Math.max(0, Math.min(1.05, scaleFraction(scale, value))) * radius
  const out = ctx.layers

  // Web: one polygon per tick, and a spoke per category.
  const grid = themeLine(ctx, valAxis.majorGridlines?.line, GRIDLINE_OPACITY)
  if (grid.stroke && valAxis.majorGridlines) {
    const path = scale.ticks
      .filter((tick) => tick > scale.min)
      .map((tick) => linePath(Array.from({ length: count }, (_, index) => polar(cx, cy, radiusOf(tick), angleOf(index))), false) + 'Z')
      .join('')
    out.grid.push(`<path d="${path}" fill="none"${strokeAttributes(grid.stroke, grid.opacity)}/>`)
  }
  const spokes = themeLine(ctx, catAxis.majorGridlines?.line ?? catAxis.line, GRIDLINE_OPACITY)
  if (spokes.stroke) {
    const path = Array.from({ length: count }, (_, index) => {
      const end = polar(cx, cy, radius, angleOf(index))
      return `M${num(cx)} ${num(cy)}L${num(end.x)} ${num(end.y)}`
    }).join('')
    out.grid.push(`<path d="${path}" fill="none"${strokeAttributes(spokes.stroke, spokes.opacity)}/>`)
  }
  if (showCategories) {
    texts.forEach((text, index) => {
      const angle = angleOf(index)
      const sin = Math.sin((angle * Math.PI) / 180)
      const cos = Math.cos((angle * Math.PI) / 180)
      const point = polar(cx, cy, radius + catFont.sizePx * 0.6, angle)
      const anchor: Anchor = sin > 0.2 ? 'start' : sin < -0.2 ? 'end' : 'middle'
      const y = point.y - (anchor === 'middle' ? (cos > 0 ? lineHeight(catFont) / 2 : -lineHeight(catFont) / 2) : 0)
      out.axes.push(textSvg(truncateText(text, labelWidth || box.w / 3, catFont.sizePx, catFont.bold), point.x, y, catFont, anchor))
    })
  }
  if (!valAxis.deleted && valAxis.tickLabelPosition !== 'none') {
    for (const tick of scale.ticks) {
      out.axes.push(textSvg(formatNumber(tick, format, { date1904: ctx.model.date1904 }), cx - valFont.sizePx * 0.4, cy - radiusOf(tick), valFont, 'end'))
    }
  }

  plot.series.forEach((series) => {
    const color = seriesColor(ctx, series)
    const points = Array.from({ length: count }, (_, index) => {
      const value = series.values.values[index]
      return value === undefined ? undefined : polar(cx, cy, radiusOf(value), angleOf(index))
    })
    const present = points.filter((point): point is Point => !!point)
    if (plot.style === 'filled') {
      const fill = fillPaint(ctx, series.style.fill, color)
      const stroke = strokeFor(ctx, series.style.line, { widthPt: 0.75 })
      if (present.length) out.series.push(`<path d="${linePath(present, false)}Z" fill="${escapeXml(fill)}"${strokeAttributes(stroke)}/>`)
    } else {
      const stroke = seriesLineStroke(ctx, plot, series, color)
      const closed = points[0] && points[points.length - 1] ? [...points, points[0]] : points
      const path = segmentsOf(closed, false).map((segment) => linePath(segment, false)).join('')
      if (stroke && path) out.series.push(`<path d="${path}" fill="none" stroke-linejoin="round"${strokeAttributes(stroke)}/>`)
    }
    const labels = effectiveDataLabels(plot.dataLabels, series.dataLabels)
    points.forEach((point, index) => {
      if (!point) return
      const marker = plot.style === 'filled' ? undefined : markerFor(ctx, plot, series, index, color)
      if (marker) out.series.push(markerSvg(marker, point.x, point.y))
      const label = dataLabelLines(ctx, labels, series, index, {
        value: series.values.values[index]!,
        category: texts[index] ?? '',
        ...(series.values.formatCode ? { valueFormat: series.values.formatCode } : {}),
      })
      if (label) placePointLabel(ctx, point, marker?.sizePx ?? 0, label.lines, label.style, label.position ?? 't')
    })
  })
}
