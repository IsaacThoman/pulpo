import { decodePartText } from '../../ooxml/package.js'
import { renderChartSvg } from '../chart/index.js'
import { customGeometry, presetGeometry, type GeometryResult } from '../geometry/index.js'
import type { RelTarget } from '../model.js'
import { attr, boolAttr, child, childElements, intAttr, NS, path, REL_TYPES, type XmlElement } from '../xml.js'
import { resolveColor, toCss, type ColorContext } from './color.js'
import { matchPlaceholder, placeholderOf, placeholderType, type LayoutInfo, type MasterInfo } from './deck.js'
import { cssFontFamily, emuToPx, escapeAttribute, escapeText, num, px, type RenderEnv } from './env.js'
import {
  blipFilter,
  blipOpacity,
  blipPart,
  fillElementOf,
  imagePlacement,
  NO_PAINT,
  paintFill,
  shadowFilter,
  strokeFor,
  styleReference,
  themeFill,
  type Box,
  type Paint,
} from './fill.js'
import { emptyBag, type PropertyBag } from './props.js'
import { renderTable } from './table.js'
import { bodyLayout, renderTextFrame, type TextStyleContext } from './text.js'

/** Where a shape tree sits: `slide` shapes inherit from layout and master placeholders. */
export type TreeLevel = 'slide' | 'layout' | 'master' | 'drawing'

/** Maps a shape's EMU transform into the coordinates of the element it is drawn in. */
export interface Frame {
  originX: number
  originY: number
  scaleX: number
  scaleY: number
  /** A flipped group mirrors its members' positions and flips; their text stays readable. */
  flipH?: boolean
  flipV?: boolean
  /** The group's child extents, needed to mirror positions. */
  extentX?: number
  extentY?: number
}

export const ROOT_FRAME: Frame = { originX: 0, originY: 0, scaleX: 1, scaleY: 1 }

export interface ShapeRenderOptions {
  env: RenderEnv
  level: TreeLevel
  frame: Frame
  /** The enclosing group's fill, for `a:grpFill`. */
  groupFill?: Paint
  /** Model key of the shape, for hit testing in the editor. */
  key?: string
  /** Leave out the text (the inline editor draws it instead). */
  hideText?: boolean
  depth?: number
}

export interface Transform {
  x: number
  y: number
  w: number
  h: number
  rot: number
  flipH: boolean
  flipV: boolean
}

export function readTransform(xfrm: XmlElement | undefined): (Transform & { chX: number; chY: number; chW: number; chH: number }) | undefined {
  if (!xfrm) return undefined
  const off = child(xfrm, 'off', NS.a)
  const ext = child(xfrm, 'ext', NS.a)
  const chOff = child(xfrm, 'chOff', NS.a)
  const chExt = child(xfrm, 'chExt', NS.a)
  const w = intAttr(ext, 'cx') ?? 0
  const h = intAttr(ext, 'cy') ?? 0
  return {
    x: intAttr(off, 'x') ?? 0,
    y: intAttr(off, 'y') ?? 0,
    w,
    h,
    rot: (intAttr(xfrm, 'rot') ?? 0) / 60000,
    flipH: boolAttr(xfrm, 'flipH') === true,
    flipV: boolAttr(xfrm, 'flipV') === true,
    chX: intAttr(chOff, 'x') ?? 0,
    chY: intAttr(chOff, 'y') ?? 0,
    chW: intAttr(chExt, 'cx') ?? w,
    chH: intAttr(chExt, 'cy') ?? h,
  }
}

/** What a shape inherits from: the layout and master placeholders it matches, least specific first. */
export function inheritanceChain(element: XmlElement, level: TreeLevel, env: RenderEnv): XmlElement[] {
  const ph = placeholderOf(element)
  if (!ph) return []
  const chain: XmlElement[] = []
  if (level === 'slide' && env.layout) {
    const layoutShape = matchPlaceholder(env.layout.placeholders, ph)
    const masterSource = layoutShape ? placeholderOf(layoutShape) ?? ph : ph
    const masterShape = env.master ? matchPlaceholder(env.master.placeholders, masterSource, true) : undefined
    if (masterShape) chain.push(masterShape)
    if (layoutShape) chain.push(layoutShape)
  } else if (level === 'layout' && env.master) {
    const masterShape = matchPlaceholder(env.master.placeholders, ph, true)
    if (masterShape) chain.push(masterShape)
  }
  return chain
}

function properties(element: XmlElement | undefined): XmlElement | undefined {
  return childElements(element).find((entry) => entry.localName === 'spPr' || entry.localName === 'grpSpPr')
}

/** The shape's transform element, inherited from placeholders when the shape has none. */
export function effectiveXfrm(element: XmlElement, chain: readonly XmlElement[]): XmlElement | undefined {
  const own = element.localName === 'graphicFrame' ? childElements(element).find((entry) => entry.localName === 'xfrm') : child(properties(element), 'xfrm', NS.a)
  if (own) return own
  for (const ancestor of [...chain].reverse()) {
    const inherited = child(properties(ancestor), 'xfrm', NS.a)
    if (inherited) return inherited
  }
  return undefined
}

function pick(element: XmlElement, chain: readonly XmlElement[], find: (spPr: XmlElement | undefined) => XmlElement | undefined): XmlElement | undefined {
  const own = find(properties(element))
  if (own) return own
  for (const ancestor of [...chain].reverse()) {
    const inherited = find(properties(ancestor))
    if (inherited) return inherited
  }
  return undefined
}

function styleOf(element: XmlElement, chain: readonly XmlElement[]): XmlElement | undefined {
  return childElements(element).find((entry) => entry.localName === 'style') ?? [...chain].reverse().map((ancestor) => childElements(ancestor).find((entry) => entry.localName === 'style')).find(Boolean)
}

/** Geometry for a shape box in px. */
export function shapeGeometry(spPr: XmlElement | undefined, w: number, h: number, fallback = 'rect'): GeometryResult {
  const custom = child(spPr, 'custGeom', NS.a)
  if (custom) return customGeometry(custom, w, h)
  const preset = child(spPr, 'prstGeom', NS.a)
  const name = attr(preset, 'prst') ?? fallback
  const adjust: Record<string, number> = {}
  for (const guide of childElements(child(preset, 'avLst', NS.a))) {
    const match = /^val\s+(-?\d+)/.exec(attr(guide, 'fmla') ?? '')
    const guideName = attr(guide, 'name')
    if (match && guideName) adjust[guideName] = Number(match[1])
  }
  return presetGeometry(name, w, h, adjust) ?? presetGeometry('rect', w, h)!
}

/** The prompt an empty placeholder shows while editing. */
function promptFor(element: XmlElement, chain: readonly XmlElement[], env: RenderEnv): string | undefined {
  const ph = placeholderOf(element)
  if (!ph) return undefined
  const layoutShape = chain[chain.length - 1]
  const layoutPh = layoutShape && placeholderOf(layoutShape)
  if (layoutShape && layoutPh && attr(layoutPh, 'hasCustomPrompt') === '1') {
    const text = [...(child(layoutShape, 'txBody') ? childElements(child(layoutShape, 'txBody')).filter((entry) => entry.localName === 'p') : [])]
      .map((paragraph) => paragraph.textContent ?? '')
      .join('\n')
      .trim()
    if (text) return text
  }
  const type = placeholderType(ph)
  if (type === 'title' || type === 'ctrTitle') return env.labels.titlePrompt
  if (type === 'subTitle') return env.labels.subtitlePrompt
  if (type === 'dt' || type === 'ftr' || type === 'sldNum' || type === 'hdr' || type === 'sldImg') return undefined
  return env.labels.bodyPrompt
}

/** The master text style that applies to a placeholder type. */
function masterTextStyle(master: MasterInfo | undefined, ph: XmlElement | undefined): XmlElement | undefined {
  if (!ph || !master) return undefined
  const type = placeholderType(ph)
  if (type === 'title' || type === 'ctrTitle') return master.titleStyle
  if (type === 'dt' || type === 'ftr' || type === 'sldNum' || type === 'hdr') return master.otherStyle
  return master.bodyStyle
}

export function textContext(element: XmlElement, chain: readonly XmlElement[], env: RenderEnv, level: TreeLevel, colors: ColorContext): TextStyleContext {
  const ph = placeholderOf(element)
  const txBody = childElements(element).find((entry) => entry.localName === 'txBody')
  const lists: (XmlElement | undefined)[] = [env.deck.defaultTextStyle()]
  if (ph && level !== 'drawing') lists.push(masterTextStyle(env.master, ph))
  else if (level === 'master' || level === 'layout') lists.push(env.master?.otherStyle)
  for (const ancestor of chain) lists.push(child(childElements(ancestor).find((entry) => entry.localName === 'txBody'), 'lstStyle', NS.a))
  const fontReference = path(styleOf(element, chain), 'fontRef')
  let baseRun: PropertyBag | undefined
  if (fontReference) {
    baseRun = emptyBag()
    const font = attr(fontReference, 'idx')
    if (font === 'major') baseRun.children.latin = typefaceElement(element, '+mj-lt')
    else if (font === 'minor') baseRun.children.latin = typefaceElement(element, '+mn-lt')
    const color = resolveColor(fontReference, colors)
    if (color) baseRun.children.fill = solidFillElement(element, color)
  }
  return { chain: lists, ...(baseRun ? { baseRun } : {}), own: child(txBody, 'lstStyle', NS.a), theme: env.theme, colors }
}

function typefaceElement(context: XmlElement, typeface: string): XmlElement {
  const element = context.ownerDocument!.createElementNS(NS.a, 'a:latin')
  element.setAttribute('typeface', typeface)
  return element
}

function solidFillElement(context: XmlElement, color: { r: number; g: number; b: number; a: number }): XmlElement {
  const document = context.ownerDocument!
  const fill = document.createElementNS(NS.a, 'a:solidFill')
  const srgb = document.createElementNS(NS.a, 'a:srgbClr')
  const hex = [color.r, color.g, color.b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')
  srgb.setAttribute('val', hex)
  if (color.a < 1) {
    const alpha = document.createElementNS(NS.a, 'a:alpha')
    alpha.setAttribute('val', String(Math.round(color.a * 100000)))
    srgb.appendChild(alpha)
  }
  fill.appendChild(srgb)
  return fill
}

const MAX_GROUP_DEPTH = 32

/** Renders one shape-tree element (sp, pic, cxnSp, grpSp, graphicFrame, or mc:AlternateContent) as HTML. */
export function renderShape(element: XmlElement, options: ShapeRenderOptions): string {
  const depth = options.depth ?? 0
  if (depth > MAX_GROUP_DEPTH) return ''
  switch (element.localName) {
    case 'sp':
    case 'cxnSp':
      return renderGeometryShape(element, options)
    case 'pic':
      return renderPicture(element, options)
    case 'grpSp':
      return renderGroup(element, options)
    case 'graphicFrame':
      return renderGraphicFrame(element, options)
    case 'AlternateContent': {
      const fallback = childElements(element).find((entry) => entry.localName === 'Fallback')
      return childElements(fallback)
        .map((entry) => renderShape(entry, { ...options, depth: depth + 1 }))
        .join('')
    }
    case 'contentPart':
    default:
      return ''
  }
}

/** A member's transform as seen through a flipped group: mirrored flips and rotation. */
export function orient<T extends Transform>(transform: T, frame: Frame): T {
  if (!frame.flipH && !frame.flipV) return transform
  const mirrored = frame.flipH !== frame.flipV
  return {
    ...transform,
    flipH: frame.flipH ? !transform.flipH : transform.flipH,
    flipV: frame.flipV ? !transform.flipV : transform.flipV,
    rot: mirrored ? -transform.rot : transform.rot,
  }
}

/** The shape box in px within its parent: group members map through the group's child space. */
export function boxIn(transform: Transform, frame: Frame): { left: number; top: number; width: number; height: number } {
  const x = frame.flipH ? (frame.extentX ?? 0) - (transform.x - frame.originX) - transform.w : transform.x - frame.originX
  const y = frame.flipV ? (frame.extentY ?? 0) - (transform.y - frame.originY) - transform.h : transform.y - frame.originY
  return {
    left: emuToPx(x * frame.scaleX),
    top: emuToPx(y * frame.scaleY),
    width: emuToPx(transform.w * frame.scaleX),
    height: emuToPx(transform.h * frame.scaleY),
  }
}

/** Transform facts the editor reads back from the DOM (placeholders inherit theirs). */
function transformAttributes(transform: Transform): string {
  return ` data-rot="${num(transform.rot)}"${transform.flipH ? ' data-flip-h=""' : ''}${transform.flipV ? ' data-flip-v=""' : ''}`
}

function wrapperStyle(box: ReturnType<typeof boxIn>, transform: Transform, hidden: boolean): string {
  const styles = ['position:absolute', `left:${px(box.left)}`, `top:${px(box.top)}`, `width:${px(box.width)}`, `height:${px(box.height)}`]
  if (transform.rot) styles.push(`transform:rotate(${num(transform.rot)}deg)`)
  if (hidden) styles.push('display:none')
  return styles.join(';')
}

function attributes(element: XmlElement, options: ShapeRenderOptions, kind: string): string {
  const nv = childElements(element).find((entry) => entry.localName?.startsWith('nv'))
  const cNvPr = child(nv, 'cNvPr')
  const parts = [`class="pp-shape"`, `data-kind="${kind}"`]
  if (options.key) parts.push(`data-key="${escapeAttribute(options.key)}"`)
  const name = attr(cNvPr, 'name')
  if (name) parts.push(`data-name="${escapeAttribute(name)}"`)
  const descr = attr(cNvPr, 'descr')
  if (descr) parts.push(`aria-label="${escapeAttribute(descr)}"`, 'role="img"')
  return parts.join(' ')
}

function isHidden(element: XmlElement): boolean {
  const nv = childElements(element).find((entry) => entry.localName?.startsWith('nv'))
  return boolAttr(child(nv, 'cNvPr'), 'hidden') === true
}

/** Fill, line, and effects of a shape after inheritance and theme style references. */
export function shapeAppearance(element: XmlElement, chain: readonly XmlElement[], env: RenderEnv, box: Box, groupFill?: Paint) {
  const style = styleOf(element, chain)
  const fillElement = pick(element, chain, fillElementOf)
  let fill: Paint = NO_PAINT
  if (fillElement) fill = paintFill(fillElement, env, box, env.colors, groupFill)
  else {
    const reference = styleReference(path(style, 'fillRef'), (index) => themeFill(env.theme, index), env)
    if (reference) fill = paintFill(reference.element, env, box, reference.colors)
  }
  const lineReference = styleReference(path(style, 'lnRef'), (index) => env.theme.lineStyles[index - 1], env)
  const lineLayers = [lineReference?.element, ...chain.map((ancestor) => child(properties(ancestor), 'ln', NS.a)), child(properties(element), 'ln', NS.a)]
  const lineColors = [lineReference?.colors ?? env.colors, ...chain.map(() => env.colors), env.colors]
  const stroke = strokeFor(lineLayers, env, box, lineColors)
  const effects = pick(element, chain, (spPr) => child(spPr, 'effectLst', NS.a))
  let shadow: ReturnType<typeof shadowFilter>
  if (effects) shadow = shadowFilter(effects, env)
  else {
    const reference = styleReference(path(style, 'effectRef'), (index) => env.theme.effectStyles[index - 1], env)
    if (reference) shadow = shadowFilter(child(reference.element, 'effectLst', NS.a), env, reference.colors)
  }
  return { fill, stroke, shadow }
}

const SHADING: Record<string, string> = {
  darken: 'rgba(0,0,0,0.4)',
  darkenLess: 'rgba(0,0,0,0.2)',
  lighten: 'rgba(255,255,255,0.4)',
  lightenLess: 'rgba(255,255,255,0.2)',
}

function geometrySvg(geometry: GeometryResult, appearance: ReturnType<typeof shapeAppearance>, box: Box, transform: Transform, extraDefs = '', imageLayer = ''): string {
  const { fill, stroke, shadow } = appearance
  const defs = fill.defs + (stroke?.paint.defs ?? '') + (stroke?.markers.defs ?? '') + (shadow?.defs ?? '') + extraDefs
  const paths = geometry.paths
    .map((entry) => {
      const fillValue = entry.fill === 'none' ? 'none' : fill.value
      const strokeAttrs = entry.stroke && stroke ? ` stroke="${stroke.paint.value}" ${stroke.attrs}${stroke.markers.start ? ` marker-start="${stroke.markers.start}"` : ''}${stroke.markers.end ? ` marker-end="${stroke.markers.end}"` : ''}` : ''
      const shade = entry.fill !== 'none' && entry.fill !== 'norm' && fill.value !== 'none' ? `<path d="${entry.d}" fill="${SHADING[entry.fill] ?? 'none'}"/>` : ''
      const fillPath = fillValue === 'none' ? '' : `<path d="${entry.d}" fill="${fillValue}"/>`
      const strokePath = strokeAttrs ? `<path d="${entry.d}" fill="none"${strokeAttrs}/>` : ''
      return fillPath + shade + strokePath
    })
    .join('')
  if (!paths && !imageLayer) return ''
  const flip = transform.flipH || transform.flipV ? ` transform="translate(${transform.flipH ? num(box.w) : 0} ${transform.flipV ? num(box.h) : 0}) scale(${transform.flipH ? -1 : 1} ${transform.flipV ? -1 : 1})"` : ''
  const filter = shadow ? ` filter="url(#${shadow.id})"` : ''
  return `<svg class="pp-geom" width="${num(Math.max(box.w, 0.01))}" height="${num(Math.max(box.h, 0.01))}" viewBox="0 0 ${num(Math.max(box.w, 0.01))} ${num(Math.max(box.h, 0.01))}" style="position:absolute;left:0;top:0;overflow:visible" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}<g${flip}${filter}>${imageLayer}${paths}</g></svg>`
}

function renderGeometryShape(element: XmlElement, options: ShapeRenderOptions): string {
  const { env } = options
  const chain = inheritanceChain(element, options.level, env)
  const xfrm = effectiveXfrm(element, chain)
  const transform = orient(readTransform(xfrm) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false }, options.frame)
  const box = boxIn(transform, options.frame)
  const size: Box = { w: box.width, h: box.height }
  const spPr = pick(element, chain, (entry) => (child(entry, 'prstGeom', NS.a) || child(entry, 'custGeom', NS.a) ? entry : undefined))
  const geometry = shapeGeometry(spPr, size.w, size.h, element.localName === 'cxnSp' ? 'line' : 'rect')
  const appearance = shapeAppearance(element, chain, env, size, options.groupFill)
  const svg = geometrySvg(geometry, appearance, size, transform)
  let text = ''
  if (!options.hideText) text = renderShapeText(element, chain, env, options, geometry, size, transform)
  return `<div ${attributes(element, options, element.localName ?? 'sp')} ${transformAttributes(transform)} style="${wrapperStyle(box, transform, isHidden(element))}">${svg}${text}</div>`
}

export interface ShapeTextLayout {
  txBody: XmlElement | undefined
  body: ReturnType<typeof bodyLayout>
  /** The text rectangle in px, relative to the shape box. */
  rect: { x: number; y: number; w: number; h: number }
  context: TextStyleContext
  prompt?: string
  upsideDown: boolean
}

/** Where and how a shape's text is laid out: its geometry's text rectangle (or `dsp:txXfrm`) and styles. */
export function shapeTextLayout(
  element: XmlElement,
  chain: readonly XmlElement[],
  env: RenderEnv,
  options: Pick<ShapeRenderOptions, 'level' | 'frame'>,
  geometry: GeometryResult,
  size: Box,
  transform: Transform,
): ShapeTextLayout | undefined {
  const txBody = childElements(element).find((entry) => entry.localName === 'txBody')
  const isPlaceholder = !!placeholderOf(element)
  if (!txBody && !isPlaceholder) return undefined
  const bodyLayers = [...chain.map((ancestor) => child(childElements(ancestor).find((entry) => entry.localName === 'txBody'), 'bodyPr', NS.a)), child(txBody, 'bodyPr', NS.a)]
  const body = bodyLayout(bodyLayers)
  let rect = { x: geometry.textRect.l, y: geometry.textRect.t, w: geometry.textRect.r - geometry.textRect.l, h: geometry.textRect.b - geometry.textRect.t }
  const textTransform = readTransform(childElements(element).find((entry) => entry.localName === 'txXfrm'))
  if (textTransform) {
    const shapeBox = boxIn(transform, options.frame)
    const textBox = boxIn(textTransform, options.frame)
    rect = { x: textBox.left - shapeBox.left, y: textBox.top - shapeBox.top, w: textBox.width, h: textBox.height }
  }
  if (body.bag.attrs.upright === '1') rect = { x: 0, y: 0, w: size.w, h: size.h }
  const prompt = options.level === 'slide' ? promptFor(element, chain, env) : undefined
  return { txBody, body, rect, context: textContext(element, chain, env, options.level, env.colors), ...(prompt ? { prompt } : {}), upsideDown: transform.flipV }
}

/** The text frame of a shape, placed in its geometry's text rectangle (or `dsp:txXfrm`). */
export function renderShapeText(element: XmlElement, chain: readonly XmlElement[], env: RenderEnv, options: Pick<ShapeRenderOptions, 'level' | 'frame'>, geometry: GeometryResult, size: Box, transform: Transform): string {
  const layout = shapeTextLayout(element, chain, env, options, geometry, size, transform)
  if (!layout) return ''
  return renderTextFrame({ ...layout, env })
}

/** Everything the inline editor needs to overlay a shape's text exactly where the renderer draws it. */
export function describeShapeText(element: XmlElement, env: RenderEnv): (ShapeTextLayout & { box: ReturnType<typeof boxIn>; transform: Transform }) | undefined {
  const chain = inheritanceChain(element, 'slide', env)
  const transform = readTransform(effectiveXfrm(element, chain)) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false }
  const box = boxIn(transform, ROOT_FRAME)
  const size: Box = { w: box.width, h: box.height }
  const spPr = pick(element, chain, (entry) => (child(entry, 'prstGeom', NS.a) || child(entry, 'custGeom', NS.a) ? entry : undefined))
  const geometry = shapeGeometry(spPr, size.w, size.h)
  const layout = shapeTextLayout(element, chain, env, { level: 'slide', frame: ROOT_FRAME }, geometry, size, transform)
  return layout && { ...layout, box, transform }
}

function renderPicture(element: XmlElement, options: ShapeRenderOptions): string {
  const { env } = options
  const chain = inheritanceChain(element, options.level, env)
  const transform = orient(readTransform(effectiveXfrm(element, chain)) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false }, options.frame)
  const box = boxIn(transform, options.frame)
  const size: Box = { w: box.width, h: box.height }
  const spPr = child(element, 'spPr')
  const geometry = shapeGeometry(spPr, size.w, size.h)
  const appearance = shapeAppearance(element, chain, env, size)
  const blipFill = childElements(element).find((entry) => entry.localName === 'blipFill')
  let image = ''
  let defs = ''
  if (blipFill) {
    const part = blipPart(blipFill, env)
    const url = part ? env.assetUrl(part) : undefined
    const place = imagePlacement(blipFill, size)
    const clip = env.nextId()
    defs = `<clipPath id="${clip}">${geometry.paths.map((entry) => `<path d="${entry.d}"/>`).join('')}</clipPath>`
    const filter = blipFilter(blipFill)
    image = url
      ? `<g clip-path="url(#${clip})"><image href="${escapeAttribute(url)}" x="${num(place.x)}" y="${num(place.y)}" width="${num(place.w)}" height="${num(place.h)}" preserveAspectRatio="none" opacity="${num(blipOpacity(blipFill))}"${filter ? ` style="filter:${filter}"` : ''}/></g>`
      : `<g clip-path="url(#${clip})"><rect width="${num(size.w)}" height="${num(size.h)}" fill="rgb(236,236,236)"/></g>`
  }
  const svg = geometrySvg(geometry, { ...appearance, fill: appearance.fill }, size, transform, defs, image)
  const media = mediaPart(element, env)
  const overlay = media
    ? `<button type="button" class="pp-media" data-media="${escapeAttribute(media.part)}" data-media-kind="${media.kind}" aria-label="${escapeAttribute(env.labels.mediaPlay)}" style="position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;border:0;background:rgba(0,0,0,0.55);color:white;font-size:20px;line-height:48px;pointer-events:auto;cursor:pointer">▶</button>`
    : ''
  return `<div ${attributes(element, options, 'pic')} ${transformAttributes(transform)} style="${wrapperStyle(box, transform, isHidden(element))}">${svg}${overlay}</div>`
}

/** The media a picture stands in for (a video or sound poster frame), if any. */
export function mediaPart(element: XmlElement, env: RenderEnv): { part: string; kind: 'video' | 'audio' } | undefined {
  const nvPr = path(element, 'nvPicPr', 'nvPr')
  if (!nvPr) return undefined
  const video = child(nvPr, 'videoFile', NS.a)
  const audio = child(nvPr, 'audioFile', NS.a)
  let target: RelTarget | undefined
  for (const ext of childElements(child(nvPr, 'extLst', NS.p))) {
    const media = childElements(ext).find((entry) => entry.localName === 'media')
    const id = media?.getAttributeNS(NS.r, 'embed')
    if (id) target = env.rel(id)
  }
  if (!target) {
    const id = (video ?? audio)?.getAttributeNS(NS.r, 'link')
    if (id) target = env.rel(id)
  }
  if (!target || target.external) return undefined
  return { part: target.target, kind: audio && !video ? 'audio' : target.type.endsWith('/audio') ? 'audio' : 'video' }
}

function renderGroup(element: XmlElement, options: ShapeRenderOptions): string {
  const { env } = options
  const transform = orient(readTransform(child(properties(element), 'xfrm', NS.a)) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false, chX: 0, chY: 0, chW: 0, chH: 0 }, options.frame)
  const box = boxIn(transform, options.frame)
  const size: Box = { w: box.width, h: box.height }
  const groupFillElement = fillElementOf(properties(element))
  const groupFill = groupFillElement ? paintFill(groupFillElement, env, size, env.colors, options.groupFill) : options.groupFill
  const frame: Frame = {
    originX: transform.chX,
    originY: transform.chY,
    scaleX: transform.chW ? (transform.w / transform.chW) * options.frame.scaleX : options.frame.scaleX,
    scaleY: transform.chH ? (transform.h / transform.chH) * options.frame.scaleY : options.frame.scaleY,
    flipH: transform.flipH,
    flipV: transform.flipV,
    extentX: transform.chW,
    extentY: transform.chH,
  }
  const members = childElements(element)
    .filter((entry) => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(entry.localName ?? ''))
    .map((member) => renderShape(member, { ...options, frame, ...(groupFill ? { groupFill } : {}), key: undefined, depth: (options.depth ?? 0) + 1 }))
    .join('')
  const style = wrapperStyle(box, transform, isHidden(element))
  return `<div ${attributes(element, options, 'grpSp')}${transformAttributes(transform)} style="${style}">${members}</div>`
}

function renderGraphicFrame(element: XmlElement, options: ShapeRenderOptions): string {
  const { env } = options
  const chain = inheritanceChain(element, options.level, env)
  const transform = orient(readTransform(effectiveXfrm(element, chain)) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false }, options.frame)
  const box = boxIn(transform, options.frame)
  const data = path(element, 'graphic', 'graphicData')
  const uri = attr(data, 'uri') ?? ''
  let content = ''
  const table = child(data, 'tbl', NS.a)
  if (table) content = renderTable(table, env, { w: box.width, h: box.height, scaleX: options.frame.scaleX, scaleY: options.frame.scaleY })
  else if (uri.endsWith('/chart')) content = renderChart(data!, env, box.width, box.height)
  else if (uri.endsWith('/diagram')) content = renderDiagram(data!, env, options)
  else {
    // OLE objects and other embeddings show their fallback picture.
    const picture = findDescendant(data, 'pic', 4)
    if (picture) {
      const inner = renderShape(picture, { ...options, frame: { originX: transform.x, originY: transform.y, scaleX: options.frame.scaleX, scaleY: options.frame.scaleY }, key: undefined, depth: (options.depth ?? 0) + 1 })
      content = inner.replace(/^<div ([^>]*?)style="position:absolute;left:[^;]*;top:[^;]*;/, '<div $1style="position:absolute;left:0px;top:0px;')
    }
  }
  return `<div ${attributes(element, options, 'graphicFrame')}${transformAttributes(transform)} style="${wrapperStyle(box, transform, isHidden(element))}">${content}</div>`
}

function findDescendant(element: XmlElement | undefined, localName: string, depth: number): XmlElement | undefined {
  if (!element || depth < 0) return undefined
  for (const entry of childElements(element)) {
    if (entry.localName === localName) return entry
    const found = findDescendant(entry, localName, depth - 1)
    if (found) return found
  }
  return undefined
}

function renderChart(data: XmlElement, env: RenderEnv, width: number, height: number): string {
  const chart = childElements(data).find((entry) => entry.localName === 'chart')
  const id = chart?.getAttributeNS(NS.r, 'id')
  const rel = id ? env.rel(id) : undefined
  const bytes = rel && !rel.external ? env.deck.parts[rel.target]?.bytes : undefined
  if (!bytes) return chartPlaceholder(env)
  const colorsTheme = env.colors
  const svg = renderChartSvg(decodePartText(bytes), {
    width,
    height,
    resolveColor: (element) => {
      const color = resolveColor(element as unknown as XmlElement, colorsTheme)
      return color ? toCss(color) : undefined
    },
    accents: ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((name) => `#${env.theme.colors[colorsTheme.colorMap[name] ?? name] ?? '000000'}`),
    textColor: toCss(resolveColor(paintElement(data, 'tx1'), colorsTheme) ?? { r: 89, g: 89, b: 89, a: 1 }),
    fontFamily: cssFontFamily(env.theme.minor.latin),
  })
  return `<div class="pp-chart" style="position:absolute;inset:0">${svg}</div>`
}

function paintElement(context: XmlElement, scheme: string): XmlElement {
  const element = context.ownerDocument!.createElementNS(NS.a, 'a:schemeClr')
  element.setAttribute('val', scheme)
  return element
}

function chartPlaceholder(env: RenderEnv): string {
  return `<div class="pp-chart" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(0,0,0,0.25);font:12px sans-serif;color:rgba(0,0,0,0.5)">${escapeText(env.labels.chartUnavailable)}</div>`
}

/** SmartArt: draws the cached drawing part (`dsp:drawing`) PowerPoint saves next to the diagram data. */
function renderDiagram(data: XmlElement, env: RenderEnv, options: ShapeRenderOptions): string {
  const relIds = childElements(data).find((entry) => entry.localName === 'relIds')
  const dataId = relIds?.getAttributeNS(NS.r, 'dm')
  const dataRel = dataId ? env.rel(dataId) : undefined
  const dataRoot = dataRel && !dataRel.external ? env.deck.xml(dataRel.target) : undefined
  let drawingPart: string | undefined
  const extension = dataRoot ? findDescendant(dataRoot, 'dataModelExt', 6) : undefined
  const drawingId = attr(extension, 'relId')
  if (drawingId) {
    const rel = env.rel(drawingId)
    if (rel && !rel.external) drawingPart = rel.target
  }
  const drawing = drawingPart ? env.deck.xml(drawingPart) : undefined
  const tree = drawing ? childElements(drawing).find((entry) => entry.localName === 'spTree') : undefined
  if (!tree || !drawingPart) return ''
  const drawingRels = env.deck.rels(drawingPart)
  const drawingEnv: RenderEnv = { ...env, rel: (id) => drawingRels.get(id) }
  const frame: Frame = { originX: 0, originY: 0, scaleX: options.frame.scaleX, scaleY: options.frame.scaleY }
  return childElements(tree)
    .filter((entry) => !['nvGrpSpPr', 'grpSpPr'].includes(entry.localName ?? ''))
    .map((entry) => renderShape(entry, { env: drawingEnv, level: 'drawing', frame, depth: (options.depth ?? 0) + 1 }))
    .join('')
}

export type { LayoutInfo, MasterInfo }
export { REL_TYPES }
