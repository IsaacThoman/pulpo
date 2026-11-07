import { pushAll } from '../../../collections.js'
import type { Element } from '@xmldom/xmldom'
import { LiveFormatError } from '../../live-format.js'
import { parseXml } from '../../ooxml/package.js'

/**
 * DrawingML charts (`c:chartSpace`, the part behind a graphic frame's `c:chart`) read into a plain
 * model for rendering. Only the cached data written into the chart part is used — never the
 * embedded workbook — so this matches what Office shows before anyone edits the data.
 *
 * Colors stay as their DrawingML elements: resolving `a:schemeClr` needs the deck's theme, which
 * the renderer gets from its caller.
 */

export type { Element }

const CHART_NAMESPACES = new Set(['http://schemas.openxmlformats.org/drawingml/2006/chart', 'http://purl.oclc.org/ooxml/drawingml/chart'])
const DRAWING_NAMESPACES = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'])
const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const C14_NS = 'http://schemas.microsoft.com/office/drawing/2007/8/2/chart'
const CHARTEX_NS = 'http://schemas.microsoft.com/office/drawing/2014/chartex'

/** Work limits against hostile or absurd files. */
export const CHART_LIMITS = {
  maxSeries: 50,
  /** Data points across every series of a chart. */
  maxPoints: 10_000,
  /** Characters of chart XML. */
  maxXmlLength: 20_000_000,
} as const

export type ChartFill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Element }
  | { kind: 'gradient'; stops: { position: number; color: Element }[]; angleDeg: number }
  /** Patterns are drawn in their foreground color. */
  | { kind: 'pattern'; color: Element }

export interface ChartLine {
  fill?: ChartFill
  widthPt?: number
  /** `a:prstDash` value: solid, dash, sysDot, … */
  dash?: string
}

/** A `c:spPr`: what is absent falls back to the automatic style. */
export interface ShapeStyle {
  fill?: ChartFill
  line?: ChartLine
}

export interface TextStyle {
  sizePt?: number
  bold?: boolean
  italic?: boolean
  /** The `a:solidFill` of the run properties. */
  color?: Element
  /** A typeface, or `+mn-lt`/`+mj-lt` for the theme fonts. */
  typeface?: string
  /** Explicit text rotation in degrees (from `a:bodyPr rot`); undefined for automatic. */
  rotationDeg?: number
}

/** A `c:manualLayout` in edge mode, as fractions of the chart. */
export interface ManualLayout {
  x: number
  y: number
  w?: number
  h?: number
  /** For the plot area: whether the box excludes (`inner`) or includes (`outer`) axis labels. */
  target: 'inner' | 'outer'
}

export interface ChartTitleModel {
  /** One entry per line; undefined for an automatic title (the series name, or "Chart Title"). */
  lines?: string[]
  style: TextStyle
  overlay: boolean
  layout?: ManualLayout
}

export type MarkerSymbol = 'auto' | 'none' | 'circle' | 'square' | 'diamond' | 'triangle' | 'x' | 'star' | 'plus' | 'dash' | 'dot' | 'picture'

export interface MarkerModel {
  symbol?: MarkerSymbol
  /** In points, 2-72. */
  size?: number
  style: ShapeStyle
}

export type DataLabelPosition = 'bestFit' | 'b' | 'ctr' | 'inBase' | 'inEnd' | 'l' | 'outEnd' | 'r' | 't'

export interface DataLabelOptions {
  showValue?: boolean
  showPercent?: boolean
  showCategory?: boolean
  showSeriesName?: boolean
  showBubbleSize?: boolean
  numberFormat?: string
  position?: DataLabelPosition
  separator?: string
  style: TextStyle
  shape: ShapeStyle
}

export interface DataLabelsModel extends DataLabelOptions {
  /** `c:delete`: no labels at all. */
  deleted: boolean
  /** Per-point overrides (`c:dLbl`). */
  points: Map<number, DataLabelPointModel>
}

export interface DataLabelPointModel extends Partial<DataLabelOptions> {
  deleted: boolean
  /** Custom text typed over the label, one entry per line. */
  lines?: string[]
}

export interface DataPointModel {
  style: ShapeStyle
  marker?: MarkerModel
  /** Pie slice explosion, percent of the radius. */
  explosion?: number
}

export interface CategoryData {
  count: number
  /** Leaf labels (the level next to the axis), or undefined where the cache has no point. */
  labels: (string | undefined)[]
  /** Numeric categories (dates, years) keep their numbers so the axis can format them. */
  numbers?: (number | undefined)[]
  formatCode?: string
  /** Outer levels of multi-level categories, innermost first; a label spans until the next. */
  outerLevels: (string | undefined)[][]
}

export interface NumberData {
  values: (number | undefined)[]
  formatCode?: string
}

export interface SeriesModel {
  /** `c:idx`: picks the automatic color. */
  index: number
  /** `c:order`: drawing and legend order. */
  order: number
  name: string
  style: ShapeStyle
  categories?: CategoryData
  /** Values, or Y values for scatter and bubble series. */
  values: NumberData
  xValues?: NumberData
  /** X values that are text: scatter charts then plot points 1, 2, 3, … */
  xLabels?: CategoryData
  bubbleSizes?: NumberData
  marker?: MarkerModel
  smooth: boolean
  explosion: number
  points: Map<number, DataPointModel>
  dataLabels?: DataLabelsModel
}

export type Grouping = 'standard' | 'clustered' | 'stacked' | 'percentStacked'

interface PlotBase {
  /** `c:axId` values, category (or X) axis first. */
  axisIds: string[]
  series: SeriesModel[]
  varyColors: boolean
  dataLabels?: DataLabelsModel
}

export interface BarPlot extends PlotBase {
  type: 'bar'
  direction: 'col' | 'bar'
  grouping: Grouping
  /** Gap between clusters, percent of a bar's width. */
  gapWidth: number
  /** Overlap of bars in a cluster, -100..100 percent. */
  overlap: number
}

export interface LinePlot extends PlotBase {
  type: 'line'
  grouping: Grouping
  /** `c:marker`: whether series without their own marker settings show markers. */
  markers: boolean
}

export interface AreaPlot extends PlotBase {
  type: 'area'
  grouping: Grouping
}

export interface PiePlot extends PlotBase {
  type: 'pie'
  /** Degrees clockwise from 12 o'clock. */
  firstSliceAngle: number
  /** Percent of the radius left empty in the middle; 0 for pies. */
  holeSize: number
}

export type ScatterStyle = 'line' | 'lineMarker' | 'marker' | 'none' | 'smooth' | 'smoothMarker'

export interface ScatterPlot extends PlotBase {
  type: 'scatter'
  style: ScatterStyle
}

export interface BubblePlot extends PlotBase {
  type: 'bubble'
  /** Percent of the default size of the largest bubble. */
  bubbleScale: number
  showNegativeBubbles: boolean
  sizeRepresents: 'area' | 'w'
}

export interface RadarPlot extends PlotBase {
  type: 'radar'
  style: 'standard' | 'marker' | 'filled'
}

export type PlotModel = BarPlot | LinePlot | AreaPlot | PiePlot | ScatterPlot | BubblePlot | RadarPlot

export interface AxisModel {
  id: string
  kind: 'cat' | 'val' | 'date' | 'ser'
  deleted: boolean
  reversed: boolean
  position: 'b' | 'l' | 'r' | 't'
  min?: number
  max?: number
  majorUnit?: number
  logBase?: number
  majorGridlines?: ShapeStyle
  minorGridlines?: ShapeStyle
  numberFormat?: { code: string; sourceLinked: boolean }
  majorTickMark: 'cross' | 'in' | 'none' | 'out'
  tickLabelPosition: 'high' | 'low' | 'nextTo' | 'none'
  crossAxisId?: string
  /** Where this axis crosses the other one, in the other axis's values. */
  crosses: 'autoZero' | 'min' | 'max' | number
  /** Value axes: whether categories sit between tick marks or on them. */
  crossBetween?: 'between' | 'midCat'
  tickLabelSkip?: number
  line?: ChartLine
  textStyle: TextStyle
  title?: ChartTitleModel
}

export interface LegendModel {
  position: 'b' | 'l' | 'r' | 't' | 'tr'
  overlay: boolean
  /** Indexes of entries the author deleted. */
  deletedEntries: Set<number>
  textStyle: TextStyle
  shape: ShapeStyle
  layout?: ManualLayout
}

export interface SupportedChartModel {
  unsupported: false
  title?: ChartTitleModel
  autoTitleDeleted: boolean
  plots: PlotModel[]
  axes: AxisModel[]
  legend?: LegendModel
  /** `c:style`, 1-48 (from `c14:style` when present). */
  style?: number
  date1904: boolean
  dispBlanksAs: 'gap' | 'span' | 'zero'
  /** The chart area (`c:chartSpace/c:spPr`). */
  chartShape: ShapeStyle
  plotShape: ShapeStyle
  plotLayout?: ManualLayout
  /** Text defaults for the whole chart (`c:chartSpace/c:txPr`). */
  textStyle: TextStyle
  roundedCorners: boolean
}

export interface UnsupportedChartModel {
  unsupported: true
  /** The chart's type element or layout, e.g. `surfaceChart`, `stockChart`, `waterfall`. */
  typeName: string
}

export type ChartModel = SupportedChartModel | UnsupportedChartModel

// ---------------------------------------------------------------------------------------------
// XML helpers. Children are matched by namespace and local name, so any prefix works, and
// `mc:AlternateContent` is read through its fallback (which uses only the standard schema).

function isChartElement(node: Element, name: string): boolean {
  return node.localName === name && CHART_NAMESPACES.has(node.namespaceURI ?? '')
}

function isDrawingElement(node: Element, name: string): boolean {
  return node.localName === name && DRAWING_NAMESPACES.has(node.namespaceURI ?? '')
}

function elementChildren(parent: Element): Element[] {
  const result: Element[] = []
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    const element = node as Element
    if (element.localName === 'AlternateContent' && element.namespaceURI === MARKUP_COMPATIBILITY_NS) {
      const branches = elementChildren(element)
      const chosen = branches.find((branch) => branch.localName === 'Fallback') ?? branches[0]
      if (chosen) pushAll(result, elementChildren(chosen))
    } else {
      result.push(element)
    }
  }
  return result
}

function chartChild(parent: Element | undefined, name: string): Element | undefined {
  return parent ? elementChildren(parent).find((child) => isChartElement(child, name)) : undefined
}

function chartChildren(parent: Element | undefined, name: string): Element[] {
  return parent ? elementChildren(parent).filter((child) => isChartElement(child, name)) : []
}

function drawingChild(parent: Element | undefined, name: string): Element | undefined {
  return parent ? elementChildren(parent).find((child) => isDrawingElement(child, name)) : undefined
}

function drawingChildren(parent: Element | undefined, name: string): Element[] {
  return parent ? elementChildren(parent).filter((child) => isDrawingElement(child, name)) : []
}

function attribute(element: Element | undefined, name: string): string | undefined {
  const value = element?.getAttribute(name)
  return value === null || value === undefined ? undefined : value
}

function valueOf(element: Element | undefined): string | undefined {
  return attribute(element, 'val')
}

/** `CT_Boolean`: a present element with no `val` means true. */
function booleanOf(element: Element | undefined, fallback: boolean): boolean {
  if (!element) return fallback
  const value = valueOf(element)
  if (value === undefined) return true
  return value === '1' || value === 'true' || value === 'on'
}

function numberOf(element: Element | undefined): number | undefined {
  const raw = valueOf(element)
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function textOf(element: Element | undefined): string {
  return element?.textContent ?? ''
}

/** Percentages in DrawingML are written in thousandths (`50000` = 50%) or, in strict files, as `50%`. */
function drawingPercent(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = raw.endsWith('%') ? parseFloat(raw) / 100 : Number(raw) / 100_000
  return Number.isFinite(value) ? value : undefined
}

// ---------------------------------------------------------------------------------------------
// Shapes and text

function readFill(parent: Element | undefined): ChartFill | undefined {
  if (!parent) return undefined
  for (const child of elementChildren(parent)) {
    if (!DRAWING_NAMESPACES.has(child.namespaceURI ?? '')) continue
    switch (child.localName) {
      case 'noFill':
        return { kind: 'none' }
      case 'solidFill':
        return { kind: 'solid', color: child }
      case 'gradFill': {
        const stops = drawingChildren(drawingChild(child, 'gsLst'), 'gs').map((stop) => ({
          position: clamp(drawingPercent(attribute(stop, 'pos')) ?? 0, 0, 1),
          color: stop,
        }))
        stops.sort((a, b) => a.position - b.position)
        const angle = Number(attribute(drawingChild(child, 'lin'), 'ang') ?? 5_400_000) / 60_000
        if (stops.length) return { kind: 'gradient', stops, angleDeg: Number.isFinite(angle) ? angle : 90 }
        break
      }
      case 'pattFill': {
        const foreground = drawingChild(child, 'fgClr')
        if (foreground) return { kind: 'pattern', color: foreground }
        break
      }
    }
  }
  return undefined
}

function readLine(line: Element | undefined): ChartLine | undefined {
  if (!line) return undefined
  const width = Number(attribute(line, 'w'))
  const dash = valueOf(drawingChild(line, 'prstDash'))
  return {
    fill: readFill(line),
    ...(Number.isFinite(width) && width >= 0 && attribute(line, 'w') !== undefined ? { widthPt: width / 12_700 } : {}),
    ...(dash ? { dash } : {}),
  }
}

function readShape(spPr: Element | undefined): ShapeStyle {
  if (!spPr) return {}
  const fill = readFill(spPr)
  const line = readLine(drawingChild(spPr, 'ln'))
  return { ...(fill ? { fill } : {}), ...(line ? { line } : {}) }
}

function readRunProperties(properties: Element | undefined): TextStyle {
  if (!properties) return {}
  const style: TextStyle = {}
  const size = Number(attribute(properties, 'sz'))
  if (attribute(properties, 'sz') !== undefined && Number.isFinite(size) && size > 0) style.sizePt = clamp(size / 100, 1, 400)
  const bold = attribute(properties, 'b')
  if (bold !== undefined) style.bold = bold === '1' || bold === 'true'
  const italic = attribute(properties, 'i')
  if (italic !== undefined) style.italic = italic === '1' || italic === 'true'
  const fill = drawingChild(properties, 'solidFill')
  if (fill) style.color = fill
  const typeface = attribute(drawingChild(properties, 'latin'), 'typeface')
  if (typeface) style.typeface = typeface
  return style
}

/** Later styles override earlier ones, field by field. */
export function mergeTextStyles(...styles: (TextStyle | undefined)[]): TextStyle {
  const merged: TextStyle = {}
  for (const style of styles) {
    if (!style) continue
    for (const [key, value] of Object.entries(style)) {
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value
    }
  }
  return merged
}

function readBodyRotation(bodyPr: Element | undefined): number | undefined {
  const raw = attribute(bodyPr, 'rot')
  if (raw === undefined) return undefined
  const rotation = Number(raw) / 60_000
  // -60000000 (-1000°) is Office's "automatic" marker.
  if (!Number.isFinite(rotation) || Math.abs(rotation) > 90) return undefined
  return rotation
}

/** A `c:txPr` or `c:rich`: the body rotation plus the first paragraph's default run properties. */
function readTextBody(body: Element | undefined): TextStyle {
  if (!body) return {}
  const paragraph = drawingChild(body, 'p')
  const rotationDeg = readBodyRotation(drawingChild(body, 'bodyPr'))
  return mergeTextStyles(readRunProperties(drawingChild(drawingChild(paragraph, 'pPr'), 'defRPr')), rotationDeg === undefined ? {} : { rotationDeg })
}

/** The lines of a `c:rich` body: one per paragraph, split again at `a:br`. */
function readRichLines(rich: Element): string[] {
  const lines: string[] = []
  for (const paragraph of drawingChildren(rich, 'p')) {
    let current = ''
    for (const run of elementChildren(paragraph)) {
      if (isDrawingElement(run, 'r') || isDrawingElement(run, 'fld')) current += textOf(drawingChild(run, 't'))
      else if (isDrawingElement(run, 'br')) {
        lines.push(current)
        current = ''
      }
    }
    lines.push(current)
  }
  return lines
}

function readRichStyle(rich: Element): TextStyle {
  const firstRun = drawingChildren(rich, 'p')
    .flatMap((paragraph) => drawingChildren(paragraph, 'r'))
    .find((run) => textOf(drawingChild(run, 't')).trim())
  return mergeTextStyles(readTextBody(rich), readRunProperties(drawingChild(firstRun, 'rPr')))
}

function readManualLayout(layout: Element | undefined): ManualLayout | undefined {
  const manual = chartChild(layout, 'manualLayout')
  if (!manual) return undefined
  // Factor mode positions relative to the automatic layout, which this renderer does not
  // reproduce exactly; only edge mode (fractions of the chart) is honored.
  const xMode = valueOf(chartChild(manual, 'xMode')) ?? 'factor'
  const yMode = valueOf(chartChild(manual, 'yMode')) ?? 'factor'
  if (xMode !== 'edge' || yMode !== 'edge') return undefined
  const x = numberOf(chartChild(manual, 'x'))
  const y = numberOf(chartChild(manual, 'y'))
  if (x === undefined || y === undefined) return undefined
  const w = numberOf(chartChild(manual, 'w'))
  const h = numberOf(chartChild(manual, 'h'))
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    ...(w !== undefined && w > 0 ? { w: clamp(w, 0, 1) } : {}),
    ...(h !== undefined && h > 0 ? { h: clamp(h, 0, 1) } : {}),
    target: valueOf(chartChild(manual, 'layoutTarget')) === 'inner' ? 'inner' : 'outer',
  }
}

function readTitle(title: Element | undefined, inherited: TextStyle): ChartTitleModel | undefined {
  if (!title) return undefined
  const tx = chartChild(title, 'tx')
  const rich = chartChild(tx, 'rich')
  const layout = readManualLayout(chartChild(title, 'layout'))
  const base = mergeTextStyles(inherited, readTextBody(chartChild(title, 'txPr')))
  let lines: string[] | undefined
  let style = base
  if (rich) {
    lines = readRichLines(rich)
    style = mergeTextStyles(base, readRichStyle(rich))
  } else {
    const reference = chartChild(tx, 'strRef')
    const cache = chartChild(reference, 'strCache')
    if (cache) lines = [readStringCache(cache, 1).labels[0] ?? '']
  }
  return {
    ...(lines ? { lines } : {}),
    style,
    overlay: booleanOf(chartChild(title, 'overlay'), false),
    ...(layout ? { layout } : {}),
  }
}

// ---------------------------------------------------------------------------------------------
// Data caches

class PointBudget {
  remaining: number = CHART_LIMITS.maxPoints

  /** Reserves room for `wanted` points and returns how many may be read. */
  take(wanted: number): number {
    const granted = clamp(Math.floor(wanted), 0, this.remaining)
    this.remaining -= granted
    return granted
  }
}

/** Declared point count, or one past the highest index when `c:ptCount` is missing. */
function declaredCount(cache: Element, points: Element[]): number {
  const declared = numberOf(chartChild(cache, 'ptCount'))
  if (declared !== undefined) return Math.max(0, Math.floor(declared))
  let highest = -1
  for (const point of points) highest = Math.max(highest, Number(attribute(point, 'idx') ?? -1))
  return Number.isFinite(highest) ? highest + 1 : 0
}

function pointIndex(point: Element, count: number): number | undefined {
  const index = Number(attribute(point, 'idx'))
  return Number.isInteger(index) && index >= 0 && index < count ? index : undefined
}

function readNumberCache(cache: Element, limit: number): NumberData {
  const points = chartChildren(cache, 'pt')
  const count = Math.min(declaredCount(cache, points), limit)
  const values: (number | undefined)[] = new Array<number | undefined>(count).fill(undefined)
  for (const point of points) {
    const index = pointIndex(point, count)
    if (index === undefined) continue
    const raw = textOf(chartChild(point, 'v')).trim()
    const value = raw === '' ? Number.NaN : Number(raw)
    values[index] = Number.isFinite(value) ? value : undefined
  }
  const formatCode = textOf(chartChild(cache, 'formatCode')).trim()
  return { values, ...(formatCode ? { formatCode } : {}) }
}

function readStringCache(cache: Element, limit: number): CategoryData {
  const points = chartChildren(cache, 'pt')
  const count = Math.min(declaredCount(cache, points), limit)
  const labels: (string | undefined)[] = new Array<string | undefined>(count).fill(undefined)
  for (const point of points) {
    const index = pointIndex(point, count)
    if (index !== undefined) labels[index] = textOf(chartChild(point, 'v'))
  }
  return { count, labels, outerLevels: [] }
}

function readMultiLevelCache(cache: Element, limit: number): CategoryData {
  const count = Math.min(Math.max(0, Math.floor(numberOf(chartChild(cache, 'ptCount')) ?? 0)), limit)
  const levels = chartChildren(cache, 'lvl').map((level) => {
    const labels: (string | undefined)[] = new Array<string | undefined>(count).fill(undefined)
    for (const point of chartChildren(level, 'pt')) {
      const index = pointIndex(point, count)
      if (index !== undefined) labels[index] = textOf(chartChild(point, 'v'))
    }
    return labels
  })
  return { count, labels: levels[0] ?? new Array<string | undefined>(count).fill(undefined), outerLevels: levels.slice(1, 4) }
}

/** A `c:cat` or `c:xVal`: strings, numbers (dates), or multi-level strings. */
function readCategories(container: Element | undefined, limit: number): CategoryData | undefined {
  if (!container) return undefined
  const multi = chartChild(chartChild(container, 'multiLvlStrRef'), 'multiLvlStrCache')
  if (multi) return readMultiLevelCache(multi, limit)
  const strings = chartChild(chartChild(container, 'strRef'), 'strCache') ?? chartChild(container, 'strLit')
  if (strings) return readStringCache(strings, limit)
  const numbers = chartChild(chartChild(container, 'numRef'), 'numCache') ?? chartChild(container, 'numLit')
  if (numbers) {
    const data = readNumberCache(numbers, limit)
    return {
      count: data.values.length,
      labels: data.values.map((value) => (value === undefined ? undefined : String(value))),
      numbers: data.values,
      ...(data.formatCode ? { formatCode: data.formatCode } : {}),
      outerLevels: [],
    }
  }
  return undefined
}

function readNumbers(container: Element | undefined, budget: PointBudget): NumberData | undefined {
  if (!container) return undefined
  const cache = chartChild(chartChild(container, 'numRef'), 'numCache') ?? chartChild(container, 'numLit')
  if (!cache) return undefined
  const points = chartChildren(cache, 'pt')
  return readNumberCache(cache, budget.take(declaredCount(cache, points)))
}

// ---------------------------------------------------------------------------------------------
// Series

const MARKER_SYMBOLS = new Set<MarkerSymbol>(['auto', 'none', 'circle', 'square', 'diamond', 'triangle', 'x', 'star', 'plus', 'dash', 'dot', 'picture'])

function readMarker(marker: Element | undefined): MarkerModel | undefined {
  if (!marker) return undefined
  const symbol = valueOf(chartChild(marker, 'symbol'))
  const size = numberOf(chartChild(marker, 'size'))
  return {
    ...(symbol && MARKER_SYMBOLS.has(symbol as MarkerSymbol) ? { symbol: symbol as MarkerSymbol } : {}),
    ...(size !== undefined ? { size: clamp(size, 2, 72) } : {}),
    style: readShape(chartChild(marker, 'spPr')),
  }
}

const LABEL_POSITIONS = new Set<DataLabelPosition>(['bestFit', 'b', 'ctr', 'inBase', 'inEnd', 'l', 'outEnd', 'r', 't'])

function readLabelOptions(element: Element, inherited: TextStyle): Partial<DataLabelOptions> & { style: TextStyle; shape: ShapeStyle } {
  const flag = (name: string): boolean | undefined => {
    const child = chartChild(element, name)
    return child ? booleanOf(child, false) : undefined
  }
  const options: Partial<DataLabelOptions> & { style: TextStyle; shape: ShapeStyle } = {
    style: mergeTextStyles(inherited, readTextBody(chartChild(element, 'txPr'))),
    shape: readShape(chartChild(element, 'spPr')),
  }
  const showValue = flag('showVal')
  if (showValue !== undefined) options.showValue = showValue
  const showPercent = flag('showPercent')
  if (showPercent !== undefined) options.showPercent = showPercent
  const showCategory = flag('showCatName')
  if (showCategory !== undefined) options.showCategory = showCategory
  const showSeriesName = flag('showSerName')
  if (showSeriesName !== undefined) options.showSeriesName = showSeriesName
  const showBubbleSize = flag('showBubbleSize')
  if (showBubbleSize !== undefined) options.showBubbleSize = showBubbleSize
  const numberFormat = chartChild(element, 'numFmt')
  // A linked format means "use the data's own format", which is the default anyway.
  if (numberFormat && attribute(numberFormat, 'sourceLinked') !== '1') {
    const code = attribute(numberFormat, 'formatCode')
    if (code) options.numberFormat = code
  }
  const position = valueOf(chartChild(element, 'dLblPos'))
  if (position && LABEL_POSITIONS.has(position as DataLabelPosition)) options.position = position as DataLabelPosition
  const separator = chartChild(element, 'separator')
  if (separator) options.separator = textOf(separator)
  return options
}

function readDataLabels(dLbls: Element | undefined, inherited: TextStyle): DataLabelsModel | undefined {
  if (!dLbls) return undefined
  const points = new Map<number, DataLabelPointModel>()
  for (const label of chartChildren(dLbls, 'dLbl').slice(0, CHART_LIMITS.maxPoints)) {
    const index = numberOf(chartChild(label, 'idx'))
    if (index === undefined || index < 0) continue
    const rich = chartChild(chartChild(label, 'tx'), 'rich')
    const options = readLabelOptions(label, inherited)
    points.set(Math.floor(index), {
      ...options,
      deleted: booleanOf(chartChild(label, 'delete'), false),
      ...(rich ? { lines: readRichLines(rich), style: mergeTextStyles(options.style, readRichStyle(rich)) } : {}),
    })
  }
  return { ...readLabelOptions(dLbls, inherited), deleted: booleanOf(chartChild(dLbls, 'delete'), false), points }
}

/** Merges series labels over plot labels: a series `c:dLbls` overrides field by field. */
export function effectiveDataLabels(plot: DataLabelsModel | undefined, series: DataLabelsModel | undefined): DataLabelsModel | undefined {
  if (!plot) return series
  if (!series) return plot
  const merged: DataLabelsModel = { ...plot, points: series.points, deleted: series.deleted, style: mergeTextStyles(plot.style, series.style), shape: { ...plot.shape, ...series.shape } }
  for (const [key, value] of Object.entries(series)) {
    if (value !== undefined && !['points', 'deleted', 'style', 'shape'].includes(key)) (merged as unknown as Record<string, unknown>)[key] = value
  }
  return merged
}

function readSeriesName(ser: Element, fallbackIndex: number): string {
  const tx = chartChild(ser, 'tx')
  const cache = chartChild(chartChild(tx, 'strRef'), 'strCache')
  if (cache) return readStringCache(cache, 64).labels.filter((label) => label !== undefined).join(' ')
  const literal = chartChild(tx, 'v')
  if (literal) return textOf(literal)
  return `Series ${fallbackIndex + 1}`
}

function readPoints(ser: Element): Map<number, DataPointModel> {
  const points = new Map<number, DataPointModel>()
  for (const point of chartChildren(ser, 'dPt').slice(0, CHART_LIMITS.maxPoints)) {
    const index = numberOf(chartChild(point, 'idx'))
    if (index === undefined || index < 0) continue
    const marker = readMarker(chartChild(point, 'marker'))
    const explosion = numberOf(chartChild(point, 'explosion'))
    points.set(Math.floor(index), {
      style: readShape(chartChild(point, 'spPr')),
      ...(marker ? { marker } : {}),
      ...(explosion !== undefined ? { explosion: clamp(explosion, 0, 400) } : {}),
    })
  }
  return points
}

function readSeries(ser: Element, position: number, budget: PointBudget, labelStyle: TextStyle, readCategoryData: boolean): SeriesModel {
  const index = numberOf(chartChild(ser, 'idx')) ?? position
  const yContainer = chartChild(ser, 'yVal') ?? chartChild(ser, 'val')
  const values = readNumbers(yContainer, budget) ?? { values: [] }
  const xContainer = chartChild(ser, 'xVal')
  const xValues = readNumbers(xContainer, budget)
  const xLabels = xValues ? undefined : readCategories(xContainer, values.values.length || CHART_LIMITS.maxPoints)
  const bubbleSizes = readNumbers(chartChild(ser, 'bubbleSize'), budget)
  const categories = readCategoryData ? readCategories(chartChild(ser, 'cat'), CHART_LIMITS.maxPoints) : undefined
  const marker = readMarker(chartChild(ser, 'marker'))
  const dataLabels = readDataLabels(chartChild(ser, 'dLbls'), labelStyle)
  return {
    index: Math.max(0, Math.floor(index)),
    order: numberOf(chartChild(ser, 'order')) ?? position,
    name: readSeriesName(ser, position),
    style: readShape(chartChild(ser, 'spPr')),
    ...(categories ? { categories } : {}),
    values,
    ...(xValues ? { xValues } : {}),
    ...(xLabels ? { xLabels } : {}),
    ...(bubbleSizes ? { bubbleSizes } : {}),
    ...(marker ? { marker } : {}),
    smooth: booleanOf(chartChild(ser, 'smooth'), false),
    explosion: clamp(numberOf(chartChild(ser, 'explosion')) ?? 0, 0, 400),
    points: readPoints(ser),
    ...(dataLabels ? { dataLabels } : {}),
  }
}

// ---------------------------------------------------------------------------------------------
// Plots

const PLOT_TYPES: Record<string, PlotModel['type']> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  ofPieChart: 'pie',
  doughnutChart: 'pie',
  scatterChart: 'scatter',
  bubbleChart: 'bubble',
  radarChart: 'radar',
}

const UNSUPPORTED_PLOTS = new Set(['surfaceChart', 'surface3DChart', 'stockChart'])

function readGrouping(element: Element, fallback: Grouping): Grouping {
  const grouping = valueOf(chartChild(element, 'grouping'))
  return grouping === 'standard' || grouping === 'clustered' || grouping === 'stacked' || grouping === 'percentStacked' ? grouping : fallback
}

function readPlot(element: Element, type: PlotModel['type'], budget: PointBudget, seriesLeft: number, labelStyle: TextStyle): PlotModel {
  const series = chartChildren(element, 'ser')
    .slice(0, seriesLeft)
    .map((ser, position) => readSeries(ser, position, budget, labelStyle, position === 0 || type === 'pie'))
  series.sort((a, b) => a.order - b.order)
  const dataLabels = readDataLabels(chartChild(element, 'dLbls'), labelStyle)
  const isPie = type === 'pie'
  const base: PlotBase = {
    axisIds: chartChildren(element, 'axId').map((axis) => valueOf(axis) ?? ''),
    series,
    // Absent `c:varyColors` means each pie slice gets its own color but other plots do not.
    varyColors: booleanOf(chartChild(element, 'varyColors'), isPie),
    ...(dataLabels ? { dataLabels } : {}),
  }
  switch (type) {
    case 'bar': {
      const grouping = readGrouping(element, 'clustered')
      const stacked = grouping === 'stacked' || grouping === 'percentStacked'
      return {
        ...base,
        type,
        direction: valueOf(chartChild(element, 'barDir')) === 'bar' ? 'bar' : 'col',
        grouping,
        gapWidth: clamp(numberOf(chartChild(element, 'gapWidth')) ?? 150, 0, 500),
        overlap: clamp(numberOf(chartChild(element, 'overlap')) ?? (stacked ? 100 : 0), -100, 100),
      }
    }
    case 'line':
      return { ...base, type, grouping: readGrouping(element, 'standard'), markers: booleanOf(chartChild(element, 'marker'), true) }
    case 'area':
      return { ...base, type, grouping: readGrouping(element, 'standard') }
    case 'pie': {
      const doughnut = element.localName === 'doughnutChart'
      return {
        ...base,
        type,
        firstSliceAngle: ((numberOf(chartChild(element, 'firstSliceAng')) ?? 0) % 360 + 360) % 360,
        holeSize: doughnut ? clamp(numberOf(chartChild(element, 'holeSize')) ?? 50, 10, 90) : 0,
      }
    }
    case 'scatter': {
      const style = valueOf(chartChild(element, 'scatterStyle'))
      const known: ScatterStyle[] = ['line', 'lineMarker', 'marker', 'none', 'smooth', 'smoothMarker']
      return { ...base, type, style: known.includes(style as ScatterStyle) ? (style as ScatterStyle) : 'lineMarker' }
    }
    case 'bubble':
      return {
        ...base,
        type,
        bubbleScale: clamp(numberOf(chartChild(element, 'bubbleScale')) ?? 100, 0, 300),
        showNegativeBubbles: booleanOf(chartChild(element, 'showNegBubbles'), false),
        sizeRepresents: valueOf(chartChild(element, 'sizeRepresents')) === 'w' ? 'w' : 'area',
      }
    case 'radar': {
      const style = valueOf(chartChild(element, 'radarStyle'))
      return { ...base, type, style: style === 'filled' ? 'filled' : style === 'standard' ? 'standard' : 'marker' }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Axes and legend

const AXIS_KINDS: Record<string, AxisModel['kind']> = { catAx: 'cat', valAx: 'val', dateAx: 'date', serAx: 'ser' }

function readAxis(element: Element, kind: AxisModel['kind'], inherited: TextStyle): AxisModel {
  const scaling = chartChild(element, 'scaling')
  const position = valueOf(chartChild(element, 'axPos'))
  const numberFormat = chartChild(element, 'numFmt')
  const formatCode = attribute(numberFormat, 'formatCode')
  const crossesAt = numberOf(chartChild(element, 'crossesAt'))
  const crosses = valueOf(chartChild(element, 'crosses'))
  const crossBetween = valueOf(chartChild(element, 'crossBetween'))
  const tickMark = valueOf(chartChild(element, 'majorTickMark'))
  const labelPosition = valueOf(chartChild(element, 'tickLblPos'))
  const majorGridlines = chartChild(element, 'majorGridlines')
  const minorGridlines = chartChild(element, 'minorGridlines')
  const logBase = numberOf(chartChild(scaling, 'logBase'))
  const min = numberOf(chartChild(scaling, 'min'))
  const max = numberOf(chartChild(scaling, 'max'))
  const majorUnit = numberOf(chartChild(element, 'majorUnit'))
  const tickLabelSkip = numberOf(chartChild(element, 'tickLblSkip'))
  const line = readShape(chartChild(element, 'spPr')).line
  // Titles keep only their own text properties; the renderer applies the defaults.
  const title = readTitle(chartChild(element, 'title'), {})
  return {
    id: valueOf(chartChild(element, 'axId')) ?? '',
    kind,
    deleted: booleanOf(chartChild(element, 'delete'), false),
    reversed: valueOf(chartChild(scaling, 'orientation')) === 'maxMin',
    position: position === 'l' || position === 'r' || position === 't' ? position : 'b',
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(majorUnit !== undefined && majorUnit > 0 ? { majorUnit } : {}),
    ...(logBase !== undefined && logBase >= 2 && logBase <= 1000 ? { logBase } : {}),
    ...(majorGridlines ? { majorGridlines: readShape(chartChild(majorGridlines, 'spPr')) } : {}),
    ...(minorGridlines ? { minorGridlines: readShape(chartChild(minorGridlines, 'spPr')) } : {}),
    ...(formatCode ? { numberFormat: { code: formatCode, sourceLinked: attribute(numberFormat, 'sourceLinked') === '1' } } : {}),
    majorTickMark: tickMark === 'cross' || tickMark === 'in' || tickMark === 'none' ? tickMark : 'out',
    tickLabelPosition: labelPosition === 'high' || labelPosition === 'low' || labelPosition === 'none' ? labelPosition : 'nextTo',
    ...(valueOf(chartChild(element, 'crossAx')) !== undefined ? { crossAxisId: valueOf(chartChild(element, 'crossAx'))! } : {}),
    crosses: crossesAt ?? (crosses === 'min' || crosses === 'max' ? crosses : 'autoZero'),
    ...(crossBetween === 'between' || crossBetween === 'midCat' ? { crossBetween } : {}),
    ...(tickLabelSkip !== undefined && tickLabelSkip >= 1 ? { tickLabelSkip: Math.floor(tickLabelSkip) } : {}),
    ...(line ? { line } : {}),
    textStyle: mergeTextStyles(inherited, readTextBody(chartChild(element, 'txPr'))),
    ...(title ? { title } : {}),
  }
}

function readLegend(legend: Element | undefined, inherited: TextStyle): LegendModel | undefined {
  if (!legend) return undefined
  const position = valueOf(chartChild(legend, 'legendPos'))
  const deletedEntries = new Set<number>()
  for (const entry of chartChildren(legend, 'legendEntry')) {
    const index = numberOf(chartChild(entry, 'idx'))
    if (index !== undefined && booleanOf(chartChild(entry, 'delete'), false)) deletedEntries.add(index)
  }
  const layout = readManualLayout(chartChild(legend, 'layout'))
  return {
    position: position === 'b' || position === 'l' || position === 't' || position === 'tr' ? position : 'r',
    overlay: booleanOf(chartChild(legend, 'overlay'), false),
    deletedEntries,
    textStyle: mergeTextStyles(inherited, readTextBody(chartChild(legend, 'txPr'))),
    shape: readShape(chartChild(legend, 'spPr')),
    ...(layout ? { layout } : {}),
  }
}

function readStyle(chartSpace: Element): number | undefined {
  // Office writes `c14:style` (100 + style) inside mc:AlternateContent with a `c:style` fallback.
  const modern = chartSpace.getElementsByTagNameNS(C14_NS, 'style').item(0)
  const modernValue = Number(modern?.getAttribute('val'))
  if (Number.isFinite(modernValue) && modernValue > 100) return modernValue - 100
  return numberOf(chartChild(chartSpace, 'style'))
}

// ---------------------------------------------------------------------------------------------

/** Parses a chart part. Throws LiveFormatError for XML that is not a chart at all. */
export function parseChart(xml: string): ChartModel {
  if (xml.length > CHART_LIMITS.maxXmlLength) throw new LiveFormatError('too_large', 'This chart is too large to draw')
  const root = parseXml(xml).documentElement
  if (!root) throw new LiveFormatError('corrupt', 'This chart has no content')
  if (root.namespaceURI === CHARTEX_NS) return { unsupported: true, typeName: chartExLayout(root) }
  if (!isChartElement(root, 'chartSpace')) throw new LiveFormatError('corrupt', 'This part is not a chart')

  const chart = chartChild(root, 'chart')
  if (!chart) throw new LiveFormatError('corrupt', 'This chart has no chart element')
  const plotArea = chartChild(chart, 'plotArea')
  const textStyle = readTextBody(chartChild(root, 'txPr'))
  const budget = new PointBudget()
  const plots: PlotModel[] = []
  let unsupportedType: string | undefined
  let seriesLeft: number = CHART_LIMITS.maxSeries
  for (const element of elementChildren(plotArea ?? chart)) {
    if (!CHART_NAMESPACES.has(element.namespaceURI ?? '')) continue
    const localName = element.localName ?? ''
    const type = PLOT_TYPES[localName]
    if (type) {
      const plot = readPlot(element, type, budget, seriesLeft, textStyle)
      seriesLeft -= plot.series.length
      plots.push(plot)
    } else if (UNSUPPORTED_PLOTS.has(localName) || (localName.endsWith('Chart') && localName !== 'chart')) {
      unsupportedType ??= localName
    }
  }
  if (!plots.length) return { unsupported: true, typeName: unsupportedType ?? 'empty' }

  const axes: AxisModel[] = []
  for (const element of elementChildren(plotArea ?? chart)) {
    const kind = isChartElement(element, element.localName ?? '') ? AXIS_KINDS[element.localName ?? ''] : undefined
    if (kind) axes.push(readAxis(element, kind, textStyle))
  }
  const title = readTitle(chartChild(chart, 'title'), {})
  const legend = readLegend(chartChild(chart, 'legend'), textStyle)
  const plotLayout = readManualLayout(chartChild(plotArea, 'layout'))
  const blanks = valueOf(chartChild(chart, 'dispBlanksAs'))
  const style = readStyle(root)
  return {
    unsupported: false,
    ...(title ? { title } : {}),
    autoTitleDeleted: booleanOf(chartChild(chart, 'autoTitleDeleted'), false),
    plots,
    axes,
    ...(legend ? { legend } : {}),
    ...(style !== undefined ? { style } : {}),
    date1904: booleanOf(chartChild(root, 'date1904'), false),
    dispBlanksAs: blanks === 'span' || blanks === 'zero' ? blanks : 'gap',
    chartShape: readShape(chartChild(root, 'spPr')),
    plotShape: readShape(chartChild(plotArea, 'spPr')),
    ...(plotLayout ? { plotLayout } : {}),
    textStyle,
    roundedCorners: booleanOf(chartChild(root, 'roundedCorners'), false),
  }
}

/** The layout of a chartex chart (waterfall, treemap, …), the closest thing it has to a type. */
function chartExLayout(root: Element): string {
  const series = root.getElementsByTagNameNS(CHARTEX_NS, 'series').item(0)
  return series?.getAttribute('layoutId') || 'chartex'
}
