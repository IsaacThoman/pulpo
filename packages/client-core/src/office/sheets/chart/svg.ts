import type { Theme } from '../../ooxml/theme.js'
import { resolveThemeFont } from '../../ooxml/theme.js'
import { drawingColorToCss, fillToCss } from './colors.js'
import type { ChartModel, LineFormat, TextStyle } from './model.js'
import { escapeXml, measureText, n, safeFontFamily } from './text.js'

/** Shared state for one render. */
export interface RenderContext {
  model: ChartModel
  theme: Theme
  width: number
  height: number
  fontFamily: string
  idPrefix: string
  /** Formats a number with an Excel format code ('' or 'General' for General). */
  format: (value: number, formatCode: string | undefined) => string
  /** Default text color. */
  textColor: string
  /** Default text size in points. */
  baseSize: number
  gridColor: string
  axisLineColor: string
  backgroundColor: string
  parts: string[]
}

export const PX_PER_PT = 96 / 72

export interface ResolvedText {
  px: number
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  /** A family to use instead of the chart's. */
  font?: string
}

export function resolveText(ctx: RenderContext, layers: (TextStyle | undefined)[], defaults: { size?: number; bold?: boolean; color?: string } = {}): ResolvedText {
  const merged: TextStyle = {}
  for (const layer of layers) if (layer) Object.assign(merged, layer)
  const size = merged.size ?? defaults.size ?? ctx.baseSize
  const result: ResolvedText = {
    px: Math.max(1, Math.min(400, size)) * PX_PER_PT,
    bold: merged.bold ?? defaults.bold ?? false,
    italic: merged.italic ?? false,
    underline: merged.underline ?? false,
    color: drawingColorToCss(merged.color, ctx.theme, defaults.color ?? ctx.textColor),
  }
  const font = resolveThemeFont(merged.font, ctx.theme)
  if (font) result.font = font
  return result
}

/** Font attributes for a text element. */
function fontAttributes(ctx: RenderContext, style: ResolvedText): string {
  let attrs = ` font-size="${n(style.px)}" fill="${escapeXml(style.color)}"`
  if (style.bold) attrs += ' font-weight="bold"'
  if (style.italic) attrs += ' font-style="italic"'
  if (style.underline) attrs += ' text-decoration="underline"'
  if (style.font) attrs += ` font-family="${escapeXml(safeFontFamily([style.font, ctx.fontFamily]))}"`
  return attrs
}

export interface TextOptions {
  anchor?: 'start' | 'middle' | 'end'
  /** Where `y` sits relative to the text. */
  baseline?: 'top' | 'middle' | 'bottom'
  /** Degrees, clockwise, around (x, y). */
  rotate?: number
}

/** Baseline offset from the vertical anchor, for one line of text. */
function baselineOffset(px: number, baseline: TextOptions['baseline']): number {
  if (baseline === 'top') return px * 0.8
  if (baseline === 'bottom') return -px * 0.22
  return px * 0.34
}

export function text(ctx: RenderContext, x: number, y: number, content: string, style: ResolvedText, options: TextOptions = {}): string {
  if (!content) return ''
  const anchor = options.anchor ?? 'start'
  const dy = baselineOffset(style.px, options.baseline ?? 'middle')
  const transform = options.rotate ? ` transform="rotate(${n(options.rotate)} ${n(x)} ${n(y)})"` : ''
  return `<text x="${n(x)}" y="${n(y + dy)}" text-anchor="${anchor}"${fontAttributes(ctx, style)}${transform}>${escapeXml(content)}</text>`
}

/** Several lines centered on (x, y) as a block. */
export function textBlock(ctx: RenderContext, x: number, y: number, lines: string[], style: ResolvedText, options: TextOptions = {}): string {
  const lineHeight = style.px * 1.2
  const total = lineHeight * lines.length
  let top: number
  if (options.baseline === 'top') top = y
  else if (options.baseline === 'bottom') top = y - total
  else top = y - total / 2
  return lines
    .map((line, i) => {
      const centerY = top + lineHeight * i + lineHeight / 2
      // Rotate every line around the block center so multi-line rotated labels stay together.
      if (options.rotate) {
        const offset = centerY - y
        const rad = (options.rotate * Math.PI) / 180
        const lx = x - offset * Math.sin(rad)
        const ly = y + offset * Math.cos(rad)
        return text(ctx, lx, ly, line, style, { anchor: options.anchor ?? 'start', baseline: 'middle', rotate: options.rotate })
      }
      return text(ctx, x, centerY, line, style, { anchor: options.anchor ?? 'start', baseline: 'middle' })
    })
    .join('')
}

export function textWidth(content: string, style: ResolvedText): number {
  return measureText(content, style.px, style.bold)
}

const DASHES: Record<string, number[]> = {
  dot: [1, 3],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
}

export interface ResolvedLine {
  color: string
  width: number
  dash?: string
}

/** A line format with fallbacks; color 'none' means no line. */
export function resolveLine(ctx: RenderContext, line: LineFormat | undefined, fallback: { color: string; width: number }): ResolvedLine {
  const color = fillToCss(line?.fill, ctx.theme, fallback.color)
  const width = Math.max(0.5, (line?.width ?? fallback.width) * PX_PER_PT)
  const result: ResolvedLine = { color, width }
  const dash = line?.dash ? DASHES[line.dash] : undefined
  if (dash) result.dash = dash.map((d) => n(d * Math.max(1, width))).join(' ')
  return result
}

export function strokeAttributes(line: ResolvedLine | undefined): string {
  if (!line || line.color === 'none') return ' stroke="none"'
  let attrs = ` stroke="${escapeXml(line.color)}" stroke-width="${n(line.width)}"`
  if (line.dash) attrs += ` stroke-dasharray="${line.dash}"`
  return attrs
}

export function rect(x: number, y: number, w: number, h: number, fill: string, line?: ResolvedLine, extra = ''): string {
  if (!(w > 0) || !(h > 0)) return ''
  if (fill === 'none' && (!line || line.color === 'none')) return ''
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${escapeXml(fill)}"${strokeAttributes(line)}${extra}/>`
}

export function path(d: string, fill: string, line?: ResolvedLine, extra = ''): string {
  if (!d) return ''
  if (fill === 'none' && (!line || line.color === 'none')) return ''
  return `<path d="${d}" fill="${escapeXml(fill)}"${strokeAttributes(line)}${extra}/>`
}

export function lineSegment(x1: number, y1: number, x2: number, y2: number, line: ResolvedLine): string {
  if (line.color === 'none') return ''
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${strokeAttributes(line)}/>`
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
