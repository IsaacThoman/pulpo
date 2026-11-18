/** Small sRGB / OKLab helpers for deriving theme palettes from a few hex colors. */

type Rgb = [number, number, number]
type Lab = [number, number, number]

const HEX_PATTERN = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Returns `#rrggbb`, or `#rrggbbaa` when the color is translucent, for a 3-, 4-, 6-, or 8-digit hex
 * color (with or without `#`), or null. Fully opaque alpha is dropped.
 */
export function normalizeHex(value: string): string | null {
  const match = HEX_PATTERN.exec(value.trim())
  if (!match) return null
  let digits = match[1]!.toLowerCase()
  if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('')
  if (digits.length === 8 && digits.endsWith('ff')) digits = digits.slice(0, 6)
  return `#${digits}`
}

/** The color without its alpha, `#rrggbb`. */
export function solidHex(hex: string): string {
  return (normalizeHex(hex) ?? '#000000').slice(0, 7)
}

/** Alpha from 0 to 1. */
export function alphaOf(hex: string): number {
  const value = normalizeHex(hex) ?? '#000000'
  return value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1
}

/** Replaces a color's alpha (0–1), keeping `#rrggbb` when opaque. */
export function withAlpha(hex: string, alpha: number): string {
  const solid = solidHex(hex)
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return byte === 255 ? solid : `${solid}${byte.toString(16).padStart(2, '0')}`
}

function hexToRgb(hex: string): Rgb {
  const value = solidHex(hex)
  return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16) / 255) as Rgb
}

/** Paints a translucent color over an opaque one, like the browser does, giving `#rrggbb`. */
export function flattenHex(hex: string, background: string): string {
  const alpha = alphaOf(hex)
  if (alpha === 1) return solidHex(hex)
  const top = hexToRgb(hex)
  const bottom = hexToRgb(background)
  return rgbToHex(top.map((channel, index) => channel * alpha + bottom[index]! * (1 - alpha)) as Rgb)
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}`
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}

function rgbToOklab([r, g, b]: Rgb): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb([lightness, a, b]: Lab): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** Mixes `amount` (0–1) of `to` into `from` in OKLab, like CSS `color-mix(in oklab, …)`. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = rgbToOklab(hexToRgb(from))
  const b = rgbToOklab(hexToRgb(to))
  return rgbToHex(oklabToRgb(a.map((value, index) => value + (b[index]! - value) * amount) as Lab))
}

/** OKLab chroma: near 0 for grays. */
export function chroma(hex: string): number {
  const [, a, b] = rgbToOklab(hexToRgb(hex))
  return Math.hypot(a, b)
}

/** OKLab lightness, 0 (black) to 1 (white). */
export function lightness(hex: string): number {
  return rgbToOklab(hexToRgb(hex))[0]
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colors, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** The candidate with the most contrast against `background`. */
export function mostReadable(background: string, candidates: readonly string[]): string {
  return candidates.reduce((best, candidate) => (
    contrastRatio(background, candidate) > contrastRatio(background, best) ? candidate : best
  ))
}
