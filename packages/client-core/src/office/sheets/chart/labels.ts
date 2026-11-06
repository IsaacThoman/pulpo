import type { DataLabelSettings, TextStyle } from './model.js'
import { fillToCss } from './colors.js'
import { rect, resolveLine, resolveText, textBlock, textWidth, type RenderContext } from './svg.js'

/** Data labels: the text Excel builds from the show* flags, and where it puts it. */

export interface LabelValues {
  value: number
  category: string
  series: string
  /** 0–1 share of the whole (pie slices). */
  percent?: number
  bubbleSize?: number
  /** The value's number format (from the source data). */
  format?: string
}

/** Where a label attaches: a point, or a bar's tip with the bar's base coordinate. */
export interface LabelAnchor {
  x: number
  y: number
  /** For bars: the pixel coordinate of the bar's base along the value direction. */
  base?: number
}

export function labelText(ctx: RenderContext, settings: DataLabelSettings, values: LabelValues): string {
  const parts: string[] = []
  const numberFormat = settings.numberFormat && !settings.numberFormat.sourceLinked ? settings.numberFormat.formatCode : undefined
  if (settings.showSeriesName) parts.push(values.series)
  if (settings.showCategoryName) parts.push(values.category)
  if (settings.showValue) parts.push(ctx.format(values.value, numberFormat ?? values.format))
  if (settings.showPercent && values.percent !== undefined) parts.push(ctx.format(values.percent, numberFormat && /%/.test(numberFormat) ? numberFormat : '0%'))
  if (settings.showBubbleSize && values.bubbleSize !== undefined) parts.push(ctx.format(values.bubbleSize, numberFormat ?? values.format))
  return parts.filter((part) => part !== '').join(settings.separator ?? ', ')
}

export function labelStyle(ctx: RenderContext, settings: { style: TextStyle } | undefined) {
  return resolveText(ctx, [ctx.model.textStyle, settings?.style], { size: ctx.baseSize * 0.9, color: '#404040' })
}

/**
 * Draws a label at `anchor`. Bar positions (`outEnd`, `inEnd`, `ctr`, `inBase`) use the bar's
 * base and tip; point positions are `t`, `b`, `l`, `r`, `ctr`.
 */
export function renderDataLabel(ctx: RenderContext, settings: DataLabelSettings, content: string, anchor: LabelAnchor, position: string, horizontalBars: boolean): string {
  const style = labelStyle(ctx, settings)
  const lines = content.split(/\r?\n/)
  const width = Math.max(...lines.map((line) => textWidth(line, style)))
  const height = lines.length * style.px * 1.2
  const gap = 3
  let cx = anchor.x
  let cy = anchor.y
  if (anchor.base !== undefined) {
    const tip = horizontalBars ? anchor.x : anchor.y
    const base = anchor.base
    // +1 when the bar grows toward larger pixel coordinates.
    const direction = tip >= base ? 1 : -1
    const extent = horizontalBars ? width : height
    let along: number
    if (position === 'inEnd') along = tip - direction * (extent / 2 + gap)
    else if (position === 'inBase') along = base + direction * (extent / 2 + gap)
    else if (position === 'ctr') along = (tip + base) / 2
    else along = tip + direction * (extent / 2 + gap)
    if (horizontalBars) cx = along
    else cy = along
  } else {
    const r = 5
    if (position === 't') cy -= height / 2 + r
    else if (position === 'b') cy += height / 2 + r
    else if (position === 'l') cx -= width / 2 + r + gap
    else if (position === 'r') cx += width / 2 + r + gap
  }
  let box = ''
  const fill = settings.format.fill ? fillToCss(settings.format.fill, ctx.theme, 'none') : 'none'
  const line = resolveLine(ctx, settings.format.line, { color: 'none', width: 0.75 })
  if (fill !== 'none' || line.color !== 'none') box = rect(cx - width / 2 - 3, cy - height / 2 - 1, width + 6, height + 2, fill, line)
  return box + textBlock(ctx, cx, cy, lines, style, { anchor: 'middle', baseline: 'middle' })
}
