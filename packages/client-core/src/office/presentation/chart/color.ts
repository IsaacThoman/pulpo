/**
 * Just enough CSS color math for automatic series colors: Office derives series 7+ from the theme
 * accents by shifting their luminance, the way `a:lumMod`/`a:lumOff` do.
 */

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, and `rgb()`/`rgba()`. Other CSS colors are left alone by callers. */
export function parseCssColor(css: string): Rgba | undefined {
  const value = css.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    }
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(value)?.[1]
  if (!functional) return undefined
  const parts = functional.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return undefined
  const channel = (part: string): number => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part))
  const alphaPart = parts[3]
  const color = {
    r: channel(parts[0]!),
    g: channel(parts[1]!),
    b: channel(parts[2]!),
    a: alphaPart === undefined ? 1 : alphaPart.endsWith('%') ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart),
  }
  return [color.r, color.g, color.b, color.a].every(Number.isFinite) ? color : undefined
}

function toCss({ r, g, b, a }: Rgba): string {
  const hex = [r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')
  return a >= 1 ? `#${hex}` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`
}

/**
 * Applies DrawingML luminance modulation and offset (fractions, so 0.6 for `lumMod val="60000"`)
 * in HSL space. Colors this cannot parse come back unchanged.
 */
export function adjustLuminance(css: string, lumMod: number, lumOff = 0): string {
  const color = parseCssColor(css)
  if (!color) return css
  const [hue, saturation, lightness] = rgbToHsl(color)
  const adjusted = Math.min(1, Math.max(0, lightness * lumMod + lumOff))
  return toCss({ ...hslToRgb(hue, saturation, adjusted), a: color.a })
}

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0)
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return [hue / 6, saturation, lightness]
}

function hslToRgb(hue: number, saturation: number, lightness: number): Omit<Rgba, 'a'> {
  if (saturation === 0) return { r: lightness * 255, g: lightness * 255, b: lightness * 255 }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset: number): number => {
    let t = hue + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return (p + (q - p) * 6 * t) * 255
    if (t < 1 / 2) return q * 255
    if (t < 2 / 3) return (p + (q - p) * (2 / 3 - t) * 6) * 255
    return p * 255
  }
  return { r: channel(1 / 3), g: channel(0), b: channel(-1 / 3) }
}

/** Office 2013+'s default theme accents, for decks whose theme gives none. */
export const DEFAULT_ACCENTS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'] as const

/**
 * Luminance variations Office's "colorful" chart palette (colors1.xml) applies to the six accents
 * in turn: series 1-6 use the plain accents, 7-12 a 60% shade, 13-18 an 80% tint, and so on.
 */
const ACCENT_VARIATIONS: readonly (readonly [lumMod: number, lumOff: number])[] = [
  [1, 0],
  [0.6, 0],
  [0.8, 0.2],
  [0.8, 0],
  [0.6, 0.4],
  [0.5, 0],
  [0.7, 0.3],
  [0.7, 0],
  [0.5, 0.5],
]

/** The automatic color of series (or, with varied colors, point) number `index`. */
export function automaticColor(accents: readonly string[], index: number): string {
  const palette = accents.length ? accents : DEFAULT_ACCENTS
  const safeIndex = Math.max(0, Math.floor(index))
  const base = palette[safeIndex % palette.length]!
  const variation = ACCENT_VARIATIONS[Math.floor(safeIndex / palette.length) % ACCENT_VARIATIONS.length]!
  return variation[0] === 1 && variation[1] === 0 ? base : adjustLuminance(base, variation[0], variation[1])
}
