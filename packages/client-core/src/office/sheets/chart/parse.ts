import { parseXml } from '../../ooxml/package.js'
import { parseDrawingColor, type DrawingColor } from '../../ooxml/theme.js'
import { DRAWINGML_NS, MARKUP_COMPATIBILITY_NS, attribute, childElements, isElement, numberAttribute, ownText, type Element } from '../../ooxml/xml.js'
import {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  type ChartAxis,
  type ChartGroup,
  type ChartModel,
  type ChartSeries,
  type ChartText,
  type ChartType,
  type ChartValue,
  type DataLabelSettings,
  type DataLabels,
  type DataPointFormat,
  type DataSource,
  type Fill,
  type Grouping,
  type Legend,
  type LineFormat,
  type ManualLayout,
  type MarkerFormat,
  type MarkerSymbol,
  type NumberFormat,
  type ShapeFormat,
  type TextRun,
  type TextStyle,
} from './model.js'

export const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHARTEX_NS = 'http://schemas.microsoft.com/office/drawing/2014/chartex'
const STRICT_CHART_NS = 'http://purl.oclc.org/ooxml/drawingml/chart'
const STRICT_DRAWINGML_NS = 'http://purl.oclc.org/ooxml/drawingml/main'
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Namespaces whose elements we read, so an `mc:Choice` requiring only these can be taken. */
const UNDERSTOOD_NAMESPACES = new Set([CHART_NS, DRAWINGML_NS, RELATIONSHIPS_NS])

const EMU_PER_POINT = 12700
const MAX_TEXT_LENGTH = 10_000
const MAX_RUNS = 1_000

// ---------------------------------------------------------------------------------------------
// Element helpers that see through mc:AlternateContent

function chooseAlternate(alternate: Element): Element | undefined {
  for (const branch of childElements(alternate, MARKUP_COMPATIBILITY_NS)) {
    if (branch.localName === 'Choice') {
      const requires = (attribute(branch, 'Requires') ?? '').split(/\s+/).filter(Boolean)
      const understood = requires.every((prefix) => {
        const ns = branch.lookupNamespaceURI(prefix)
        return !!ns && UNDERSTOOD_NAMESPACES.has(ns)
      })
      if (understood) return branch
    } else if (branch.localName === 'Fallback') return branch
  }
  return undefined
}

/** Element children, with mc:AlternateContent replaced by the branch we understand. */
function kids(parent: Element | undefined, depth = 0): Element[] {
  if (!parent) return []
  const result: Element[] = []
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (!isElement(node)) continue
    if (node.namespaceURI === MARKUP_COMPATIBILITY_NS && node.localName === 'AlternateContent') {
      const branch = depth < 4 ? chooseAlternate(node) : undefined
      if (branch) result.push(...kids(branch, depth + 1))
    } else result.push(node)
  }
  return result
}

function c(parent: Element | undefined, name: string): Element | undefined {
  return kids(parent).find((el) => el.localName === name && el.namespaceURI === CHART_NS)
}

function cs(parent: Element | undefined, name: string): Element[] {
  return kids(parent).filter((el) => el.localName === name && el.namespaceURI === CHART_NS)
}

function a(parent: Element | undefined, name: string): Element | undefined {
  return kids(parent).find((el) => el.localName === name && el.namespaceURI === DRAWINGML_NS)
}

function as(parent: Element | undefined, name: string): Element[] {
  return kids(parent).filter((el) => el.localName === name && el.namespaceURI === DRAWINGML_NS)
}

/** `<c:x val="…"/>` as a string. */
function val(parent: Element | undefined, name: string): string | undefined {
  return attribute(c(parent, name), 'val')
}

function numVal(parent: Element | undefined, name: string): number | undefined {
  const text = val(parent, name)
  if (text === undefined || text.trim() === '') return undefined
  // Percent values may be written as `50%` in newer schemas.
  const value = Number(text.replace(/%$/, ''))
  return Number.isFinite(value) ? value : undefined
}

/** CT_Boolean: the element present with no `val` means true. */
function boolVal(parent: Element | undefined, name: string, fallback: boolean): boolean {
  const el = c(parent, name)
  if (!el) return fallback
  const text = attribute(el, 'val')
  if (text === undefined) return true
  return text === '1' || text === 'true'
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function limitText(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
}

// ---------------------------------------------------------------------------------------------
// Shapes and text

function parseFill(parent: Element | undefined): Fill | undefined {
  for (const el of kids(parent)) {
    if (el.namespaceURI !== DRAWINGML_NS) continue
    switch (el.localName) {
      case 'noFill':
        return { type: 'none' }
      case 'solidFill': {
        const color = parseDrawingColor(el)
        return color ? { type: 'solid', color } : { type: 'other' }
      }
      case 'gradFill': {
        const stops: { position: number; color: DrawingColor }[] = []
        for (const stop of as(a(el, 'gsLst'), 'gs').slice(0, 64)) {
          const color = parseDrawingColor(stop)
          if (color) stops.push({ position: clamp((numberAttribute(stop, 'pos') ?? 0) / 100000, 0, 1), color })
        }
        stops.sort((x, y) => x.position - y.position)
        const angle = numberAttribute(a(el, 'lin'), 'ang')
        if (!stops.length) return { type: 'other' }
        return angle === undefined ? { type: 'gradient', stops } : { type: 'gradient', stops, angle: angle / 60000 }
      }
      case 'pattFill': {
        const fill: Fill = { type: 'pattern' }
        const foreground = parseDrawingColor(a(el, 'fgClr'))
        const background = parseDrawingColor(a(el, 'bgClr'))
        if (foreground) fill.foreground = foreground
        if (background) fill.background = background
        return fill
      }
      case 'blipFill':
      case 'grpFill':
        return { type: 'other' }
    }
  }
  return undefined
}

function parseLine(element: Element | undefined): LineFormat | undefined {
  if (!element) return undefined
  const line: LineFormat = {}
  const width = numberAttribute(element, 'w')
  if (width !== undefined) line.width = clamp(width / EMU_PER_POINT, 0, 100)
  const fill = parseFill(element)
  if (fill) line.fill = fill
  const dash = attribute(a(element, 'prstDash'), 'val')
  if (dash) line.dash = dash
  return line
}

function parseShape(spPr: Element | undefined): ShapeFormat {
  const shape: ShapeFormat = {}
  if (!spPr) return shape
  const fill = parseFill(spPr)
  if (fill) shape.fill = fill
  const line = parseLine(a(spPr, 'ln'))
  if (line) shape.line = line
  return shape
}

function parseRunProperties(element: Element | undefined): TextStyle {
  const style: TextStyle = {}
  if (!element) return style
  const size = numberAttribute(element, 'sz')
  if (size !== undefined && size > 0) style.size = clamp(size / 100, 1, 400)
  const bold = attribute(element, 'b')
  if (bold !== undefined) style.bold = bold === '1' || bold === 'true'
  const italic = attribute(element, 'i')
  if (italic !== undefined) style.italic = italic === '1' || italic === 'true'
  const underline = attribute(element, 'u')
  if (underline !== undefined) style.underline = underline !== 'none'
  const fill = parseFill(element)
  if (fill?.type === 'solid') style.color = fill.color
  const latin = attribute(a(element, 'latin'), 'typeface')
  if (latin) style.font = latin
  return style
}

/** The default text style and rotation of a `c:txPr` or `c:rich` body. */
function parseTextBody(body: Element | undefined): { style: TextStyle; rotation?: number } {
  if (!body) return { style: {} }
  // The first paragraph's defaults win; later ones only fill gaps.
  const style: TextStyle = {}
  for (const paragraph of as(body, 'p').slice(0, 4).reverse()) Object.assign(style, parseRunProperties(a(a(paragraph, 'pPr'), 'defRPr')))
  const rot = numberAttribute(a(body, 'bodyPr'), 'rot')
  // Excel writes rot="-60000000" for "automatic"; only -90°..90° is a real rotation.
  return rot === undefined || Math.abs(rot) > 5_400_000 ? { style } : { style, rotation: rot / 60000 }
}

function parseRich(rich: Element): TextRun[][] {
  const paragraphs: TextRun[][] = []
  let runs = 0
  for (const paragraph of as(rich, 'p')) {
    const defaults = parseRunProperties(a(a(paragraph, 'pPr'), 'defRPr'))
    const line: TextRun[] = []
    for (const run of kids(paragraph)) {
      if (run.namespaceURI !== DRAWINGML_NS || ++runs > MAX_RUNS) continue
      if (run.localName === 'r' || run.localName === 'fld') {
        line.push({ text: limitText(ownText(a(run, 't'))), style: { ...defaults, ...parseRunProperties(a(run, 'rPr')) } })
      } else if (run.localName === 'br') {
        paragraphs.push(line.splice(0))
      }
    }
    paragraphs.push(line)
  }
  return paragraphs
}

function parseLayout(layout: Element | undefined): ManualLayout | undefined {
  const manual = c(layout, 'manualLayout')
  if (!manual) return undefined
  const result: ManualLayout = {
    xMode: val(manual, 'xMode') === 'factor' ? 'factor' : 'edge',
    yMode: val(manual, 'yMode') === 'factor' ? 'factor' : 'edge',
  }
  const target = val(manual, 'layoutTarget')
  if (target === 'inner' || target === 'outer') result.target = target
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = numVal(manual, key)
    if (value !== undefined) result[key] = clamp(value, -1, 2)
  }
  return result
}

function parseTitle(title: Element | undefined): ChartText | undefined {
  if (!title) return undefined
  const tx = c(title, 'tx')
  const rich = c(tx, 'rich')
  const result: ChartText = {
    paragraphs: rich ? parseRich(rich) : [],
    style: {},
    overlay: boolVal(title, 'overlay', false),
    format: parseShape(c(title, 'spPr')),
  }
  const body = rich ?? c(title, 'txPr')
  const parsed = parseTextBody(body)
  result.style = parsed.style
  if (parsed.rotation !== undefined) result.rotation = parsed.rotation
  const strRef = c(tx, 'strRef')
  if (strRef) {
    const formula = ownText(c(strRef, 'f')).trim()
    const cache = readCache(c(strRef, 'strCache'), 'string')
    result.ref = {}
    if (formula) result.ref.formula = formula
    const text = cache?.values.filter((v) => v !== null).join(' ')
    if (text !== undefined) result.ref.cache = limitText(text)
  }
  const layout = parseLayout(c(title, 'layout'))
  if (layout) result.layout = layout
  return result
}

// ---------------------------------------------------------------------------------------------
// Data

function readPoints(cache: Element, kind: 'number' | 'string', count: number, values: ChartValue[]): string | undefined {
  let firstFormat: string | undefined
  for (const pt of cs(cache, 'pt')) {
    const index = numberAttribute(pt, 'idx')
    if (index === undefined || !Number.isInteger(index) || index < 0 || index >= count) continue
    const text = ownText(c(pt, 'v'))
    if (kind === 'number') {
      const number = text.trim() === '' ? NaN : Number(text)
      values[index] = Number.isFinite(number) ? number : null
      firstFormat ??= attribute(pt, 'formatCode')
    } else values[index] = limitText(text)
  }
  return firstFormat
}

function readCache(cache: Element | undefined, kind: 'number' | 'string'): DataSource | undefined {
  if (!cache) return undefined
  const declared = numVal(cache, 'ptCount')
  const points = cs(cache, 'pt')
  let count = declared !== undefined && declared >= 0 ? Math.floor(declared) : 0
  if (declared === undefined) {
    for (const pt of points) count = Math.max(count, (numberAttribute(pt, 'idx') ?? -1) + 1)
  }
  count = clamp(count, 0, MAX_CHART_POINTS)
  const values: ChartValue[] = new Array<ChartValue>(count).fill(null)
  const pointFormat = readPoints(cache, kind, count, values)
  const source: DataSource = { kind, count, values }
  const formatCode = ownText(c(cache, 'formatCode')).trim() || pointFormat
  if (formatCode) source.formatCode = formatCode
  return source
}

function readMultiLevel(cache: Element | undefined): DataSource | undefined {
  if (!cache) return undefined
  const count = clamp(Math.floor(numVal(cache, 'ptCount') ?? 0), 0, MAX_CHART_POINTS)
  const levels: (string | null)[][] = []
  for (const level of cs(cache, 'lvl').slice(0, 16)) {
    const labels: ChartValue[] = new Array<ChartValue>(count).fill(null)
    readPoints(level, 'string', count, labels)
    levels.push(labels as (string | null)[])
  }
  return { kind: 'multiLevel', count, values: levels[0] ? [...levels[0]] : new Array<ChartValue>(count).fill(null), levels }
}

/** `c:cat`, `c:val`, `c:xVal`, `c:yVal`, `c:bubbleSize`. */
function parseDataSource(element: Element | undefined): DataSource | undefined {
  if (!element) return undefined
  for (const child of kids(element)) {
    if (child.namespaceURI !== CHART_NS) continue
    let source: DataSource | undefined
    let formula = ''
    switch (child.localName) {
      case 'numRef':
        formula = ownText(c(child, 'f')).trim()
        source = readCache(c(child, 'numCache'), 'number') ?? { kind: 'number', count: 0, values: [] }
        break
      case 'strRef':
        formula = ownText(c(child, 'f')).trim()
        source = readCache(c(child, 'strCache'), 'string') ?? { kind: 'string', count: 0, values: [] }
        break
      case 'multiLvlStrRef':
        formula = ownText(c(child, 'f')).trim()
        source = readMultiLevel(c(child, 'multiLvlStrCache')) ?? { kind: 'multiLevel', count: 0, values: [] }
        break
      case 'numLit':
        source = readCache(child, 'number')
        break
      case 'strLit':
        source = readCache(child, 'string')
        break
      default:
        continue
    }
    if (!source) return undefined
    if (formula) source.formula = limitText(formula)
    return source
  }
  return undefined
}

const MARKER_SYMBOLS = new Set<MarkerSymbol>(['none', 'auto', 'circle', 'square', 'diamond', 'triangle', 'x', 'star', 'dot', 'dash', 'plus', 'picture'])

function parseMarker(marker: Element | undefined): MarkerFormat | undefined {
  if (!marker) return undefined
  const result: MarkerFormat = { format: parseShape(c(marker, 'spPr')) }
  const symbol = val(marker, 'symbol') as MarkerSymbol | undefined
  if (symbol && MARKER_SYMBOLS.has(symbol)) result.symbol = symbol
  const size = numVal(marker, 'size')
  if (size !== undefined) result.size = clamp(size, 2, 72)
  return result
}

function parseNumberFormat(element: Element | undefined): NumberFormat | undefined {
  if (!element) return undefined
  const formatCode = attribute(element, 'formatCode')
  if (formatCode === undefined) return undefined
  return { formatCode: limitText(formatCode), sourceLinked: attribute(element, 'sourceLinked') === '1' || attribute(element, 'sourceLinked') === 'true' }
}

function parseLabelSettings(element: Element, inherited?: DataLabelSettings): DataLabelSettings {
  const settings: DataLabelSettings = {
    showValue: boolVal(element, 'showVal', inherited?.showValue ?? false),
    showPercent: boolVal(element, 'showPercent', inherited?.showPercent ?? false),
    showCategoryName: boolVal(element, 'showCatName', inherited?.showCategoryName ?? false),
    showSeriesName: boolVal(element, 'showSerName', inherited?.showSeriesName ?? false),
    showLegendKey: boolVal(element, 'showLegendKey', inherited?.showLegendKey ?? false),
    showBubbleSize: boolVal(element, 'showBubbleSize', inherited?.showBubbleSize ?? false),
    style: { ...inherited?.style, ...parseTextBody(c(element, 'txPr')).style },
    format: { ...inherited?.format, ...parseShape(c(element, 'spPr')) },
  }
  const separator = c(element, 'separator')
  if (separator) settings.separator = limitText(ownText(separator))
  else if (inherited?.separator !== undefined) settings.separator = inherited.separator
  const numberFormat = parseNumberFormat(c(element, 'numFmt')) ?? inherited?.numberFormat
  if (numberFormat) settings.numberFormat = numberFormat
  const position = val(element, 'dLblPos') ?? inherited?.position
  if (position) settings.position = position
  return settings
}

function parseDataLabels(element: Element | undefined, inherited?: DataLabels): DataLabels | undefined {
  if (!element) return undefined
  const settings = parseLabelSettings(element, inherited)
  const labels: DataLabels = { ...settings, deleted: boolVal(element, 'delete', false), points: [] }
  for (const point of cs(element, 'dLbl').slice(0, 10_000)) {
    const index = numVal(point, 'idx')
    if (index === undefined || index < 0) continue
    labels.points.push({ ...parseLabelSettings(point, settings), index, deleted: boolVal(point, 'delete', false) })
  }
  return labels
}

function parseSeries(ser: Element, groupLabels: DataLabels | undefined): ChartSeries {
  const series: ChartSeries = {
    index: numVal(ser, 'idx') ?? 0,
    order: numVal(ser, 'order') ?? 0,
    format: parseShape(c(ser, 'spPr')),
    points: [],
  }
  const tx = c(ser, 'tx')
  if (tx) {
    const strRef = c(tx, 'strRef')
    if (strRef) {
      const formula = ownText(c(strRef, 'f')).trim()
      if (formula) series.nameFormula = limitText(formula)
      const cache = readCache(c(strRef, 'strCache'), 'string')
      const name = cache?.values.filter((v) => v !== null).join(' ')
      if (name !== undefined && cache?.count) series.name = limitText(name)
    } else {
      const literal = c(tx, 'v')
      if (literal) series.name = limitText(ownText(literal))
    }
  }
  const categories = parseDataSource(c(ser, 'cat'))
  if (categories) series.categories = categories
  const values = parseDataSource(c(ser, 'val')) ?? parseDataSource(c(ser, 'yVal'))
  if (values) series.values = values
  const xValues = parseDataSource(c(ser, 'xVal'))
  if (xValues) series.xValues = xValues
  const bubbleSizes = parseDataSource(c(ser, 'bubbleSize'))
  if (bubbleSizes) series.bubbleSizes = bubbleSizes
  const marker = parseMarker(c(ser, 'marker'))
  if (marker) series.marker = marker
  if (c(ser, 'smooth')) series.smooth = boolVal(ser, 'smooth', false)
  const explosion = numVal(ser, 'explosion')
  if (explosion !== undefined) series.explosion = clamp(explosion, 0, 400)
  if (c(ser, 'invertIfNegative')) series.invertIfNegative = boolVal(ser, 'invertIfNegative', false)
  for (const dPt of cs(ser, 'dPt').slice(0, MAX_CHART_POINTS)) {
    const index = numVal(dPt, 'idx')
    if (index === undefined || index < 0) continue
    const point: DataPointFormat = { index, format: parseShape(c(dPt, 'spPr')) }
    const pointMarker = parseMarker(c(dPt, 'marker'))
    if (pointMarker) point.marker = pointMarker
    const pointExplosion = numVal(dPt, 'explosion')
    if (pointExplosion !== undefined) point.explosion = clamp(pointExplosion, 0, 400)
    if (c(dPt, 'invertIfNegative')) point.invertIfNegative = boolVal(dPt, 'invertIfNegative', false)
    series.points.push(point)
  }
  const labels = parseDataLabels(c(ser, 'dLbls'), groupLabels)
  if (labels) series.dataLabels = labels
  return series
}

const GROUP_TYPES: Record<string, { type: ChartType; is3D: boolean }> = {
  barChart: { type: 'bar', is3D: false },
  bar3DChart: { type: 'bar', is3D: true },
  lineChart: { type: 'line', is3D: false },
  line3DChart: { type: 'line', is3D: true },
  areaChart: { type: 'area', is3D: false },
  area3DChart: { type: 'area', is3D: true },
  pieChart: { type: 'pie', is3D: false },
  pie3DChart: { type: 'pie', is3D: true },
  doughnutChart: { type: 'doughnut', is3D: false },
  scatterChart: { type: 'scatter', is3D: false },
  bubbleChart: { type: 'bubble', is3D: false },
  radarChart: { type: 'radar', is3D: false },
}

const UNSUPPORTED_TYPES: Record<string, string> = {
  stockChart: 'stock',
  surfaceChart: 'surface',
  surface3DChart: 'surface',
  ofPieChart: 'pie of pie / bar of pie',
}

function parseGroup(element: Element, type: ChartType, is3D: boolean): ChartGroup {
  const groupingText = val(element, 'grouping')
  const grouping: Grouping =
    groupingText === 'stacked' || groupingText === 'percentStacked' || groupingText === 'clustered' || groupingText === 'standard'
      ? groupingText
      : type === 'bar'
        ? 'clustered'
        : 'standard'
  const defaultVary = type === 'pie' || type === 'doughnut'
  const group: ChartGroup = {
    type,
    is3D,
    barDirection: val(element, 'barDir') === 'bar' ? 'bar' : 'col',
    // A clustered 3-D bar chart may say `standard`; draw it clustered.
    grouping: type === 'bar' && grouping === 'standard' ? 'clustered' : grouping,
    varyColors: boolVal(element, 'varyColors', defaultVary),
    gapWidth: clamp(numVal(element, 'gapWidth') ?? 150, 0, 500),
    overlap: clamp(numVal(element, 'overlap') ?? (grouping === 'stacked' || grouping === 'percentStacked' ? 100 : 0), -100, 100),
    holeSize: clamp(numVal(element, 'holeSize') ?? 50, 1, 90),
    firstSliceAngle: (((numVal(element, 'firstSliceAng') ?? 0) % 360) + 360) % 360,
    showMarkers: boolVal(element, 'marker', type !== 'line'),
    bubbleScale: clamp(numVal(element, 'bubbleScale') ?? 100, 0, 300),
    showNegativeBubbles: boolVal(element, 'showNegBubbles', false),
    sizeRepresents: val(element, 'sizeRepresents') === 'w' ? 'w' : 'area',
    axisIds: cs(element, 'axId')
      .map((el) => numberAttribute(el, 'val'))
      .filter((id): id is number => id !== undefined),
    series: [],
  }
  // Excel stacks bars only when they fully overlap; stacked groups always do.
  if (type === 'bar' && (group.grouping === 'stacked' || group.grouping === 'percentStacked')) group.overlap = 100
  const scatterStyle = val(element, 'scatterStyle')
  if (scatterStyle) group.scatterStyle = scatterStyle
  const radarStyle = val(element, 'radarStyle')
  if (radarStyle) group.radarStyle = radarStyle
  const labels = parseDataLabels(c(element, 'dLbls'))
  if (labels) group.dataLabels = labels
  for (const ser of cs(element, 'ser').slice(0, MAX_CHART_SERIES)) group.series.push(parseSeries(ser, labels))
  group.series.sort((x, y) => x.order - y.order)
  return group
}

const TICK_MARKS = new Set(['none', 'in', 'out', 'cross'])

function parseAxis(element: Element, kind: ChartAxis['kind']): ChartAxis {
  const scaling = c(element, 'scaling')
  const position = val(element, 'axPos')
  const crosses = val(element, 'crosses')
  const majorTick = val(element, 'majorTickMark')
  const minorTick = val(element, 'minorTickMark')
  const labelPosition = val(element, 'tickLblPos')
  const axis: ChartAxis = {
    id: numVal(element, 'axId') ?? 0,
    kind,
    deleted: boolVal(element, 'delete', false),
    position: position === 't' || position === 'l' || position === 'r' ? position : 'b',
    crosses: crosses === 'min' || crosses === 'max' ? crosses : 'autoZero',
    reversed: val(scaling, 'orientation') === 'maxMin',
    majorTickMark: majorTick && TICK_MARKS.has(majorTick) ? (majorTick as ChartAxis['majorTickMark']) : 'cross',
    minorTickMark: minorTick && TICK_MARKS.has(minorTick) ? (minorTick as ChartAxis['minorTickMark']) : 'none',
    tickLabelPosition: labelPosition === 'low' || labelPosition === 'high' || labelPosition === 'none' ? labelPosition : 'nextTo',
    format: parseShape(c(element, 'spPr')),
    textStyle: {},
  }
  const crossAxisId = numVal(element, 'crossAx')
  if (crossAxisId !== undefined) axis.crossAxisId = crossAxisId
  const crossesAt = numVal(element, 'crossesAt')
  if (crossesAt !== undefined) axis.crossesAt = crossesAt
  const crossBetween = val(element, 'crossBetween')
  if (crossBetween === 'between' || crossBetween === 'midCat') axis.crossBetween = crossBetween
  const logBase = numVal(scaling, 'logBase')
  if (logBase !== undefined && logBase >= 2 && logBase <= 1000) axis.logBase = logBase
  const min = numVal(scaling, 'min')
  const max = numVal(scaling, 'max')
  if (min !== undefined) axis.min = min
  if (max !== undefined) axis.max = max
  if (min !== undefined && max !== undefined && min >= max) {
    delete axis.min
    delete axis.max
  }
  const majorUnit = numVal(element, 'majorUnit')
  if (majorUnit !== undefined && majorUnit > 0) axis.majorUnit = majorUnit
  const minorUnit = numVal(element, 'minorUnit')
  if (minorUnit !== undefined && minorUnit > 0) axis.minorUnit = minorUnit
  const major = c(element, 'majorGridlines')
  if (major) axis.majorGridlines = parseShape(c(major, 'spPr'))
  const minor = c(element, 'minorGridlines')
  if (minor) axis.minorGridlines = parseShape(c(minor, 'spPr'))
  const numberFormat = parseNumberFormat(c(element, 'numFmt'))
  if (numberFormat) axis.numberFormat = numberFormat
  const title = parseTitle(c(element, 'title'))
  if (title) axis.title = title
  const text = parseTextBody(c(element, 'txPr'))
  axis.textStyle = text.style
  if (text.rotation !== undefined) axis.textRotation = text.rotation
  const skip = numVal(element, 'tickLblSkip')
  if (skip !== undefined && skip >= 1) axis.tickLabelSkip = Math.floor(skip)
  const markSkip = numVal(element, 'tickMarkSkip')
  if (markSkip !== undefined && markSkip >= 1) axis.tickMarkSkip = Math.floor(markSkip)
  const timeUnit = (name: string) => {
    const unit = val(element, name)
    return unit === 'days' || unit === 'months' || unit === 'years' ? unit : undefined
  }
  const baseTimeUnit = timeUnit('baseTimeUnit')
  if (baseTimeUnit) axis.baseTimeUnit = baseTimeUnit
  const majorTimeUnit = timeUnit('majorTimeUnit')
  if (majorTimeUnit) axis.majorTimeUnit = majorTimeUnit
  const dispUnits = c(element, 'dispUnits')
  if (dispUnits) {
    const custom = numVal(dispUnits, 'custUnit')
    const builtIn = val(dispUnits, 'builtInUnit')
    const units: Record<string, number> = {
      hundreds: 1e2,
      thousands: 1e3,
      tenThousands: 1e4,
      hundredThousands: 1e5,
      millions: 1e6,
      tenMillions: 1e7,
      hundredMillions: 1e8,
      billions: 1e9,
      trillions: 1e12,
    }
    const unit = custom ?? (builtIn ? units[builtIn] : undefined)
    if (unit && unit > 0 && Number.isFinite(unit)) axis.displayUnit = unit
  }
  return axis
}

function parseLegend(element: Element | undefined): Legend | undefined {
  if (!element) return undefined
  const position = val(element, 'legendPos')
  const legend: Legend = {
    position: position === 'l' || position === 't' || position === 'b' || position === 'tr' ? position : 'r',
    overlay: boolVal(element, 'overlay', false),
    deletedEntries: [],
    style: parseTextBody(c(element, 'txPr')).style,
    format: parseShape(c(element, 'spPr')),
  }
  for (const entry of cs(element, 'legendEntry').slice(0, 10_000)) {
    const index = numVal(entry, 'idx')
    if (index !== undefined && boolVal(entry, 'delete', false)) legend.deletedEntries.push(index)
  }
  const layout = parseLayout(c(element, 'layout'))
  if (layout) legend.layout = layout
  return legend
}

function emptyModel(): ChartModel {
  return {
    unsupported: false,
    autoTitleDeleted: false,
    groups: [],
    axes: [],
    displayBlanksAs: 'zero',
    plotVisibleOnly: true,
    style: 2,
    roundedCorners: false,
    date1904: false,
    chartFormat: {},
    plotAreaFormat: {},
    textStyle: {},
  }
}

function unsupported(reason: string, error?: string): ChartModel {
  const model = emptyModel()
  model.unsupported = true
  model.unsupportedReason = reason
  if (error) model.error = error
  return model
}

/**
 * Reads a chart part. Never throws: malformed XML yields a model with `error` set, and chart
 * kinds we cannot draw (stock, surface, pie-of-pie, chartex) yield `unsupported`, so the caller
 * shows a placeholder in either case.
 */
export function parseChart(xml: string): ChartModel {
  let root: Element | null
  try {
    let source = xml
    if (source.includes(STRICT_CHART_NS)) {
      source = source.split(STRICT_CHART_NS).join(CHART_NS).split(STRICT_DRAWINGML_NS).join(DRAWINGML_NS)
    }
    root = parseXml(source).documentElement
  } catch (error) {
    return unsupported('The chart could not be read', error instanceof Error ? error.message : String(error))
  }
  if (!root) return unsupported('The chart could not be read', 'No root element')
  if (root.namespaceURI === CHARTEX_NS) return unsupported('This chart type is not supported yet')
  if (root.namespaceURI !== CHART_NS || root.localName !== 'chartSpace') return unsupported('The chart could not be read', 'Not a chart part')

  try {
    return parseChartSpace(root)
  } catch (error) {
    return unsupported('The chart could not be read', error instanceof Error ? error.message : String(error))
  }
}

function parseChartSpace(root: Element): ChartModel {
  const model = emptyModel()
  model.date1904 = boolVal(root, 'date1904', false)
  model.roundedCorners = boolVal(root, 'roundedCorners', true)
  const style = numVal(root, 'style')
  if (style !== undefined && style >= 1 && style <= 48) model.style = Math.floor(style)
  model.chartFormat = parseShape(c(root, 'spPr'))
  model.textStyle = parseTextBody(c(root, 'txPr')).style
  const chart = c(root, 'chart')
  if (!chart) return unsupported('The chart is empty')

  const title = parseTitle(c(chart, 'title'))
  if (title) model.title = title
  model.autoTitleDeleted = boolVal(chart, 'autoTitleDeleted', false)
  model.plotVisibleOnly = boolVal(chart, 'plotVisOnly', true)
  const blanks = val(chart, 'dispBlanksAs')
  model.displayBlanksAs = blanks === 'gap' || blanks === 'span' ? blanks : 'zero'
  const legend = parseLegend(c(chart, 'legend'))
  if (legend) model.legend = legend

  const plotArea = c(chart, 'plotArea')
  model.plotAreaFormat = parseShape(c(plotArea, 'spPr'))
  const layout = parseLayout(c(plotArea, 'layout'))
  if (layout) model.plotAreaLayout = layout
  for (const element of kids(plotArea)) {
    if (element.namespaceURI !== CHART_NS) continue
    const name = element.localName ?? ''
    const known = GROUP_TYPES[name]
    if (known) {
      model.groups.push(parseGroup(element, known.type, known.is3D))
      continue
    }
    const unknown = UNSUPPORTED_TYPES[name]
    if (unknown) {
      const result = unsupported(`${unknown[0]!.toUpperCase()}${unknown.slice(1)} charts are not supported yet`)
      return result
    }
    if (name === 'catAx') model.axes.push(parseAxis(element, 'category'))
    else if (name === 'valAx') model.axes.push(parseAxis(element, 'value'))
    else if (name === 'dateAx') model.axes.push(parseAxis(element, 'date'))
    else if (name === 'serAx') model.axes.push(parseAxis(element, 'series'))
  }
  if (!model.groups.length) return unsupported('The chart has no data to show')
  return model
}
