import { attr, childElements, intAttr, NS, type XmlElement } from '../xml.js'

/**
 * DrawingML colors: the six color models, theme scheme colors through the color map, and the
 * transforms (tint, shade, lumMod, alpha, …) Office applies in order.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

export interface ColorContext {
  /** Theme scheme colors by name (dk1, lt1, accent1, …) as hex. */
  scheme: Record<string, string>
  /** The color map (bg1 → lt1, tx1 → dk1, …). */
  colorMap: Record<string, string>
  /** What `phClr` stands for inside a theme style. */
  placeholder?: Rgba
}

export const DEFAULT_COLOR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
}

const COLOR_ELEMENTS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'hslClr', 'scrgbClr'])

/** The color element inside a fill or color container (`a:solidFill`, `a:fgClr`, …). */
export function colorChild(container: XmlElement | undefined): XmlElement | undefined {
  if (!container) return undefined
  if (COLOR_ELEMENTS.has(container.localName ?? '')) return container
  return childElements(container).find((element) => COLOR_ELEMENTS.has(element.localName ?? ''))
}

export function parseHex(hex: string | undefined): Rgba | undefined {
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16), a: 1 }
}

export function toHex(color: Rgba): string {
  const part = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `${part(color.r)}${part(color.g)}${part(color.b)}`.toUpperCase()
}

export function toCss(color: Rgba | undefined): string {
  if (!color) return 'transparent'
  const rgb = `${Math.round(clamp(color.r, 0, 255))}, ${Math.round(clamp(color.g, 0, 255))}, ${Math.round(clamp(color.b, 0, 255))}`
  return color.a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${Math.round(clamp(color.a, 0, 1) * 1000) / 1000})`
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

/** Resolves a color element (or a container holding one) to RGBA. */
export function resolveColor(element: XmlElement | undefined, context: ColorContext): Rgba | undefined {
  const color = colorChild(element)
  if (!color) return undefined
  const base = baseColor(color, context)
  if (!base) return undefined
  return applyTransforms(base, color)
}

function baseColor(element: XmlElement, context: ColorContext): Rgba | undefined {
  switch (element.localName) {
    case 'srgbClr':
      return parseHex(attr(element, 'val'))
    case 'sysClr':
      return parseHex(attr(element, 'lastClr')) ?? (attr(element, 'val') === 'window' ? parseHex('FFFFFF') : parseHex('000000'))
    case 'schemeClr': {
      const name = attr(element, 'val') ?? ''
      if (name === 'phClr') return context.placeholder ? { ...context.placeholder } : parseHex('000000')
      const mapped = context.colorMap[name] ?? DEFAULT_COLOR_MAP[name] ?? name
      return parseHex(context.scheme[mapped]) ?? parseHex(context.scheme[name])
    }
    case 'prstClr':
      return parseHex(PRESET_COLORS[attr(element, 'val') ?? ''] ?? '000000')
    case 'hslClr': {
      const hue = (intAttr(element, 'hue') ?? 0) / 60000
      const saturation = percentage(attr(element, 'sat'))
      const lightness = percentage(attr(element, 'lum'))
      return { ...hslToRgb(hue, saturation, lightness), a: 1 }
    }
    case 'scrgbClr': {
      const channel = (name: string) => linearToSrgb(percentage(attr(element, name))) * 255
      return { r: channel('r'), g: channel('g'), b: channel('b'), a: 1 }
    }
    default:
      return undefined
  }
}

/** DrawingML percentages: thousandths of a percent (`50000` = 50%), or `50%` in strict files. */
function percentage(value: string | undefined): number {
  if (!value) return 0
  if (value.endsWith('%')) return Number.parseFloat(value) / 100
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number / 100000 : 0
}

function applyTransforms(input: Rgba, element: XmlElement): Rgba {
  let color = { ...input }
  for (const transform of childElements(element)) {
    if (transform.namespaceURI !== NS.a) continue
    const value = percentage(attr(transform, 'val'))
    const raw = intAttr(transform, 'val') ?? 0
    switch (transform.localName) {
      case 'alpha':
        color.a = value
        break
      case 'alphaMod':
        color.a *= value
        break
      case 'alphaOff':
        color.a = clamp(color.a + value, 0, 1)
        break
      case 'tint':
        color = mapLinear(color, (channel) => channel * value + (1 - value))
        break
      case 'shade':
        color = mapLinear(color, (channel) => channel * value)
        break
      case 'lumMod':
        color = mapHsl(color, (h, s, l) => [h, s, l * value])
        break
      case 'lumOff':
        color = mapHsl(color, (h, s, l) => [h, s, l + value])
        break
      case 'lum':
        color = mapHsl(color, (h, s) => [h, s, value])
        break
      case 'satMod':
        color = mapHsl(color, (h, s, l) => [h, s * value, l])
        break
      case 'satOff':
        color = mapHsl(color, (h, s, l) => [h, s + value, l])
        break
      case 'sat':
        color = mapHsl(color, (h, _s, l) => [h, value, l])
        break
      case 'hueMod':
        color = mapHsl(color, (h, s, l) => [h * value, s, l])
        break
      case 'hueOff':
        color = mapHsl(color, (h, s, l) => [h + raw / 60000, s, l])
        break
      case 'hue':
        color = mapHsl(color, (_h, s, l) => [raw / 60000, s, l])
        break
      case 'comp':
        color = mapHsl(color, (h, s, l) => [h + 180, s, l])
        break
      case 'inv':
        color = { r: 255 - color.r, g: 255 - color.g, b: 255 - color.b, a: color.a }
        break
      case 'gray': {
        const gray = 0.3 * color.r + 0.59 * color.g + 0.11 * color.b
        color = { r: gray, g: gray, b: gray, a: color.a }
        break
      }
      case 'red':
        color.r = value * 255
        break
      case 'green':
        color.g = value * 255
        break
      case 'blue':
        color.b = value * 255
        break
      case 'redMod':
        color.r *= value
        break
      case 'greenMod':
        color.g *= value
        break
      case 'blueMod':
        color.b *= value
        break
      case 'redOff':
        color.r += value * 255
        break
      case 'greenOff':
        color.g += value * 255
        break
      case 'blueOff':
        color.b += value * 255
        break
      default:
        break
    }
  }
  return { r: clamp(color.r, 0, 255), g: clamp(color.g, 0, 255), b: clamp(color.b, 0, 255), a: clamp(color.a, 0, 1) }
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const clamped = clamp(value, 0, 1)
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
}

/** Tint and shade work on linear light, as in Office, which is why 50% shade is not half as bright. */
function mapLinear(color: Rgba, map: (channel: number) => number): Rgba {
  const channel = (value: number) => linearToSrgb(map(srgbToLinear(value / 255))) * 255
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b), a: color.a }
}

function mapHsl(color: Rgba, map: (h: number, s: number, l: number) => [number, number, number]): Rgba {
  const [h, s, l] = rgbToHsl(color)
  const [nh, ns, nl] = map(h, s, l)
  return { ...hslToRgb((((nh % 360) + 360) % 360) / 1, clamp(ns, 0, 1), clamp(nl, 0, 1)), a: color.a }
}

export function rgbToHsl(color: Rgba): [number, number, number] {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

export function hslToRgb(hue: number, saturation: number, lightness: number): { r: number; g: number; b: number } {
  const h = (((hue % 360) + 360) % 360) / 360
  if (saturation === 0) return { r: lightness * 255, g: lightness * 255, b: lightness * 255 }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (t: number) => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 }
}

/** ST_PresetColorVal: CSS color names in DrawingML spelling. */
const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  gray: '808080',
  grey: '808080',
  ltGray: 'D3D3D3',
  dkGray: 'A9A9A9',
  silver: 'C0C0C0',
  orange: 'FFA500',
  purple: '800080',
  navy: '000080',
  teal: '008080',
  maroon: '800000',
  olive: '808000',
  lime: '00FF00',
  aqua: '00FFFF',
  fuchsia: 'FF00FF',
  brown: 'A52A2A',
  pink: 'FFC0CB',
  gold: 'FFD700',
  indigo: '4B0082',
  violet: 'EE82EE',
  dkBlue: '00008B',
  dkRed: '8B0000',
  dkGreen: '006400',
  ltBlue: 'ADD8E6',
  ltGreen: '90EE90',
  ltYellow: 'FFFFE0',
  dkOrange: 'FF8C00',
  coral: 'FF7F50',
  tomato: 'FF6347',
  salmon: 'FA8072',
  tan: 'D2B48C',
  beige: 'F5F5DC',
  khaki: 'F0E68C',
  crimson: 'DC143C',
  turquoise: '40E0D0',
  skyBlue: '87CEEB',
  steelBlue: '4682B4',
  royalBlue: '4169E1',
  slateGray: '708090',
  dkSlateGray: '2F4F4F',
  ltSlateGray: '778899',
  forestGreen: '228B22',
  seaGreen: '2E8B57',
  chocolate: 'D2691E',
  firebrick: 'B22222',
  goldenrod: 'DAA520',
  orchid: 'DA70D6',
  plum: 'DDA0DD',
  lavender: 'E6E6FA',
  ivory: 'FFFFF0',
  wheat: 'F5DEB3',
  snow: 'FFFAFA',
  ltGrey: 'D3D3D3',
  dkGrey: 'A9A9A9',
}
