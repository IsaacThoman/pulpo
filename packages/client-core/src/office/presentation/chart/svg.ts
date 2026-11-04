import type { MarkerSymbol } from './model.js'

/** SVG building blocks for the chart renderer: escaping, text metrics, and marker shapes. */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapes text for element content and attribute values, dropping characters XML forbids. */
export function escapeXml(text: string): string {
  // oxlint-disable-next-line no-control-regex -- stripping the control characters XML cannot carry
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)
}

/** A coordinate for SVG output: two decimals, no exponent, no `-0`. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? '0' : String(rounded)
}

/**
 * Approximate advance widths, in ems, of a typical sans-serif UI font (Calibri/Segoe/Arial-like).
 * The renderer has no font metrics; these keep labels from colliding without measuring text.
 */
function charWidth(char: string): number {
  if (/[ilj.,:;'|!`]/.test(char)) return 0.27
  if (/[ frtI()[\]{}\-"]/.test(char)) return 0.36
  if (/[mwMW@%]/.test(char)) return 0.86
  if (/[A-Z]/.test(char)) return 0.64
  if (/[0-9$#?+=<>_~^*]/.test(char)) return 0.54
  if (/[a-z]/.test(char)) return 0.5
  // CJK and other wide scripts.
  if (char.codePointAt(0)! >= 0x2e80) return 1
  return 0.58
}

export function estimateTextWidth(text: string, sizePx: number, bold = false): number {
  let ems = 0
  for (const char of text) ems += charWidth(char)
  return ems * sizePx * (bold ? 1.06 : 1)
}

/** Cuts text to fit `maxWidth`, ending in an ellipsis when anything was dropped. */
export function truncateText(text: string, maxWidth: number, sizePx: number, bold = false): string {
  if (estimateTextWidth(text, sizePx, bold) <= maxWidth) return text
  const characters = [...text]
  let kept = characters.length
  while (kept > 0 && estimateTextWidth(characters.slice(0, kept).join('') + '…', sizePx, bold) > maxWidth) kept--
  return kept > 0 ? characters.slice(0, kept).join('').trimEnd() + '…' : ''
}

/** Greedy word wrap; words longer than a line stay whole (callers truncate them). */
export function wrapText(text: string, maxWidth: number, sizePx: number, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && estimateTextWidth(candidate, sizePx, bold) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current || !lines.length) lines.push(current)
  return lines
}

/** The automatic marker symbols Office cycles through, by series index. */
const AUTO_MARKERS: readonly MarkerSymbol[] = ['diamond', 'square', 'triangle', 'x', 'star', 'circle', 'plus', 'dash', 'dot']

export function automaticMarker(seriesIndex: number): MarkerSymbol {
  return AUTO_MARKERS[Math.max(0, seriesIndex) % AUTO_MARKERS.length]!
}

/** Path data for a marker of `size` px centered on (x, y); undefined for `none`. */
export function markerPath(symbol: MarkerSymbol, x: number, y: number, size: number): string | undefined {
  const r = size / 2
  const p = (dx: number, dy: number): string => `${num(x + dx)} ${num(y + dy)}`
  switch (symbol) {
    case 'none':
    case 'picture':
      return undefined
    case 'square':
      return `M${p(-r, -r)}H${num(x + r)}V${num(y + r)}H${num(x - r)}Z`
    case 'diamond':
      return `M${p(0, -r)}L${p(r, 0)}L${p(0, r)}L${p(-r, 0)}Z`
    case 'triangle':
      return `M${p(0, -r)}L${p(r, r)}L${p(-r, r)}Z`
    case 'x':
      return `M${p(-r, -r)}L${p(r, r)}M${p(r, -r)}L${p(-r, r)}`
    case 'plus':
      return `M${p(0, -r)}L${p(0, r)}M${p(-r, 0)}L${p(r, 0)}`
    case 'star':
      return `M${p(-r, -r)}L${p(r, r)}M${p(r, -r)}L${p(-r, r)}M${p(0, -r)}L${p(0, r)}`
    case 'dash':
      return `M${p(-r, -r / 4)}H${num(x + r)}V${num(y + r / 4)}H${num(x - r)}Z`
    case 'dot':
      return `M${p(-r / 2, 0)}a${num(r / 2)} ${num(r / 2)} 0 1 0 ${num(r)} 0a${num(r / 2)} ${num(r / 2)} 0 1 0 ${num(-r)} 0Z`
    default:
      return `M${p(-r, 0)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`
  }
}

/** Symbols drawn as strokes only: they have no inside to fill. */
export function isOpenMarker(symbol: MarkerSymbol): boolean {
  return symbol === 'x' || symbol === 'plus' || symbol === 'star'
}

/** A polyline, or a Catmull-Rom spline through the points (Office's "smoothed line"). */
export function linePath(points: readonly Point[], smooth: boolean): string {
  const first = points[0]
  if (!first) return ''
  let path = `M${num(first.x)} ${num(first.y)}`
  if (!smooth || points.length < 3) {
    for (const point of points.slice(1)) path += `L${num(point.x)} ${num(point.y)}`
    return path
  }
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index]!
    const p1 = points[index]!
    const p2 = points[index + 1]!
    const p3 = points[index + 2] ?? p2
    // Tension 1/6 matches the classic Catmull-Rom to Bézier conversion.
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    path += `C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(p2.x)} ${num(p2.y)}`
  }
  return path
}

const DASH_PATTERNS: Record<string, readonly number[]> = {
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  dot: [1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
  sysDot: [1, 1],
}

/** `stroke-dasharray` for an `a:prstDash`, scaled by the line width as Office does. */
export function dashArray(dash: string | undefined, widthPx: number): string | undefined {
  const pattern = dash ? DASH_PATTERNS[dash] : undefined
  return pattern ? pattern.map((length) => num(length * Math.max(widthPx, 0.75))).join(' ') : undefined
}

/** A short, stable hash for making SVG ids unique per chart (several charts share a page). */
export function hashString(text: string): string {
  let hash = 0x811c9dc5
  const step = Math.max(1, Math.floor(text.length / 4096))
  for (let index = 0; index < text.length; index += step) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
