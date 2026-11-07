import { decodePartText, relationshipsPathFor, resolveTarget } from '../../ooxml/package.js'
import type { PartSnapshot, RelTarget } from '../model.js'
import { attr, child, childElements, NS, parseXmlDocument, path, REL_TYPES, type XmlElement } from '../xml.js'
import { DEFAULT_COLOR_MAP } from './color.js'

/**
 * Parsed, cached views of the parts a slide inherits from: presentation defaults, slide masters,
 * layouts, themes, and table styles. Parts are immutable in the model (only slides are edited),
 * so each is parsed once per byte array.
 */

export interface FontScheme {
  latin: string
  ea: string
  cs: string
}

export interface Theme {
  name: string
  colors: Record<string, string>
  major: FontScheme
  minor: FontScheme
  fillStyles: XmlElement[]
  lineStyles: XmlElement[]
  effectStyles: XmlElement[]
  backgroundFillStyles: XmlElement[]
}

export const DEFAULT_THEME: Theme = {
  name: 'Office',
  colors: {
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
  },
  major: { latin: 'Calibri Light', ea: '', cs: '' },
  minor: { latin: 'Calibri', ea: '', cs: '' },
  fillStyles: [],
  lineStyles: [],
  effectStyles: [],
  backgroundFillStyles: [],
}

/** Placeholders indexed for inheritance lookups. */
export interface PlaceholderIndex {
  byIdx: Map<number, XmlElement>
  byType: Map<string, XmlElement>
}

export interface MasterInfo {
  path: string
  root: XmlElement
  theme: Theme
  colorMap: Record<string, string>
  titleStyle?: XmlElement
  bodyStyle?: XmlElement
  otherStyle?: XmlElement
  placeholders: PlaceholderIndex
  layouts: string[]
}

export interface LayoutInfo {
  path: string
  root: XmlElement
  name: string
  type: string
  master?: MasterInfo
  placeholders: PlaceholderIndex
  /** Layout `clrMapOvr`, when it overrides the master's map. */
  colorMap?: Record<string, string>
  showMasterShapes: boolean
}

export class DeckResources {
  private readonly documents = new Map<string, { bytes: Uint8Array; root: XmlElement | undefined }>()
  private readonly themes = new Map<string, Theme>()
  private readonly masters = new Map<string, MasterInfo>()
  private readonly layouts = new Map<string, LayoutInfo>()

  constructor(
    public parts: Record<string, PartSnapshot>,
    public mainPart: string,
  ) {}

  /** Swaps in a newer part map (after a collaborator or agent changed parts), keeping caches of unchanged parts. */
  update(parts: Record<string, PartSnapshot>, mainPart: string): void {
    if (parts === this.parts && mainPart === this.mainPart) return
    this.parts = parts
    this.mainPart = mainPart
    this.themes.clear()
    this.masters.clear()
    this.layouts.clear()
  }

  /** The root element of an XML part, or undefined when missing or unreadable. */
  xml(partPath: string): XmlElement | undefined {
    const bytes = this.parts[partPath]?.bytes
    if (!bytes) return undefined
    const cached = this.documents.get(partPath)
    if (cached && cached.bytes === bytes) return cached.root
    let root: XmlElement | undefined
    try {
      root = parseXmlDocument(decodePartText(bytes)).documentElement ?? undefined
    } catch {
      root = undefined
    }
    this.documents.set(partPath, { bytes, root })
    return root
  }

  /** Relationships of a raw part, resolved. */
  rels(partPath: string): Map<string, RelTarget> {
    const rels = new Map<string, RelTarget>()
    const root = this.xml(relationshipsPathFor(partPath))
    for (const element of childElements(root)) {
      const id = attr(element, 'Id')
      const type = attr(element, 'Type')
      const target = attr(element, 'Target')
      if (!id || !type || target === undefined) continue
      const external = attr(element, 'TargetMode') === 'External'
      rels.set(id, { type, target: external ? target : resolveTarget(partPath, target), ...(external ? { external: true } : {}) })
    }
    return rels
  }

  related(partPath: string, type: string): string | undefined {
    for (const rel of this.rels(partPath).values()) if (rel.type === type && !rel.external) return rel.target
    return undefined
  }

  defaultTextStyle(): XmlElement | undefined {
    return child(this.xml(this.mainPart), 'defaultTextStyle', NS.p)
  }

  theme(partPath: string | undefined): Theme {
    if (!partPath) return DEFAULT_THEME
    const cached = this.themes.get(partPath)
    if (cached) return cached
    const theme = parseTheme(this.xml(partPath))
    this.themes.set(partPath, theme)
    return theme
  }

  master(partPath: string): MasterInfo | undefined {
    const cached = this.masters.get(partPath)
    if (cached) return cached
    const root = this.xml(partPath)
    if (!root) return undefined
    const txStyles = child(root, 'txStyles', NS.p)
    const info: MasterInfo = {
      path: partPath,
      root,
      theme: this.theme(this.related(partPath, REL_TYPES.theme)),
      colorMap: readColorMap(child(root, 'clrMap', NS.p)) ?? DEFAULT_COLOR_MAP,
      titleStyle: child(txStyles, 'titleStyle', NS.p),
      bodyStyle: child(txStyles, 'bodyStyle', NS.p),
      otherStyle: child(txStyles, 'otherStyle', NS.p),
      placeholders: indexPlaceholders(root),
      layouts: childElements(child(root, 'sldLayoutIdLst', NS.p)).flatMap((entry) => {
        const id = entry.getAttributeNS(NS.r, 'id')
        const rel = id ? this.rels(partPath).get(id) : undefined
        return rel && !rel.external ? [rel.target] : []
      }),
    }
    this.masters.set(partPath, info)
    return info
  }

  layout(partPath: string): LayoutInfo | undefined {
    const cached = this.layouts.get(partPath)
    if (cached) return cached
    const root = this.xml(partPath)
    if (!root) return undefined
    const masterPath = this.related(partPath, REL_TYPES.slideMaster)
    const override = path(root, 'clrMapOvr', 'overrideClrMapping')
    const info: LayoutInfo = {
      path: partPath,
      root,
      name: attr(child(root, 'cSld', NS.p), 'name') ?? '',
      type: attr(root, 'type') ?? 'cust',
      master: masterPath ? this.master(masterPath) : undefined,
      placeholders: indexPlaceholders(root),
      colorMap: override ? readColorMap(override) : undefined,
      showMasterShapes: attr(root, 'showMasterSp') !== '0',
    }
    this.layouts.set(partPath, info)
    return info
  }

  /** Every slide master, in presentation order. */
  masterPaths(): string[] {
    const presentation = this.xml(this.mainPart)
    const rels = this.rels(this.mainPart)
    return childElements(child(presentation, 'sldMasterIdLst', NS.p)).flatMap((entry) => {
      const rel = rels.get(entry.getAttributeNS(NS.r, 'id') ?? '')
      return rel && !rel.external && this.parts[rel.target] ? [rel.target] : []
    })
  }

  /** Table style definitions by style id, from ppt/tableStyles.xml. */
  tableStyle(styleId: string | undefined): XmlElement | undefined {
    if (!styleId) return undefined
    const partPath = this.related(this.mainPart, REL_TYPES.tableStyles)
    const root = partPath ? this.xml(partPath) : undefined
    return childElements(root).find((element) => element.localName === 'tblStyle' && attr(element, 'styleId') === styleId)
  }

  defaultTableStyleId(): string | undefined {
    const partPath = this.related(this.mainPart, REL_TYPES.tableStyles)
    return attr(partPath ? this.xml(partPath) : undefined, 'def')
  }
}

export function readColorMap(element: XmlElement | undefined): Record<string, string> | undefined {
  if (!element) return undefined
  const map: Record<string, string> = {}
  for (const key of Object.keys(DEFAULT_COLOR_MAP)) {
    const value = attr(element, key)
    if (value) map[key] = value
  }
  return { ...DEFAULT_COLOR_MAP, ...map }
}

function parseFont(element: XmlElement | undefined, fallback: FontScheme): FontScheme {
  if (!element) return fallback
  return {
    latin: attr(child(element, 'latin', NS.a), 'typeface') || fallback.latin,
    ea: attr(child(element, 'ea', NS.a), 'typeface') ?? '',
    cs: attr(child(element, 'cs', NS.a), 'typeface') ?? '',
  }
}

export function parseTheme(root: XmlElement | undefined): Theme {
  const elements = child(root, 'themeElements', NS.a)
  if (!elements) return DEFAULT_THEME
  const colors: Record<string, string> = { ...DEFAULT_THEME.colors }
  for (const entry of childElements(child(elements, 'clrScheme', NS.a))) {
    const color = firstColorElement(entry)
    const value = color?.localName === 'sysClr' ? attr(color, 'lastClr') : attr(color, 'val')
    if (entry.localName && value && /^[0-9a-fA-F]{6}$/.test(value)) colors[entry.localName] = value.toUpperCase()
  }
  const fonts = child(elements, 'fontScheme', NS.a)
  const format = child(elements, 'fmtScheme', NS.a)
  return {
    name: attr(root, 'name') ?? '',
    colors,
    major: parseFont(child(fonts, 'majorFont', NS.a), DEFAULT_THEME.major),
    minor: parseFont(child(fonts, 'minorFont', NS.a), DEFAULT_THEME.minor),
    fillStyles: childElements(child(format, 'fillStyleLst', NS.a)),
    lineStyles: childElements(child(format, 'lnStyleLst', NS.a)),
    effectStyles: childElements(child(format, 'effectStyleLst', NS.a)),
    backgroundFillStyles: childElements(child(format, 'bgFillStyleLst', NS.a)),
  }
}

function firstColorElement(element: XmlElement): XmlElement | undefined {
  return childElements(element)[0]
}

/** The `p:ph` of a shape element (p: or dsp: namespace), if it is a placeholder. */
export function placeholderOf(shape: XmlElement): XmlElement | undefined {
  const nv = childElements(shape).find((entry) => entry.localName?.startsWith('nv'))
  return path(nv, 'nvPr', 'ph')
}

export function placeholderType(ph: XmlElement | undefined): string {
  return attr(ph, 'type') ?? 'body'
}

function indexPlaceholders(root: XmlElement): PlaceholderIndex {
  const index: PlaceholderIndex = { byIdx: new Map(), byType: new Map() }
  for (const shape of childElements(path(root, 'cSld', 'spTree'))) {
    const ph = placeholderOf(shape)
    if (!ph) continue
    const idx = attr(ph, 'idx')
    const type = placeholderType(ph)
    if (idx !== undefined && !index.byIdx.has(Number(idx))) index.byIdx.set(Number(idx), shape)
    if (!index.byType.has(type)) index.byType.set(type, shape)
  }
  return index
}

/** Types that inherit from the same master placeholder. */
function masterType(type: string): string {
  if (type === 'ctrTitle') return 'title'
  if (type === 'subTitle' || type === 'obj' || type === 'tbl' || type === 'chart' || type === 'dgm' || type === 'media' || type === 'clipArt' || type === 'pic') return 'body'
  return type
}

/**
 * The placeholder a slide (or layout) placeholder inherits from in `index`: by idx first, as
 * PowerPoint does, then by type.
 */
export function matchPlaceholder(index: PlaceholderIndex, ph: XmlElement, master = false): XmlElement | undefined {
  const type = placeholderType(ph)
  if (master) return index.byType.get(masterType(type)) ?? index.byType.get(type)
  const idx = attr(ph, 'idx')
  if (idx !== undefined) {
    const byIdx = index.byIdx.get(Number(idx))
    if (byIdx) return byIdx
  }
  return index.byType.get(type) ?? (type === 'ctrTitle' ? index.byType.get('title') : undefined) ?? (type === 'title' ? index.byType.get('ctrTitle') : undefined)
}
