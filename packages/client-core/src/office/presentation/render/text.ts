import { attr, child, childElements, intAttr, NS, parseFragment, type XmlElement } from '../xml.js'
import { resolveColor, toCss, type ColorContext, type Rgba } from './color.js'
import type { Theme } from './deck.js'
import { cssFontFamily, emuToPx, escapeAttribute, escapeText, num, px, PX_PER_PT, type RenderEnv } from './env.js'
import { bagNumber, childValue, cloneBag, emptyBag, mergeBag, mergeInto, resolveLevel, type PropertyBag } from './props.js'

/**
 * Text bodies as HTML. Paragraphs carry their level's default run formatting, so runs only state
 * what they change and CSS inheritance does the rest, which is also how the inline editor (a
 * ProseMirror view using these same functions) stays pixel-identical to the rendering.
 *
 * Font sizes are written as `calc(var(--pp-fs) * Npx)`: the autofit scale lives in one CSS
 * variable on the frame, so shrinking text to fit does not need a re-render.
 */

export interface TextStyleContext {
  /** Inherited list styles, least specific first (presentation defaults … the layout placeholder's). */
  chain: (XmlElement | undefined)[]
  /**
   * Run properties from the shape style (`p:style/a:fontRef`) or a table style. They beat
   * inherited list styles (a default shape's text is white although the master says black) but
   * not the shape's own list style or explicit formatting.
   */
  baseRun?: PropertyBag
  /** The text body's own `a:lstStyle`. */
  own?: XmlElement
  theme: Theme
  colors: ColorContext
}

export interface BodyLayout {
  bag: PropertyBag
  /** `a:normAutofit/@fontScale` as a fraction. */
  fontScale: number
  /** `a:normAutofit/@lnSpcReduction` as a fraction. */
  lineReduction: number
  autofit: 'none' | 'norm' | 'shape'
}

/** Merges body properties (master → layout → shape) and reads autofit. */
export function bodyLayout(layers: readonly (XmlElement | undefined)[]): BodyLayout {
  const bag = emptyBag()
  for (const layer of layers) mergeInto(bag, layer)
  let autofit: BodyLayout['autofit'] = 'none'
  let fontScale = 1
  let lineReduction = 0
  // The most specific layer that says anything about autofit wins.
  for (const layer of [...layers].reverse()) {
    if (!layer) continue
    const own = childElements(layer).find((element) => ['normAutofit', 'spAutoFit', 'noAutofit'].includes(element.localName ?? ''))
    if (!own) continue
    if (own.localName === 'normAutofit') {
      autofit = 'norm'
      fontScale = (intAttr(own, 'fontScale') ?? 100000) / 100000
      lineReduction = (intAttr(own, 'lnSpcReduction') ?? 0) / 100000
    } else autofit = own.localName === 'spAutoFit' ? 'shape' : 'none'
    break
  }
  return { bag, fontScale, lineReduction, autofit }
}

export interface Insets {
  l: number
  t: number
  r: number
  b: number
}

export function bodyInsets(body: BodyLayout): Insets {
  const read = (name: string, fallback: number) => emuToPx(bagNumber(body.bag, name) ?? fallback)
  return { l: read('lIns', 91440), t: read('tIns', 45720), r: read('rIns', 91440), b: read('bIns', 45720) }
}

/** Typeface for a run, resolving theme font references (`+mj-lt`, `+mn-ea`, …). */
export function resolveTypeface(run: PropertyBag, theme: Theme): string {
  const latin = attr(run.children.latin, 'typeface')
  const pick = (value: string | undefined): string | undefined => {
    if (!value) return undefined
    if (value === '+mj-lt') return theme.major.latin
    if (value === '+mn-lt') return theme.minor.latin
    if (value === '+mj-ea') return theme.major.ea || theme.major.latin
    if (value === '+mn-ea') return theme.minor.ea || theme.minor.latin
    if (value === '+mj-cs') return theme.major.cs || theme.major.latin
    if (value === '+mn-cs') return theme.minor.cs || theme.minor.latin
    return value
  }
  return pick(latin) ?? pick(attr(run.children.ea, 'typeface')) ?? theme.minor.latin
}

/** Font size in points (`sz` is hundredths of a point; PowerPoint's default is 18). */
export function fontSizePt(run: PropertyBag): number {
  const size = bagNumber(run, 'sz')
  return size && size > 0 ? Math.min(size, 400000) / 100 : 18
}

export function runColor(run: PropertyBag, colors: ColorContext): Rgba | undefined {
  const fill = run.children.fill
  if (!fill) return undefined
  if (fill.localName === 'noFill') return { r: 0, g: 0, b: 0, a: 0 }
  if (fill.localName === 'gradFill') return resolveColor(childElements(child(fill, 'gsLst', NS.a))[0], colors)
  if (fill.localName === 'pattFill') return resolveColor(child(fill, 'fgClr', NS.a), colors)
  return resolveColor(fill, colors)
}

/** CSS for run properties. `inherited` is what the paragraph already sets, so only differences are written. */
export function runCss(run: PropertyBag, context: TextStyleContext, options: { hyperlink?: boolean } = {}): string {
  const styles: string[] = []
  if (run.attrs.sz !== undefined || run.children.latin || run.children.ea) {
    if (run.attrs.sz !== undefined) styles.push(`font-size:calc(var(--pp-fs, 1) * ${num(fontSizePt(run) * PX_PER_PT)}px)`)
    if (run.children.latin || run.children.ea) styles.push(`font-family:${cssFontFamily(resolveTypeface(run, context.theme))}`)
  }
  if (run.attrs.b !== undefined) styles.push(`font-weight:${run.attrs.b === '1' || run.attrs.b === 'true' ? 700 : 400}`)
  if (run.attrs.i !== undefined) styles.push(`font-style:${run.attrs.i === '1' || run.attrs.i === 'true' ? 'italic' : 'normal'}`)
  const decorations = decorationCss(run, options.hyperlink)
  if (decorations) styles.push(decorations)
  const color = options.hyperlink && !run.children.fill ? hyperlinkColor(context) : runColor(run, context.colors)
  if (color) styles.push(`color:${toCss(color)}`)
  const highlight = run.children.highlight && resolveColor(run.children.highlight, context.colors)
  if (highlight) styles.push(`background-color:${toCss(highlight)}`)
  const cap = run.attrs.cap
  if (cap === 'all') styles.push('text-transform:uppercase')
  else if (cap === 'small') styles.push('font-variant:small-caps')
  else if (cap === 'none') styles.push('text-transform:none;font-variant:normal')
  const spacing = bagNumber(run, 'spc')
  if (spacing) styles.push(`letter-spacing:${num((spacing / 100) * PX_PER_PT)}px`)
  const baseline = bagNumber(run, 'baseline')
  if (baseline) styles.push(`vertical-align:${num(baseline / 1000)}%;font-size:${baseline > 0 ? '0.67em' : '0.67em'}`)
  return styles.join(';')
}

function hyperlinkColor(context: TextStyleContext): Rgba | undefined {
  const mapped = context.colors.colorMap.hlink ?? 'hlink'
  const hex = context.colors.scheme[mapped] ?? context.colors.scheme.hlink
  return hex ? { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16), a: 1 } : undefined
}

function decorationCss(run: PropertyBag, hyperlink = false): string {
  const underline = run.attrs.u
  const strike = run.attrs.strike
  const lines: string[] = []
  let style = ''
  if ((underline && underline !== 'none') || (hyperlink && underline !== 'none')) {
    lines.push('underline')
    if (underline?.startsWith('dbl')) style = 'double'
    else if (underline?.includes('wav')) style = 'wavy'
    else if (underline?.includes('dotted') || underline?.includes('Dotted')) style = 'dotted'
    else if (underline?.includes('dash') || underline?.includes('Dash')) style = 'dashed'
  }
  if (strike && strike !== 'noStrike') {
    lines.push('line-through')
    if (strike === 'dblStrike') style = 'double'
  }
  if (!lines.length) return underline === 'none' || strike === 'noStrike' ? 'text-decoration:none' : ''
  return `text-decoration:${lines.join(' ')}${style ? ` ${style}` : ''}`
}

/** All the run CSS a paragraph sets for its level, so plain runs inherit it. */
export function defaultRunCss(run: PropertyBag, context: TextStyleContext): string {
  const styles = [
    `font-size:calc(var(--pp-fs, 1) * ${num(fontSizePt(run) * PX_PER_PT)}px)`,
    `font-family:${cssFontFamily(resolveTypeface(run, context.theme))}`,
    `color:${toCss(runColor(run, context.colors) ?? resolveColor(parseFragment('<a:schemeClr val="tx1"/>'), context.colors) ?? { r: 0, g: 0, b: 0, a: 1 })}`,
  ]
  const rest = cloneBag(run)
  delete rest.attrs.sz
  delete rest.children.latin
  delete rest.children.ea
  delete rest.children.fill
  return [...styles, runCss(rest, context)].filter(Boolean).join(';')
}

export interface ParagraphStyle {
  level: number
  paragraph: PropertyBag
  run: PropertyBag
  css: string
  bullet?: BulletSpec
  fontSizePt: number
}

export type BulletSpec = { kind: 'char'; char: string; css: string } | { kind: 'number'; scheme: string; startAt: number; css: string } | { kind: 'image'; part?: string; css: string }

/** Resolves a paragraph's properties through the chain and its own `a:pPr`. */
export function paragraphStyle(pPr: XmlElement | undefined, context: TextStyleContext, body: BodyLayout, firstRun?: XmlElement): ParagraphStyle {
  const level = Math.min(8, Math.max(0, intAttr(pPr, 'lvl') ?? 0))
  const inherited = resolveLevel(context.chain, level)
  const own = resolveLevel([context.own], level)
  const paragraph = mergeInto(mergeBag(cloneBag(inherited.paragraph), own.paragraph), pPr, ['defRPr', 'extLst'])
  const run = mergeBag(mergeBag(cloneBag(inherited.run), context.baseRun), own.run)
  const ownDefault = childElements(pPr).find((element) => element.localName === 'defRPr')
  mergeInto(run, ownDefault)
  const size = firstRun ? fontSizePt(mergeInto(cloneBag(run), firstRun)) : fontSizePt(run)
  const styles: string[] = [defaultRunCss(run, context)]
  const align = paragraph.attrs.algn
  styles.push(`text-align:${align === 'ctr' ? 'center' : align === 'r' ? 'right' : align === 'just' || align === 'dist' || align === 'justLow' || align === 'thaiDist' ? 'justify' : 'left'}`)
  if (align === 'dist') styles.push('text-align-last:justify')
  if (paragraph.attrs.rtl === '1') styles.push('direction:rtl')
  const marL = emuToPx(bagNumber(paragraph, 'marL') ?? 0)
  const marR = emuToPx(bagNumber(paragraph, 'marR') ?? 0)
  const indent = emuToPx(bagNumber(paragraph, 'indent') ?? 0)
  if (marL) styles.push(`padding-left:${px(marL)}`)
  if (marR) styles.push(`padding-right:${px(marR)}`)
  if (indent) styles.push(`text-indent:${px(indent)}`)
  const lineSpacing = paragraph.children.lnSpc
  const linePercent = childValue(lineSpacing, 'spcPct')
  const linePoints = childValue(lineSpacing, 'spcPts')
  if (linePoints !== undefined) styles.push(`line-height:${px((linePoints / 100) * PX_PER_PT)}`)
  else {
    const percent = (linePercent ?? 100000) / 100000
    styles.push(`line-height:calc(${num(Math.max(0.1, percent - body.lineReduction))} * 1.2)`)
  }
  const spacing = (name: 'spcBef' | 'spcAft') => {
    const element = paragraph.children[name]
    const points = childValue(element, 'spcPts')
    if (points !== undefined) return px((points / 100) * PX_PER_PT)
    const percent = childValue(element, 'spcPct')
    if (percent !== undefined) return `calc(var(--pp-fs, 1) * ${num(((percent / 100000) * size * PX_PER_PT * 1.2) * Math.max(0, 1 - body.lineReduction))}px)`
    return undefined
  }
  const before = spacing('spcBef')
  const after = spacing('spcAft')
  if (before) styles.push(`margin-top:${before}`)
  if (after) styles.push(`margin-bottom:${after}`)
  const tabSize = bagNumber(paragraph, 'defTabSz')
  if (tabSize) styles.push(`tab-size:${px(emuToPx(tabSize))}`)
  return { level, paragraph, run, css: styles.join(';'), bullet: bulletFor(paragraph, run, context, indent), fontSizePt: size }
}

function bulletFor(paragraph: PropertyBag, run: PropertyBag, context: TextStyleContext, indent: number): BulletSpec | undefined {
  const bullet = paragraph.children.bullet
  if (!bullet || bullet.localName === 'buNone') return undefined
  const styles: string[] = ['display:inline-block', 'text-indent:0', 'font-style:normal', 'font-weight:normal', 'text-decoration:none']
  if (indent < 0) styles.push(`min-width:${px(-indent)}`)
  else styles.push('padding-right:0.4em')
  const colorElement = paragraph.children.buClr
  const color = colorElement?.localName === 'buClr' ? resolveColor(colorElement, context.colors) : undefined
  if (color) styles.push(`color:${toCss(color)}`)
  const sizeElement = paragraph.children.buSz
  const size = fontSizePt(run)
  if (sizeElement?.localName === 'buSzPct') styles.push(`font-size:calc(var(--pp-fs, 1) * ${num(((intAttr(sizeElement, 'val') ?? 100000) / 100000) * size * PX_PER_PT)}px)`)
  else if (sizeElement?.localName === 'buSzPts') styles.push(`font-size:calc(var(--pp-fs, 1) * ${num(((intAttr(sizeElement, 'val') ?? 1800) / 100) * PX_PER_PT)}px)`)
  const fontElement = paragraph.children.buFont
  if (fontElement?.localName === 'buFont') {
    const typeface = attr(fontElement, 'typeface')
    if (typeface) styles.push(`font-family:${cssFontFamily(resolveTypeface({ attrs: {}, children: { latin: fontElement } }, context.theme))}`)
  }
  const css = styles.join(';')
  if (bullet.localName === 'buChar') return { kind: 'char', char: symbolCharacter(attr(bullet, 'char') ?? '•', attr(fontElement, 'typeface')), css }
  if (bullet.localName === 'buAutoNum') return { kind: 'number', scheme: attr(bullet, 'type') ?? 'arabicPeriod', startAt: intAttr(bullet, 'startAt') ?? 1, css }
  if (bullet.localName === 'buBlip') {
    const blip = child(child(bullet, 'blip', NS.a) ?? bullet, 'blip', NS.a) ?? childElements(bullet).find((element) => element.localName === 'blip')
    return { kind: 'image', ...(blip ? { part: blip.getAttributeNS(NS.r, 'embed') ?? undefined } : {}), css }
  }
  return undefined
}

/** Symbol-font bullets (Wingdings and friends) mapped to the Unicode characters they draw. */
function symbolCharacter(char: string, typeface: string | undefined): string {
  const font = (typeface ?? '').toLowerCase()
  if (font.startsWith('wingdings')) {
    const map: Record<string, string> = { '§': '■', 'Ø': '➢', 'ü': '✔', 'v': '❖', 'q': '❑', 'n': '■', 'l': '●', 'Ÿ': '•', 'à': '➔', 'è': '➜', 'ö': '✓', 'o': '□', 'p': '◆', 'u': '◆', 'w': '⬥' }
    return map[char] ?? '•'
  }
  if (font === 'symbol') {
    const map: Record<string, string> = { '·': '•', 'Ø': '¬', 'à': '◊' }
    return map[char] ?? char
  }
  return char
}

/** The label of the `n`th item (1-based) in an auto-numbering scheme. */
export function autoNumberLabel(scheme: string, n: number): string {
  const alpha = (value: number) => {
    let label = ''
    let rest = value
    while (rest > 0) {
      rest--
      label = String.fromCharCode(97 + (rest % 26)) + label
      rest = Math.floor(rest / 26)
    }
    return label
  }
  const roman = (value: number) => {
    const numerals: [number, string][] = [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ]
    let rest = Math.min(Math.max(value, 1), 3999)
    let label = ''
    for (const [amount, symbol] of numerals) {
      while (rest >= amount) {
        label += symbol
        rest -= amount
      }
    }
    return label
  }
  let core = String(n)
  if (scheme.startsWith('alphaLc')) core = alpha(n)
  else if (scheme.startsWith('alphaUc')) core = alpha(n).toUpperCase()
  else if (scheme.startsWith('romanLc')) core = roman(n)
  else if (scheme.startsWith('romanUc')) core = roman(n).toUpperCase()
  if (scheme.endsWith('ParenBoth')) return `(${core})`
  if (scheme.endsWith('ParenR')) return `${core})`
  if (scheme.endsWith('Plain')) return core
  if (scheme.endsWith('Period') || scheme.startsWith('arabic')) return `${core}.`
  return `${core}.`
}

/** Numbers of auto-numbered paragraphs, restarting when a higher level or a different scheme intervenes. */
export function autoNumbers(styles: readonly ParagraphStyle[]): (number | undefined)[] {
  const counters = new Map<number, { scheme: string; value: number }>()
  return styles.map((style) => {
    for (const level of [...counters.keys()]) if (level > style.level) counters.delete(level)
    const bullet = style.bullet
    if (bullet?.kind !== 'number') {
      counters.delete(style.level)
      return undefined
    }
    const current = counters.get(style.level)
    const value = current && current.scheme === bullet.scheme ? current.value + 1 : bullet.startAt
    counters.set(style.level, { scheme: bullet.scheme, value })
    return value
  })
}

export interface TextFrameInput {
  txBody: XmlElement | undefined
  context: TextStyleContext
  body: BodyLayout
  /** The text rectangle within the shape, before insets, in px. */
  rect: { x: number; y: number; w: number; h: number }
  env: RenderEnv
  /** Shown in an empty placeholder in edit mode. */
  prompt?: string
  /** Rotate the text 180° (vertically flipped shapes). */
  upsideDown?: boolean
}

/** CSS for a text frame and its inner block, shared by the renderer and the inline editor. */
export function textFrameStyles(body: BodyLayout, rect: TextFrameInput['rect'], options: { upsideDown?: boolean; firstAlign?: string } = {}): { outer: string; inner: string; anchor: string } {
  const insets = bodyInsets(body)
  const vertical = body.bag.attrs.vert ?? 'horz'
  const rotated = vertical === 'vert' || vertical === 'vert270' || vertical === 'wordArtVertRtl'
  let box = { x: rect.x + insets.l, y: rect.y + insets.t, w: Math.max(0, rect.w - insets.l - insets.r), h: Math.max(0, rect.h - insets.t - insets.b) }
  const transforms: string[] = []
  if (rotated) {
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    box = { x: center.x - box.h / 2, y: center.y - box.w / 2, w: box.h, h: box.w }
    transforms.push(vertical === 'vert270' ? 'rotate(-90deg)' : 'rotate(90deg)')
  }
  if (options.upsideDown) transforms.push('rotate(180deg)')
  const anchor = body.bag.attrs.anchor ?? 't'
  const justify = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'
  const wrap = body.bag.attrs.wrap !== 'none'
  const styles = [
    'position:absolute',
    `left:${px(box.x)}`,
    `top:${px(box.y)}`,
    `width:${px(box.w)}`,
    `height:${px(box.h)}`,
    'display:flex',
    'flex-direction:column',
    `justify-content:${justify}`,
    `--pp-fs:${num(body.fontScale)}`,
    `white-space:${wrap ? 'pre-wrap' : 'pre'}`,
    'overflow-wrap:break-word',
  ]
  if (!wrap) styles.push(`align-items:${options.firstAlign === 'ctr' ? 'center' : options.firstAlign === 'r' ? 'flex-end' : 'flex-start'}`)
  if (transforms.length) styles.push(`transform:${transforms.join(' ')}`)
  if (vertical === 'eaVert' || vertical === 'mongolianVert') styles.push('writing-mode:vertical-rl')
  if (vertical === 'wordArtVert') styles.push('writing-mode:vertical-rl;text-orientation:upright')
  const columns = bagNumber(body.bag, 'numCol') ?? 1
  const inner = [wrap ? 'width:100%' : 'width:max-content']
  if (columns > 1) inner.push(`column-count:${Math.min(16, columns)}`, `column-gap:${px(emuToPx(bagNumber(body.bag, 'spcCol') ?? 0))}`, 'column-fill:auto', 'height:100%')
  return { outer: styles.join(';'), inner: inner.join(';'), anchor }
}

/** The text frame: insets, anchoring, columns, vertical text, and the paragraphs. */
export function renderTextFrame(input: TextFrameInput): string {
  const { body, rect } = input
  const paragraphs = childElements(input.txBody).filter((element) => element.localName === 'p' && element.namespaceURI === NS.a)
  const empty = !paragraphs.some((paragraph) => childElements(paragraph).some((element) => ['r', 'fld', 'br'].includes(element.localName ?? '') && (element.localName !== 'r' || (child(element, 't', NS.a)?.textContent ?? '') !== '')))
  const showPrompt = empty && input.prompt && input.env.mode === 'edit'
  if (empty && !showPrompt) return ''
  const styles = textFrameStyles(body, rect, { upsideDown: input.upsideDown, firstAlign: attr(child(paragraphs[0], 'pPr', NS.a), 'algn') })
  const content = showPrompt ? renderPrompt(input, paragraphs[0]) : renderParagraphs(paragraphs, input)
  return `<div class="pp-text" data-anchor="${escapeAttribute(styles.anchor)}" data-autofit="${body.autofit}" style="${styles.outer};pointer-events:none"><div class="pp-text-inner" style="${styles.inner}">${content}</div></div>`
}

function renderPrompt(input: TextFrameInput, firstParagraph: XmlElement | undefined): string {
  const style = paragraphStyle(child(firstParagraph, 'pPr', NS.a), input.context, input.body)
  return `<div class="pp-p pp-prompt" style="${style.css};opacity:0.55">${escapeText(input.prompt ?? '')}</div>`
}

export function renderParagraphs(paragraphs: XmlElement[], input: TextFrameInput): string {
  const styles = paragraphs.map((paragraph) =>
    paragraphStyle(
      child(paragraph, 'pPr', NS.a),
      input.context,
      input.body,
      childElements(paragraph).find((element) => element.localName === 'r')?.getElementsByTagNameNS(NS.a, 'rPr').item(0) ?? undefined,
    ),
  )
  const numbers = autoNumbers(styles)
  return paragraphs
    .map((paragraph, index) => {
      const style = styles[index]!
      const runs = renderRuns(paragraph, input)
      const hasText = runs.trim() !== ''
      const bullet = hasText && style.bullet ? renderBullet(style.bullet, numbers[index], input.env) : ''
      // Empty paragraphs still take a line, sized by their end-of-paragraph properties.
      const end = child(paragraph, 'endParaRPr', NS.a)
      const endCss = !hasText && end ? runCss(mergeInto(emptyBag(), end), input.context) : ''
      return `<div class="pp-p" style="${style.css}">${bullet}${hasText ? runs : `<span style="${endCss}">​</span>`}</div>`
    })
    .join('')
}

function renderBullet(bullet: BulletSpec, number: number | undefined, env: RenderEnv): string {
  if (bullet.kind === 'char') return `<span class="pp-bullet" style="${bullet.css}">${escapeText(bullet.char)}</span>`
  if (bullet.kind === 'number') return `<span class="pp-bullet" style="${bullet.css}">${escapeText(autoNumberLabel(bullet.scheme, number ?? bullet.startAt))}</span>`
  const rel = bullet.part ? env.rel(bullet.part) : undefined
  const url = rel && !rel.external ? env.assetUrl(rel.target) : undefined
  return url
    ? `<span class="pp-bullet" style="${bullet.css}"><img src="${escapeAttribute(url)}" alt="" style="height:0.8em;vertical-align:middle"/></span>`
    : `<span class="pp-bullet" style="${bullet.css}">•</span>`
}

function renderRuns(paragraph: XmlElement, input: TextFrameInput): string {
  const parts: string[] = []
  for (const element of childElements(paragraph)) {
    const name = element.localName
    if (name === 'r') {
      const text = child(element, 't', NS.a)?.textContent ?? ''
      if (!text) continue
      parts.push(renderRun(text, child(element, 'rPr', NS.a), input))
    } else if (name === 'br') {
      const rPr = child(element, 'rPr', NS.a)
      parts.push(`<br${rPr ? ` style="${escapeAttribute(runCss(mergeInto(emptyBag(), rPr), input.context))}"` : ''}/>`)
    } else if (name === 'fld') {
      parts.push(renderRun(fieldText(element, input.env), child(element, 'rPr', NS.a), input))
    } else if (name === 'AlternateContent') {
      const fallback = childElements(element).find((entry) => entry.localName === 'Fallback')
      for (const run of childElements(fallback).filter((entry) => entry.localName === 'r')) {
        const text = child(run, 't', NS.a)?.textContent ?? ''
        if (text) parts.push(renderRun(text, child(run, 'rPr', NS.a), input))
      }
    }
  }
  return parts.join('')
}

function renderRun(text: string, rPr: XmlElement | undefined, input: TextFrameInput): string {
  const bag = mergeInto(emptyBag(), rPr)
  const hyperlink = !!bag.children.hlinkClick
  const css = runCss(bag, input.context, { hyperlink })
  const content = escapeText(text).replaceAll('\v', '<br/>')
  const href = hyperlink ? linkTarget(bag.children.hlinkClick!, input.env) : undefined
  return `<span${css ? ` style="${escapeAttribute(css)}"` : ''}${href ? ` data-href="${escapeAttribute(href)}"` : ''}>${content}</span>`
}

function linkTarget(link: XmlElement, env: RenderEnv): string | undefined {
  const id = link.getAttributeNS(NS.r, 'id')
  const rel = id ? env.rel(id) : undefined
  if (rel?.external) return rel.target
  const action = attr(link, 'action')
  return action ? `#${action}` : undefined
}

/** Field text: slide numbers and dates are computed; other fields show their cached text. */
export function fieldText(field: XmlElement, env: RenderEnv): string {
  return computedFieldText(attr(field, 'type') ?? '', env.slideNumber, env.now) ?? child(field, 't', NS.a)?.textContent ?? ''
}

/** The text of a slide number or date field, or undefined for fields that keep their saved text. */
export function computedFieldText(type: string, slideNumber: number, now: Date): string | undefined {
  if (type === 'slidenum') return String(slideNumber)
  if (type.startsWith('datetime')) return formatDate(type, now)
  return undefined
}

function formatDate(type: string, date: Date): string {
  const long = { year: 'numeric', month: 'long', day: 'numeric' } as const
  switch (type) {
    case 'datetime2':
      return date.toLocaleDateString('en-US', { weekday: 'long', ...long })
    case 'datetime3':
    case 'datetime4':
      return date.toLocaleDateString('en-US', long)
    case 'datetime10':
    case 'datetime11':
    case 'datetime12':
    case 'datetime13':
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    default:
      return date.toLocaleDateString('en-US')
  }
}
