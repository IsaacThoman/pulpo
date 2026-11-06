import type { DrawingColor } from '../../ooxml/theme.js'

/**
 * A DrawingML chart (`xl/charts/chartN.xml`) as the renderer needs it. The file itself is kept
 * untouched; this model is read-only and rebuilt whenever the part changes. Colors stay unresolved
 * (scheme colors resolve against the workbook theme at render time).
 */

export type Fill =
  | { type: 'none' }
  | { type: 'solid'; color: DrawingColor }
  | { type: 'gradient'; stops: { position: number; color: DrawingColor }[]; angle?: number }
  | { type: 'pattern'; foreground?: DrawingColor; background?: DrawingColor }
  /** Picture, group, or other fills we do not draw; the renderer uses the automatic color. */
  | { type: 'other' }

export interface LineFormat {
  fill?: Fill
  /** Width in points. */
  width?: number
  /** `a:prstDash` value (`solid`, `dash`, `sysDot`, …). */
  dash?: string
}

/** `c:spPr`: what the file says; anything missing falls back to the chart style. */
export interface ShapeFormat {
  fill?: Fill
  line?: LineFormat
}

export interface TextStyle {
  /** Points. */
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: DrawingColor
  /** A typeface or theme font reference (`+mn-lt`). */
  font?: string
}

export interface TextRun {
  text: string
  style: TextStyle
}

export interface ManualLayout {
  /** For the plot area: whether x/y/w/h bound the plot itself (`inner`) or include its labels. */
  target?: 'inner' | 'outer'
  xMode: 'edge' | 'factor'
  yMode: 'edge' | 'factor'
  x?: number
  y?: number
  w?: number
  h?: number
}

/** A title (chart or axis). */
export interface ChartText {
  /** Rich text paragraphs, each a list of runs. Empty when the text comes from `ref`/auto. */
  paragraphs: TextRun[][]
  /** Text from a cell reference (`c:tx/c:strRef`). */
  ref?: { formula?: string; cache?: string }
  /** Default run style (`a:defRPr` / `c:txPr`). */
  style: TextStyle
  /** Degrees, from `a:bodyPr rot`. */
  rotation?: number
  overlay: boolean
  format: ShapeFormat
  layout?: ManualLayout
}

export type ChartValue = number | string | null

/** A series' categories, values, x/y values, or bubble sizes. */
export interface DataSource {
  /** The `c:f` reference (`Sheet1!$B$2:$B$7`), if any. */
  formula?: string
  kind: 'number' | 'string' | 'multiLevel'
  /** The cache's (or first point's) number format code. */
  formatCode?: string
  /** Point count (capped at MAX_CHART_POINTS). */
  count: number
  /** Cached points, `count` long; missing points are null. */
  values: ChartValue[]
  /** Multi-level category labels: `levels[0]` is the innermost (next to the axis). */
  levels?: (string | null)[][]
}

export type MarkerSymbol = 'none' | 'auto' | 'circle' | 'square' | 'diamond' | 'triangle' | 'x' | 'star' | 'dot' | 'dash' | 'plus' | 'picture'

export interface MarkerFormat {
  symbol?: MarkerSymbol
  /** Points (2–72). */
  size?: number
  format: ShapeFormat
}

export interface DataLabelSettings {
  showValue: boolean
  showPercent: boolean
  showCategoryName: boolean
  showSeriesName: boolean
  showLegendKey: boolean
  showBubbleSize: boolean
  separator?: string
  numberFormat?: NumberFormat
  /** `c:dLblPos` (`outEnd`, `inEnd`, `ctr`, `inBase`, `t`, `b`, `l`, `r`, `bestFit`). */
  position?: string
  style: TextStyle
  format: ShapeFormat
}

export interface DataLabels extends DataLabelSettings {
  /** All labels of this series/group are deleted. */
  deleted: boolean
  /** Per-point overrides (`c:dLbl`). */
  points: (DataLabelSettings & { index: number; deleted: boolean })[]
}

export interface DataPointFormat {
  index: number
  format: ShapeFormat
  marker?: MarkerFormat
  explosion?: number
  invertIfNegative?: boolean
}

export interface ChartSeries {
  index: number
  order: number
  /** Literal or cached name. */
  name?: string
  /** `c:tx/c:strRef/c:f`. */
  nameFormula?: string
  categories?: DataSource
  values?: DataSource
  /** Scatter and bubble x values (`c:xVal`); `values` holds `c:yVal`. */
  xValues?: DataSource
  bubbleSizes?: DataSource
  format: ShapeFormat
  marker?: MarkerFormat
  points: DataPointFormat[]
  smooth?: boolean
  explosion?: number
  invertIfNegative?: boolean
  dataLabels?: DataLabels
}

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'bubble' | 'radar'
export type Grouping = 'clustered' | 'stacked' | 'percentStacked' | 'standard'

/** One chart type element of the plot area (`c:barChart`, `c:lineChart`, …). */
export interface ChartGroup {
  type: ChartType
  /** Drawn flat: we do not render perspective. */
  is3D: boolean
  barDirection: 'col' | 'bar'
  grouping: Grouping
  varyColors: boolean
  /** Bar gap as a percentage of bar width (0–500). */
  gapWidth: number
  /** Bar overlap percentage (-100–100). */
  overlap: number
  /** Doughnut hole size percentage (10–90). */
  holeSize: number
  /** Pie/doughnut first slice angle, degrees clockwise from 12 o'clock. */
  firstSliceAngle: number
  scatterStyle?: string
  radarStyle?: string
  /** Line charts: `c:marker val`, whether series show markers by default. */
  showMarkers: boolean
  bubbleScale: number
  showNegativeBubbles: boolean
  sizeRepresents: 'area' | 'w'
  axisIds: number[]
  series: ChartSeries[]
  dataLabels?: DataLabels
}

export interface NumberFormat {
  formatCode: string
  /** Use the source data's format instead. */
  sourceLinked: boolean
}

export interface ChartAxis {
  id: number
  kind: 'category' | 'value' | 'date' | 'series'
  deleted: boolean
  /** `c:axPos` as written; the renderer derives the real side from the chart type and crossings. */
  position: 'b' | 't' | 'l' | 'r'
  crossAxisId?: number
  crosses: 'autoZero' | 'min' | 'max'
  crossesAt?: number
  crossBetween?: 'between' | 'midCat'
  reversed: boolean
  logBase?: number
  min?: number
  max?: number
  majorUnit?: number
  minorUnit?: number
  majorGridlines?: ShapeFormat
  minorGridlines?: ShapeFormat
  numberFormat?: NumberFormat
  majorTickMark: 'none' | 'in' | 'out' | 'cross'
  minorTickMark: 'none' | 'in' | 'out' | 'cross'
  tickLabelPosition: 'nextTo' | 'low' | 'high' | 'none'
  title?: ChartText
  format: ShapeFormat
  textStyle: TextStyle
  /** Label rotation in degrees from `c:txPr/a:bodyPr rot`. */
  textRotation?: number
  tickLabelSkip?: number
  tickMarkSkip?: number
  baseTimeUnit?: 'days' | 'months' | 'years'
  majorTimeUnit?: 'days' | 'months' | 'years'
  /** `c:dispUnits` divisor (1000 for thousands …). */
  displayUnit?: number
}

export interface Legend {
  position: 'r' | 'l' | 't' | 'b' | 'tr'
  overlay: boolean
  /** Entry indexes the user deleted. */
  deletedEntries: number[]
  style: TextStyle
  format: ShapeFormat
  layout?: ManualLayout
}

export interface ChartModel {
  /** The caller should show a placeholder instead of rendering. */
  unsupported: boolean
  /** Why: an unsupported chart type, a chartex chart, or unreadable XML. */
  unsupportedReason?: string
  /** Set when the XML could not be parsed at all. */
  error?: string
  title?: ChartText
  autoTitleDeleted: boolean
  groups: ChartGroup[]
  axes: ChartAxis[]
  legend?: Legend
  displayBlanksAs: 'gap' | 'zero' | 'span'
  plotVisibleOnly: boolean
  /** `c:style` (1–48), the Office 2007 style that fills in unformatted elements. */
  style: number
  roundedCorners: boolean
  date1904: boolean
  chartFormat: ShapeFormat
  plotAreaFormat: ShapeFormat
  plotAreaLayout?: ManualLayout
  /** `c:chartSpace/c:txPr`: the default for every text in the chart. */
  textStyle: TextStyle
}

/** The most points a series keeps; longer series are truncated. */
export const MAX_CHART_POINTS = 1_048_576
/** The most series a chart keeps (Excel's limit is 255). */
export const MAX_CHART_SERIES = 255
