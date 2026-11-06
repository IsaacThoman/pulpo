import { attr, child, childElements, intAttr, NS, type XmlElement } from '../xml.js'
import { colorChild, resolveColor, toCss, type ColorContext, type Rgba } from './color.js'
import type { Theme } from './deck.js'
import { emuToPx, escapeAttribute, num, type RenderEnv } from './env.js'
import { emptyBag, mergeInto } from './props.js'

/**
 * Fills, lines, and shadows as SVG paint. Each returns the attribute values to put on a path and
 * the `<defs>` they need.
 */

export interface Paint {
  /** A color, `url(#id)`, or `none`. */
  value: string
  defs: string
  /** The color for things that need one plain color (text fallback, shading). */
  color?: Rgba
}

export const NO_PAINT: Paint = { value: 'none', defs: '' }

const FILL_NAMES = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

export function fillElementOf(parent: XmlElement | undefined): XmlElement | undefined {
  return childElements(parent).find((element) => FILL_NAMES.has(element.localName ?? '') && element.namespaceURI === NS.a)
}

/** A theme style (`a:fillRef`, `a:lnRef`, …) resolved to its element and placeholder color. */
export function styleReference(
  reference: XmlElement | undefined,
  lookup: (index: number) => XmlElement | undefined,
  env: RenderEnv,
): { element: XmlElement; colors: ColorContext } | undefined {
  if (!reference) return undefined
  const index = intAttr(reference, 'idx') ?? 0
  if (index <= 0) return undefined
  const element = lookup(index)
  if (!element) return undefined
  const placeholder = resolveColor(reference, env.colors)
  return { element, colors: { ...env.colors, ...(placeholder ? { placeholder } : {}) } }
}

/** A theme fill by style index: 1..999 are fill styles, 1001+ background fill styles. */
export function themeFill(theme: Theme, index: number): XmlElement | undefined {
  if (index >= 1001) return theme.backgroundFillStyles[index - 1001]
  return index > 0 ? theme.fillStyles[index - 1] : undefined
}

export interface Box {
  w: number
  h: number
}

/** SVG paint for a fill element. `group` is the enclosing group's fill, for `a:grpFill`. */
export function paintFill(fill: XmlElement | undefined, env: RenderEnv, box: Box, colors: ColorContext = env.colors, group?: Paint): Paint {
  if (!fill) return NO_PAINT
  switch (fill.localName) {
    case 'noFill':
      return NO_PAINT
    case 'solidFill': {
      const color = resolveColor(fill, colors)
      return color ? { value: toCss(color), defs: '', color } : NO_PAINT
    }
    case 'gradFill':
      return gradientPaint(fill, env, box, colors)
    case 'blipFill':
      return imagePaint(fill, env, box)
    case 'pattFill':
      return patternPaint(fill, env, colors)
    case 'grpFill':
      return group ?? NO_PAINT
    default:
      return NO_PAINT
  }
}

function gradientStops(fill: XmlElement, colors: ColorContext): { offset: number; color: Rgba }[] {
  const stops = childElements(child(fill, 'gsLst', NS.a))
    .map((stop) => ({ offset: (intAttr(stop, 'pos') ?? 0) / 100000, color: resolveColor(stop, colors) }))
    .filter((stop): stop is { offset: number; color: Rgba } => stop.color !== undefined)
    .sort((a, b) => a.offset - b.offset)
  return stops
}

function stopsMarkup(stops: { offset: number; color: Rgba }[]): string {
  return stops
    .map((stop) => `<stop offset="${num(Math.min(1, Math.max(0, stop.offset)))}" stop-color="${toCss({ ...stop.color, a: 1 })}"${stop.color.a < 1 ? ` stop-opacity="${num(stop.color.a)}"` : ''}/>`)
    .join('')
}

function gradientPaint(fill: XmlElement, env: RenderEnv, box: Box, colors: ColorContext): Paint {
  const stops = gradientStops(fill, colors)
  if (!stops.length) return NO_PAINT
  if (stops.length === 1) return { value: toCss(stops[0]!.color), defs: '', color: stops[0]!.color }
  const id = env.nextId()
  const average = stops[Math.floor(stops.length / 2)]!.color
  const pathElement = child(fill, 'path', NS.a)
  if (pathElement) {
    const rect = child(pathElement, 'fillToRect', NS.a)
    const l = (intAttr(rect, 'l') ?? 0) / 100000
    const t = (intAttr(rect, 't') ?? 0) / 100000
    const r = (intAttr(rect, 'r') ?? 0) / 100000
    const b = (intAttr(rect, 'b') ?? 0) / 100000
    const cx = ((l + (1 - r)) / 2) * box.w
    const cy = ((t + (1 - b)) / 2) * box.h
    const radius = Math.max(Math.hypot(cx, cy), Math.hypot(box.w - cx, cy), Math.hypot(cx, box.h - cy), Math.hypot(box.w - cx, box.h - cy)) || 1
    // DrawingML path gradients run from the focus (first stop) outward; SVG radial gradients too.
    return {
      value: `url(#${id})`,
      defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}">${stopsMarkup(stops)}</radialGradient>`,
      color: average,
    }
  }
  const linear = child(fill, 'lin', NS.a)
  let angle = ((intAttr(linear, 'ang') ?? 0) / 60000) * (Math.PI / 180)
  if (linear && attr(linear, 'scaled') === '1' && box.w > 0 && box.h > 0) angle = Math.atan2(Math.sin(angle) * box.h, Math.cos(angle) * box.w)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const half = (Math.abs(box.w * cos) + Math.abs(box.h * sin)) / 2
  const cx = box.w / 2
  const cy = box.h / 2
  return {
    value: `url(#${id})`,
    defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(cx - cos * half)}" y1="${num(cy - sin * half)}" x2="${num(cx + cos * half)}" y2="${num(cy + sin * half)}">${stopsMarkup(stops)}</linearGradient>`,
    color: average,
  }
}

/** Where an image goes in a box, honoring `a:srcRect` cropping and `a:fillRect` insets. */
export function imagePlacement(blipFill: XmlElement, box: Box): { x: number; y: number; w: number; h: number } {
  const crop = child(blipFill, 'srcRect', NS.a)
  const fraction = (element: XmlElement | undefined, name: string) => (intAttr(element, name) ?? 0) / 100000
  const stretch = child(child(blipFill, 'stretch', NS.a), 'fillRect', NS.a)
  const inset = { l: fraction(stretch, 'l'), t: fraction(stretch, 't'), r: fraction(stretch, 'r'), b: fraction(stretch, 'b') }
  const target = { x: box.w * inset.l, y: box.h * inset.t, w: box.w * (1 - inset.l - inset.r), h: box.h * (1 - inset.t - inset.b) }
  const l = fraction(crop, 'l')
  const t = fraction(crop, 't')
  const r = fraction(crop, 'r')
  const b = fraction(crop, 'b')
  const visibleW = 1 - l - r || 1
  const visibleH = 1 - t - b || 1
  const w = target.w / visibleW
  const h = target.h / visibleH
  return { x: target.x - l * w, y: target.y - t * h, w, h }
}

/** The image part of a blip fill, through the part's relationships. */
export function blipPart(blipFill: XmlElement, env: RenderEnv): string | undefined {
  const blip = child(blipFill, 'blip', NS.a)
  const id = blip?.getAttributeNS(NS.r, 'embed')
  const rel = id ? env.rel(id) : undefined
  return rel && !rel.external ? rel.target : undefined
}

export function blipOpacity(blipFill: XmlElement): number {
  const blip = child(blipFill, 'blip', NS.a)
  const alpha = child(blip, 'alphaModFix', NS.a)
  return alpha ? (intAttr(alpha, 'amt') ?? 100000) / 100000 : 1
}

export function blipFilter(blipFill: XmlElement): string {
  const blip = child(blipFill, 'blip', NS.a)
  return child(blip, 'grayscl', NS.a) ? 'grayscale(1)' : ''
}

function imagePaint(fill: XmlElement, env: RenderEnv, box: Box): Paint {
  const part = blipPart(fill, env)
  const url = part ? env.assetUrl(part) : undefined
  const id = env.nextId()
  if (!url) return { value: 'rgb(230, 230, 230)', defs: '', color: { r: 230, g: 230, b: 230, a: 1 } }
  const opacity = blipOpacity(fill)
  const tile = child(fill, 'tile', NS.a)
  if (tile) {
    const sx = (intAttr(tile, 'sx') ?? 100000) / 100000
    const sy = (intAttr(tile, 'sy') ?? 100000) / 100000
    // The renderer does not know the image's own size; tiles assume a 96 px source, the common texture size.
    const w = Math.max(4, 96 * sx)
    const h = Math.max(4, 96 * sy)
    return {
      value: `url(#${id})`,
      defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(emuToPx(intAttr(tile, 'tx') ?? 0))}" y="${num(emuToPx(intAttr(tile, 'ty') ?? 0))}" width="${num(w)}" height="${num(h)}"><image href="${escapeAttribute(url)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" opacity="${num(opacity)}"/></pattern>`,
    }
  }
  const place = imagePlacement(fill, box)
  return {
    value: `url(#${id})`,
    defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(box.w)}" height="${num(box.h)}"><image href="${escapeAttribute(url)}" x="${num(place.x)}" y="${num(place.y)}" width="${num(place.w)}" height="${num(place.h)}" preserveAspectRatio="none" opacity="${num(opacity)}"/></pattern>`,
  }
}

/** Preset patterns as 8×8 tiles: foreground path data on the background color. */
const PATTERNS: Record<string, string> = {
  pct5: 'M0 0h1v1H0z',
  pct10: 'M0 0h1v1H0zM4 4h1v1H4z',
  pct20: 'M0 0h1v1H0zM4 0h1v1H4zM2 4h1v1H2zM6 4h1v1H6z',
  pct25: 'M0 0h1v1H0zM4 0h1v1H4zM2 2h1v1H2zM6 2h1v1H6zM0 4h1v1H0zM4 4h1v1H4zM2 6h1v1H2zM6 6h1v1H6z',
  pct30: 'M0 0h2v1H0zM4 0h2v1H4zM2 2h2v1H2zM6 2h2v1H6zM0 4h2v1H0zM4 4h2v1H4zM2 6h2v1H2zM6 6h2v1H6z',
  pct40: 'M0 0h2v2H0zM4 0h2v2H4zM2 4h2v2H2zM6 4h2v2H6z',
  pct50: 'M0 0h1v1H0zM2 0h1v1H2zM4 0h1v1H4zM6 0h1v1H6zM1 1h1v1H1zM3 1h1v1H3zM5 1h1v1H5zM7 1h1v1H7zM0 2h1v1H0zM2 2h1v1H2zM4 2h1v1H4zM6 2h1v1H6zM1 3h1v1H1zM3 3h1v1H3zM5 3h1v1H5zM7 3h1v1H7zM0 4h1v1H0zM2 4h1v1H2zM4 4h1v1H4zM6 4h1v1H6zM1 5h1v1H1zM3 5h1v1H3zM5 5h1v1H5zM7 5h1v1H7zM0 6h1v1H0zM2 6h1v1H2zM4 6h1v1H4zM6 6h1v1H6zM1 7h1v1H1zM3 7h1v1H3zM5 7h1v1H5zM7 7h1v1H7z',
  pct60: 'M0 0h3v3H0zM4 4h3v3H4zM4 0h3v2H4zM0 4h3v2H0z',
  pct70: 'M0 0h8v3H0zM0 4h8v3H0z',
  pct75: 'M0 0h8v3H0zM0 4h8v3H0zM0 3h3v1H0z',
  pct80: 'M0 0h8v8H0z',
  pct90: 'M0 0h8v8H0z',
  horz: 'M0 0h8v1H0zM0 4h8v1H0z',
  vert: 'M0 0h1v8H0zM4 0h1v8H4z',
  ltHorz: 'M0 0h8v1H0zM0 4h8v1H0z',
  ltVert: 'M0 0h1v8H0zM4 0h1v8H4z',
  dkHorz: 'M0 0h8v2H0zM0 4h8v2H0z',
  dkVert: 'M0 0h2v8H0zM4 0h2v8H4z',
  narHorz: 'M0 0h8v1H0zM0 2h8v1H0zM0 4h8v1H0zM0 6h8v1H0z',
  narVert: 'M0 0h1v8H0zM2 0h1v8H2zM4 0h1v8H4zM6 0h1v8H6z',
  dashHorz: 'M0 0h4v1H0zM4 4h4v1H4z',
  dashVert: 'M0 0h1v4H0zM4 4h1v4H4z',
  cross: 'M0 0h8v1H0zM0 0h1v8H0z',
  smGrid: 'M0 0h8v1H0zM0 0h1v8H0zM0 4h8v1H0zM4 0h1v8H4z',
  lgGrid: 'M0 0h8v1H0zM0 0h1v8H0z',
  dnDiag: 'M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM7 7h1v1H7z',
  upDiag: 'M7 0h1v1H7zM6 1h1v1H6zM5 2h1v1H5zM4 3h1v1H4zM3 4h1v1H3zM2 5h1v1H2zM1 6h1v1H1zM0 7h1v1H0z',
  ltDnDiag: 'M0 0h1v1H0zM2 2h1v1H2zM4 4h1v1H4zM6 6h1v1H6z',
  ltUpDiag: 'M6 0h1v1H6zM4 2h1v1H4zM2 4h1v1H2zM0 6h1v1H0z',
  dkDnDiag: 'M0 0h2v1H0zM1 1h2v1H1zM2 2h2v1H2zM3 3h2v1H3zM4 4h2v1H4zM5 5h2v1H5zM6 6h2v1H6zM7 7h1v1H7z',
  dkUpDiag: 'M6 0h2v1H6zM5 1h2v1H5zM4 2h2v1H4zM3 3h2v1H3zM2 4h2v1H2zM1 5h2v1H1zM0 6h2v1H0zM0 7h1v1H0z',
  wdDnDiag: 'M0 0h3v1H0zM1 1h3v1H1zM2 2h3v1H2zM3 3h3v1H3zM4 4h3v1H4zM5 5h3v1H5z',
  wdUpDiag: 'M5 0h3v1H5zM4 1h3v1H4zM3 2h3v1H3zM2 3h3v1H2zM1 4h3v1H1zM0 5h3v1H0z',
  diagCross: 'M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM7 7h1v1H7zM7 0h1v1H7zM6 1h1v1H6zM5 2h1v1H5zM4 3h1v1H4zM3 4h1v1H3zM2 5h1v1H2zM1 6h1v1H1zM0 7h1v1H0z',
  smCheck: 'M0 0h2v2H0zM4 0h2v2H4zM2 2h2v2H2zM6 2h2v2H6zM0 4h2v2H0zM4 4h2v2H4zM2 6h2v2H2zM6 6h2v2H6z',
  lgCheck: 'M0 0h4v4H0zM4 4h4v4H4z',
  dotGrid: 'M0 0h1v1H0zM4 0h1v1H4zM0 4h1v1H0zM4 4h1v1H4z',
  solidDmnd: 'M4 0l4 4-4 4-4-4z',
  openDmnd: 'M4 0l4 4-4 4-4-4zm0 1L1 4l3 3 3-3z',
  sphere: 'M4 1a3 3 0 1 0 .01 0z',
  weave: 'M0 0h1v1H0zM2 2h1v1H2zM4 0h1v1H4zM6 2h1v1H6zM0 4h1v1H0zM4 4h1v1H4z',
  plaid: 'M0 0h4v2H0zM0 4h8v1H0zM2 0h1v8H2z',
  divot: 'M1 1h2v1H1zM5 5h2v1H5z',
  shingle: 'M0 0h8v1H0zM3 1h1v3H3zM7 4h1v4H7z',
  wave: 'M0 2h2v1H0zM2 1h2v1H2zM4 2h2v1H4zM6 3h2v1H6z',
  zigZag: 'M0 3h1v1H0zM1 2h1v1H1zM2 1h1v1H2zM3 0h1v1H3zM4 0h1v1H4zM5 1h1v1H5zM6 2h1v1H6zM7 3h1v1H7z',
  trellis: 'M0 0h2v1H0zM4 0h2v1H4zM2 2h2v1H2zM6 2h2v1H6zM0 4h2v1H0zM4 4h2v1H4zM2 6h2v1H2zM6 6h2v1H6z',
  horzBrick: 'M0 0h8v1H0zM0 4h8v1H0zM0 0h1v4H0zM4 4h1v4H4z',
  diagBrick: 'M0 7h1v1H0zM1 6h1v1H1zM2 5h1v1H2zM3 4h1v1H3zM4 3h1v1H4zM5 2h1v1H5zM6 1h1v1H6zM7 0h1v1H7zM4 4h1v1H4zM5 5h1v1H5z',
}

function patternPaint(fill: XmlElement, env: RenderEnv, colors: ColorContext): Paint {
  const foreground = resolveColor(child(fill, 'fgClr', NS.a), colors) ?? { r: 0, g: 0, b: 0, a: 1 }
  const background = resolveColor(child(fill, 'bgClr', NS.a), colors) ?? { r: 255, g: 255, b: 255, a: 1 }
  const preset = attr(fill, 'prst') ?? 'pct5'
  const shape = PATTERNS[preset] ?? PATTERNS.pct50!
  const id = env.nextId()
  return {
    value: `url(#${id})`,
    defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="${toCss(background)}"/><path d="${shape}" fill="${toCss(foreground)}"/></pattern>`,
    color: foreground,
  }
}

// ---------------------------------------------------------------------------------------------
// Lines

export interface Stroke {
  paint: Paint
  width: number
  attrs: string
  /** Marker definitions and references for arrowheads. */
  markers: { defs: string; start?: string; end?: string }
}

const DASHES: Record<string, number[]> = {
  dash: [4, 3],
  dot: [1, 1],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
}

/**
 * The effective line of a shape: theme line style (from `p:style`), then inherited lines, then the
 * shape's own `a:ln`, each overriding what the one before set.
 */
export function strokeFor(layers: readonly (XmlElement | undefined)[], env: RenderEnv, box: Box, colors: readonly ColorContext[] = []): Stroke | undefined {
  const bag = emptyBag()
  let fillColors = env.colors
  layers.forEach((layer, index) => {
    if (!layer) return
    mergeInto(bag, layer)
    if (fillElementOf(layer)) fillColors = colors[index] ?? env.colors
  })
  const fill = bag.children.fill
  if (!fill || fill.localName === 'noFill') return undefined
  const paint = fill.localName === 'pattFill' ? solidFromPattern(fill, fillColors) : paintFill(fill, env, box, fillColors)
  if (paint.value === 'none') return undefined
  const widthEmu = Number.parseInt(bag.attrs.w ?? '9525', 10)
  const width = Math.max(emuToPx(Number.isFinite(widthEmu) ? widthEmu : 9525), 0.75)
  const parts = [`stroke-width="${num(width)}"`]
  const cap = bag.attrs.cap
  parts.push(`stroke-linecap="${cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt'}"`)
  const join = bag.children.round ? 'round' : bag.children.bevel ? 'bevel' : 'miter'
  parts.push(`stroke-linejoin="${join}"`)
  const dash = attr(bag.children.prstDash, 'val')
  const custom = bag.children.custDash
  let pattern = dash ? DASHES[dash] : undefined
  if (custom) {
    pattern = childElements(custom).flatMap((entry) => [(intAttr(entry, 'd') ?? 100000) / 100000, (intAttr(entry, 'sp') ?? 100000) / 100000])
  }
  if (pattern?.length) {
    // Dash lengths scale with the line; round caps already add half a width at each end.
    const adjust = cap === 'rnd' || cap === 'sq' ? width : 0
    parts.push(`stroke-dasharray="${pattern.map((value, index) => num(Math.max(0.01, value * width + (index % 2 ? adjust : -adjust)))).join(' ')}"`)
  }
  const colorCss = paint.color ? toCss(paint.color) : paint.value
  const markers = arrowMarkers(bag.children.headEnd, bag.children.tailEnd, colorCss, env)
  return { paint, width, attrs: parts.join(' '), markers }
}

function solidFromPattern(fill: XmlElement, colors: ColorContext): Paint {
  const color = resolveColor(child(fill, 'fgClr', NS.a), colors)
  return color ? { value: toCss(color), defs: '', color } : NO_PAINT
}

const ARROW_SIZES: Record<string, number> = { sm: 2, med: 3, lg: 5 }

function arrowMarkers(head: XmlElement | undefined, tail: XmlElement | undefined, color: string, env: RenderEnv): Stroke['markers'] {
  let defs = ''
  const marker = (end: XmlElement | undefined, atStart: boolean): string | undefined => {
    const type = attr(end, 'type')
    if (!end || !type || type === 'none') return undefined
    const w = ARROW_SIZES[attr(end, 'w') ?? 'med'] ?? 3
    const l = ARROW_SIZES[attr(end, 'len') ?? 'med'] ?? 3
    const id = env.nextId()
    // Drawn pointing along +x in stroke-width units; orient flips the start marker.
    let shape: string
    switch (type) {
      case 'arrow':
        shape = `<path d="M0 0L${l} ${w / 2}L0 ${w}" fill="none" stroke="${color}" stroke-width="0.6"/>`
        break
      case 'stealth':
        shape = `<path d="M0 0L${l} ${w / 2}L0 ${w}L${l * 0.35} ${w / 2}z" fill="${color}"/>`
        break
      case 'diamond':
        shape = `<path d="M0 ${w / 2}L${l / 2} 0L${l} ${w / 2}L${l / 2} ${w}z" fill="${color}"/>`
        break
      case 'oval':
        shape = `<ellipse cx="${l / 2}" cy="${w / 2}" rx="${l / 2}" ry="${w / 2}" fill="${color}"/>`
        break
      default:
        shape = `<path d="M0 0L${l} ${w / 2}L0 ${w}z" fill="${color}"/>`
    }
    const refX = type === 'diamond' || type === 'oval' ? l / 2 : l * 0.8
    defs += `<marker id="${id}" markerUnits="strokeWidth" markerWidth="${l}" markerHeight="${w}" viewBox="0 0 ${l} ${w}" refX="${num(refX)}" refY="${w / 2}" orient="${atStart ? 'auto-start-reverse' : 'auto'}" overflow="visible">${shape}</marker>`
    return `url(#${id})`
  }
  const start = marker(head, true)
  const end = marker(tail, false)
  return { defs, ...(start ? { start } : {}), ...(end ? { end } : {}) }
}

// ---------------------------------------------------------------------------------------------
// Effects

/** An SVG filter for an outer shadow, if the effect list has one. Other effects are kept, not drawn. */
export function shadowFilter(effects: XmlElement | undefined, env: RenderEnv, colors: ColorContext = env.colors): { id: string; defs: string } | undefined {
  const shadow = child(effects, 'outerShdw', NS.a)
  if (!shadow) return undefined
  const color = resolveColor(shadow, colors) ?? { r: 0, g: 0, b: 0, a: 0.4 }
  const distance = emuToPx(intAttr(shadow, 'dist') ?? 0)
  const direction = ((intAttr(shadow, 'dir') ?? 0) / 60000) * (Math.PI / 180)
  const blur = emuToPx(intAttr(shadow, 'blurRad') ?? 0)
  const id = env.nextId()
  return {
    id,
    defs: `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="${num(distance * Math.cos(direction))}" dy="${num(distance * Math.sin(direction))}" stdDeviation="${num(blur / 2)}" flood-color="${toCss({ ...color, a: 1 })}" flood-opacity="${num(color.a)}"/></filter>`,
  }
}

export { colorChild }
