import { jmlAttr, jmlChild, jmlElements, jmlNumber, jmlOn, localName, type JmlElement } from './jsonml.js'

/**
 * WordprocessingML properties as CSS. Pure string functions: the schema's `toDOM`, the style
 * sheet generator, and the static renderer for headers and footers all share them, and none of
 * them touch the DOM.
 *
 * Lengths stay in points (1 twip = 1/20 pt, sizes are half-points) so CSS lays text out at the
 * sizes Word uses.
 */

export type CssProps = Record<string, string>

export const twipsToPt = (twips: number) => twips / 20
export const emuToPt = (emu: number) => emu / 12700
export const PT_TO_PX = 96 / 72

const round = (value: number) => Math.round(value * 100) / 100
const pt = (value: number) => `${round(value)}pt`

export function cssText(props: CssProps): string {
  let text = ''
  for (const key in props) text += `${key}:${props[key]};`
  return text
}

/** Class-safe form of a style id (`Heading 1` → `Heading_201`). */
export function cssIdent(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, (char) => `_${char.charCodeAt(0).toString(16)}`)
}

export const HIGHLIGHT_COLORS: Record<string, string> = {
  black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#00ff00', magenta: '#ff00ff', red: '#ff0000',
  yellow: '#ffff00', white: '#ffffff', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000',
  darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0',
}

const THEME_COLOR_VARS: Record<string, string> = {
  dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2', text1: 'dk1', background1: 'lt1', text2: 'dk2',
  background2: 'lt2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4',
  accent5: 'accent5', accent6: 'accent6', hyperlink: 'hlink', followedHyperlink: 'folHlink',
}

function hexColor(value: string | undefined): string | undefined {
  if (!value || value === 'auto') return undefined
  return /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toLowerCase()}` : undefined
}

/** Applies a theme tint (toward white) or shade (toward black), both hex bytes. */
function tintShade(hex: string, tint?: string, shade?: string): string {
  const parse = (value?: string) => (value && /^[0-9a-fA-F]{2}$/.test(value) ? Number.parseInt(value, 16) / 255 : undefined)
  const tintValue = parse(tint)
  const shadeValue = parse(shade)
  if (tintValue === undefined && shadeValue === undefined) return hex
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  const adjusted = channels.map((channel) => {
    let value = channel
    if (shadeValue !== undefined) value = value * shadeValue
    if (tintValue !== undefined) value = value * tintValue + 255 * (1 - tintValue)
    return Math.max(0, Math.min(255, Math.round(value)))
  })
  return `#${adjusted.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export interface ThemeInfo {
  /** Scheme colors by their theme name (`accent1`, `dk1`, …) as `#rrggbb`. */
  colors: Record<string, string>
  fonts: { major?: string; minor?: string; majorEastAsia?: string; minorEastAsia?: string; majorCs?: string; minorCs?: string }
}

/**
 * A color from `w:color`/`w:shd`-style attributes: the theme color (with tint/shade) when the
 * theme is known, else the literal value.
 */
export function resolveColor(
  value: string | undefined,
  themeColor: string | undefined,
  tint: string | undefined,
  shade: string | undefined,
  theme?: ThemeInfo,
): string | undefined {
  if (themeColor) {
    const key = THEME_COLOR_VARS[themeColor] ?? themeColor
    const base = theme?.colors[key]
    if (base) return tintShade(base, tint, shade)
    const literal = hexColor(value)
    if (literal) return literal
    return `var(--docx-theme-${key})`
  }
  return hexColor(value)
}

/** Fonts Word documents name, with metric-compatible open fonts after them. */
const FONT_FALLBACKS: Record<string, string> = {
  calibri: 'Carlito, "Liberation Sans", Arial, sans-serif',
  'calibri light': 'Carlito, "Liberation Sans", Arial, sans-serif',
  cambria: 'Caladea, "Liberation Serif", "Times New Roman", serif',
  arial: '"Liberation Sans", Arimo, Helvetica, sans-serif',
  'times new roman': '"Liberation Serif", Tinos, Times, serif',
  'courier new': '"Liberation Mono", Cousine, Courier, monospace',
  helvetica: 'Arial, "Liberation Sans", sans-serif',
  symbol: '"Symbol", serif',
  'segoe ui': 'system-ui, "Segoe UI", sans-serif',
  aptos: 'Aptos, Carlito, "Liberation Sans", sans-serif',
  georgia: 'Georgia, Gelasio, serif',
  verdana: 'Verdana, "DejaVu Sans", sans-serif',
}

export function fontStack(name: string): string {
  const fallback = FONT_FALLBACKS[name.toLowerCase()]
  const quoted = `"${name.replace(/["\\]/g, '')}"`
  return fallback ? `${quoted}, ${fallback}` : `${quoted}, sans-serif`
}

/** Line height factor of a font's "single" spacing, so `w:spacing w:line="240"` matches Word. */
const FONT_LINE_FACTORS: Record<string, number> = {
  calibri: 1.22, 'calibri light': 1.22, carlito: 1.22, cambria: 1.17, caladea: 1.17, arial: 1.15,
  'liberation sans': 1.15, 'times new roman': 1.15, 'liberation serif': 1.15, 'courier new': 1.13,
  aptos: 1.2, georgia: 1.14, verdana: 1.22, 'segoe ui': 1.33,
}

export function fontLineFactor(name: string | undefined): number | undefined {
  return name ? FONT_LINE_FACTORS[name.toLowerCase()] : undefined
}

function themeFont(theme: string, info?: ThemeInfo): string | undefined {
  const major = theme.startsWith('major')
  if (theme.endsWith('EastAsia')) return major ? info?.fonts.majorEastAsia : info?.fonts.minorEastAsia
  if (theme.endsWith('Bidi')) return major ? info?.fonts.majorCs : info?.fonts.minorCs
  return major ? info?.fonts.major : info?.fonts.minor
}

/** The Latin font `w:rFonts` names (theme fonts resolved), which is what most text uses. */
export function latinFont(rFonts: JmlElement | undefined, theme?: ThemeInfo): string | undefined {
  if (!rFonts) return undefined
  const themed = jmlAttr(rFonts, 'w:asciiTheme') ?? jmlAttr(rFonts, 'w:hAnsiTheme')
  if (themed) return themeFont(themed, theme) ?? (themed.startsWith('major') ? 'var(--docx-font-major)' : 'var(--docx-font-minor)')
  return jmlAttr(rFonts, 'w:ascii') ?? jmlAttr(rFonts, 'w:hAnsi') ?? jmlAttr(rFonts, 'w:eastAsia') ?? jmlAttr(rFonts, 'w:cs')
}

/** CSS for one run property element (`w:b`, `w:sz`, …), or undefined if it does not render. */
export function runPropertyCss(element: JmlElement, theme?: ThemeInfo): CssProps | undefined {
  const name = localName(element[0])
  const on = jmlOn(element)
  switch (name) {
    case 'b':
      return { 'font-weight': on ? '700' : '400' }
    case 'i':
      return { 'font-style': on ? 'italic' : 'normal' }
    case 'caps':
      return { 'text-transform': on ? 'uppercase' : 'none' }
    case 'smallCaps':
      return { 'font-variant-caps': on ? 'small-caps' : 'normal' }
    case 'strike':
      return on ? { 'text-decoration-line': 'line-through' } : undefined
    case 'dstrike':
      return on ? { 'text-decoration-line': 'line-through', 'text-decoration-style': 'double' } : undefined
    case 'vanish':
      return on ? { display: 'none' } : undefined
    case 'outline':
      return on ? { '-webkit-text-stroke': '0.5pt currentColor', color: 'transparent' } : undefined
    case 'shadow':
      return on ? { 'text-shadow': '1pt 1pt 1pt rgb(0 0 0 / 0.4)' } : undefined
    case 'emboss':
      return on ? { 'text-shadow': '-1px -1px 0 rgb(255 255 255 / 0.6), 1px 1px 0 rgb(0 0 0 / 0.3)' } : undefined
    case 'imprint':
      return on ? { 'text-shadow': '1px 1px 0 rgb(255 255 255 / 0.6), -1px -1px 0 rgb(0 0 0 / 0.3)' } : undefined
    case 'color': {
      const color = resolveColor(jmlAttr(element, 'w:val'), jmlAttr(element, 'w:themeColor'), jmlAttr(element, 'w:themeTint'), jmlAttr(element, 'w:themeShade'), theme)
      // `auto` is black on light shading, which is what the page shows.
      return { color: color ?? 'var(--docx-auto-color, #000)' }
    }
    case 'spacing': {
      const value = jmlNumber(element, 'w:val')
      return value === undefined ? undefined : { 'letter-spacing': pt(twipsToPt(value)) }
    }
    case 'w': {
      const value = jmlNumber(element, 'w:val')
      return value === undefined || value === 100 ? undefined : { display: 'inline-block', transform: `scaleX(${value / 100})`, 'transform-origin': 'left' }
    }
    case 'position': {
      const value = jmlNumber(element, 'w:val')
      return value === undefined ? undefined : { 'vertical-align': pt(value / 2), 'line-height': '1' }
    }
    case 'sz': {
      const value = jmlNumber(element, 'w:val')
      return value === undefined ? undefined : { 'font-size': pt(value / 2) }
    }
    case 'highlight': {
      const color = HIGHLIGHT_COLORS[jmlAttr(element, 'w:val') ?? '']
      return color ? { 'background-color': color } : undefined
    }
    case 'u': {
      const value = jmlAttr(element, 'w:val') ?? 'single'
      if (value === 'none') return { 'text-decoration-line': 'none' }
      const color = resolveColor(jmlAttr(element, 'w:color'), jmlAttr(element, 'w:themeColor'), jmlAttr(element, 'w:themeTint'), jmlAttr(element, 'w:themeShade'), theme)
      const style = value.startsWith('double') ? 'double' : value.includes('dot') || value.includes('dash') ? (value.includes('dash') ? 'dashed' : 'dotted') : value.startsWith('wav') ? 'wavy' : 'solid'
      return {
        'text-decoration-line': 'underline',
        'text-decoration-style': style,
        ...(value === 'thick' || value.endsWith('Heavy') ? { 'text-decoration-thickness': '2px' } : {}),
        ...(color ? { 'text-decoration-color': color } : {}),
        ...(value === 'words' ? { 'text-decoration-skip-ink': 'auto' } : {}),
      }
    }
    case 'shd': {
      const fill = shadingColor(element, theme)
      return fill ? { 'background-color': fill } : undefined
    }
    case 'vertAlign': {
      const value = jmlAttr(element, 'w:val')
      if (value === 'superscript') return { 'vertical-align': 'super', 'font-size': '65%' }
      if (value === 'subscript') return { 'vertical-align': 'sub', 'font-size': '65%' }
      return undefined
    }
    case 'rFonts': {
      const font = latinFont(element, theme)
      if (!font) return undefined
      const factor = fontLineFactor(font)
      return {
        'font-family': font.startsWith('var(') ? font : fontStack(font),
        ...(factor ? { '--docx-flh': String(factor) } : {}),
      }
    }
    case 'bdr': {
      const border = borderCss(element, theme)
      return border ? { border } : undefined
    }
    default:
      return undefined
  }
}

/** Merges declarations, joining text-decoration lines so underline and strike can both show. */
export function mergeCss(target: CssProps, source: CssProps | undefined): CssProps {
  if (!source) return target
  for (const key in source) {
    if (key === 'text-decoration-line' && target[key] && target[key] !== 'none' && source[key] !== 'none' && !target[key]!.includes(source[key]!)) {
      target[key] = `${target[key]} ${source[key]}`
    } else {
      target[key] = source[key]!
    }
  }
  return target
}

/** CSS for every property of a `w:rPr`. */
export function runPropertiesCss(rPr: JmlElement | undefined, theme?: ThemeInfo): CssProps {
  const props: CssProps = {}
  if (!rPr) return props
  for (const child of jmlElements(rPr)) mergeCss(props, runPropertyCss(child, theme))
  return props
}

/** The fill of a `w:shd`, applying its pattern as a blend of fill and pattern color. */
export function shadingColor(shd: JmlElement, theme?: ThemeInfo): string | undefined {
  const pattern = jmlAttr(shd, 'w:val')
  const fill = resolveColor(jmlAttr(shd, 'w:fill'), jmlAttr(shd, 'w:themeFill'), jmlAttr(shd, 'w:themeFillTint'), jmlAttr(shd, 'w:themeFillShade'), theme)
  const color = resolveColor(jmlAttr(shd, 'w:color'), jmlAttr(shd, 'w:themeColor'), jmlAttr(shd, 'w:themeTint'), jmlAttr(shd, 'w:themeShade'), theme)
  if (pattern === 'solid') return color ?? '#000000'
  const percent = /^pct(\d+)$/.exec(pattern ?? '')
  if (percent && color && fill && !color.startsWith('var(') && !fill.startsWith('var(')) {
    const share = Number(percent[1]) / 100
    const mix = [1, 3, 5].map((offset) => Math.round(Number.parseInt(fill.slice(offset, offset + 2), 16) * (1 - share) + Number.parseInt(color.slice(offset, offset + 2), 16) * share))
    return `#${mix.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  }
  return fill
}

const BORDER_STYLES: Record<string, string> = {
  single: 'solid', thick: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed', dotDash: 'dashed',
  dotDotDash: 'dotted', triple: 'double', thinThickSmallGap: 'double', thickThinSmallGap: 'double',
  thinThickMediumGap: 'double', thickThinMediumGap: 'double', thinThickLargeGap: 'double', thickThinLargeGap: 'double',
  wave: 'solid', doubleWave: 'double', dashSmallGap: 'dashed', dashDotStroked: 'dashed', threeDEmboss: 'ridge',
  threeDEngrave: 'groove', outset: 'outset', inset: 'inset',
}

/** A border element (`w:top`, `w:bdr`, …) as a CSS `border` value; `none` when it is turned off. */
export function borderCss(element: JmlElement | undefined, theme?: ThemeInfo): string | undefined {
  if (!element) return undefined
  const value = jmlAttr(element, 'w:val') ?? 'single'
  if (value === 'nil' || value === 'none') return 'none'
  const size = jmlNumber(element, 'w:sz') ?? 4
  const color = resolveColor(jmlAttr(element, 'w:color'), jmlAttr(element, 'w:themeColor'), jmlAttr(element, 'w:themeTint'), jmlAttr(element, 'w:themeShade'), theme) ?? 'currentColor'
  const style = BORDER_STYLES[value] ?? 'solid'
  // Eighths of a point; CSS needs at least a hairline, and double borders three.
  const width = Math.max(style === 'double' ? 2.25 : 0.5, size / 8)
  return `${round(width)}pt ${style} ${color}`
}

/** CSS of one paragraph property element; `side` effects such as borders return several declarations. */
export function paragraphPropertyCss(element: JmlElement, theme?: ThemeInfo): CssProps | undefined {
  const name = localName(element[0])
  switch (name) {
    case 'jc': {
      const value = jmlAttr(element, 'w:val')
      const align = value === 'center' ? 'center' : value === 'right' || value === 'end' ? 'right' : value === 'both' || value === 'distribute' || value?.startsWith('thai') || value?.endsWith('Kashida') ? 'justify' : 'left'
      return { 'text-align': align }
    }
    case 'ind': {
      const props: CssProps = {}
      const left = jmlNumber(element, 'w:left') ?? jmlNumber(element, 'w:start')
      const right = jmlNumber(element, 'w:right') ?? jmlNumber(element, 'w:end')
      const firstLine = jmlNumber(element, 'w:firstLine')
      const hanging = jmlNumber(element, 'w:hanging')
      if (left !== undefined) props['margin-left'] = pt(twipsToPt(left))
      if (right !== undefined) props['margin-right'] = pt(twipsToPt(right))
      if (hanging !== undefined) props['text-indent'] = pt(-twipsToPt(hanging))
      else if (firstLine !== undefined) props['text-indent'] = pt(twipsToPt(firstLine))
      return props
    }
    case 'spacing': {
      const props: CssProps = {}
      const before = jmlNumber(element, 'w:before')
      const after = jmlNumber(element, 'w:after')
      if (jmlOn(element) !== false) {
        if (jmlAttr(element, 'w:beforeAutospacing') === '1' || jmlAttr(element, 'w:beforeAutospacing') === 'true') props['padding-top'] = '14pt'
        else if (before !== undefined) props['padding-top'] = pt(twipsToPt(before))
        if (jmlAttr(element, 'w:afterAutospacing') === '1' || jmlAttr(element, 'w:afterAutospacing') === 'true') props['padding-bottom'] = '14pt'
        else if (after !== undefined) props['padding-bottom'] = pt(twipsToPt(after))
      }
      const line = jmlNumber(element, 'w:line')
      if (line !== undefined) {
        const rule = jmlAttr(element, 'w:lineRule') ?? 'auto'
        if (rule === 'auto') {
          props['--docx-lh'] = String(round(line / 240))
          props['--docx-lh-abs'] = 'initial'
          props['--docx-lh-min'] = '0pt'
        } else if (rule === 'exact') {
          props['--docx-lh-abs'] = pt(twipsToPt(line))
          props['--docx-lh-min'] = '0pt'
        } else {
          props['--docx-lh'] = '1'
          props['--docx-lh-abs'] = 'initial'
          props['--docx-lh-min'] = pt(twipsToPt(line))
        }
      }
      return props
    }
    case 'pBdr': {
      const props: CssProps = {}
      for (const side of ['top', 'left', 'bottom', 'right'] as const) {
        const border = jmlChild(element, `w:${side}`)
        const css = borderCss(border, theme)
        if (!css) continue
        props[`border-${side}`] = css
        const space = jmlNumber(border, 'w:space')
        if (space && css !== 'none') props[`--docx-bdr-space-${side}`] = pt(space)
      }
      if (props['--docx-bdr-space-left']) props['padding-left'] = props['--docx-bdr-space-left']
      if (props['--docx-bdr-space-right']) props['padding-right'] = props['--docx-bdr-space-right']
      return props
    }
    case 'shd': {
      const fill = shadingColor(element, theme)
      return fill ? { 'background-color': fill } : undefined
    }
    case 'bidi':
      return jmlOn(element) ? { direction: 'rtl' } : undefined
    case 'textDirection':
      return undefined
    default:
      return undefined
  }
}

/** CSS of a `w:pPr`-like list of property elements. */
export function paragraphPropertiesCss(elements: Iterable<JmlElement>, theme?: ThemeInfo): CssProps {
  const props: CssProps = {}
  for (const element of elements) mergeCss(props, paragraphPropertyCss(element, theme))
  return props
}
