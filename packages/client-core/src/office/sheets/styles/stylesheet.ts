import { parseXml, serializeXml, type XmlDocument } from '../../ooxml/package.js'
import { builtinFormatCode } from '../numfmt/index.js'
import { attr, boolAttr, child, children, numberAttr, SHEET_NS, type XmlElement } from '../codec/xml.js'
import type { BorderEdge, BorderStyle, HorizontalAlign, SheetColor, StyleProps, UnderlineStyle, VerticalAlign } from '../model/schema.js'

/**
 * The workbook stylesheet (`xl/styles.xml`). Cells point at its cell formats (`cellXfs`) by
 * index; the stylesheet is kept as read, and edits made in the editor are stored as overrides on
 * top of a cell's format (see schema.ts). On export each distinct format-plus-overrides gets a
 * format of its own, appended to the stylesheet, so formats nobody touched keep their indexes.
 */

/** Everything the renderer needs about a cell's look, with defaults filled in. */
export interface ResolvedStyle extends StyleProps {
  vertAlign?: 'superscript' | 'subscript'
  /** Pattern fills other than solid (`gray125`, `darkHorizontal`, …): pattern type and colors. */
  pattern?: { type: string; fg?: SheetColor; bg?: SheetColor }
  gradient?: { type: 'linear' | 'path'; degree: number; stops: { position: number; color: SheetColor }[] }
  diagonalUp?: BorderEdge | null
  diagonalDown?: BorderEdge | null
  /** Name of the cell style (`Normal`, `Good`, …) the format is based on. */
  styleName?: string
  quotePrefix?: boolean
}

export const DEFAULT_FONT = { name: 'Calibri', size: 11 }

export const DEFAULT_STYLE: ResolvedStyle = {
  fontName: DEFAULT_FONT.name,
  fontSize: DEFAULT_FONT.size,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  fontColor: null,
  fill: null,
  borderTop: null,
  borderBottom: null,
  borderLeft: null,
  borderRight: null,
  hAlign: 'general',
  vAlign: 'bottom',
  wrap: false,
  rotation: 0,
  indent: 0,
  shrink: false,
  numFmt: 'General',
  locked: true,
  hidden: false,
}

interface FontRecord {
  name?: string
  size?: number
  bold: boolean
  italic: boolean
  underline: UnderlineStyle | null
  strike: boolean
  color: SheetColor | null
  vertAlign?: 'superscript' | 'subscript'
}

interface FillRecord {
  solid: SheetColor | null
  pattern?: ResolvedStyle['pattern']
  gradient?: ResolvedStyle['gradient']
}

interface BorderRecord {
  top: BorderEdge | null
  bottom: BorderEdge | null
  left: BorderEdge | null
  right: BorderEdge | null
  diagonalUp: BorderEdge | null
  diagonalDown: BorderEdge | null
}

interface XfRecord {
  numFmtId: number
  fontId: number
  fillId: number
  borderId: number
  xfId?: number
  hAlign: HorizontalAlign
  vAlign: VerticalAlign
  wrap: boolean
  rotation: number
  indent: number
  shrink: boolean
  locked: boolean
  hidden: boolean
  quotePrefix: boolean
}

/** A differential format, as conditional formats and table styles use. */
export interface DifferentialStyle {
  font?: Partial<Pick<ResolvedStyle, 'bold' | 'italic' | 'underline' | 'strike' | 'fontColor'>>
  fill?: SheetColor | null
  border?: Partial<Pick<ResolvedStyle, 'borderTop' | 'borderBottom' | 'borderLeft' | 'borderRight'>>
  numFmt?: string
}

export function parseColor(element: XmlElement | undefined): SheetColor | null {
  if (!element) return null
  const color: SheetColor = {}
  const rgb = attr(element, 'rgb')
  const theme = numberAttr(element, 'theme')
  const indexed = numberAttr(element, 'indexed')
  const tint = numberAttr(element, 'tint')
  if (rgb) color.rgb = rgb.toUpperCase()
  else if (theme !== undefined) color.theme = theme
  else if (indexed !== undefined) color.indexed = indexed
  else if (boolAttr(element, 'auto')) color.auto = true
  else return null
  if (tint) color.tint = tint
  return color
}

export function colorAttrs(color: SheetColor): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (color.rgb) attrs.rgb = color.rgb.length === 6 ? `FF${color.rgb}` : color.rgb
  else if (color.theme !== undefined) attrs.theme = String(color.theme)
  else if (color.indexed !== undefined) attrs.indexed = String(color.indexed)
  else if (color.auto) attrs.auto = '1'
  if (color.tint) attrs.tint = String(color.tint)
  return attrs
}

function parseFont(element: XmlElement): FontRecord {
  const value = (name: string) => attr(child(element, name), 'val')
  const flag = (name: string) => {
    const node = child(element, name)
    return !!node && (attr(node, 'val') === undefined || boolAttr(node, 'val'))
  }
  const underlineNode = child(element, 'u')
  const underline = underlineNode ? ((attr(underlineNode, 'val') ?? 'single') as UnderlineStyle | 'none') : null
  const vertAlign = value('vertAlign')
  const size = Number(value('sz'))
  return {
    ...(value('name') ? { name: value('name') } : {}),
    ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    bold: flag('b'),
    italic: flag('i'),
    underline: underline === 'none' ? null : underline,
    strike: flag('strike'),
    color: parseColor(child(element, 'color')),
    ...(vertAlign === 'superscript' || vertAlign === 'subscript' ? { vertAlign } : {}),
  }
}

function parseFill(element: XmlElement): FillRecord {
  const pattern = child(element, 'patternFill')
  if (pattern) {
    const type = attr(pattern, 'patternType') ?? (child(pattern, 'fgColor') ? 'solid' : 'none')
    const fg = parseColor(child(pattern, 'fgColor'))
    const bg = parseColor(child(pattern, 'bgColor'))
    if (type === 'none') return { solid: null }
    // Solid fills paint the foreground color; Excel falls back to black when none is given.
    if (type === 'solid') return { solid: fg ?? { indexed: 64 } }
    return { solid: null, pattern: { type, ...(fg ? { fg } : {}), ...(bg ? { bg } : {}) } }
  }
  const gradient = child(element, 'gradientFill')
  if (gradient) {
    const stops = children(gradient, 'stop').map((stop) => ({ position: numberAttr(stop, 'position') ?? 0, color: parseColor(child(stop, 'color')) ?? { rgb: 'FFFFFFFF' } }))
    return { solid: null, gradient: { type: attr(gradient, 'type') === 'path' ? 'path' : 'linear', degree: numberAttr(gradient, 'degree') ?? 0, stops } }
  }
  return { solid: null }
}

function parseEdge(element: XmlElement | undefined): BorderEdge | null {
  const style = attr(element, 'style') as BorderStyle | 'none' | undefined
  if (!element || !style || style === 'none') return null
  const color = parseColor(child(element, 'color'))
  return color ? { style, color } : { style }
}

function parseBorder(element: XmlElement): BorderRecord {
  const diagonal = parseEdge(child(element, 'diagonal'))
  return {
    top: parseEdge(child(element, 'top')),
    bottom: parseEdge(child(element, 'bottom')),
    left: parseEdge(child(element, 'left') ?? child(element, 'start')),
    right: parseEdge(child(element, 'right') ?? child(element, 'end')),
    diagonalUp: boolAttr(element, 'diagonalUp') ? diagonal : null,
    diagonalDown: boolAttr(element, 'diagonalDown') ? diagonal : null,
  }
}

function parseXf(element: XmlElement): XfRecord {
  const alignment = child(element, 'alignment')
  const protection = child(element, 'protection')
  return {
    numFmtId: numberAttr(element, 'numFmtId') ?? 0,
    fontId: numberAttr(element, 'fontId') ?? 0,
    fillId: numberAttr(element, 'fillId') ?? 0,
    borderId: numberAttr(element, 'borderId') ?? 0,
    ...(numberAttr(element, 'xfId') !== undefined ? { xfId: numberAttr(element, 'xfId')! } : {}),
    hAlign: (attr(alignment, 'horizontal') as HorizontalAlign | undefined) ?? 'general',
    vAlign: (attr(alignment, 'vertical') as VerticalAlign | undefined) ?? 'bottom',
    wrap: boolAttr(alignment, 'wrapText'),
    rotation: numberAttr(alignment, 'textRotation') ?? 0,
    indent: numberAttr(alignment, 'indent') ?? 0,
    shrink: boolAttr(alignment, 'shrinkToFit'),
    locked: boolAttr(protection, 'locked', true),
    hidden: boolAttr(protection, 'hidden'),
    quotePrefix: boolAttr(element, 'quotePrefix'),
  }
}

const SAME = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export class Stylesheet {
  readonly document: XmlDocument
  private numFmts = new Map<number, string>()
  private fonts: FontRecord[] = []
  private fills: FillRecord[] = []
  private borders: BorderRecord[] = []
  private xfs: XfRecord[] = []
  private styleXfNames = new Map<number, string>()
  private dxfs: DifferentialStyle[] = []
  /** Workbook-specific replacement for the legacy indexed palette, if any (`AARRGGBB`). */
  indexedColors: string[] | undefined
  private resolvedCache = new Map<number, ResolvedStyle>()
  /** Formats added by `intern`, by key, so equal styles share one format. */
  private interned = new Map<string, number>()

  constructor(xml: string = DEFAULT_STYLES_XML) {
    this.document = parseXml(xml)
    this.read()
  }

  private section(name: string): XmlElement | undefined {
    return child(this.document.documentElement!, name)
  }

  private read(): void {
    for (const element of children(this.section('numFmts'), 'numFmt')) {
      const id = numberAttr(element, 'numFmtId')
      const code = attr(element, 'formatCode')
      if (id !== undefined && code !== undefined) this.numFmts.set(id, code)
    }
    this.fonts = children(this.section('fonts'), 'font').map(parseFont)
    this.fills = children(this.section('fills'), 'fill').map(parseFill)
    this.borders = children(this.section('borders'), 'border').map(parseBorder)
    this.xfs = children(this.section('cellXfs'), 'xf').map(parseXf)
    const styleNames = children(this.section('cellStyles'), 'cellStyle')
    for (const style of styleNames) {
      const xfId = numberAttr(style, 'xfId')
      if (xfId !== undefined) this.styleXfNames.set(xfId, attr(style, 'name') ?? '')
    }
    this.dxfs = children(this.section('dxfs'), 'dxf').map((element) => this.parseDxf(element))
    const indexed = child(this.section('colors'), 'indexedColors')
    if (indexed) this.indexedColors = children(indexed, 'rgbColor').map((color) => attr(color, 'rgb') ?? 'FF000000')
  }

  private parseDxf(element: XmlElement): DifferentialStyle {
    const dxf: DifferentialStyle = {}
    const font = child(element, 'font')
    if (font) {
      const parsed = parseFont(font)
      dxf.font = {}
      if (child(font, 'b')) dxf.font.bold = parsed.bold
      if (child(font, 'i')) dxf.font.italic = parsed.italic
      if (child(font, 'u')) dxf.font.underline = parsed.underline
      if (child(font, 'strike')) dxf.font.strike = parsed.strike
      if (parsed.color) dxf.font.fontColor = parsed.color
    }
    const fill = child(element, 'fill')
    if (fill) {
      // Differential fills paint bgColor for solid patterns (an Excel quirk), else fgColor.
      const pattern = child(fill, 'patternFill')
      const color = parseColor(child(pattern, 'bgColor')) ?? parseColor(child(pattern, 'fgColor'))
      dxf.fill = attr(pattern, 'patternType') === 'none' ? null : color
    }
    const border = child(element, 'border')
    if (border) {
      const parsed = parseBorder(border)
      dxf.border = {}
      if (child(border, 'top')) dxf.border.borderTop = parsed.top
      if (child(border, 'bottom')) dxf.border.borderBottom = parsed.bottom
      if (child(border, 'left')) dxf.border.borderLeft = parsed.left
      if (child(border, 'right')) dxf.border.borderRight = parsed.right
    }
    const numFmt = child(element, 'numFmt')
    if (numFmt) dxf.numFmt = attr(numFmt, 'formatCode') ?? 'General'
    return dxf
  }

  get xfCount(): number {
    return this.xfs.length
  }

  get dxfCount(): number {
    return this.dxfs.length
  }

  dxf(index: number): DifferentialStyle | undefined {
    return this.dxfs[index]
  }

  /** The format code of a number format id: custom, built-in, or General. */
  formatCode(id: number): string {
    return this.numFmts.get(id) ?? builtinFormatCode(id) ?? 'General'
  }

  /** The default font (font 0), used for column widths and new cells. */
  get defaultFont(): { name: string; size: number } {
    const font = this.fonts[0]
    return { name: font?.name ?? DEFAULT_FONT.name, size: font?.size ?? DEFAULT_FONT.size }
  }

  /** A cell format, resolved. Out-of-range indexes resolve to format 0, as Excel does. */
  resolve(xf: number | undefined): ResolvedStyle {
    const index = xf !== undefined && xf >= 0 && xf < this.xfs.length ? xf : 0
    const cached = this.resolvedCache.get(index)
    if (cached) return cached
    const record = this.xfs[index]
    let style: ResolvedStyle = { ...DEFAULT_STYLE, ...this.defaultFontProps() }
    if (record) {
      const font = this.fonts[record.fontId] ?? this.fonts[0]
      const fill = this.fills[record.fillId]
      const border = this.borders[record.borderId]
      style = {
        ...style,
        ...(font?.name ? { fontName: font.name } : {}),
        ...(font?.size ? { fontSize: font.size } : {}),
        bold: font?.bold ?? false,
        italic: font?.italic ?? false,
        underline: font?.underline ?? null,
        strike: font?.strike ?? false,
        fontColor: font?.color ?? null,
        ...(font?.vertAlign ? { vertAlign: font.vertAlign } : {}),
        fill: fill?.solid ?? null,
        ...(fill?.pattern ? { pattern: fill.pattern } : {}),
        ...(fill?.gradient ? { gradient: fill.gradient } : {}),
        borderTop: border?.top ?? null,
        borderBottom: border?.bottom ?? null,
        borderLeft: border?.left ?? null,
        borderRight: border?.right ?? null,
        diagonalUp: border?.diagonalUp ?? null,
        diagonalDown: border?.diagonalDown ?? null,
        hAlign: record.hAlign,
        vAlign: record.vAlign,
        wrap: record.wrap,
        rotation: record.rotation,
        indent: record.indent,
        shrink: record.shrink,
        numFmt: this.formatCode(record.numFmtId),
        locked: record.locked,
        hidden: record.hidden,
        quotePrefix: record.quotePrefix,
        ...(record.xfId !== undefined && this.styleXfNames.has(record.xfId) ? { styleName: this.styleXfNames.get(record.xfId)! } : {}),
      }
    }
    this.resolvedCache.set(index, style)
    return style
  }

  private defaultFontProps(): Pick<ResolvedStyle, 'fontName' | 'fontSize'> {
    const font = this.defaultFont
    return { fontName: font.name, fontSize: font.size }
  }

  /**
   * The index of a format equal to format `base` with `overrides` applied, adding one to the
   * stylesheet if needed. Used on export; the stylesheet document is changed in place.
   */
  intern(base: number | undefined, overrides: Partial<StyleProps>): number {
    const baseIndex = base !== undefined && base >= 0 && base < this.xfs.length ? base : 0
    const resolved = this.resolve(baseIndex)
    const changed = Object.entries(overrides).filter(([prop, value]) => !SAME(resolved[prop as keyof StyleProps], value)) as [keyof StyleProps, unknown][]
    if (!changed.length) return baseIndex
    const key = `${baseIndex}|${JSON.stringify(Object.fromEntries(changed.sort(([a], [b]) => a.localeCompare(b))))}`
    const known = this.interned.get(key)
    if (known !== undefined) return known
    const target: ResolvedStyle = { ...resolved, ...Object.fromEntries(changed) }
    const record = { ...this.xfs[baseIndex]! }
    const touched = new Set(changed.map(([prop]) => prop))
    if (['fontName', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'fontColor'].some((prop) => touched.has(prop as keyof StyleProps))) {
      record.fontId = this.addFont(record.fontId, target)
    }
    if (touched.has('fill')) record.fillId = this.addFill(target.fill)
    if (['borderTop', 'borderBottom', 'borderLeft', 'borderRight'].some((prop) => touched.has(prop as keyof StyleProps))) {
      record.borderId = this.addBorder(record.borderId, target)
    }
    if (touched.has('numFmt')) record.numFmtId = this.numFmtId(target.numFmt)
    Object.assign(record, {
      hAlign: target.hAlign,
      vAlign: target.vAlign,
      wrap: target.wrap,
      rotation: target.rotation,
      indent: target.indent,
      shrink: target.shrink,
      locked: target.locked,
      hidden: target.hidden,
    })
    const index = this.appendXf(baseIndex, record, touched)
    this.interned.set(key, index)
    return index
  }

  /** The id of a number format code, adding a custom format when it isn't built in. */
  numFmtId(code: string): number {
    for (let id = 0; id <= 49; id++) if (builtinFormatCode(id) === code) return id
    for (const [id, existing] of this.numFmts) if (existing === code) return id
    const id = Math.max(163, ...this.numFmts.keys()) + 1
    const numFmts = this.ensureSection('numFmts', ['fonts'])
    const element = this.document.createElementNS(SHEET_NS, 'numFmt')
    element.setAttribute('numFmtId', String(id))
    element.setAttribute('formatCode', code)
    numFmts.appendChild(element)
    numFmts.setAttribute('count', String(children(numFmts, 'numFmt').length))
    this.numFmts.set(id, code)
    return id
  }

  private addFont(baseId: number, style: ResolvedStyle): number {
    const fonts = this.ensureSection('fonts', ['fills'])
    const baseElement = children(fonts, 'font')[baseId] ?? children(fonts, 'font')[0]
    const element = (baseElement ? baseElement.cloneNode(true) : this.document.createElementNS(SHEET_NS, 'font')) as XmlElement
    // Excel requires font children in schema order: b i strike condense extend outline shadow u vertAlign sz color name family charset scheme.
    const ORDER = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme']
    const setChild = (name: string, attrs: Record<string, string> | undefined) => {
      for (const existing of children(element, name)) element.removeChild(existing)
      if (!attrs) return
      const node = this.document.createElementNS(SHEET_NS, name)
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
      const position = ORDER.indexOf(name)
      const before = children(element).find((existing) => ORDER.indexOf(existing.localName ?? '') > position)
      element.insertBefore(node, before ?? null)
    }
    setChild('b', style.bold ? {} : undefined)
    setChild('i', style.italic ? {} : undefined)
    setChild('strike', style.strike ? {} : undefined)
    setChild('u', style.underline ? (style.underline === 'single' ? {} : { val: style.underline }) : undefined)
    setChild('sz', { val: String(style.fontSize) })
    setChild('color', style.fontColor ? colorAttrs(style.fontColor) : undefined)
    if (style.fontName !== (this.fonts[baseId]?.name ?? DEFAULT_FONT.name)) {
      setChild('name', { val: style.fontName })
      // The theme font scheme would override an explicitly chosen font.
      setChild('scheme', undefined)
      setChild('family', undefined)
    }
    fonts.appendChild(element)
    fonts.setAttribute('count', String(children(fonts, 'font').length))
    this.fonts.push(parseFont(element))
    return this.fonts.length - 1
  }

  private addFill(color: SheetColor | null): number {
    const fills = this.ensureSection('fills', ['borders'])
    const element = this.document.createElementNS(SHEET_NS, 'fill')
    const pattern = this.document.createElementNS(SHEET_NS, 'patternFill')
    pattern.setAttribute('patternType', color ? 'solid' : 'none')
    if (color) {
      const fg = this.document.createElementNS(SHEET_NS, 'fgColor')
      for (const [key, value] of Object.entries(colorAttrs(color))) fg.setAttribute(key, value)
      pattern.appendChild(fg)
      const bg = this.document.createElementNS(SHEET_NS, 'bgColor')
      bg.setAttribute('indexed', '64')
      pattern.appendChild(bg)
    }
    element.appendChild(pattern)
    fills.appendChild(element)
    fills.setAttribute('count', String(children(fills, 'fill').length))
    this.fills.push(parseFill(element))
    return this.fills.length - 1
  }

  private addBorder(baseId: number, style: ResolvedStyle): number {
    const borders = this.ensureSection('borders', ['cellStyleXfs', 'cellXfs'])
    const baseElement = children(borders, 'border')[baseId]
    const element = this.document.createElementNS(SHEET_NS, 'border')
    if (baseElement) for (const name of ['diagonalUp', 'diagonalDown', 'outline']) if (baseElement.hasAttribute(name)) element.setAttribute(name, baseElement.getAttribute(name)!)
    const edge = (name: string, value: BorderEdge | null) => {
      const node = this.document.createElementNS(SHEET_NS, name)
      if (value) {
        node.setAttribute('style', value.style)
        if (value.color) {
          const color = this.document.createElementNS(SHEET_NS, 'color')
          for (const [key, attrValue] of Object.entries(colorAttrs(value.color))) color.setAttribute(key, attrValue)
          node.appendChild(color)
        }
      }
      element.appendChild(node)
    }
    edge('left', style.borderLeft)
    edge('right', style.borderRight)
    edge('top', style.borderTop)
    edge('bottom', style.borderBottom)
    const diagonal = baseElement && child(baseElement, 'diagonal')
    element.appendChild(diagonal ? diagonal.cloneNode(true) : this.document.createElementNS(SHEET_NS, 'diagonal'))
    borders.appendChild(element)
    borders.setAttribute('count', String(children(borders, 'border').length))
    this.borders.push(parseBorder(element))
    return this.borders.length - 1
  }

  private appendXf(baseIndex: number, record: XfRecord, touched: Set<keyof StyleProps>): number {
    const cellXfs = this.ensureSection('cellXfs', ['cellStyles', 'dxfs'])
    const baseElement = children(cellXfs, 'xf')[baseIndex]
    const element = (baseElement ? baseElement.cloneNode(true) : this.document.createElementNS(SHEET_NS, 'xf')) as XmlElement
    element.setAttribute('numFmtId', String(record.numFmtId))
    element.setAttribute('fontId', String(record.fontId))
    element.setAttribute('fillId', String(record.fillId))
    element.setAttribute('borderId', String(record.borderId))
    if (!element.hasAttribute('xfId')) element.setAttribute('xfId', '0')
    const apply = (name: string, props: (keyof StyleProps)[]) => {
      if (props.some((prop) => touched.has(prop))) element.setAttribute(name, '1')
    }
    apply('applyNumberFormat', ['numFmt'])
    apply('applyFont', ['fontName', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'fontColor'])
    apply('applyFill', ['fill'])
    apply('applyBorder', ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'])
    apply('applyAlignment', ['hAlign', 'vAlign', 'wrap', 'rotation', 'indent', 'shrink'])
    apply('applyProtection', ['locked', 'hidden'])
    const alignment: Record<string, string> = {}
    if (record.hAlign !== 'general') alignment.horizontal = record.hAlign
    if (record.vAlign !== 'bottom') alignment.vertical = record.vAlign
    if (record.wrap) alignment.wrapText = '1'
    if (record.rotation) alignment.textRotation = String(record.rotation)
    if (record.indent) alignment.indent = String(record.indent)
    if (record.shrink) alignment.shrinkToFit = '1'
    const oldAlignment = child(element, 'alignment')
    // Keep alignment attributes we don't model (readingOrder, justifyLastLine, relativeIndent).
    const alignmentNode = oldAlignment ?? this.document.createElementNS(SHEET_NS, 'alignment')
    for (const name of ['horizontal', 'vertical', 'wrapText', 'textRotation', 'indent', 'shrinkToFit']) alignmentNode.removeAttribute(name)
    for (const [key, value] of Object.entries(alignment)) alignmentNode.setAttribute(key, value)
    if (!oldAlignment && alignmentNode.attributes.length) element.insertBefore(alignmentNode, element.firstChild)
    else if (oldAlignment && !alignmentNode.attributes.length) element.removeChild(oldAlignment)
    const protection = child(element, 'protection')
    if (touched.has('locked') || touched.has('hidden')) {
      const node = protection ?? this.document.createElementNS(SHEET_NS, 'protection')
      if (record.locked) node.removeAttribute('locked')
      else node.setAttribute('locked', '0')
      if (record.hidden) node.setAttribute('hidden', '1')
      else node.removeAttribute('hidden')
      if (!protection) {
        const extLst = child(element, 'extLst')
        element.insertBefore(node, extLst ?? null)
      }
    }
    cellXfs.appendChild(element)
    cellXfs.setAttribute('count', String(children(cellXfs, 'xf').length))
    this.xfs.push(parseXf(element))
    return this.xfs.length - 1
  }

  /** A top-level section, created in schema order (before the first of `before` present). */
  private ensureSection(name: string, before: string[]): XmlElement {
    const existing = this.section(name)
    if (existing) return existing
    const root = this.document.documentElement!
    const element = this.document.createElementNS(SHEET_NS, name)
    element.setAttribute('count', '0')
    const ORDER = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst']
    const position = ORDER.indexOf(name)
    const next = children(root).find((node) => ORDER.indexOf(node.localName ?? '') > position) ?? before.map((entry) => this.section(entry)).find(Boolean)
    root.insertBefore(element, next ?? null)
    return element
  }

  /** The stylesheet XML, including formats added by `intern`. */
  toXml(): string {
    return serializeXml(this.document)
  }

  /**
   * Adds every cell format of `other` that this stylesheet lacks (with its font, fill, border,
   * and number format) and returns the mapping from `other`'s indexes to this one's. Used when a
   * new version of a file brings its own stylesheet.
   */
  merge(other: Stylesheet): { xf: number[]; dxf: number[] } {
    const otherRoot = other.document.documentElement!
    const importInto = (section: string, before: string[], source: XmlElement | undefined, count: () => number): number => {
      const target = this.ensureSection(section, before)
      if (source) target.appendChild(this.document.importNode(source, true))
      const total = children(target).length
      target.setAttribute('count', String(total))
      return count()
    }
    const known = new Map<string, number>()
    for (let own = this.xfs.length - 1; own >= 0; own--) known.set(styleKey(this.resolve(own)), own)
    const xf = other.xfs.map((record, index) => {
      const existing = known.get(styleKey(other.resolve(index)))
      if (existing !== undefined) return existing
      // Bring the format over element by element, so pattern and gradient fills and unmodeled
      // attributes survive.
      const font = children(child(otherRoot, 'fonts'), 'font')[record.fontId]
      const fill = children(child(otherRoot, 'fills'), 'fill')[record.fillId]
      const border = children(child(otherRoot, 'borders'), 'border')[record.borderId]
      const fontId = importInto('fonts', ['fills'], font, () => (this.fonts.push(font ? parseFont(font) : this.fonts[0]!), this.fonts.length - 1))
      const fillId = importInto('fills', ['borders'], fill, () => (this.fills.push(fill ? parseFill(fill) : { solid: null }), this.fills.length - 1))
      const borderId = importInto('borders', ['cellStyleXfs', 'cellXfs'], border, () => (this.borders.push(border ? parseBorder(border) : parseBorder(this.document.createElementNS(SHEET_NS, 'border'))), this.borders.length - 1))
      const numFmtId = this.numFmtId(other.formatCode(record.numFmtId))
      const source = children(child(otherRoot, 'cellXfs'), 'xf')[index]!
      const element = this.document.importNode(source, true) as XmlElement
      element.setAttribute('fontId', String(fontId))
      element.setAttribute('fillId', String(fillId))
      element.setAttribute('borderId', String(borderId))
      element.setAttribute('numFmtId', String(numFmtId))
      // Named cell styles aren't merged; point at Normal.
      element.setAttribute('xfId', '0')
      const cellXfs = this.ensureSection('cellXfs', ['cellStyles', 'dxfs'])
      cellXfs.appendChild(element)
      cellXfs.setAttribute('count', String(children(cellXfs, 'xf').length))
      this.xfs.push(parseXf(element))
      return this.xfs.length - 1
    })
    const dxf = other.dxfs.map((entry, index) => {
      const own = this.dxfs.findIndex((existing) => SAME(existing, entry))
      if (own >= 0) return own
      const dxfs = this.ensureSection('dxfs', ['tableStyles', 'colors', 'extLst'])
      const source = children(child(other.document.documentElement!, 'dxfs'), 'dxf')[index]
      if (source) dxfs.appendChild(this.document.importNode(source, true))
      dxfs.setAttribute('count', String(children(dxfs, 'dxf').length))
      this.dxfs.push(entry)
      return this.dxfs.length - 1
    })
    return { xf, dxf }
  }
}

function styleKey(style: ResolvedStyle): string {
  const { styleName: _name, ...rest } = style
  return JSON.stringify(rest)
}

/** The stylesheet of a new workbook: Excel's defaults (Calibri 11, no fill, no border). */
export const DEFAULT_STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
  '</styleSheet>'
