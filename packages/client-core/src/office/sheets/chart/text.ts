/**
 * Text helpers for SVG output without a DOM: escaping, approximate measurement (Calibri-like
 * metrics; good enough to lay out labels the way Excel does), and wrapping.
 */

/** Escapes text for element content and double-quoted attribute values. */
export function escapeXml(text: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const ch = text[i]!
    if (ch === '&') result += '&amp;'
    else if (ch === '<') result += '&lt;'
    else if (ch === '>') result += '&gt;'
    else if (ch === '"') result += '&quot;'
    else if (ch === "'") result += '&#39;'
    // Control characters are not allowed in XML 1.0; drop them.
    else if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue
    else if (code === 0xfffe || code === 0xffff) continue
    else result += ch
  }
  return result
}

const NARROW = new Set("ijl!|'.,:;I`")
const SEMI_NARROW = new Set('frt()[]{}/\\-"*J')
const WIDE = new Set('mwMW%@')

/** Approximate advance width of one character, in em. */
function charWidth(ch: string): number {
  if (ch === ' ') return 0.226
  if (NARROW.has(ch)) return 0.23
  if (SEMI_NARROW.has(ch)) return 0.32
  if (WIDE.has(ch)) return ch === 'm' || ch === 'w' ? 0.78 : 0.86
  if (ch >= '0' && ch <= '9') return 0.507
  if (ch >= 'a' && ch <= 'z') return 0.48
  if (ch >= 'A' && ch <= 'Z') return 0.6
  const code = ch.codePointAt(0) ?? 0
  // CJK, Hangul, full-width forms, emoji: about a full em.
  if (code >= 0x2e80) return 1
  return 0.55
}

/** Approximate width in px of `text` at `sizePx`. */
export function measureText(text: string, sizePx: number, bold = false): number {
  let width = 0
  for (const ch of text) width += charWidth(ch)
  return width * sizePx * (bold ? 1.06 : 1)
}

/** Truncates `text` with an ellipsis so it fits `maxWidth`. */
export function truncateText(text: string, maxWidth: number, sizePx: number, bold = false): string {
  if (measureText(text, sizePx, bold) <= maxWidth) return text
  const ellipsis = '…'
  const budget = maxWidth - measureText(ellipsis, sizePx, bold)
  if (budget <= 0) return ''
  let width = 0
  let result = ''
  for (const ch of text) {
    const w = charWidth(ch) * sizePx * (bold ? 1.06 : 1)
    if (width + w > budget) break
    width += w
    result += ch
  }
  return result + ellipsis
}

/** Greedy word wrap into at most `maxLines` lines; the last line is truncated if needed. */
export function wrapText(text: string, maxWidth: number, sizePx: number, bold = false, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines: string[] = []
  let current = ''
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const candidate = current ? `${current} ${word}` : word
    if (!current || measureText(candidate, sizePx, bold) <= maxWidth) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
    if (lines.length === maxLines - 1) {
      current = words.slice(i).join(' ')
      break
    }
  }
  lines.push(current)
  return lines.map((line) => truncateText(line, maxWidth, sizePx, bold))
}

/** Formats a coordinate compactly. */
export function n(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** A font-family attribute value built only from safe characters. */
export function safeFontFamily(names: (string | undefined)[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of names) {
    if (!raw) continue
    for (const piece of raw.split(',')) {
      const name = piece
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[^\p{L}\p{N} _.-]/gu, '')
        .trim()
        .slice(0, 64)
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      const generic = ['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy'].includes(name)
      parts.push(generic || /^[A-Za-z-]+$/.test(name) ? name : `'${name}'`)
    }
  }
  return parts.join(', ')
}
