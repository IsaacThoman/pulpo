import { automaticColor, drawingColorToCss, fillToCss } from './colors.js'
import type { ResolvedSeries } from './data.js'
import type { ChartGroup, MarkerFormat, MarkerSymbol, ShapeFormat } from './model.js'
import { n } from './text.js'
import { PX_PER_PT, path, resolveLine, type RenderContext, type ResolvedLine } from './svg.js'

/** How one series (or one of its points) is painted. */
export interface Paint {
  /** The automatic or explicit main color (fill for bars, line for lines). */
  color: string
  fill: string
  line: ResolvedLine
  marker?: MarkerPaint
}

export interface MarkerPaint {
  symbol: Exclude<MarkerSymbol, 'auto' | 'picture'>
  size: number
  fill: string
  line: ResolvedLine
}

const AUTO_SYMBOLS: MarkerPaint['symbol'][] = ['diamond', 'square', 'triangle', 'x', 'star', 'circle', 'plus', 'dot', 'dash']

function isLineLike(group: ChartGroup): boolean {
  return group.type === 'line' || group.type === 'scatter' || (group.type === 'radar' && group.radarStyle !== 'filled')
}

/** Whether points get their own automatic colors. */
export function variesByPoint(group: ChartGroup): boolean {
  return group.varyColors && (group.type === 'pie' || group.type === 'doughnut' || group.series.length === 1)
}

function defaultMarkerSymbol(group: ChartGroup): boolean {
  if (group.type === 'line') return group.showMarkers
  if (group.type === 'scatter') return !group.scatterStyle || /marker/i.test(group.scatterStyle)
  if (group.type === 'radar') return group.radarStyle === 'marker'
  return false
}

function mergeShape(base: ShapeFormat, override: ShapeFormat | undefined): ShapeFormat {
  if (!override) return base
  const merged: ShapeFormat = { ...base }
  if (override.fill) merged.fill = override.fill
  if (override.line) merged.line = { ...base.line, ...override.line }
  return merged
}

function markerPaint(
  ctx: RenderContext,
  group: ChartGroup,
  seriesIndex: number,
  color: string,
  marker: MarkerFormat | undefined,
  pointMarker: MarkerFormat | undefined,
): MarkerPaint | undefined {
  let symbol = pointMarker?.symbol ?? marker?.symbol
  if (!symbol) symbol = defaultMarkerSymbol(group) ? 'auto' : 'none'
  if (symbol === 'none') return undefined
  const resolved = symbol === 'auto' || symbol === 'picture' ? AUTO_SYMBOLS[seriesIndex % AUTO_SYMBOLS.length]! : symbol
  const format = mergeShape(marker?.format ?? {}, pointMarker?.format)
  return {
    symbol: resolved,
    size: Math.max(2, Math.min(72, pointMarker?.size ?? marker?.size ?? 5)) * PX_PER_PT,
    fill: fillToCss(format.fill, ctx.theme, resolved === 'x' || resolved === 'plus' || resolved === 'dash' ? 'none' : color),
    line: resolveLine(ctx, format.line, { color, width: 0.75 }),
  }
}

/**
 * The paint for `resolved` (or its point `pointIndex` of `pointCount`). Explicit formatting from
 * the file wins; everything else comes from the automatic colors.
 */
export function seriesPaint(ctx: RenderContext, resolved: ResolvedSeries, seriesCount: number, pointIndex?: number, pointCount?: number): Paint {
  const { series, group } = resolved
  const byPoint = pointIndex !== undefined && variesByPoint(group)
  const autoIndex = byPoint ? pointIndex : series.index
  const autoCount = byPoint ? (pointCount ?? 1) : seriesCount
  const auto = drawingColorToCss(automaticColor(autoIndex, autoCount, ctx.model.style), ctx.theme, '#4472c4')
  const point = pointIndex === undefined ? undefined : series.points.find((p) => p.index === pointIndex)
  // With varied colors, the series' own fill does not apply to points (Excel ignores it there).
  const seriesFormat = byPoint ? { line: series.format.line } : series.format
  const format = mergeShape(seriesFormat, point?.format)

  if (isLineLike(group)) {
    const line = resolveLine(ctx, format.line, { color: auto, width: 2.25 })
    const color = line.color === 'none' ? auto : line.color
    const paint: Paint = { color, fill: 'none', line }
    const marker = markerPaint(ctx, group, series.index, color, series.marker, point?.marker)
    if (marker) paint.marker = marker
    return paint
  }
  const fill = fillToCss(format.fill, ctx.theme, auto)
  const defaultLine =
    group.type === 'pie' || group.type === 'doughnut'
      ? { color: ctx.backgroundColor === 'none' ? '#ffffff' : ctx.backgroundColor, width: 0.75 }
      : group.type === 'radar'
        ? { color: fill, width: 2.25 }
        : { color: 'none', width: 0.75 }
  const line = resolveLine(ctx, format.line, defaultLine)
  const paint: Paint = { color: fill === 'none' ? (line.color === 'none' ? auto : line.color) : fill, fill, line }
  if (group.type === 'radar') {
    const marker = markerPaint(ctx, group, series.index, paint.color, series.marker, point?.marker)
    if (marker) paint.marker = marker
  }
  return paint
}

/** SVG for a marker centered at (x, y). */
export function markerSvg(marker: MarkerPaint, x: number, y: number): string {
  const r = marker.size / 2
  const d = markerPath(marker.symbol, x, y, r)
  return path(d, marker.fill, marker.line)
}

function markerPath(symbol: MarkerPaint['symbol'], x: number, y: number, r: number): string {
  switch (symbol) {
    case 'circle':
      return `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`
    case 'square':
      return `M${n(x - r)} ${n(y - r)}h${n(2 * r)}v${n(2 * r)}h${n(-2 * r)}Z`
    case 'diamond':
      return `M${n(x)} ${n(y - r * 1.2)}L${n(x + r * 1.2)} ${n(y)}L${n(x)} ${n(y + r * 1.2)}L${n(x - r * 1.2)} ${n(y)}Z`
    case 'triangle':
      return `M${n(x)} ${n(y - r * 1.15)}L${n(x + r * 1.15)} ${n(y + r * 0.85)}L${n(x - r * 1.15)} ${n(y + r * 0.85)}Z`
    case 'x':
      return `M${n(x - r)} ${n(y - r)}L${n(x + r)} ${n(y + r)}M${n(x + r)} ${n(y - r)}L${n(x - r)} ${n(y + r)}`
    case 'plus':
      return `M${n(x - r)} ${n(y)}H${n(x + r)}M${n(x)} ${n(y - r)}V${n(y + r)}`
    case 'star':
      return `M${n(x - r)} ${n(y - r)}L${n(x + r)} ${n(y + r)}M${n(x + r)} ${n(y - r)}L${n(x - r)} ${n(y + r)}M${n(x)} ${n(y - r)}V${n(y + r)}`
    case 'dot': {
      const s = r * 0.5
      return `M${n(x - s)} ${n(y - s)}h${n(2 * s)}v${n(2 * s)}h${n(-2 * s)}Z`
    }
    case 'dash':
      return `M${n(x - r)} ${n(y - r * 0.2)}h${n(2 * r)}v${n(r * 0.4)}h${n(-2 * r)}Z`
    case 'none':
      return ''
  }
}
