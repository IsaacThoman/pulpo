import { dateToSerial, serialToParts } from '../dates.js'
import type { ResolvedSeries } from './data.js'
import { labelText, renderDataLabel, type LabelAnchor, type LabelValues } from './labels.js'
import { fillToCss } from './colors.js'
import type { ChartAxis, ChartGroup, DataLabelSettings, ShapeFormat } from './model.js'
import { computeValueScale, type AxisScale } from './scale.js'
import { markerSvg, seriesPaint } from './style.js'
import { n, truncateText, wrapText } from './text.js'
import { lineSegment, path, rect, resolveLine, resolveText, text, textBlock, textWidth, type Rect, type RenderContext, type ResolvedText } from './svg.js'

/** Bar, line, area, scatter, and bubble charts: everything drawn against two axes. */

type Side = 'left' | 'right' | 'top' | 'bottom'

interface AxisInfo {
  axis: ChartAxis
  role: 'category' | 'value'
  orientation: 'h' | 'v'
  /** The axis this one crosses. */
  cross?: AxisInfo
  series: ResolvedSeries[]
  groups: ChartGroup[]
  visible: boolean
  // Category axes
  count: number
  labels: string[]
  outerLevels: (string | null)[][]
  between: boolean
  date?: DateAxis
  // Value axes
  scale?: AxisScale
  dataMin: number
  dataMax: number
  percent: boolean
  formatCode?: string
  // Layout
  labelStyle: ResolvedText
  labelSide: Side
  labelLayout?: CategoryLabelLayout
  valueLabelExtent: number
  titleExtent: number
}

interface DateAxis {
  /** Slot index for each point. */
  slots: number[]
  /** Serial of each slot's start. */
  slotSerials: number[]
  unit: 'days' | 'months' | 'years'
  formatCode?: string
}

interface CategoryLabelLayout {
  /** Every `skip`-th label is drawn. */
  skip: number
  rotate: number
  /** Lines per label (wrapped), indexed like labels. */
  lines: Map<number, string[]>
  /** Perpendicular extent in px. */
  extent: number
}

const DEFAULT_TICK = 4
const LABEL_GAP = 4

function syntheticAxis(id: number, kind: ChartAxis['kind'], position: ChartAxis['position'], crossAxisId: number): ChartAxis {
  return {
    id,
    kind,
    deleted: false,
    position,
    crossAxisId,
    crosses: 'autoZero',
    reversed: false,
    majorTickMark: 'none',
    minorTickMark: 'none',
    tickLabelPosition: 'nextTo',
    format: {},
    textStyle: {},
    ...(kind === 'value' ? { majorGridlines: {} } : {}),
  }
}

function isHorizontalPosition(axis: ChartAxis): boolean {
  return axis.position === 'b' || axis.position === 't'
}

/** [independent axis, dependent axis] for a group. */
function groupAxes(ctx: RenderContext, group: ChartGroup, index: number): [ChartAxis, ChartAxis] {
  const found = group.axisIds.map((id) => ctx.model.axes.find((axis) => axis.id === id)).filter((axis): axis is ChartAxis => !!axis)
  const fallbackX = syntheticAxis(-1 - index * 2, group.type === 'scatter' || group.type === 'bubble' ? 'value' : 'category', 'b', -2 - index * 2)
  const fallbackY = syntheticAxis(-2 - index * 2, 'value', 'l', -1 - index * 2)
  if (group.type === 'scatter' || group.type === 'bubble') {
    const values = found.filter((axis) => axis.kind === 'value')
    if (values.length >= 2) {
      const [first, second] = values as [ChartAxis, ChartAxis]
      if (isHorizontalPosition(second) && !isHorizontalPosition(first)) return [second, first]
      return [first, second]
    }
    return [values[0] && isHorizontalPosition(values[0]) ? values[0] : fallbackX, values[0] && !isHorizontalPosition(values[0]) ? values[0] : fallbackY]
  }
  const category = found.find((axis) => axis.kind === 'category' || axis.kind === 'date') ?? found.find((axis) => axis.kind !== 'value' && axis.kind !== 'series')
  const value = found.find((axis) => axis.kind === 'value')
  return [category ?? fallbackX, value ?? fallbackY]
}

function seriesOfGroup(all: ResolvedSeries[], group: ChartGroup): ResolvedSeries[] {
  return all.filter((series) => series.group === group)
}

/** Category labels for an axis: formatted text per point. */
function categoryLabels(ctx: RenderContext, info: AxisInfo): void {
  const withCategories = info.series.find((series) => series.categories && series.categories.values.length)
  let count = 0
  for (const series of info.series) count = Math.max(count, series.values.length, series.categories?.values.length ?? 0)
  info.count = count
  const labels: string[] = new Array<string>(count)
  const source = withCategories?.categories
  const format = info.axis.numberFormat && !info.axis.numberFormat.sourceLinked ? info.axis.numberFormat.formatCode : source?.formatCode
  for (let i = 0; i < count; i++) {
    const value = source?.values[i]
    labels[i] = value === null || value === undefined ? (source ? '' : String(i + 1)) : typeof value === 'number' ? ctx.format(value, format) : value
  }
  info.labels = labels
  if (source?.levels && source.levels.length > 1) info.outerLevels = source.levels.slice(1, 3)

  // Date axes place points by date when the categories are dates.
  const numeric = !!source && source.values.length > 0 && source.values.every((value) => value === null || typeof value === 'number')
  if (info.axis.kind === 'date' && numeric && source) {
    const serials = source.values.map((value) => (typeof value === 'number' ? Math.floor(value) : NaN))
    const finite = serials.filter((value) => Number.isFinite(value))
    if (finite.length) {
      const min = Math.min(...finite.slice(0, 100_000))
      const max = Math.max(...finite.slice(0, 100_000))
      const unit = info.axis.baseTimeUnit ?? 'days'
      const date1904 = ctx.model.date1904
      const monthIndex = (serial: number) => {
        const parts = serialToParts(serial, date1904)
        return parts ? parts.year * 12 + parts.month - 1 : 0
      }
      const slotOf = (serial: number) =>
        unit === 'days' ? serial - min : unit === 'months' ? monthIndex(serial) - monthIndex(min) : Math.floor(monthIndex(serial) / 12) - Math.floor(monthIndex(min) / 12)
      const slotCount = Math.min(100_000, Math.max(1, slotOf(max) + 1))
      const slotSerials: number[] = []
      if (unit === 'days') for (let i = 0; i < slotCount; i++) slotSerials.push(min + i)
      else {
        // Each slot starts on the first of its month (or year).
        const start = monthIndex(min)
        for (let i = 0; i < slotCount; i++) {
          const month = unit === 'months' ? start + i : (Math.floor(start / 12) + i) * 12
          slotSerials.push(dateToSerial(Math.floor(month / 12), (month % 12) + 1, 1, date1904))
        }
      }
      const date: DateAxis = { slots: serials.map((serial) => (Number.isFinite(serial) ? Math.min(slotCount - 1, slotOf(serial)) : -1)), slotSerials, unit }
      const dateFormat = format && format !== 'General' ? format : undefined
      if (dateFormat) date.formatCode = dateFormat
      info.date = date
      info.count = slotCount
      info.labels = slotSerials.map((serial) => ctx.format(serial, dateFormat ?? 'm/d/yyyy'))
    }
  }
}

/** Stacked [start, end] per series and point for a bar/line/area group. */
function stackGroup(group: ChartGroup, series: ResolvedSeries[], blanksAsZero: boolean): { start: (number | null)[]; end: (number | null)[] }[] {
  const stacked = group.grouping === 'stacked' || group.grouping === 'percentStacked'
  const percent = group.grouping === 'percentStacked'
  const count = series.reduce((max, s) => Math.max(max, s.values.length), 0)
  if (!stacked) {
    return series.map((s) => ({
      start: s.values.map((v) => (v === null && !blanksAsZero ? null : 0)),
      end: s.values.map((v) => (v === null ? (blanksAsZero ? 0 : null) : v)),
    }))
  }
  const totals: number[] = new Array<number>(count).fill(0)
  if (percent) for (const s of series) for (let i = 0; i < count; i++) totals[i]! += Math.abs(s.values[i] ?? 0)
  const positive: number[] = new Array<number>(count).fill(0)
  const negative: number[] = new Array<number>(count).fill(0)
  const lineLike = group.type !== 'bar'
  return series.map((s) => {
    const start: (number | null)[] = new Array<number | null>(count)
    const end: (number | null)[] = new Array<number | null>(count)
    for (let i = 0; i < count; i++) {
      const raw = s.values[i]
      const value = raw === null || raw === undefined ? 0 : percent ? (totals[i] ? raw / totals[i]! : 0) : raw
      if (lineLike) {
        // Lines and areas stack as a running sum.
        start[i] = positive[i]!
        positive[i]! += value
        end[i] = raw === null && !blanksAsZero && group.type === 'line' ? null : positive[i]!
      } else if (value >= 0) {
        start[i] = positive[i]!
        positive[i]! += value
        end[i] = raw === null ? null : positive[i]!
      } else {
        start[i] = negative[i]!
        negative[i]! += value
        end[i] = raw === null ? null : negative[i]!
      }
    }
    return { start, end }
  })
}

/** Tick label format for a value axis. */
function valueFormatCode(info: AxisInfo): string | undefined {
  const numberFormat = info.axis.numberFormat
  if (numberFormat && !numberFormat.sourceLinked) return numberFormat.formatCode
  if (info.percent) return '0%'
  const linked = info.series.find((series) => series.valueFormat)
  if (info.cross?.role === 'value' && info.orientation === 'h') {
    // Scatter x axis: the x values' format.
    const x = info.series.find((series) => series.series.xValues?.formatCode)
    return x?.series.xValues?.formatCode ?? numberFormat?.formatCode
  }
  return linked?.valueFormat ?? numberFormat?.formatCode
}

function sideLength(plot: Rect, info: AxisInfo): number {
  return info.orientation === 'h' ? plot.w : plot.h
}

function computeScale(ctx: RenderContext, info: AxisInfo, plot: Rect): void {
  const length = Math.max(10, sideLength(plot, info))
  const style = info.labelStyle
  let spacing: number
  if (info.orientation === 'v') spacing = style.px * 1.9
  else {
    // Horizontal value axes: room for the widest label.
    const sample = [info.dataMin, info.dataMax].filter(Number.isFinite).map((value) => textWidth(ctx.format(value, info.formatCode), style))
    spacing = Math.max(style.px * 3, ...sample.map((width) => width + style.px * 1.5))
  }
  const options: Parameters<typeof computeValueScale>[2] = { maxIntervals: Math.max(1, Math.floor(length / spacing)) }
  const axis = info.axis
  if (axis.min !== undefined) options.min = axis.min
  if (axis.max !== undefined) options.max = axis.max
  if (axis.majorUnit !== undefined) options.majorUnit = axis.majorUnit
  if (axis.logBase !== undefined) options.logBase = axis.logBase
  if (info.percent) options.percent = true
  info.scale = computeValueScale(info.dataMin, info.dataMax, options)
}

/** Maps a value to a pixel coordinate along a value axis. */
function valueToPx(info: AxisInfo, plot: Rect, value: number): number {
  const scale = info.scale!
  let t: number
  if (scale.logBase) {
    const log = (v: number) => Math.log(v) / Math.log(scale.logBase!)
    t = value > 0 ? (log(value) - log(scale.min)) / (log(scale.max) - log(scale.min)) : -1
  } else t = (value - scale.min) / (scale.max - scale.min)
  if (!Number.isFinite(t)) t = 0
  if (info.axis.reversed) t = 1 - t
  return info.orientation === 'h' ? plot.x + t * plot.w : plot.y + plot.h - t * plot.h
}

/** Maps a continuous category coordinate (center of category i is i + 0.5 between ticks, i on them). */
function categoryToPx(info: AxisInfo, plot: Rect, u: number): number {
  const count = Math.max(1, info.count)
  let t: number
  if (info.between) t = u / count
  else t = count > 1 ? u / (count - 1) : 0.5 + u
  if (info.axis.reversed) t = 1 - t
  return info.orientation === 'h' ? plot.x + t * plot.w : plot.y + plot.h - t * plot.h
}

function categoryCenter(info: AxisInfo, index: number): number {
  const slot = info.date ? (info.date.slots[index] ?? -1) : index
  return info.between ? slot + 0.5 : slot
}

function bandPx(info: AxisInfo, plot: Rect): number {
  const count = Math.max(1, info.count)
  return sideLength(plot, info) / (info.between ? count : Math.max(1, count - 1))
}

/** The value where a category (or x) axis crosses a value axis. */
function crossingValue(info: AxisInfo, valueAxis: AxisInfo): number {
  const scale = valueAxis.scale!
  if (info.axis.crossesAt !== undefined) return Math.min(scale.max, Math.max(scale.min, info.axis.crossesAt))
  if (info.axis.crosses === 'min') return scale.min
  if (info.axis.crosses === 'max') return scale.max
  if (scale.logBase) return scale.min
  return Math.min(scale.max, Math.max(scale.min, 0))
}

/** Pixel position of `info`'s axis line along its cross axis. */
function axisLinePosition(info: AxisInfo, plot: Rect): number {
  const cross = info.cross
  const vertical = info.orientation === 'v'
  if (!cross) return vertical ? plot.x : plot.y + plot.h
  if (cross.role === 'value' && cross.scale) return valueToPx(cross, plot, crossingValue(info, cross))
  // Crossing a category axis: at the first or last category edge.
  const atMax = info.axis.crosses === 'max'
  const u = atMax ? (cross.between ? cross.count : Math.max(0, cross.count - 1)) : 0
  if (info.axis.crossesAt !== undefined && cross.count > 0) {
    // crossesAt counts categories from 1; between ticks it crosses at that category's leading edge.
    const at = Math.max(1, Math.min(cross.count, info.axis.crossesAt)) - 1
    return categoryToPx(cross, plot, at)
  }
  return categoryToPx(cross, plot, u)
}

function minSide(info: AxisInfo): Side {
  // The side of the plot at the cross axis' minimum.
  const cross = info.cross
  const reversed = cross?.axis.reversed ?? false
  if (info.orientation === 'v') return reversed ? 'right' : 'left'
  return reversed ? 'top' : 'bottom'
}

function opposite(side: Side): Side {
  return side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top'
}

function labelSide(info: AxisInfo, plot: Rect): Side {
  const near = minSide(info)
  const position = info.axis.tickLabelPosition
  if (position === 'low') return near
  if (position === 'high') return opposite(near)
  // Next to the axis: on the far side only when the axis sits at the far edge.
  const line = axisLinePosition(info, plot)
  const far = opposite(near)
  const edge = far === 'right' ? plot.x + plot.w : far === 'left' ? plot.x : far === 'top' ? plot.y : plot.y + plot.h
  return Math.abs(line - edge) < 0.5 ? far : near
}

function tickLength(mark: ChartAxis['majorTickMark']): { outside: number; inside: number } {
  if (mark === 'out') return { outside: DEFAULT_TICK, inside: 0 }
  if (mark === 'in') return { outside: 0, inside: DEFAULT_TICK }
  if (mark === 'cross') return { outside: DEFAULT_TICK, inside: DEFAULT_TICK }
  return { outside: 0, inside: 0 }
}

/** Labels to measure for a category axis (all, or a sample for huge axes). */
function sampleIndexes(count: number, limit = 400): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, i) => i)
  const step = count / limit
  return Array.from({ length: limit }, (_, i) => Math.floor(i * step))
}

function layoutCategoryLabels(info: AxisInfo, plot: Rect): CategoryLabelLayout {
  const style = info.labelStyle
  const band = bandPx(info, plot)
  const lineHeight = style.px * 1.2
  const indexes = sampleIndexes(info.count)
  const widths = indexes.map((i) => textWidth(info.labels[i] ?? '', style))
  const maxWidth = Math.max(0, ...widths)
  const explicitRotation = info.axis.textRotation
  const lines = new Map<number, string[]>()
  const fixedSkip = info.axis.tickLabelSkip

  if (info.orientation === 'v') {
    const skip = fixedSkip ?? Math.max(1, Math.ceil(lineHeight / Math.max(band, 1e-9)))
    const limit = Math.max(40, plot.w * 0.4)
    for (const i of indexes) lines.set(i, [truncateText(info.labels[i] ?? '', limit, style.px, style.bold)])
    return { skip, rotate: 0, lines, extent: Math.min(maxWidth, limit) }
  }

  if (explicitRotation !== undefined && explicitRotation !== 0) {
    const rad = (Math.abs(explicitRotation) * Math.PI) / 180
    const along = lineHeight / Math.max(Math.sin(rad), 0.2)
    const skip = fixedSkip ?? Math.max(1, Math.ceil(along / Math.max(band, 1e-9)))
    for (const i of indexes) lines.set(i, [info.labels[i] ?? ''])
    return { skip, rotate: explicitRotation, lines, extent: maxWidth * Math.sin(rad) + lineHeight * Math.cos(rad) }
  }

  // Horizontal if every label fits its band, else wrap to two lines, else rotate 45°.
  if (fixedSkip || maxWidth <= band * 0.95) {
    const skip = fixedSkip ?? 1
    for (const i of indexes) lines.set(i, [info.labels[i] ?? ''])
    const fits = maxWidth <= band * skip * 0.95
    if (fits || fixedSkip) {
      for (const i of indexes) lines.set(i, wrapText(info.labels[i] ?? '', band * skip * 0.95, style.px, style.bold, 2))
      const rows = Math.max(1, ...[...lines.values()].map((l) => l.length))
      return { skip, rotate: 0, lines, extent: rows * lineHeight }
    }
  }
  const wrapped = indexes.map((i) => wrapText(info.labels[i] ?? '', band * 0.95, style.px, style.bold, 2))
  const wrapFits = wrapped.every((label, k) => label.every((line) => textWidth(line, style) <= band * 0.95) && !label.some((line) => line.endsWith('…')) && k >= 0)
  if (wrapFits && band > style.px * 2) {
    indexes.forEach((i, k) => lines.set(i, wrapped[k]!))
    return { skip: 1, rotate: 0, lines, extent: 2 * lineHeight }
  }
  const limit = Math.max(30, Math.min(plot.h * 0.6, 200))
  for (const i of indexes) lines.set(i, [truncateText(info.labels[i] ?? '', limit, style.px, style.bold)])
  const along = lineHeight * Math.SQRT2
  const skip = Math.max(1, Math.ceil(along / Math.max(band, 1e-9)))
  const extent = (Math.min(maxWidth, limit) + lineHeight) * Math.SQRT1_2
  return { skip, rotate: -45, lines, extent }
}

function axisTitleExtent(ctx: RenderContext, info: AxisInfo): number {
  const title = info.axis.title
  if (!title || info.axis.deleted) return 0
  const style = resolveText(ctx, [ctx.model.textStyle, title.style], { size: ctx.baseSize, bold: false })
  const lines = Math.max(1, title.paragraphs.length || 1)
  return lines * style.px * 1.2 + 6
}

function axisTitleText(info: AxisInfo): string {
  const title = info.axis.title
  if (!title) return ''
  const fromRuns = title.paragraphs.map((runs) => runs.map((run) => run.text).join('')).join(' ')
  return fromRuns || title.ref?.cache || 'Axis Title'
}

/** Perpendicular extent of an axis' labels and ticks outside the plot. */
function labelExtent(ctx: RenderContext, info: AxisInfo, plot: Rect): number {
  if (!info.visible || info.axis.tickLabelPosition === 'none') return 0
  const ticks = tickLength(info.axis.majorTickMark).outside
  if (info.role === 'category') {
    info.labelLayout = layoutCategoryLabels(info, plot)
    const outer = info.orientation === 'h' ? info.outerLevels.length * info.labelStyle.px * 1.4 : 0
    return info.labelLayout.extent + ticks + LABEL_GAP + outer
  }
  const scale = info.scale!
  const labels = scale.ticks.map((tick) => formatTick(ctx, info, tick))
  if (info.orientation === 'v') return Math.max(0, ...labels.map((label) => textWidth(label, info.labelStyle))) + ticks + LABEL_GAP
  return info.labelStyle.px * 1.2 + ticks + LABEL_GAP
}

function formatTick(ctx: RenderContext, info: AxisInfo, value: number): string {
  const unit = info.axis.displayUnit ?? 1
  return ctx.format(unit !== 1 ? value / unit : value, info.formatCode)
}

export interface CartesianResult {
  svg: string
  plot: Rect
}

/** Lays out and draws axes and series inside `area`. */
export function renderCartesian(ctx: RenderContext, area: Rect, all: ResolvedSeries[]): CartesianResult {
  const model = ctx.model
  const groups = model.groups.filter((group) => group.type !== 'pie' && group.type !== 'doughnut' && group.type !== 'radar')
  const horizontalBars = groups[0]?.type === 'bar' && groups[0].barDirection === 'bar'
  const infos = new Map<number, AxisInfo>()
  const pairs: { group: ChartGroup; independent: AxisInfo; dependent: AxisInfo }[] = []
  const blanksAsZero = model.displayBlanksAs === 'zero'

  const infoFor = (axis: ChartAxis, role: AxisInfo['role'], orientation: AxisInfo['orientation']): AxisInfo => {
    let info = infos.get(axis.id)
    if (!info) {
      info = {
        axis,
        role,
        orientation,
        series: [],
        groups: [],
        visible: !axis.deleted,
        count: 0,
        labels: [],
        outerLevels: [],
        between: true,
        dataMin: NaN,
        dataMax: NaN,
        percent: false,
        labelStyle: resolveText(ctx, [model.textStyle, axis.textStyle], { size: ctx.baseSize }),
        labelSide: 'bottom',
        valueLabelExtent: 0,
        titleExtent: 0,
      }
      infos.set(axis.id, info)
    }
    return info
  }

  groups.forEach((group, index) => {
    const [x, y] = groupAxes(ctx, group, index)
    const xy = group.type === 'scatter' || group.type === 'bubble'
    const independent = infoFor(x, xy ? 'value' : 'category', horizontalBars && !xy ? 'v' : 'h')
    const dependent = infoFor(y, 'value', horizontalBars && !xy ? 'h' : 'v')
    // Prefer the pairing the file states (crossAx); a shared category axis keeps its first partner.
    if (!independent.cross || independent.axis.crossAxisId === y.id) independent.cross = dependent
    if (!dependent.cross || dependent.axis.crossAxisId === x.id) dependent.cross = independent
    const series = seriesOfGroup(all, group)
    for (const info of [independent, dependent]) {
      info.groups.push(group)
      info.series.push(...series)
    }
    pairs.push({ group, independent, dependent })
  })

  // Category axes: labels, counts, between/midCat.
  for (const info of infos.values()) {
    if (info.role !== 'category') continue
    categoryLabels(ctx, info)
    const crossBetween = info.cross?.axis.crossBetween
    const onlyArea = info.groups.every((group) => group.type === 'area')
    info.between = crossBetween ? crossBetween === 'between' : !onlyArea
    if (info.groups.some((group) => group.type === 'bar')) info.between = info.between || crossBetween !== 'midCat'
  }

  // Value ranges.
  const stacks = new Map<ChartGroup, ReturnType<typeof stackGroup>>()
  const extend = (info: AxisInfo, value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return
    if (info.axis.logBase && value <= 0) return
    if (!(value >= info.dataMin)) info.dataMin = Number.isNaN(info.dataMin) ? value : Math.min(info.dataMin, value)
    if (!(value <= info.dataMax)) info.dataMax = Number.isNaN(info.dataMax) ? value : Math.max(info.dataMax, value)
  }
  for (const { group, independent, dependent } of pairs) {
    const series = seriesOfGroup(all, group)
    if (group.type === 'scatter' || group.type === 'bubble') {
      for (const s of series) {
        const count = s.values.length
        for (let i = 0; i < count; i++) {
          const y = s.values[i]
          if (y === null || y === undefined) continue
          extend(dependent, y)
          extend(independent, s.xValues ? s.xValues[i] : i + 1)
        }
      }
      continue
    }
    if (group.grouping === 'percentStacked') dependent.percent = true
    const stack = stackGroup(group, series, blanksAsZero || group.type === 'area')
    stacks.set(group, stack)
    for (const { start, end } of stack) {
      for (let i = 0; i < end.length; i++) {
        extend(dependent, end[i])
        if (group.grouping !== 'standard' && group.grouping !== 'clustered') extend(dependent, start[i])
      }
    }
  }
  for (const info of infos.values()) if (info.role === 'value') info.formatCode = valueFormatCode(info) ?? ''

  // Layout: alternate between scales and label extents until the plot settles.
  const layout = model.plotAreaLayout
  const inner = layout && layout.target === 'inner' && layout.xMode === 'edge' && layout.yMode === 'edge' && layout.w && layout.h
  let outer = area
  if (layout && !inner && layout.xMode === 'edge' && layout.yMode === 'edge' && layout.w && layout.h) {
    outer = { x: (layout.x ?? 0) * ctx.width, y: (layout.y ?? 0) * ctx.height, w: layout.w * ctx.width, h: layout.h * ctx.height }
  }
  let plot: Rect = inner
    ? { x: (layout.x ?? 0) * ctx.width, y: (layout.y ?? 0) * ctx.height, w: layout.w! * ctx.width, h: layout.h! * ctx.height }
    : { x: outer.x + 40, y: outer.y + 8, w: Math.max(10, outer.w - 56), h: Math.max(10, outer.h - 36) }
  for (let pass = 0; pass < 3; pass++) {
    for (const info of infos.values()) if (info.role === 'value') computeScale(ctx, info, plot)
    const extents: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
    for (const info of infos.values()) {
      info.labelSide = labelSide(info, plot)
      const extent = labelExtent(ctx, info, plot)
      info.valueLabelExtent = extent
      info.titleExtent = axisTitleExtent(ctx, info)
      const titleSide = info.orientation === 'v' ? (info.labelSide === 'right' ? 'right' : 'left') : info.labelSide === 'top' ? 'top' : 'bottom'
      extents[info.labelSide] += extent
      extents[titleSide] += info.titleExtent
    }
    if (inner) break
    const pad = 4
    plot = {
      x: outer.x + extents.left + pad,
      y: outer.y + extents.top + pad + 4,
      w: Math.max(10, outer.w - extents.left - extents.right - pad * 2 - 4),
      h: Math.max(10, outer.h - extents.top - extents.bottom - pad * 2 - 4),
    }
  }
  return { svg: drawCartesian(ctx, plot, infos, pairs, stacks, all), plot }
}

// ---------------------------------------------------------------------------------------------
// Drawing

function drawCartesian(
  ctx: RenderContext,
  plot: Rect,
  infos: Map<number, AxisInfo>,
  pairs: { group: ChartGroup; independent: AxisInfo; dependent: AxisInfo }[],
  stacks: Map<ChartGroup, ReturnType<typeof stackGroup>>,
  all: ResolvedSeries[],
): string {
  const parts: string[] = []
  const model = ctx.model
  parts.push(rect(plot.x, plot.y, plot.w, plot.h, plotFill(ctx, model.plotAreaFormat), resolveLine(ctx, model.plotAreaFormat.line, { color: 'none', width: 0.75 })))

  // Gridlines (minor first).
  for (const info of infos.values()) parts.push(drawGridlines(ctx, info, plot))

  const clipId = `${ctx.idPrefix}-plot`
  const looseClipId = `${ctx.idPrefix}-plot-loose`
  parts.push(
    `<defs><clipPath id="${clipId}"><rect x="${n(plot.x)}" y="${n(plot.y)}" width="${n(plot.w)}" height="${n(plot.h)}"/></clipPath>` +
      `<clipPath id="${looseClipId}"><rect x="${n(plot.x - 12)}" y="${n(plot.y - 12)}" width="${n(plot.w + 24)}" height="${n(plot.h + 24)}"/></clipPath></defs>`,
  )

  const seriesCount = model.groups.reduce((sum, group) => sum + group.series.length, 0)
  const labels: string[] = []
  // Areas first, then bars, then lines and points, as Excel layers them.
  const order: ChartGroup['type'][] = ['area', 'bar', 'bubble', 'line', 'scatter']
  for (const type of order) {
    for (const pair of pairs) {
      if (pair.group.type !== type) continue
      const series = seriesOfGroup(all, pair.group)
      const stack = stacks.get(pair.group)
      const body =
        type === 'bar'
          ? drawBars(ctx, plot, pair, series, stack!, seriesCount, labels)
          : type === 'area'
            ? drawAreas(ctx, plot, pair, series, stack!, seriesCount, labels)
            : type === 'line'
              ? drawLines(ctx, plot, pair, series, stack!, seriesCount, labels)
              : drawPoints(ctx, plot, pair, series, seriesCount, labels)
      if (body) parts.push(`<g clip-path="url(#${type === 'bar' || type === 'area' ? clipId : looseClipId})">${body}</g>`)
    }
  }

  for (const info of infos.values()) parts.push(drawAxis(ctx, info, plot))
  parts.push(...labels)
  return parts.join('')
}

function plotFill(ctx: RenderContext, format: ShapeFormat): string {
  return format.fill ? fillToCss(format.fill, ctx.theme, 'none') : 'none'
}

function drawGridlines(ctx: RenderContext, info: AxisInfo, plot: Rect): string {
  const parts: string[] = []
  const draw = (position: number, line: ReturnType<typeof resolveLine>) => {
    if (info.orientation === 'v') parts.push(lineSegment(plot.x, position, plot.x + plot.w, position, line))
    else parts.push(lineSegment(position, plot.y, position, plot.y + plot.h, line))
  }
  if (info.axis.minorGridlines) {
    const line = resolveLine(ctx, info.axis.minorGridlines.line, { color: ctx.gridColor, width: 0.75 })
    if (info.role === 'value' && info.scale) {
      const scale = info.scale
      const minor = info.axis.minorUnit ?? (scale.logBase ? undefined : scale.majorUnit / 5)
      if (minor && (scale.max - scale.min) / minor <= 500) {
        for (let v = scale.min; v <= scale.max + minor * 1e-9; v += minor) draw(valueToPx(info, plot, v), line)
      } else if (scale.logBase) {
        for (const tick of scale.ticks) for (let k = 2; k < scale.logBase; k++) if (tick * k < scale.max) draw(valueToPx(info, plot, tick * k), line)
      }
    }
  }
  if (info.axis.majorGridlines) {
    const line = resolveLine(ctx, info.axis.majorGridlines.line, { color: ctx.gridColor, width: 0.75 })
    if (info.role === 'value' && info.scale) {
      for (const tick of info.scale.ticks) draw(valueToPx(info, plot, tick), line)
    } else if (info.role === 'category' && info.count > 0) {
      const step = Math.max(1, Math.ceil(3 / Math.max(bandPx(info, plot), 1e-9)))
      const last = info.between ? info.count : info.count - 1
      for (let u = 0; u <= last; u += step) draw(categoryToPx(info, plot, u), line)
    }
  }
  return parts.join('')
}

function drawAxis(ctx: RenderContext, info: AxisInfo, plot: Rect): string {
  if (!info.visible) return ''
  const parts: string[] = []
  const vertical = info.orientation === 'v'
  const position = axisLinePosition(info, plot)
  const defaultLine = info.role === 'category' ? { color: ctx.axisLineColor, width: 0.75 } : { color: 'none', width: 0.75 }
  const line = resolveLine(ctx, info.axis.format.line, defaultLine)
  const tickLine = line.color === 'none' ? resolveLine(ctx, undefined, { color: ctx.axisLineColor, width: 0.75 }) : line
  if (vertical) parts.push(lineSegment(position, plot.y, position, plot.y + plot.h, line))
  else parts.push(lineSegment(plot.x, position, plot.x + plot.w, position, line))

  const side = info.labelSide
  const outward = side === 'left' || side === 'top' ? -1 : 1
  const labelPosition =
    info.axis.tickLabelPosition === 'nextTo'
      ? position
      : side === 'left'
        ? plot.x
        : side === 'right'
          ? plot.x + plot.w
          : side === 'top'
            ? plot.y
            : plot.y + plot.h
  const major = tickLength(info.axis.majorTickMark)
  const tickAt = (along: number) => {
    if (!major.inside && !major.outside) return
    const a = position - outward * major.inside
    const b = position + outward * major.outside
    if (vertical) parts.push(lineSegment(a, along, b, along, tickLine))
    else parts.push(lineSegment(along, a, along, b, tickLine))
  }
  const offset = major.outside + LABEL_GAP
  const style = info.labelStyle
  const showLabels = info.axis.tickLabelPosition !== 'none'

  if (info.role === 'value' && info.scale) {
    for (const tick of info.scale.ticks) {
      const along = valueToPx(info, plot, tick)
      tickAt(along)
      if (!showLabels) continue
      const label = formatTick(ctx, info, tick)
      if (vertical) {
        parts.push(text(ctx, labelPosition + outward * offset, along, label, style, { anchor: outward < 0 ? 'end' : 'start', baseline: 'middle' }))
      } else {
        parts.push(text(ctx, along, labelPosition + outward * offset, label, style, { anchor: 'middle', baseline: outward < 0 ? 'bottom' : 'top' }))
      }
    }
  } else if (info.role === 'category' && info.count > 0) {
    const layout = info.labelLayout
    // Never closer than 3px apart, whatever the file asks for.
    const markSkip = Math.max(info.axis.tickMarkSkip ?? 1, Math.ceil(3 / Math.max(bandPx(info, plot), 1e-9)))
    const last = info.between ? info.count : info.count - 1
    for (let u = 0; u <= last; u += markSkip) tickAt(categoryToPx(info, plot, u))
    if (showLabels && layout) {
      const skip = Math.max(1, layout.skip)
      for (let i = 0; i < info.count; i += skip) {
        const lines = layout.lines.get(i) ?? [info.labels[i] ?? '']
        if (!lines.some(Boolean)) continue
        const along = categoryToPx(info, plot, info.between ? i + 0.5 : i)
        if (vertical) {
          parts.push(textBlock(ctx, labelPosition + outward * offset, along, lines, style, { anchor: outward < 0 ? 'end' : 'start', baseline: 'middle' }))
        } else if (layout.rotate) {
          const y = labelPosition + outward * offset
          const anchor = layout.rotate < 0 ? (outward > 0 ? 'end' : 'start') : outward > 0 ? 'start' : 'end'
          parts.push(textBlock(ctx, along, y + (outward > 0 ? style.px * 0.3 : -style.px * 0.3), lines, style, { anchor, baseline: 'middle', rotate: layout.rotate }))
        } else {
          parts.push(textBlock(ctx, along, labelPosition + outward * offset, lines, style, { anchor: 'middle', baseline: outward < 0 ? 'bottom' : 'top' }))
        }
      }
      // Outer category levels: group labels under the inner ones.
      if (!vertical && info.outerLevels.length) {
        let y = labelPosition + outward * (offset + layout.extent + 2)
        for (const level of info.outerLevels) {
          let start = 0
          for (let i = 1; i <= info.count; i++) {
            if (i < info.count && (level[i] === null || level[i] === undefined)) continue
            const label = level[start] ?? ''
            const a = categoryToPx(info, plot, info.between ? start : start - 0.5)
            const b = categoryToPx(info, plot, info.between ? i : i - 0.5)
            const width = Math.abs(b - a)
            parts.push(text(ctx, (a + b) / 2, y, truncateText(label, width * 0.95, style.px, style.bold), style, { anchor: 'middle', baseline: outward < 0 ? 'bottom' : 'top' }))
            parts.push(lineSegment(a, y - outward * 2, a, y + outward * style.px * 1.2, tickLine))
            start = i
          }
          parts.push(lineSegment(categoryToPx(info, plot, info.between ? info.count : info.count - 0.5), y - outward * 2, categoryToPx(info, plot, info.between ? info.count : info.count - 0.5), y + outward * style.px * 1.2, tickLine))
          y += outward * style.px * 1.4
        }
      }
    }
  }

  // Axis title beyond the labels.
  const title = info.axis.title
  if (title) {
    const titleStyle = resolveText(ctx, [ctx.model.textStyle, title.style, title.paragraphs[0]?.[0]?.style], { size: ctx.baseSize, bold: false })
    const content = axisTitleText(info)
    const extent = info.valueLabelExtent
    if (vertical) {
      const titleSide = side === 'right' ? 1 : -1
      const x = (titleSide < 0 ? plot.x : plot.x + plot.w) + titleSide * (extent + titleStyle.px * 0.6 + 2)
      const rotate = title.rotation ?? -90
      parts.push(text(ctx, x, plot.y + plot.h / 2, truncateText(content, plot.h, titleStyle.px, titleStyle.bold), titleStyle, { anchor: 'middle', baseline: 'middle', rotate }))
    } else {
      const titleSide = side === 'top' ? -1 : 1
      const y = (titleSide < 0 ? plot.y : plot.y + plot.h) + titleSide * (extent + titleStyle.px * 0.6 + 2)
      parts.push(text(ctx, plot.x + plot.w / 2, y, truncateText(content, plot.w, titleStyle.px, titleStyle.bold), titleStyle, { anchor: 'middle', baseline: 'middle' }))
    }
  }
  return parts.join('')
}

// ---------------------------------------------------------------------------------------------
// Series

/** Indexes to draw when a categorical series has far more points than pixels. */
function representativeIndexes(series: ResolvedSeries[], count: number, pixels: number): number[] | undefined {
  const limit = Math.max(1000, Math.ceil(pixels * 2))
  if (count <= limit) return undefined
  const bucket = Math.ceil(count / limit)
  const result: number[] = []
  for (let start = 0; start < count; start += bucket) {
    let best = start
    let bestScore = -1
    for (let i = start; i < Math.min(count, start + bucket); i++) {
      let score = 0
      for (const s of series) score += Math.abs(s.values[i] ?? 0)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    result.push(best)
  }
  return result
}

/** Per-bucket min and max indexes of one series, in order: keeps a line's envelope. */
function envelopeIndexes(values: (number | null)[], count: number, pixels: number): number[] | undefined {
  const limit = Math.max(1000, Math.ceil(pixels * 2))
  if (count <= limit) return undefined
  const bucket = Math.ceil(count / (limit / 2))
  const result: number[] = []
  for (let start = 0; start < count; start += bucket) {
    let min = -1
    let max = -1
    let blank = -1
    for (let i = start; i < Math.min(count, start + bucket); i++) {
      const v = values[i]
      if (v === null || v === undefined) {
        if (blank < 0) blank = i
        continue
      }
      if (min < 0 || v < values[min]!) min = i
      if (max < 0 || v > values[max]!) max = i
    }
    const picks = [min, max, blank].filter((i) => i >= 0).sort((x, y) => x - y)
    for (const i of picks) if (result[result.length - 1] !== i) result.push(i)
  }
  return result
}

function labelSettingsFor(series: ResolvedSeries, index: number): (DataLabelSettings & { deleted?: boolean }) | undefined {
  const labels = series.series.dataLabels ?? series.group.dataLabels
  if (!labels || labels.deleted) return undefined
  const point = labels.points.find((p) => p.index === index)
  const settings = point ?? labels
  if (point?.deleted) return undefined
  if (!settings.showValue && !settings.showCategoryName && !settings.showSeriesName && !settings.showPercent && !settings.showBubbleSize) return undefined
  return settings
}

const MAX_LABELS = 2000

function pushLabel(
  ctx: RenderContext,
  labels: string[],
  series: ResolvedSeries,
  index: number,
  values: LabelValues,
  anchor: LabelAnchor,
  defaultPosition: string,
  horizontalBars: boolean,
): void {
  if (labels.length >= MAX_LABELS) return
  const settings = labelSettingsFor(series, index)
  if (!settings) return
  const content = labelText(ctx, settings, values.format || !series.valueFormat ? values : { ...values, format: series.valueFormat })
  if (!content) return
  labels.push(renderDataLabel(ctx, settings, content, anchor, settings.position ?? defaultPosition, horizontalBars))
}

function categoryLabelAt(info: AxisInfo, index: number): string {
  if (info.date) return info.labels[info.date.slots[index] ?? -1] ?? ''
  return info.labels[index] ?? ''
}

function drawBars(
  ctx: RenderContext,
  plot: Rect,
  pair: { group: ChartGroup; independent: AxisInfo; dependent: AxisInfo },
  series: ResolvedSeries[],
  stack: ReturnType<typeof stackGroup>,
  seriesCount: number,
  labels: string[],
): string {
  const { group, independent: cat, dependent: val } = pair
  const parts: string[] = []
  const stacked = group.grouping === 'stacked' || group.grouping === 'percentStacked'
  const slots = stacked ? 1 : Math.max(1, series.length)
  const overlap = group.overlap / 100
  const gap = group.gapWidth / 100
  const width = 1 / (slots - (slots - 1) * overlap + gap)
  const cluster = width * (slots - (slots - 1) * overlap)
  const origin = valueToPx(val, plot, crossingValue(cat, val))
  const horizontal = cat.orientation === 'v'
  const count = cat.date ? series.reduce((max, s) => Math.max(max, s.values.length), 0) : cat.count
  const sample = representativeIndexes(series, count, sideLength(plot, cat))
  const bucket = sample ? Math.ceil(count / sample.length) : 1
  const indexes = sample ?? Array.from({ length: count }, (_, i) => i)
  const pointCount = count

  series.forEach((s, k) => {
    const slot = stacked ? 0 : k
    const { start, end } = stack[k]!
    const paints = new Map<number, ReturnType<typeof seriesPaint>>()
    const basePaint = seriesPaint(ctx, s, seriesCount)
    for (const i of indexes) {
      const value = end[i]
      if (value === null || value === undefined) continue
      const from = start[i] ?? 0
      const center = categoryCenter(cat, i)
      if (center < -0.5) continue
      const left = center - (cluster * bucket) / 2 + slot * width * (1 - overlap) * bucket
      const a = categoryToPx(cat, plot, left)
      const b = categoryToPx(cat, plot, left + width * bucket)
      const v0 = stacked ? valueToPx(val, plot, from) : origin
      const v1 = valueToPx(val, plot, value)
      const paint = s.series.points.length || group.varyColors ? (paints.get(i) ?? seriesPaint(ctx, s, seriesCount, i, pointCount)) : basePaint
      let fill = paint.fill
      let line = paint.line
      const raw = s.values[i] ?? 0
      const invert = s.series.points.find((p) => p.index === i)?.invertIfNegative ?? s.series.invertIfNegative
      if (invert && raw < 0) {
        line = { ...line, color: line.color === 'none' ? paint.fill : line.color, width: Math.max(line.width, 1) }
        fill = '#ffffff'
      }
      const x = horizontal ? Math.min(v0, v1) : Math.min(a, b)
      const y = horizontal ? Math.min(a, b) : Math.min(v0, v1)
      const w = horizontal ? Math.abs(v1 - v0) : Math.max(0.5, Math.abs(b - a))
      const h = horizontal ? Math.max(0.5, Math.abs(b - a)) : Math.abs(v1 - v0)
      parts.push(rect(x, y, w, h, fill, line))
      if (!sample) {
        const tip = horizontal ? { x: v1, y: (a + b) / 2 } : { x: (a + b) / 2, y: v1 }
        const values: LabelValues = { value: raw, category: categoryLabelAt(cat, i), series: s.name }
        if (s.valueFormat) values.format = s.valueFormat
        pushLabel(ctx, labels, s, i, values, { ...tip, base: v0 }, stacked ? 'ctr' : 'outEnd', horizontal)
      }
    }
  })
  return parts.join('')
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('')
  let d = `M${n(points[0]!.x)} ${n(points[0]!.y)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    const t = 1 / 6
    d += `C${n(p1.x + (p2.x - p0.x) * t)} ${n(p1.y + (p2.y - p0.y) * t)} ${n(p2.x - (p3.x - p1.x) * t)} ${n(p2.y - (p3.y - p1.y) * t)} ${n(p2.x)} ${n(p2.y)}`
  }
  return d
}

function polyline(segments: { x: number; y: number }[][], smooth: boolean): string {
  return segments
    .filter((segment) => segment.length)
    .map((segment) => (smooth ? smoothPath(segment) : segment.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('')))
    .join('')
}

function drawLines(
  ctx: RenderContext,
  plot: Rect,
  pair: { group: ChartGroup; independent: AxisInfo; dependent: AxisInfo },
  series: ResolvedSeries[],
  stack: ReturnType<typeof stackGroup>,
  seriesCount: number,
  labels: string[],
): string {
  const { group, independent: cat, dependent: val } = pair
  const parts: string[] = []
  const span = ctx.model.displayBlanksAs === 'span'
  const markers: string[] = []
  series.forEach((s, k) => {
    const { end } = stack[k]!
    const paint = seriesPaint(ctx, s, seriesCount)
    const count = end.length
    const sampled = group.grouping === 'standard' ? envelopeIndexes(end, count, sideLength(plot, cat)) : representativeIndexes(series, count, sideLength(plot, cat))
    const indexes = sampled ?? Array.from({ length: count }, (_, i) => i)
    const segments: { x: number; y: number }[][] = [[]]
    const points: { x: number; y: number; i: number }[] = []
    for (const i of indexes) {
      const value = end[i]
      const center = categoryCenter(cat, i)
      if (value === null || value === undefined || center < -0.5) {
        if (!span && segments[segments.length - 1]!.length) segments.push([])
        continue
      }
      const along = categoryToPx(cat, plot, center)
      const across = valueToPx(val, plot, value)
      const point = cat.orientation === 'h' ? { x: along, y: across } : { x: across, y: along }
      segments[segments.length - 1]!.push(point)
      points.push({ ...point, i })
    }
    parts.push(path(polyline(segments, !!s.series.smooth), 'none', paint.line, ' stroke-linejoin="round" stroke-linecap="round"'))
    const markerLimit = sampled ? 0 : 5000
    if (points.length <= markerLimit) {
      for (const point of points) {
        const pointPaint = s.series.points.length || group.varyColors ? seriesPaint(ctx, s, seriesCount, point.i, count) : paint
        if (pointPaint.marker) markers.push(markerSvg(pointPaint.marker, point.x, point.y))
        pushLabel(ctx, labels, s, point.i, { value: s.values[point.i] ?? 0, category: categoryLabelAt(cat, point.i), series: s.name }, point, 'r', false)
      }
    }
  })
  return parts.join('') + markers.join('')
}

function drawAreas(
  ctx: RenderContext,
  plot: Rect,
  pair: { group: ChartGroup; independent: AxisInfo; dependent: AxisInfo },
  series: ResolvedSeries[],
  stack: ReturnType<typeof stackGroup>,
  seriesCount: number,
  labels: string[],
): string {
  const { group, independent: cat, dependent: val } = pair
  const parts: string[] = []
  const stacked = group.grouping !== 'standard'
  const origin = crossingValue(cat, val)
  const count = stack.reduce((max, s) => Math.max(max, s.end.length), 0)
  const indexes = representativeIndexes(series, count, sideLength(plot, cat)) ?? Array.from({ length: count }, (_, i) => i)
  const toPoint = (i: number, value: number) => {
    const along = categoryToPx(cat, plot, categoryCenter(cat, i))
    const across = valueToPx(val, plot, value)
    return cat.orientation === 'h' ? `${n(along)} ${n(across)}` : `${n(across)} ${n(along)}`
  }
  // Excel draws the first series at the back.
  series.forEach((s, k) => {
    const { start, end } = stack[k]!
    const paint = seriesPaint(ctx, s, seriesCount)
    const valid = indexes.filter((i) => categoryCenter(cat, i) >= -0.5)
    if (!valid.length) return
    const top = valid.map((i) => toPoint(i, end[i] ?? (stacked ? (start[i] ?? 0) : 0)))
    const bottom = valid
      .slice()
      .reverse()
      .map((i) => toPoint(i, stacked ? (start[i] ?? 0) : origin))
    parts.push(path(`M${top.join('L')}L${bottom.join('L')}Z`, paint.fill, paint.line))
    if (indexes.length === count) {
      for (const i of valid) {
        const value = end[i]
        if (value === null || value === undefined) continue
        const mid = ((start[i] ?? origin) + value) / 2
        const along = categoryToPx(cat, plot, categoryCenter(cat, i))
        const across = valueToPx(val, plot, stacked ? mid : value)
        const point = cat.orientation === 'h' ? { x: along, y: across } : { x: across, y: along }
        pushLabel(ctx, labels, s, i, { value: s.values[i] ?? 0, category: categoryLabelAt(cat, i), series: s.name }, point, 'ctr', false)
      }
    }
  })
  return parts.join('')
}

function drawPoints(
  ctx: RenderContext,
  plot: Rect,
  pair: { group: ChartGroup; independent: AxisInfo; dependent: AxisInfo },
  series: ResolvedSeries[],
  seriesCount: number,
  labels: string[],
): string {
  const { group, independent: xAxis, dependent: yAxis } = pair
  const parts: string[] = []
  const span = ctx.model.displayBlanksAs !== 'gap'
  if (group.type === 'bubble') {
    let maxSize = 0
    for (const s of series) for (const size of s.bubbleSizes ?? []) if (size !== null && Math.abs(size) > maxSize) maxSize = Math.abs(size)
    const maxRadius = (Math.min(plot.w, plot.h) * 0.25 * (group.bubbleScale / 100)) / 2
    for (const s of series) {
      const count = Math.min(s.values.length, 20_000)
      for (let i = 0; i < count; i++) {
        const y = s.values[i]
        const size = s.bubbleSizes?.[i] ?? 1
        if (y === null || y === undefined || size === null || (size < 0 && !group.showNegativeBubbles) || maxSize === 0) continue
        const xValue = s.xValues ? s.xValues[i] : i + 1
        if (xValue === null || xValue === undefined) continue
        const ratio = Math.abs(size) / maxSize
        const r = Math.max(1, group.sizeRepresents === 'w' ? ratio * maxRadius : Math.sqrt(ratio) * maxRadius)
        const cx = valueToPx(xAxis, plot, xValue)
        const cy = valueToPx(yAxis, plot, y)
        const paint = seriesPaint(ctx, s, seriesCount, i, count)
        const fill = size < 0 ? '#ffffff' : paint.fill
        parts.push(
          `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${paint.line.color === 'none' ? '' : ` stroke="${paint.line.color}" stroke-width="${n(paint.line.width)}"`}/>`,
        )
        pushLabel(ctx, labels, s, i, { value: y, category: String(xValue), series: s.name, bubbleSize: size }, { x: cx, y: cy }, 'ctr', false)
      }
    }
    return parts.join('')
  }

  for (const s of series) {
    const paint = seriesPaint(ctx, s, seriesCount)
    const count = s.values.length
    const segments: { x: number; y: number }[][] = [[]]
    const points: { x: number; y: number; i: number }[] = []
    let last: { x: number; y: number } | undefined
    const cells = new Set<number>()
    const markerCap = 20_000
    for (let i = 0; i < count; i++) {
      const y = s.values[i]
      const xValue = s.xValues ? s.xValues[i] : i + 1
      if (y === null || y === undefined || xValue === null || xValue === undefined) {
        if (!span && segments[segments.length - 1]!.length) segments.push([])
        continue
      }
      const point = { x: valueToPx(xAxis, plot, xValue), y: valueToPx(yAxis, plot, y) }
      // Drop points closer than half a pixel to the previous one.
      if (!last || Math.abs(point.x - last.x) >= 0.5 || Math.abs(point.y - last.y) >= 0.5) {
        segments[segments.length - 1]!.push(point)
        last = point
      }
      const cell = Math.round(point.x) * 100_003 + Math.round(point.y)
      if (count <= 5000 || (!cells.has(cell) && points.length < markerCap)) {
        cells.add(cell)
        points.push({ ...point, i })
      }
    }
    const lineLimit = 40_000
    const kept = segments.reduce((sum, segment) => sum + segment.length, 0)
    const stride = kept > lineLimit ? Math.ceil(kept / lineLimit) : 1
    const thinned = stride > 1 ? segments.map((segment) => segment.filter((_, i) => i % stride === 0 || i === segment.length - 1)) : segments
    parts.push(path(polyline(thinned, !!s.series.smooth && kept < 5000), 'none', paint.line, ' stroke-linejoin="round" stroke-linecap="round"'))
    for (const point of points) {
      const pointPaint = s.series.points.length || group.varyColors ? seriesPaint(ctx, s, seriesCount, point.i, count) : paint
      if (pointPaint.marker) parts.push(markerSvg(pointPaint.marker, point.x, point.y))
      if (count <= 5000) {
        const xValue = s.xValues ? s.xValues[point.i] : point.i + 1
        pushLabel(ctx, labels, s, point.i, { value: s.values[point.i] ?? 0, category: String(xValue ?? ''), series: s.name }, point, 'r', false)
      }
    }
  }
  return parts.join('')
}

