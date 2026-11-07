import { jmlAttr, jmlChild, jmlElements, jmlOn, unpackJml, type JmlElement } from './jsonml.js'

/**
 * Word styles: lookup, `basedOn` inheritance, and merging of property sets the way Word does it
 * (a derived style's `w:spacing w:before` keeps its base's `w:after`, tab stops add up, borders
 * merge per side).
 */

export type StyleType = 'paragraph' | 'character' | 'table' | 'numbering'

/** Conditional formats of table styles, in the order Word applies them. */
export const TABLE_CONDITIONS = [
  'wholeTable', 'band1Vert', 'band2Vert', 'band1Horz', 'band2Horz', 'firstCol', 'lastCol', 'firstRow', 'lastRow',
  'neCell', 'nwCell', 'seCell', 'swCell',
] as const
export type TableCondition = (typeof TABLE_CONDITIONS)[number]

export interface PropertySet {
  pPr?: JmlElement
  rPr?: JmlElement
  tblPr?: JmlElement
  trPr?: JmlElement
  tcPr?: JmlElement
}

export interface StyleDef extends PropertySet {
  id: string
  type: StyleType
  name: string
  basedOn?: string
  next?: string
  link?: string
  isDefault: boolean
  hidden: boolean
  uiPriority?: number
  qFormat: boolean
  conditions: Map<TableCondition, PropertySet>
  element: JmlElement
}

/** Elements whose attributes merge one by one rather than replacing each other. */
const ATTRIBUTE_MERGED = new Set(['w:spacing', 'w:ind', 'w:rFonts', 'w:lang', 'w:numPr', 'w:tblW', 'w:tblInd', 'w:tcW', 'w:shd'])
/** Elements whose children merge by name (one border per side, one margin per side). */
const CHILD_MERGED = new Set(['w:pBdr', 'w:tblBorders', 'w:tcBorders', 'w:tblCellMar', 'w:tcMar', 'w:numPr', 'w:tblLook'])

function mergeTabs(base: JmlElement, override: JmlElement): JmlElement {
  const stops = new Map<string, JmlElement>()
  for (const tab of jmlElements(base)) stops.set(jmlAttr(tab, 'w:pos') ?? '', tab)
  for (const tab of jmlElements(override)) {
    const pos = jmlAttr(tab, 'w:pos') ?? ''
    if (jmlAttr(tab, 'w:val') === 'clear') stops.delete(pos)
    else stops.set(pos, tab)
  }
  const sorted = [...stops.values()].sort((a, b) => Number(jmlAttr(a, 'w:pos')) - Number(jmlAttr(b, 'w:pos')))
  return ['w:tabs', {}, ...sorted]
}

/** One property element over another, as a derived style or direct formatting applies it. */
export function mergeElement(base: JmlElement | undefined, override: JmlElement | undefined): JmlElement | undefined {
  if (!override) return base
  if (!base) return override
  const name = override[0]
  if (name === 'w:tabs') return mergeTabs(base, override)
  if (CHILD_MERGED.has(name)) {
    const children = new Map<string, JmlElement>()
    for (const child of jmlElements(base)) children.set(child[0], child)
    for (const child of jmlElements(override)) children.set(child[0], mergeElement(children.get(child[0]), child)!)
    return [name, { ...base[1], ...override[1] }, ...children.values()]
  }
  if (ATTRIBUTE_MERGED.has(name)) {
    const attrs = { ...base[1], ...override[1] }
    // A first-line indent and a hanging indent exclude each other.
    if (name === 'w:ind') {
      if (override[1]['w:hanging'] !== undefined) delete attrs['w:firstLine']
      else if (override[1]['w:firstLine'] !== undefined) delete attrs['w:hanging']
    }
    return [name, attrs, ...(override.slice(2) as JmlElement[])]
  }
  return override
}

/** A property container (`w:pPr`, `w:rPr`, …) as a map of its children by name. */
export type PropertyMap = Map<string, JmlElement>

export function propertyMap(container: JmlElement | undefined): PropertyMap {
  const map: PropertyMap = new Map()
  if (container) for (const child of jmlElements(container)) map.set(child[0], child)
  return map
}

export function mergeProperties(base: PropertyMap, override: PropertyMap | JmlElement | undefined): PropertyMap {
  const result = new Map(base)
  const entries = override instanceof Map ? override : propertyMap(override)
  for (const [name, element] of entries) result.set(name, mergeElement(result.get(name), element)!)
  return result
}

/** Toggle properties: in a style chain, setting them again turns them off (Word's XOR rule). */
const TOGGLES = new Set(['w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:vanish'])

export function isToggle(name: string): boolean {
  return TOGGLES.has(name)
}

function conditionSet(element: JmlElement): PropertySet {
  return {
    pPr: jmlChild(element, 'w:pPr'),
    rPr: jmlChild(element, 'w:rPr'),
    tblPr: jmlChild(element, 'w:tblPr'),
    trPr: jmlChild(element, 'w:trPr'),
    tcPr: jmlChild(element, 'w:tcPr'),
  }
}

export function parseStyle(element: JmlElement): StyleDef {
  const conditions = new Map<TableCondition, PropertySet>()
  for (const child of jmlElements(element)) {
    if (child[0] === 'w:tblStylePr') {
      const type = jmlAttr(child, 'w:type') as TableCondition | undefined
      if (type) conditions.set(type, conditionSet(child))
    }
  }
  const uiPriority = jmlAttr(jmlChild(element, 'w:uiPriority'), 'w:val')
  return {
    id: jmlAttr(element, 'w:styleId') ?? '',
    type: (jmlAttr(element, 'w:type') ?? 'paragraph') as StyleType,
    name: jmlAttr(jmlChild(element, 'w:name'), 'w:val') ?? jmlAttr(element, 'w:styleId') ?? '',
    basedOn: jmlAttr(jmlChild(element, 'w:basedOn'), 'w:val'),
    next: jmlAttr(jmlChild(element, 'w:next'), 'w:val'),
    link: jmlAttr(jmlChild(element, 'w:link'), 'w:val'),
    isDefault: ['1', 'true', 'on'].includes(element[1]['w:default'] ?? ''),
    hidden: jmlOn(jmlChild(element, 'w:hidden')) === true || jmlOn(jmlChild(element, 'w:semiHidden')) === true,
    uiPriority: uiPriority === undefined ? undefined : Number(uiPriority),
    qFormat: jmlOn(jmlChild(element, 'w:qFormat')) === true,
    conditions,
    element,
    ...conditionSet(element),
  }
}

/** Built-in style names Word shows translated or capitalized differently than stored. */
const DISPLAY_NAMES: Record<string, string> = {
  'heading 1': 'Heading 1', 'heading 2': 'Heading 2', 'heading 3': 'Heading 3', 'heading 4': 'Heading 4',
  'heading 5': 'Heading 5', 'heading 6': 'Heading 6', 'heading 7': 'Heading 7', 'heading 8': 'Heading 8',
  'heading 9': 'Heading 9', header: 'Header', footer: 'Footer', 'footnote text': 'Footnote Text',
  'endnote text': 'Endnote Text', 'annotation text': 'Comment Text', 'toc 1': 'TOC 1', 'toc 2': 'TOC 2', 'toc 3': 'TOC 3',
  caption: 'Caption', title: 'Title',
}

export function styleDisplayName(style: StyleDef): string {
  return DISPLAY_NAMES[style.name.toLowerCase()] ?? style.name
}

export class StyleSheet {
  readonly styles = new Map<string, StyleDef>()
  readonly docDefaults: { pPr: PropertyMap; rPr: PropertyMap }
  private readonly defaults = new Map<StyleType, StyleDef>()
  private readonly resolved = new Map<string, { pPr: PropertyMap; rPr: PropertyMap; tblPr: PropertyMap; trPr: PropertyMap; tcPr: PropertyMap }>()

  constructor(entries: Iterable<[string, string]>) {
    let docDefaults: JmlElement | undefined
    for (const [key, value] of entries) {
      const element = unpackJml<JmlElement>(value)
      if (!element) continue
      if (key === 'docDefaults') docDefaults = element
      else if (key.startsWith('style:')) {
        const style = parseStyle(element)
        this.styles.set(style.id, style)
        if (style.isDefault && !this.defaults.has(style.type)) this.defaults.set(style.type, style)
      }
    }
    this.docDefaults = {
      pPr: propertyMap(jmlChild(jmlChild(docDefaults, 'w:pPrDefault'), 'w:pPr')),
      rPr: propertyMap(jmlChild(jmlChild(docDefaults, 'w:rPrDefault'), 'w:rPr')),
    }
  }

  get(id: string | null | undefined): StyleDef | undefined {
    return id ? this.styles.get(id) : undefined
  }

  defaultStyle(type: StyleType): StyleDef | undefined {
    return this.defaults.get(type)
  }

  /** The paragraph style a paragraph uses: its own, or the default when it names none or a missing one. */
  paragraphStyle(id: string | null | undefined): StyleDef | undefined {
    const style = this.get(id)
    return style?.type === 'paragraph' ? style : this.defaultStyle('paragraph')
  }

  /** The style and its bases, base first; cycles end the chain. */
  chain(id: string | null | undefined): StyleDef[] {
    const result: StyleDef[] = []
    const seen = new Set<string>()
    for (let style = this.get(id); style && !seen.has(style.id) && result.length < 64; style = this.get(style.basedOn)) {
      seen.add(style.id)
      result.unshift(style)
    }
    return result
  }

  /**
   * A style's own properties with everything it inherits (docDefaults not included). Toggle
   * properties follow Word's rule: each style that sets one flips it.
   */
  resolve(id: string | null | undefined): { pPr: PropertyMap; rPr: PropertyMap; tblPr: PropertyMap; trPr: PropertyMap; tcPr: PropertyMap } {
    const key = id ?? ''
    const cached = this.resolved.get(key)
    if (cached) return cached
    let pPr: PropertyMap = new Map()
    let rPr: PropertyMap = new Map()
    let tblPr: PropertyMap = new Map()
    let trPr: PropertyMap = new Map()
    let tcPr: PropertyMap = new Map()
    for (const style of this.chain(id)) {
      pPr = mergeProperties(pPr, style.pPr)
      tblPr = mergeProperties(tblPr, style.tblPr)
      trPr = mergeProperties(trPr, style.trPr)
      tcPr = mergeProperties(tcPr, style.tcPr)
      // Within one chain a derived style's toggle replaces its base's; Word's XOR rule only applies
      // between the table, paragraph, and character styles of one run.
      rPr = mergeProperties(rPr, style.rPr)
    }
    const result = { pPr, rPr, tblPr, trPr, tcPr }
    this.resolved.set(key, result)
    return result
  }

  /** Paragraph styles to offer in the style picker, the most used first. */
  pickerStyles(): StyleDef[] {
    return [...this.styles.values()]
      .filter((style) => style.type === 'paragraph' && (!style.hidden || style.qFormat))
      .sort((a, b) => Number(b.qFormat) - Number(a.qFormat) || (a.uiPriority ?? 99) - (b.uiPriority ?? 99) || styleDisplayName(a).localeCompare(styleDisplayName(b)))
  }

  /** The style id with this name or id, for agents and pasted HTML that say `Heading 1`. */
  findByName(name: string): StyleDef | undefined {
    const lower = name.toLowerCase()
    for (const style of this.styles.values()) if (style.id.toLowerCase() === lower || style.name.toLowerCase() === lower) return style
    return undefined
  }

  /** Outline level (0–8) of a paragraph style, from its own or inherited `w:outlineLvl`. */
  outlineLevel(id: string | null | undefined): number | undefined {
    const value = jmlAttr(this.resolve(this.paragraphStyle(id)?.id).pPr.get('w:outlineLvl'), 'w:val')
    const level = value === undefined ? undefined : Number(value)
    return level !== undefined && level >= 0 && level < 9 ? level : undefined
  }
}

/** Which conditional formats of a table style apply to a cell, in application order. */
export function cellConditions(
  look: { firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean; noHBand: boolean; noVBand: boolean },
  position: { row: number; rows: number; col: number; cols: number; headerRows: number },
  bandSize: { rows: number; cols: number } = { rows: 1, cols: 1 },
): TableCondition[] {
  const result: TableCondition[] = ['wholeTable']
  const isFirstRow = look.firstRow && position.row < Math.max(1, position.headerRows)
  const isLastRow = look.lastRow && position.row === position.rows - 1
  const isFirstCol = look.firstColumn && position.col === 0
  const isLastCol = look.lastColumn && position.col === position.cols - 1
  if (!look.noVBand && !isFirstCol && !isLastCol) {
    const index = position.col - (look.firstColumn ? 1 : 0)
    result.push(Math.floor(index / Math.max(1, bandSize.cols)) % 2 === 0 ? 'band1Vert' : 'band2Vert')
  }
  if (!look.noHBand && !isFirstRow && !isLastRow) {
    const index = position.row - (look.firstRow ? Math.max(1, position.headerRows) : 0)
    result.push(Math.floor(index / Math.max(1, bandSize.rows)) % 2 === 0 ? 'band1Horz' : 'band2Horz')
  }
  if (isFirstCol) result.push('firstCol')
  if (isLastCol) result.push('lastCol')
  if (isFirstRow) result.push('firstRow')
  if (isLastRow) result.push('lastRow')
  if (isFirstRow && isLastCol) result.push('neCell')
  if (isFirstRow && isFirstCol) result.push('nwCell')
  if (isLastRow && isLastCol) result.push('seCell')
  if (isLastRow && isFirstCol) result.push('swCell')
  return result
}

/** Reads `w:tblLook`, in either its attribute or its legacy hex form. */
export function tableLook(tblLook: JmlElement | undefined): { firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean; noHBand: boolean; noVBand: boolean } {
  const hex = jmlAttr(tblLook, 'w:val')
  const bits = hex ? Number.parseInt(hex, 16) : undefined
  const flag = (name: string, mask: number, fallback: boolean) => {
    const value = jmlAttr(tblLook, name)
    if (value !== undefined) return value === '1' || value === 'true' || value === 'on'
    if (bits !== undefined && Number.isFinite(bits)) return (bits & mask) !== 0
    return fallback
  }
  return {
    firstRow: flag('w:firstRow', 0x20, true),
    lastRow: flag('w:lastRow', 0x40, false),
    firstColumn: flag('w:firstColumn', 0x80, true),
    lastColumn: flag('w:lastColumn', 0x100, false),
    noHBand: flag('w:noHBand', 0x200, false),
    noVBand: flag('w:noVBand', 0x400, true),
  }
}
