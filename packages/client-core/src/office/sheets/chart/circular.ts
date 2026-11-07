import { maxOf } from '../../../collections.js'
import type { ResolvedSeries } from './data.js'
import { labelStyle, labelText, type LabelValues } from './labels.js'
import type { ChartAxis, ChartGroup } from './model.js'
import { computeValueScale } from './scale.js'
import { markerSvg, seriesPaint } from './style.js'
import { n, truncateText } from './text.js'
import { lineSegment, path, resolveLine, resolveText, text, textBlock, textWidth, type Rect, type RenderContext } from './svg.js'

/** Pie, doughnut, and radar charts. */

const MAX_SLICES = 2000

function polar(cx: number, cy: number, r: number, degrees: number): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

/** A ring (or pie) sector from `a0` to `a1` degrees clockwise from 12 o'clock. */
function sector(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number): string {
  const sweep = a1 - a0
  if (sweep >= 359.999) {
    // Full circle: two half arcs (an arc cannot start and end at the same point).
    const top = polar(cx, cy, outer, 0)
    const bottom = polar(cx, cy, outer, 180)
    let d = `M${n(top.x)} ${n(top.y)}A${n(outer)} ${n(outer)} 0 1 1 ${n(bottom.x)} ${n(bottom.y)}A${n(outer)} ${n(outer)} 0 1 1 ${n(top.x)} ${n(top.y)}Z`
    if (inner > 0) {
      const itop = polar(cx, cy, inner, 0)
      const ibottom = polar(cx, cy, inner, 180)
      d += `M${n(itop.x)} ${n(itop.y)}A${n(inner)} ${n(inner)} 0 1 0 ${n(ibottom.x)} ${n(ibottom.y)}A${n(inner)} ${n(inner)} 0 1 0 ${n(itop.x)} ${n(itop.y)}Z`
    }
    return d
  }
  const large = sweep > 180 ? 1 : 0
  const p0 = polar(cx, cy, outer, a0)
  const p1 = polar(cx, cy, outer, a1)
  if (inner <= 0) return `M${n(cx)} ${n(cy)}L${n(p0.x)} ${n(p0.y)}A${n(outer)} ${n(outer)} 0 ${large} 1 ${n(p1.x)} ${n(p1.y)}Z`
  const q1 = polar(cx, cy, inner, a1)
  const q0 = polar(cx, cy, inner, a0)
  return `M${n(p0.x)} ${n(p0.y)}A${n(outer)} ${n(outer)} 0 ${large} 1 ${n(p1.x)} ${n(p1.y)}L${n(q1.x)} ${n(q1.y)}A${n(inner)} ${n(inner)} 0 ${large} 0 ${n(q0.x)} ${n(q0.y)}Z`
}

function labelSettingsFor(series: ResolvedSeries, index: number) {
  const labels = series.series.dataLabels ?? series.group.dataLabels
  if (!labels || labels.deleted) return undefined
  const point = labels.points.find((p) => p.index === index)
  if (point?.deleted) return undefined
  const settings = point ?? labels
  if (!settings.showValue && !settings.showCategoryName && !settings.showSeriesName && !settings.showPercent) return undefined
  return settings
}

function categoryLabel(ctx: RenderContext, series: ResolvedSeries, index: number): string {
  const value = series.categories?.values[index]
  if (value === null || value === undefined) return series.categories ? '' : String(index + 1)
  return typeof value === 'number' ? ctx.format(value, series.categories?.formatCode) : value
}

export function renderPie(ctx: RenderContext, area: Rect, group: ChartGroup, all: ResolvedSeries[]): string {
  const series = all.filter((s) => s.group === group)
  const rings = group.type === 'pie' ? series.slice(0, 1) : series
  if (!rings.length) return ''
  const seriesCount = ctx.model.groups.reduce((sum, g) => sum + g.series.length, 0)
  const anyLabels = rings.some((s) => {
    const labels = s.series.dataLabels ?? group.dataLabels
    return !!labels && !labels.deleted && (labels.showValue || labels.showPercent || labels.showCategoryName || labels.showSeriesName)
  })
  const outsideLabels =
    anyLabels &&
    group.type === 'pie' &&
    rings.some((s) => {
      const position = (s.series.dataLabels ?? group.dataLabels)?.position
      return !position || position === 'bestFit' || position === 'outEnd'
    })
  const sample = rings[0]!
  const style = labelStyle(ctx, sample.series.dataLabels ?? group.dataLabels)
  // Outside labels need room beside the pie for their widest text.
  let labelWidth = 0
  if (outsideLabels) {
    const first = rings[0]!
    const values = first.values.slice(0, MAX_SLICES).map((value) => Math.abs(value ?? 0))
    const total = values.reduce((sum, value) => sum + value, 0) || 1
    values.forEach((value, i) => {
      const settings = labelSettingsFor(first, i)
      if (!settings) return
      const content = labelText(ctx, settings, { value: first.values[i] ?? 0, category: categoryLabel(ctx, first, i), series: first.name, percent: value / total })
      for (const line of content.split(/\r?\n/)) labelWidth = Math.max(labelWidth, textWidth(line, labelStyle(ctx, settings)))
    })
    labelWidth = Math.min(labelWidth, area.w * 0.3)
  }
  const marginX = outsideLabels ? labelWidth + style.px * 0.8 : 4
  const marginY = outsideLabels ? style.px * 1.6 : 4
  let maxExplosion = 0
  for (const s of rings) {
    maxExplosion = Math.max(maxExplosion, s.series.explosion ?? 0)
    for (const point of s.series.points) maxExplosion = Math.max(maxExplosion, point.explosion ?? 0)
  }
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2
  const radius = Math.max(4, Math.min(area.w / 2 - marginX, area.h / 2 - marginY) / (1 + Math.min(maxExplosion, 400) / 100))
  const hole = group.type === 'doughnut' ? (radius * group.holeSize) / 100 : 0
  const ringWidth = (radius - hole) / rings.length
  const parts: string[] = []
  const labels: string[] = []

  rings.forEach((s, ring) => {
    const values = s.values.slice(0, MAX_SLICES).map((value) => Math.abs(value ?? 0))
    const total = values.reduce((sum, value) => sum + value, 0)
    if (!(total > 0)) return
    // The first series is the innermost ring.
    const inner = group.type === 'doughnut' ? hole + ringWidth * ring : 0
    const outer = group.type === 'doughnut' ? inner + ringWidth : radius
    let angle = group.firstSliceAngle
    values.forEach((value, i) => {
      const sweep = (value / total) * 360
      const a0 = angle
      const a1 = angle + sweep
      angle = a1
      if (sweep <= 0) return
      const paint = seriesPaint(ctx, s, seriesCount, i, values.length)
      const explosion = (s.series.points.find((p) => p.index === i)?.explosion ?? s.series.explosion ?? 0) / 100
      const offset = polar(0, 0, radius * explosion, (a0 + a1) / 2)
      parts.push(path(sector(cx + offset.x, cy + offset.y, outer, inner, a0, a1), paint.fill, paint.line, ' stroke-linejoin="round"'))

      const settings = labelSettingsFor(s, i)
      if (!settings || labels.length > 500) return
      const labelValues: LabelValues = { value: s.values[i] ?? 0, category: categoryLabel(ctx, s, i), series: s.name, percent: value / total }
      if (s.valueFormat) labelValues.format = s.valueFormat
      const content = labelText(ctx, settings, labelValues)
      if (!content) return
      const pointStyle = labelStyle(ctx, settings)
      const lines = content.split(/\r?\n/)
      const width = maxOf(lines.map((line) => textWidth(line, pointStyle)))
      const middle = (a0 + a1) / 2
      const position = settings.position ?? (group.type === 'pie' ? 'bestFit' : 'ctr')
      const centerX = cx + offset.x
      const centerY = cy + offset.y
      // Inside when it fits the slice, else outside.
      const insideRadius = group.type === 'doughnut' ? (inner + outer) / 2 : position === 'inEnd' ? outer * 0.8 : outer * 0.62
      const chord = (2 * Math.PI * insideRadius * sweep) / 360
      const fits = chord > width * 0.9 && sweep > 12
      const outside = position === 'outEnd' || (position === 'bestFit' && !fits)
      if (outside) {
        const anchorPoint = polar(centerX, centerY, outer + pointStyle.px * 0.5, middle)
        const right = Math.sin((middle * Math.PI) / 180) >= 0
        const limit = right ? area.x + area.w - anchorPoint.x - 2 : anchorPoint.x - area.x - 2
        const clipped = lines.map((line) => truncateText(line, Math.max(20, limit), pointStyle.px, pointStyle.bold))
        labels.push(textBlock(ctx, anchorPoint.x + (right ? 2 : -2), anchorPoint.y, clipped, pointStyle, { anchor: right ? 'start' : 'end', baseline: 'middle' }))
      } else {
        const at = polar(centerX, centerY, insideRadius, middle)
        labels.push(textBlock(ctx, at.x, at.y, lines, pointStyle, { anchor: 'middle', baseline: 'middle' }))
      }
    })
  })
  return parts.join('') + labels.join('')
}

export function renderRadar(ctx: RenderContext, area: Rect, group: ChartGroup, all: ResolvedSeries[]): string {
  const series = all.filter((s) => s.group === group)
  const seriesCount = ctx.model.groups.reduce((sum, g) => sum + g.series.length, 0)
  const axes = group.axisIds.map((id) => ctx.model.axes.find((axis) => axis.id === id)).filter((axis): axis is ChartAxis => !!axis)
  const categoryAxis = axes.find((axis) => axis.kind === 'category' || axis.kind === 'date')
  const valueAxis = axes.find((axis) => axis.kind === 'value')
  const count = Math.min(1000, series.reduce((max, s) => Math.max(max, s.values.length), 0))
  if (!count) return ''
  const withCategories = series.find((s) => s.categories)
  const labels = Array.from({ length: count }, (_, i) => (withCategories ? categoryLabel(ctx, withCategories, i) : String(i + 1)))
  const catStyle = resolveText(ctx, [ctx.model.textStyle, categoryAxis?.textStyle], { size: ctx.baseSize })
  const valStyle = resolveText(ctx, [ctx.model.textStyle, valueAxis?.textStyle], { size: ctx.baseSize })
  const showCategories = !categoryAxis?.deleted && categoryAxis?.tickLabelPosition !== 'none'
  const maxLabel = showCategories ? Math.min(area.w * 0.25, maxOf(labels.map((label) => textWidth(label, catStyle)))) : 0
  const radius = Math.max(8, Math.min((area.w - 2 * (maxLabel + 8)) / 2, (area.h - 2 * (catStyle.px * 1.4 + 4)) / 2))
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2

  let min = NaN
  let max = NaN
  for (const s of series)
    for (const value of s.values) {
      if (value === null) continue
      min = Number.isNaN(min) ? value : Math.min(min, value)
      max = Number.isNaN(max) ? value : Math.max(max, value)
    }
  const options: Parameters<typeof computeValueScale>[2] = { maxIntervals: Math.max(1, Math.floor(radius / (valStyle.px * 2.2))) }
  if (valueAxis?.min !== undefined) options.min = valueAxis.min
  if (valueAxis?.max !== undefined) options.max = valueAxis.max
  if (valueAxis?.majorUnit !== undefined) options.majorUnit = valueAxis.majorUnit
  const scale = computeValueScale(min, max, options)
  const toRadius = (value: number) => (Math.max(scale.min, Math.min(scale.max, value)) - scale.min) / (scale.max - scale.min || 1) * radius
  const angleOf = (i: number) => (i / count) * 360

  const parts: string[] = []
  const grid = resolveLine(ctx, valueAxis?.majorGridlines?.line, { color: ctx.gridColor, width: 0.75 })
  if (!valueAxis || valueAxis.majorGridlines) {
    for (const tick of scale.ticks) {
      const r = toRadius(tick)
      if (r <= 0) continue
      const d = Array.from({ length: count }, (_, i) => polar(cx, cy, r, angleOf(i)))
        .map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`)
        .join('')
      parts.push(path(`${d}Z`, 'none', grid))
    }
  }
  const spoke = resolveLine(ctx, categoryAxis?.majorGridlines?.line ?? categoryAxis?.format.line, { color: ctx.gridColor, width: 0.75 })
  for (let i = 0; i < count; i++) {
    const end = polar(cx, cy, radius, angleOf(i))
    parts.push(lineSegment(cx, cy, end.x, end.y, spoke))
    if (showCategories) {
      const at = polar(cx, cy, radius + 6, angleOf(i))
      const sin = Math.sin((angleOf(i) * Math.PI) / 180)
      const cos = Math.cos((angleOf(i) * Math.PI) / 180)
      const anchor = Math.abs(sin) < 0.1 ? 'middle' : sin > 0 ? 'start' : 'end'
      const label = truncateText(labels[i] ?? '', maxLabel + 1, catStyle.px, catStyle.bold)
      parts.push(text(ctx, at.x, at.y - cos * catStyle.px * 0.4, label, catStyle, { anchor, baseline: 'middle' }))
    }
  }
  if (!valueAxis?.deleted && valueAxis?.tickLabelPosition !== 'none') {
    const code = valueAxis?.numberFormat?.formatCode && !valueAxis.numberFormat.sourceLinked ? valueAxis.numberFormat.formatCode : series[0]?.valueFormat
    for (const tick of scale.ticks) parts.push(text(ctx, cx - 4, cy - toRadius(tick), ctx.format(tick, code), valStyle, { anchor: 'end', baseline: 'middle' }))
  }

  const markers: string[] = []
  for (const s of series) {
    const paint = seriesPaint(ctx, s, seriesCount)
    const points = Array.from({ length: count }, (_, i) => polar(cx, cy, toRadius(s.values[i] ?? 0), angleOf(i)))
    const d = `${points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('')}Z`
    if (group.radarStyle === 'filled') parts.push(path(d, paint.fill, paint.line))
    else parts.push(path(d, 'none', paint.line, ' stroke-linejoin="round"'))
    if (paint.marker) for (const p of points) markers.push(markerSvg(paint.marker, p.x, p.y))
  }
  return parts.join('') + markers.join('')
}
