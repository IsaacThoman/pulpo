import { parseXml } from './package.js'
import { DRAWINGML_NS, attribute, childElement, childElements, numberAttribute, type Element } from './xml.js'

/**
 * Office themes (`theme1.xml`) and the two color systems that refer to them: DrawingML colors
 * (charts, shapes, docx/pptx) and SpreadsheetML cell colors (fonts, fills, borders).
 */

export type ThemeColorSlot =
  | 'dk1'
  | 'lt1'
  | 'dk2'
  | 'lt2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6'
  | 'hlink'
  | 'folHlink'

/** The color scheme slots in the order they appear in theme XML. */
export const THEME_COLOR_SLOTS: readonly ThemeColorSlot[] = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]

/**
 * SpreadsheetML `theme="n"` indexes. Excel swaps the dark/light pairs relative to the XML order:
 * 0 is lt1 (usually white), 1 is dk1 (usually black).
 */
export const SPREADSHEET_THEME_SLOTS: readonly ThemeColorSlot[] = [
  'lt1',
  'dk1',
  'lt2',
  'dk2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]

export interface ThemeFonts {
  /** Latin typeface; may be empty. */
  latin: string
  eastAsian: string
  complexScript: string
}

export interface Theme {
  name: string
  /** Upper-case `RRGGBB` per slot. */
  colors: Record<ThemeColorSlot, string>
  /** Headings font (`+mj-lt`). */
  majorFont: ThemeFonts
  /** Body font (`+mn-lt`); charts and cells use it. */
  minorFont: ThemeFonts
}

/** The Office 2013–2022 theme ("Office"): Calibri, blue/orange/gray accents. */
export const DEFAULT_THEME: Theme = Object.freeze({
  name: 'Office Theme',
  colors: Object.freeze({
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2: '44546A',
    lt2: 'E7E6E6',
    accent1: '4472C4',
    accent2: 'ED7D31',
    accent3: 'A5A5A5',
    accent4: 'FFC000',
    accent5: '5B9BD5',
    accent6: '70AD47',
    hlink: '0563C1',
    folHlink: '954F72',
  }),
  majorFont: Object.freeze({ latin: 'Calibri Light', eastAsian: '', complexScript: '' }),
  minorFont: Object.freeze({ latin: 'Calibri', eastAsian: '', complexScript: '' }),
}) as Theme

/** The Office 2007–2010 theme, which openpyxl and older files carry. */
export const OFFICE_2007_THEME: Theme = Object.freeze({
  name: 'Office Theme',
  colors: Object.freeze({
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2: '1F497D',
    lt2: 'EEECE1',
    accent1: '4F81BD',
    accent2: 'C0504D',
    accent3: '9BBB59',
    accent4: '8064A2',
    accent5: '4BACC6',
    accent6: 'F79646',
    hlink: '0000FF',
    folHlink: '800080',
  }),
  majorFont: Object.freeze({ latin: 'Cambria', eastAsian: '', complexScript: '' }),
  minorFont: Object.freeze({ latin: 'Calibri', eastAsian: '', complexScript: '' }),
}) as Theme

/** The Office 2023+ theme: Aptos. */
export const OFFICE_2023_THEME: Theme = Object.freeze({
  name: 'Office Theme',
  colors: Object.freeze({
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2: '0E2841',
    lt2: 'E8E8E8',
    accent1: '156082',
    accent2: 'E97132',
    accent3: '196B24',
    accent4: '0F9ED5',
    accent5: 'A02B93',
    accent6: '4EA72E',
    hlink: '467886',
    folHlink: '96607D',
  }),
  majorFont: Object.freeze({ latin: 'Aptos Display', eastAsian: '', complexScript: '' }),
  minorFont: Object.freeze({ latin: 'Aptos', eastAsian: '', complexScript: '' }),
}) as Theme

const SYSTEM_COLORS: Record<string, string> = {
  windowText: '000000',
  window: 'FFFFFF',
  menuText: '000000',
  menu: 'F0F0F0',
  btnFace: 'F0F0F0',
  btnText: '000000',
  btnShadow: 'A0A0A0',
  btnHighlight: 'FFFFFF',
  highlight: '0078D7',
  highlightText: 'FFFFFF',
  grayText: '6D6D6D',
  captionText: '000000',
  activeCaption: '99B4D1',
  inactiveCaption: 'BFCDDB',
  inactiveCaptionText: '000000',
  infoText: '000000',
  infoBk: 'FFFFE1',
  windowFrame: '646464',
  activeBorder: 'B4B4B4',
  inactiveBorder: 'F4F7FC',
  appWorkspace: 'ABABAB',
  background: '000000',
  scrollBar: 'C8C8C8',
  '3dDkShadow': '696969',
  '3dLight': 'E3E3E3',
  hotLight: '0066CC',
  gradientActiveCaption: 'B9D1EA',
  gradientInactiveCaption: 'D7E4F2',
  menuHighlight: '3399FF',
  menuBar: 'F0F0F0',
}

function readThemeColor(element: Element | undefined): string | undefined {
  if (!element) return undefined
  for (const child of childElements(element, DRAWINGML_NS)) {
    if (child.localName === 'srgbClr') return normalizeHex(attribute(child, 'val'))
    if (child.localName === 'sysClr') {
      return normalizeHex(attribute(child, 'lastClr')) ?? SYSTEM_COLORS[attribute(child, 'val') ?? '']
    }
    // Other color types are legal but rare in schemes; resolve them without a theme.
    const rgba = resolveDrawingColor(child, DEFAULT_THEME)
    if (rgba) return rgbaToHex(rgba).slice(1).toUpperCase()
  }
  return undefined
}

function readFonts(element: Element | undefined, fallback: ThemeFonts): ThemeFonts {
  if (!element) return { ...fallback }
  const face = (name: string, otherwise: string) => {
    const value = attribute(childElement(element, DRAWINGML_NS, name), 'typeface')
    return value === undefined ? otherwise : value
  }
  return { latin: face('latin', fallback.latin), eastAsian: face('ea', fallback.eastAsian), complexScript: face('cs', fallback.complexScript) }
}

/**
 * Parses a theme part. Slots and fonts the file does not define keep `fallback`'s values.
 * Throws LiveFormatError for malformed XML.
 */
export function parseTheme(xml: string, fallback: Theme = DEFAULT_THEME): Theme {
  const root = parseXml(xml).documentElement
  const elements = childElement(root ?? undefined, DRAWINGML_NS, 'themeElements')
  const scheme = childElement(elements, DRAWINGML_NS, 'clrScheme')
  const fontScheme = childElement(elements, DRAWINGML_NS, 'fontScheme')
  const colors = { ...fallback.colors }
  for (const slot of THEME_COLOR_SLOTS) {
    const value = readThemeColor(childElement(scheme, DRAWINGML_NS, slot))
    if (value) colors[slot] = value
  }
  return {
    name: attribute(root ?? undefined, 'name') ?? fallback.name,
    colors,
    majorFont: readFonts(childElement(fontScheme, DRAWINGML_NS, 'majorFont'), fallback.majorFont),
    minorFont: readFonts(childElement(fontScheme, DRAWINGML_NS, 'minorFont'), fallback.minorFont),
  }
}

/** Resolves a `+mn-lt`/`+mj-lt`-style theme font reference; other names pass through. */
export function resolveThemeFont(typeface: string | undefined, theme: Theme): string | undefined {
  if (!typeface) return undefined
  const match = /^\+(mn|mj)-(lt|ea|cs)$/.exec(typeface)
  if (!match) return typeface
  const fonts = match[1] === 'mj' ? theme.majorFont : theme.minorFont
  const face = match[2] === 'lt' ? fonts.latin : match[2] === 'ea' ? fonts.eastAsian : fonts.complexScript
  return face || undefined
}

// ---------------------------------------------------------------------------------------------
// Color math

/** A color with 0–255 channels and 0–1 alpha. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function normalizeHex(value: string | undefined): string | undefined {
  if (!value) return undefined
  const hex = value.trim()
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : undefined
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function hexToRgba(hex: string, alpha = 1): Rgba | undefined {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return undefined
  const value = Number.parseInt(match[1]!, 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: alpha }
}

function channelHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
}

/** `#rrggbb`, ignoring alpha. */
export function rgbaToHex(color: Rgba): string {
  return `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`
}

/** `#rrggbb` when opaque, else `rgba(r,g,b,a)`. Always a safe CSS color literal. */
export function rgbaToCss(color: Rgba): string {
  const alpha = clamp(Number.isFinite(color.a) ? color.a : 1, 0, 1)
  if (alpha >= 1) return rgbaToHex(color)
  const channel = (value: number) => Math.round(clamp(value, 0, 255))
  return `rgba(${channel(color.r)},${channel(color.g)},${channel(color.b)},${Number(alpha.toFixed(3))})`
}

interface Hsl {
  h: number // 0–1
  s: number
  l: number
}

function rgbToHsl({ r, g, b }: Rgba): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hslToRgb({ h, s, l }: Hsl, a: number): Rgba {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255, a }
}

function toLinear(channel: number): number {
  const c = clamp(channel / 255, 0, 1)
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function fromLinear(value: number): number {
  const c = clamp(value, 0, 1)
  return (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255
}

// ---------------------------------------------------------------------------------------------
// DrawingML colors

export type DrawingColorKind = 'srgb' | 'scheme' | 'sys' | 'prst' | 'scrgb' | 'hsl'

export interface DrawingColorModifier {
  /** The modifier element's local name (`lumMod`, `alpha`, `shade`, …). */
  name: string
  /** The `val` attribute (1/1000 percent for most modifiers, 1/60000 degree for hue). */
  value: number
}

/**
 * A parsed DrawingML color: a base color plus its modifiers, in document order. Kept unresolved so
 * the same chart or shape can render against different themes.
 */
export interface DrawingColor {
  kind: DrawingColorKind
  /** `RRGGBB` for srgb; the scheme, system, or preset name otherwise. */
  value: string
  /** sysClr `lastClr`. */
  lastColor?: string
  /** scrgbClr r/g/b or hslClr hue/sat/lum, as written. */
  components?: [number, number, number]
  modifiers: DrawingColorModifier[]
}

const COLOR_ELEMENTS: Record<string, DrawingColorKind> = {
  srgbClr: 'srgb',
  schemeClr: 'scheme',
  sysClr: 'sys',
  prstClr: 'prst',
  scrgbClr: 'scrgb',
  hslClr: 'hsl',
}

const MAX_MODIFIERS = 32

/**
 * Parses a DrawingML color element (`a:srgbClr`, `a:schemeClr`, …), or the first color inside a
 * container such as `a:solidFill`. Returns undefined when there is no color.
 */
export function parseDrawingColor(element: Element | null | undefined): DrawingColor | undefined {
  if (!element) return undefined
  let colorElement: Element | undefined
  if (element.namespaceURI === DRAWINGML_NS && element.localName && element.localName in COLOR_ELEMENTS) colorElement = element
  else colorElement = childElements(element, DRAWINGML_NS).find((child) => !!child.localName && child.localName in COLOR_ELEMENTS)
  if (!colorElement) return undefined
  const kind = COLOR_ELEMENTS[colorElement.localName ?? '']!
  const color: DrawingColor = { kind, value: attribute(colorElement, 'val') ?? '', modifiers: [] }
  if (kind === 'sys') {
    const last = normalizeHex(attribute(colorElement, 'lastClr'))
    if (last) color.lastColor = last
  } else if (kind === 'scrgb') {
    color.components = [numberAttribute(colorElement, 'r') ?? 0, numberAttribute(colorElement, 'g') ?? 0, numberAttribute(colorElement, 'b') ?? 0]
  } else if (kind === 'hsl') {
    color.components = [numberAttribute(colorElement, 'hue') ?? 0, numberAttribute(colorElement, 'sat') ?? 0, numberAttribute(colorElement, 'lum') ?? 0]
  }
  for (const modifier of childElements(colorElement, DRAWINGML_NS)) {
    if (color.modifiers.length >= MAX_MODIFIERS) break
    const value = numberAttribute(modifier, 'val')
    color.modifiers.push({ name: modifier.localName ?? '', value: value ?? 0 })
  }
  return color
}

export interface DrawingColorContext {
  /**
   * The color map (`p:clrMap`/`c:clrMapOvr`): what bg1/tx1/bg2/tx2 point at. Defaults to
   * bg1→lt1, tx1→dk1, bg2→lt2, tx2→dk2.
   */
  colorMap?: Partial<Record<string, ThemeColorSlot>>
  /** The color `phClr` stands for (style matrix references). */
  placeholder?: Rgba
}

const DEFAULT_COLOR_MAP: Record<string, ThemeColorSlot> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }

function schemeHex(name: string, theme: Theme, context: DrawingColorContext): string | undefined {
  const mapped = context.colorMap?.[name] ?? DEFAULT_COLOR_MAP[name] ?? name
  return (theme.colors as Record<string, string | undefined>)[mapped]
}

function baseColor(color: DrawingColor, theme: Theme, context: DrawingColorContext): Rgba | undefined {
  switch (color.kind) {
    case 'srgb': {
      const hex = normalizeHex(color.value)
      return hex ? hexToRgba(hex) : undefined
    }
    case 'scheme': {
      if (color.value === 'phClr') return context.placeholder ? { ...context.placeholder } : undefined
      const hex = schemeHex(color.value, theme, context)
      return hex ? hexToRgba(hex) : undefined
    }
    case 'sys': {
      const hex = color.lastColor ?? SYSTEM_COLORS[color.value]
      return hex ? hexToRgba(hex) : undefined
    }
    case 'prst': {
      const hex = presetColorHex(color.value)
      return hex ? hexToRgba(hex) : undefined
    }
    case 'scrgb': {
      const [r, g, b] = color.components ?? [0, 0, 0]
      return { r: fromLinear(r / 100000), g: fromLinear(g / 100000), b: fromLinear(b / 100000), a: 1 }
    }
    case 'hsl': {
      const [hue, sat, lum] = color.components ?? [0, 0, 0]
      return hslToRgb({ h: (((hue / 60000) % 360) + 360) % 360 / 360, s: clamp(sat / 100000, 0, 1), l: clamp(lum / 100000, 0, 1) }, 1)
    }
  }
}

function applyModifier(color: Rgba, modifier: DrawingColorModifier): Rgba {
  const fraction = modifier.value / 100000
  switch (modifier.name) {
    case 'alpha':
      return { ...color, a: clamp(fraction, 0, 1) }
    case 'alphaMod':
      return { ...color, a: clamp(color.a * fraction, 0, 1) }
    case 'alphaOff':
      return { ...color, a: clamp(color.a + fraction, 0, 1) }
    case 'lumMod':
    case 'lumOff':
    case 'lum':
    case 'satMod':
    case 'satOff':
    case 'sat':
    case 'hueMod':
    case 'hueOff':
    case 'hue': {
      const hsl = rgbToHsl(color)
      if (modifier.name === 'lumMod') hsl.l = clamp(hsl.l * fraction, 0, 1)
      else if (modifier.name === 'lumOff') hsl.l = clamp(hsl.l + fraction, 0, 1)
      else if (modifier.name === 'lum') hsl.l = clamp(fraction, 0, 1)
      else if (modifier.name === 'satMod') hsl.s = clamp(hsl.s * fraction, 0, 1)
      else if (modifier.name === 'satOff') hsl.s = clamp(hsl.s + fraction, 0, 1)
      else if (modifier.name === 'sat') hsl.s = clamp(fraction, 0, 1)
      else if (modifier.name === 'hueMod') hsl.h = ((hsl.h * fraction) % 1 + 1) % 1
      else if (modifier.name === 'hueOff') hsl.h = ((hsl.h + modifier.value / 60000 / 360) % 1 + 1) % 1
      else hsl.h = (((modifier.value / 60000) % 360) + 360) % 360 / 360
      return hslToRgb(hsl, color.a)
    }
    case 'shade': {
      // Office applies shade and tint in linear RGB.
      const f = clamp(fraction, 0, 1)
      return { r: fromLinear(toLinear(color.r) * f), g: fromLinear(toLinear(color.g) * f), b: fromLinear(toLinear(color.b) * f), a: color.a }
    }
    case 'tint': {
      const f = clamp(fraction, 0, 1)
      const tint = (c: number) => fromLinear(1 - (1 - toLinear(c)) * f)
      return { r: tint(color.r), g: tint(color.g), b: tint(color.b), a: color.a }
    }
    case 'comp': {
      const hsl = rgbToHsl(color)
      hsl.h = (hsl.h + 0.5) % 1
      return hslToRgb(hsl, color.a)
    }
    case 'inv':
      return { r: 255 - color.r, g: 255 - color.g, b: 255 - color.b, a: color.a }
    case 'gray': {
      const gray = color.r * 0.3 + color.g * 0.59 + color.b * 0.11
      return { r: gray, g: gray, b: gray, a: color.a }
    }
    case 'gamma':
      return { r: fromLinear(color.r / 255), g: fromLinear(color.g / 255), b: fromLinear(color.b / 255), a: color.a }
    case 'invGamma':
      return { r: toLinear(color.r) * 255, g: toLinear(color.g) * 255, b: toLinear(color.b) * 255, a: color.a }
    case 'red':
    case 'green':
    case 'blue':
    case 'redMod':
    case 'greenMod':
    case 'blueMod':
    case 'redOff':
    case 'greenOff':
    case 'blueOff': {
      const key = modifier.name.startsWith('red') ? 'r' : modifier.name.startsWith('green') ? 'g' : 'b'
      const linear = toLinear(color[key])
      const next = modifier.name.endsWith('Mod') ? linear * fraction : modifier.name.endsWith('Off') ? linear + fraction : fraction
      return { ...color, [key]: fromLinear(next) }
    }
    default:
      return color
  }
}

/**
 * Resolves a DrawingML color against a theme. Accepts a parsed color, a color element, or a
 * container (`a:solidFill`). Returns undefined when there is no color or it cannot be resolved.
 */
export function resolveDrawingColor(
  color: DrawingColor | Element | null | undefined,
  theme: Theme,
  context: DrawingColorContext = {},
): Rgba | undefined {
  if (!color) return undefined
  const parsed = 'kind' in color && 'modifiers' in color ? color : parseDrawingColor(color as Element)
  if (!parsed) return undefined
  let rgba = baseColor(parsed, theme, context)
  if (!rgba) return undefined
  for (const modifier of parsed.modifiers) rgba = applyModifier(rgba, modifier)
  return {
    r: Math.round(clamp(rgba.r, 0, 255)),
    g: Math.round(clamp(rgba.g, 0, 255)),
    b: Math.round(clamp(rgba.b, 0, 255)),
    a: clamp(rgba.a, 0, 1),
  }
}

// CSS named colors, which DrawingML preset colors are (with dk/lt/med abbreviations).
const NAMED_COLORS =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,' +
  'darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,' +
  'darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,' +
  'darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,' +
  'firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,' +
  'goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,' +
  'indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,' +
  'lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,' +
  'lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,' +
  'lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,' +
  'linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,' +
  'mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,' +
  'mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,' +
  'navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,' +
  'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,' +
  'peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,' +
  'saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,' +
  'skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,' +
  'tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,' +
  'whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32'

let namedColorMap: Map<string, string> | undefined

/** The `RRGGBB` of a DrawingML preset color name (`red`, `dkBlue`, `ltGray`, `medSeaGreen`, …). */
export function presetColorHex(name: string): string | undefined {
  namedColorMap ??= new Map(NAMED_COLORS.split(',').map((pair) => pair.split(':') as [string, string]))
  const normalized = name
    .replace(/^dk(?=[A-Z])/, 'dark')
    .replace(/^lt(?=[A-Z])/, 'light')
    .replace(/^med(?=[A-Z])/, 'medium')
    .toLowerCase()
  return namedColorMap.get(normalized)?.toUpperCase()
}

// ---------------------------------------------------------------------------------------------
// SpreadsheetML colors

/** Excel's legacy 64-color palette (indexes 0–63). 64 and 65 are the system foreground/background. */
export const INDEXED_COLORS: readonly string[] = Object.freeze([
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
])

/** A `<color>`/`<fgColor>`/`<bgColor>` as written in styles.xml. */
export interface SpreadsheetColor {
  /** `AARRGGBB` (or `RRGGBB`). Excel ignores the alpha byte. */
  rgb?: string
  /** Index into SPREADSHEET_THEME_SLOTS. */
  theme?: number
  indexed?: number
  /** -1..1: darkens toward black or lightens toward white. */
  tint?: number
  /** The automatic (system) color. */
  auto?: boolean
}

export interface SpreadsheetColorOptions {
  /** A workbook's `<indexedColors>` palette, replacing INDEXED_COLORS. */
  indexedPalette?: readonly string[]
  /** What automatic and index 64 resolve to. Default black (text). */
  systemForeground?: string
  /** What index 65 resolves to. Default white. */
  systemBackground?: string
}

const HLS_MAX = 240

/**
 * Applies an Excel cell-color tint to `RRGGBB`, returning `RRGGBB`. Excel works in the Windows HLS space (0–240 per component,
 * integer math) and rounds back to 0–255 channels, so results differ by a unit or two from exact
 * float HSL math; this reproduces Excel's swatches (accent1 lighter 40% is #8EA9DB, not #8FAADC).
 */
export function applyExcelTint(hex: string, tint: number): string {
  const rgba = hexToRgba(hex)
  if (!rgba) return hex
  if (!Number.isFinite(tint) || tint === 0) return rgbaToHex(rgba).slice(1).toUpperCase()
  const t = clamp(tint, -1, 1)
  const hsl = rgbToHsl(rgba)
  const round = (value: number) => Math.floor(value + 0.5)
  const hue = round(hsl.h * HLS_MAX)
  const lum = Math.floor(hsl.l * HLS_MAX + 1e-9)
  const sat = round(hsl.s * HLS_MAX)
  const tinted = round(t < 0 ? lum * (1 + t) : lum * (1 - t) + (HLS_MAX - HLS_MAX * (1 - t)))
  const l = clamp(tinted, 0, HLS_MAX)
  if (sat === 0) {
    const gray = round((l * 255) / HLS_MAX)
    return rgbaToHex({ r: gray, g: gray, b: gray, a: 1 }).slice(1).toUpperCase()
  }
  const m2 = l > HLS_MAX / 2 ? sat + l - round((sat * l) / HLS_MAX) : round(((sat + HLS_MAX) * l) / HLS_MAX)
  const m1 = 2 * l - m2
  const channel = (h: number) => {
    let x = h > HLS_MAX ? h - HLS_MAX : h < 0 ? h + HLS_MAX : h
    let value: number
    if (x > (HLS_MAX * 2) / 3) value = m1
    else if (x > HLS_MAX / 2) {
      x = (HLS_MAX * 2) / 3 - x
      value = round((x * (m2 - m1)) / (HLS_MAX / 6)) + m1
    } else if (x > HLS_MAX / 6) value = m2
    else value = round((x * (m2 - m1)) / (HLS_MAX / 6)) + m1
    return clamp(round((value * 255) / HLS_MAX), 0, 255)
  }
  return rgbaToHex({ r: channel(hue + HLS_MAX / 3), g: channel(hue), b: channel(hue - HLS_MAX / 3), a: 1 }).slice(1).toUpperCase()
}

/**
 * Resolves a SpreadsheetML color to `#RRGGBB`, applying its tint. Returns undefined for colors that
 * do not resolve (unknown theme or indexed slots, malformed rgb), so callers fall back to defaults.
 */
export function resolveSpreadsheetColor(color: SpreadsheetColor, theme: Theme, options: SpreadsheetColorOptions = {}): string | undefined {
  let hex: string | undefined
  if (color.rgb !== undefined) {
    const raw = color.rgb.trim()
    hex = normalizeHex(raw.length === 8 ? raw.slice(2) : raw)
  } else if (color.theme !== undefined) {
    const slot = Number.isInteger(color.theme) ? SPREADSHEET_THEME_SLOTS[color.theme] : undefined
    hex = slot ? theme.colors[slot] : undefined
  } else if (color.indexed !== undefined) {
    const index = color.indexed
    if (index === 64) hex = normalizeHex(options.systemForeground) ?? '000000'
    else if (index === 65) hex = normalizeHex(options.systemBackground) ?? 'FFFFFF'
    else if (Number.isInteger(index) && index >= 0) {
      const palette = options.indexedPalette ?? INDEXED_COLORS
      const entry = palette[index]
      hex = entry === undefined ? undefined : normalizeHex(entry.length === 8 ? entry.slice(2) : entry)
    }
  } else if (color.auto) {
    hex = normalizeHex(options.systemForeground) ?? '000000'
  }
  if (!hex) return undefined
  return `#${applyExcelTint(hex, color.tint ?? 0)}`
}
