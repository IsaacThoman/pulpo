import { insertAll } from '../../collections.js'
import { Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { COPY_RELATIONSHIPS, PRESERVED_IMAGE, PRESERVED_LINK, isPictureReference, relationshipReferences } from './relationships.js'
import { DOCX_MAX_TABLE_DEPTH } from './format.js'
import { LiveFormatError, type LiveAssetStore } from '../live-format.js'
import { OoxmlPackage, relationshipsPathFor, resolveTarget, type Relationship } from '../ooxml/package.js'
import type { ThemeInfo } from './css.js'
import {
  CONTENT_SLOT,
  elementToJml,
  jmlAttr,
  jmlChild,
  jmlElements,
  jmlNumber,
  packJml,
  walkJml,
  type JmlElement,
  type JmlNode,
} from './jsonml.js'
import { emptyMaps, type CommentMeta, type DocxModel, type StoryMeta } from './model.js'
import { CONTENT_TYPE, REL, W_NS } from './names.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_MARK_BY_ELEMENT, docxSchema, packMarks } from './schema.js'

/** Limits that keep hostile documents from exhausting memory or time. */
export const DOCX_LIMITS = {
  /** Most nested tables (tables in cells in tables…). */
  maxTableDepth: DOCX_MAX_TABLE_DEPTH,
  /** Most blocks in one story. */
  maxBlocks: 400_000,
  /** Most columns in one table row (cells, grid columns, and skipped grid columns). */
  maxColumns: 1_000,
  /** Most grid positions in one table (rows × columns), which editors allocate per table. */
  maxTableCells: 250_000,
  /** Largest XML part we parse, in bytes. */
  maxXmlPartBytes: 64 * 1024 * 1024,
}

const STRICT_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main'

const MAIN_CONTENT_TYPES = new Set<string>([CONTENT_TYPE.document, CONTENT_TYPE.template, CONTENT_TYPE.macroDocument, CONTENT_TYPE.macroTemplate])

export const PARAGRAPH_ATTR_BY_ELEMENT: Record<string, string> = Object.fromEntries(
  Object.entries(PARAGRAPH_PROPERTY_ATTRS).map(([attr, element]) => [element, attr]),
)

/** Inline elements that wrap runs and become wrapper marks. */
const WRAPPER_ELEMENTS: Record<string, string> = {
  'w:hyperlink': 'link',
  'w:sdt': 'sdt',
  'w:fldSimple': 'fldSimple',
  'w:smartTag': 'wrap',
  'w:customXml': 'wrap',
  'w:dir': 'wrap',
  'w:bdo': 'wrap',
  'w:moveFrom': 'moveFrom',
  'w:moveTo': 'moveTo',
  'w:ins': 'ins',
  'w:del': 'del',
}

/** Wrapper children that are properties, not content, and stay in the wrapper's JsonML. */
const WRAPPER_PROPERTY_CHILDREN = new Set(['w:sdtPr', 'w:sdtEndPr', 'w:smartTagPr', 'w:customXmlPr'])

/** Hints Word rewrites on every save; keeping them would tie runs together for nothing. */
const DROPPED_ELEMENTS = new Set(['w:lastRenderedPageBreak', 'w:proofErr'])

const BLOCK_MARKERS = new Set([
  'w:bookmarkStart', 'w:bookmarkEnd', 'w:commentRangeStart', 'w:commentRangeEnd', 'w:permStart', 'w:permEnd',
  'w:moveFromRangeStart', 'w:moveFromRangeEnd', 'w:moveToRangeStart', 'w:moveToRangeEnd',
  'w:customXmlInsRangeStart', 'w:customXmlInsRangeEnd', 'w:customXmlDelRangeStart', 'w:customXmlDelRangeEnd',
  'w:customXmlMoveFromRangeStart', 'w:customXmlMoveFromRangeEnd', 'w:customXmlMoveToRangeStart', 'w:customXmlMoveToRangeEnd',
])

export function mimeTypeForPart(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (extension) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'tif':
    case 'tiff': return 'image/tiff'
    case 'svg': return 'image/svg+xml'
    case 'emf': return 'image/x-emf'
    case 'wmf': return 'image/x-wmf'
    case 'webp': return 'image/webp'
    case 'xml':
    case 'rels': return 'application/xml'
    default: return 'application/octet-stream'
  }
}

/** Per-part state while converting one story. */
interface PartContext {
  pkg: OoxmlPackage
  part: string
  rels: Map<string, Relationship>
  /** Asset hash of every part, by path. */
  hashes: Map<string, string>
  blocks: number
}

function readXml(pkg: OoxmlPackage, path: string): JmlElement | undefined {
  const bytes = pkg.get(path)
  if (!bytes) return undefined
  if (bytes.byteLength > DOCX_LIMITS.maxXmlPartBytes) throw new LiveFormatError('too_large', `${path} is too large to edit`)
  const text = pkg.text(path) ?? ''
  // OOXML never declares a DTD; refusing one rules out entity tricks outright.
  if (/<!DOCTYPE/i.test(text.slice(0, 4096))) throw new LiveFormatError('corrupt', `${path} declares a DTD`)
  const document = pkg.xml(path)
  const root = document?.documentElement
  if (!root) return undefined
  const value = elementToJml(root)
  // A file cannot forge the private relationship metadata used by our clipboard.
  walkJml(value, (child) => { delete child[1][COPY_RELATIONSHIPS]; delete child[1][PRESERVED_IMAGE]; delete child[1][PRESERVED_LINK] })
  return value
}

function relationshipMap(pkg: OoxmlPackage, part: string): Map<string, Relationship> {
  return new Map(pkg.relationships(part).map((rel) => [rel.id, rel]))
}

/** The asset hash of the image a drawing or VML object shows, if its part is in the package. */
function imageHash(element: JmlElement, context: PartContext): string | null {
  for (const ref of relationshipReferences(element).filter(isPictureReference)) {
    if (ref.src && /^[0-9a-f]{64}$/.test(ref.src)) return ref.src
    const rel = context.rels.get(ref.id)
    if (!rel || rel.type !== REL.image || rel.targetMode === 'External') continue
    const hash = context.hashes.get(resolveTarget(context.part, rel.target))
    if (hash) return hash
  }
  return null
}

/** A wrapper element's JsonML with its content replaced by CONTENT_SLOT. */
function wrapperShell(element: JmlElement): { shell: JmlElement; content: JmlNode[] } {
  const [name, attrs] = element
  if (name === 'w:sdt') {
    const shell: JmlElement = [name, attrs]
    let content: JmlNode[] = []
    for (const child of jmlElements(element)) {
      if (child[0] === 'w:sdtContent') {
        shell.push([child[0], child[1], CONTENT_SLOT])
        content = child.slice(2) as JmlNode[]
      } else {
        shell.push(child)
      }
    }
    if (!shell.some((child, index) => index >= 2 && Array.isArray(child) && child[0] === 'w:sdtContent')) shell.push(['w:sdtContent', {}, CONTENT_SLOT])
    return { shell, content }
  }
  const shell: JmlElement = [name, attrs]
  const content: JmlNode[] = []
  for (const child of element.slice(2) as JmlNode[]) {
    if (Array.isArray(child) && WRAPPER_PROPERTY_CHILDREN.has(child[0])) shell.push(child)
    else content.push(child)
  }
  shell.push(CONTENT_SLOT)
  return { shell, content }
}

/** Puts `inner` where `outer` has its content slot. */
function nestShell(outer: JmlElement, inner: JmlElement): JmlElement {
  return [outer[0], outer[1], ...(outer.slice(2) as JmlNode[]).map((child) => child === CONTENT_SLOT ? inner : Array.isArray(child) ? nestShell(child, inner) : child)]
}

/**
 * Finds `name` elements (rows or cells) inside content controls and custom XML, however deeply
 * nested, handing each one with the wrappers around it as one shell.
 */
function unwrap(element: JmlElement, name: string, found: (element: JmlElement, shell: JmlElement) => void, other: (element: JmlElement) => void, depth = 0): void {
  if (depth > 32) throw new LiveFormatError('corrupt', 'This document nests content controls too deeply')
  const { shell, content } = wrapperShell(element)
  for (const child of content) {
    if (!Array.isArray(child)) continue
    if (child[0] === name) found(child, shell)
    else if (child[0] === 'w:sdt' || child[0] === 'w:customXml') unwrap(child, name, (inner, innerShell) => found(inner, nestShell(shell, innerShell)), other, depth + 1)
    // Markers beside the rows or cells inside a wrapper move out in front of it.
    else other(child)
  }
}

function runMarks(rPr: JmlElement | undefined): readonly Mark[] {
  const schema = docxSchema()
  let marks: readonly Mark[] = Mark.none
  if (!rPr) return marks
  const rest: JmlElement[] = []
  for (const child of jmlElements(rPr)) {
    const markName = RUN_MARK_BY_ELEMENT[child[0]]
    if (markName) marks = schema.mark(markName, { v: packJml(child) }).addToSet(marks)
    else if (child[0] === 'w:rPrChange') marks = schema.mark('rPrChange', { v: packJml(child) }).addToSet(marks)
    else rest.push(child)
  }
  if (rest.length) marks = schema.mark('rPrRest', { v: packJml(rest) }).addToSet(marks)
  return marks
}

function containsDrawing(element: JmlElement): boolean {
  let found = false
  walkJml(element, (child) => {
    if (child[0] === 'w:drawing' || child[0] === 'w:pict' || child[0] === 'w:object') found = true
    return !found
  })
  return found
}

class InlineBuilder {
  readonly nodes: ProseMirrorNode[] = []
  private readonly schema = docxSchema()

  constructor(private readonly context: PartContext) {}

  private push(node: ProseMirrorNode, marks: readonly Mark[]) {
    this.nodes.push(node.mark(marks))
  }

  private atom(type: string, attrs: Record<string, unknown>, marks: readonly Mark[]) {
    this.nodes.push(this.schema.node(type, { ...attrs, marks: packMarks(marks) }))
  }

  /** Inline content of a paragraph or wrapper, under `wrappers`. */
  content(children: JmlNode[], wrappers: readonly Mark[]): void {
    for (const child of children) {
      if (typeof child === 'string') continue
      this.element(child, wrappers)
    }
  }

  private element(element: JmlElement, wrappers: readonly Mark[]): void {
    const name = element[0]
    if (name === 'w:r') return this.run(element, wrappers)
    if (DROPPED_ELEMENTS.has(name) || name === 'w:pPr') return
    const wrapperMark = WRAPPER_ELEMENTS[name]
    if (wrapperMark) {
      const { shell, content } = wrapperShell(element)
      const before = this.nodes.length
      const attrs: Record<string, unknown> = { v: packJml(shell) }
      if (wrapperMark === 'link') {
        const relId = jmlAttr(element, 'r:id')
        const rel = relId ? this.context.rels.get(relId) : undefined
        attrs.href = jmlAttr(element, PRESERVED_LINK) ?? rel?.target ?? null
      }
      if (wrapperMark === 'wrap' || wrapperMark === 'sdt') attrs.level = wrappers.filter((mark) => mark.type.name === wrapperMark).length
      this.content(content, this.schema.mark(wrapperMark, attrs).addToSet(wrappers))
      // An empty wrapper (a bookmark-less hyperlink, an empty revision) is kept whole.
      if (this.nodes.length === before) this.atom('inlineXml', { v: packJml(element), inRun: false }, wrappers)
      return
    }
    switch (name) {
      case 'w:bookmarkStart':
      case 'w:bookmarkEnd':
        return this.atom('bookmark', { v: packJml(element), edge: name.endsWith('Start') ? 'start' : 'end', id: jmlAttr(element, 'w:id') ?? null, name: jmlAttr(element, 'w:name') ?? null }, wrappers)
      case 'w:commentRangeStart':
      case 'w:commentRangeEnd':
        return this.atom('commentMark', { v: packJml(element), edge: name.endsWith('Start') ? 'start' : 'end', id: jmlAttr(element, 'w:id') ?? null }, wrappers)
      case 'm:oMath':
      case 'm:oMathPara':
        return this.atom('math', { v: packJml(element) }, wrappers)
      default:
        return this.atom('inlineXml', { v: packJml(element), inRun: false }, wrappers)
    }
  }

  private run(run: JmlElement, wrappers: readonly Mark[]): void {
    const rPr = jmlChild(run, 'w:rPr')
    let marks = wrappers
    for (const mark of runMarks(rPr)) marks = mark.addToSet(marks)
    for (const child of jmlElements(run)) {
      const name = child[0]
      if (name === 'w:rPr' || DROPPED_ELEMENTS.has(name)) continue
      const v = packJml(child)
      switch (name) {
        case 'w:t':
        case 'w:delText': {
          const text = (child.slice(2) as JmlNode[]).filter((part): part is string => typeof part === 'string').join('')
          // Word treats a tab character in text as a tab.
          text.split('\t').forEach((part, index) => {
            if (index > 0) this.atom('tab', { v: packJml(['w:tab', {}]) }, marks)
            if (part) this.push(this.schema.text(part), marks)
          })
          break
        }
        case 'w:tab':
          this.atom('tab', { v }, marks)
          break
        case 'w:br':
          this.atom('break', { v, type: jmlAttr(child, 'w:type') ?? 'textWrapping' }, marks)
          break
        case 'w:cr':
          this.atom('break', { v, type: 'textWrapping' }, marks)
          break
        case 'w:drawing':
        case 'w:pict':
        case 'w:object':
          this.atom('drawing', { v, src: imageHash(child, this.context) }, marks)
          break
        case 'mc:AlternateContent':
          if (containsDrawing(child)) this.atom('drawing', { v, src: imageHash(child, this.context) }, marks)
          else this.atom('inlineXml', { v, inRun: true }, marks)
          break
        case 'w:footnoteReference':
        case 'w:endnoteReference':
          this.atom('noteRef', { v, kind: name === 'w:footnoteReference' ? 'footnote' : 'endnote', id: jmlAttr(child, 'w:id') ?? null }, marks)
          break
        case 'w:commentReference':
          this.atom('commentMark', { v, edge: 'ref', id: jmlAttr(child, 'w:id') ?? null }, marks)
          break
        case 'w:fldChar':
          this.atom('fieldChar', { v, charType: jmlAttr(child, 'w:fldCharType') ?? 'begin' }, marks)
          break
        case 'w:instrText':
        case 'w:delInstrText':
          this.atom('fieldCode', { v }, marks)
          break
        case 'w:sym':
          this.atom('sym', { v }, marks)
          break
        default:
          this.atom('inlineXml', { v, inRun: true }, marks)
      }
    }
  }
}

/** Rehydrate preserved table continuations through the same lossless block importer. */
export function preservedBlocks(children: JmlNode[]): ProseMirrorNode[] {
  return new BlockBuilder({ pkg: new OoxmlPackage(new Map()), part: '', rels: new Map(), hashes: new Map(), blocks: 0 }).blocks(children, 0)
}

function attrsOrNull(attrs: Record<string, string>): string | null {
  return Object.keys(attrs).length ? JSON.stringify(attrs) : null
}

class BlockBuilder {
  private readonly schema = docxSchema()

  constructor(private readonly context: PartContext) {}

  /** Blocks of a body, cell, or story; leaves trailing markers in `trail`. */
  blocks(children: JmlNode[], tableDepth: number, sectPrOut?: { sectPr?: JmlElement; trail?: JmlElement[] }): ProseMirrorNode[] {
    const blocks: ProseMirrorNode[] = []
    let lead: JmlElement[] = []
    const withLead = (node: ProseMirrorNode) => {
      if (!lead.length) return node
      const attrs = { ...node.attrs, lead: packJml(lead) }
      lead = []
      return node.type.create(attrs, node.content, node.marks)
    }
    for (const child of children) {
      if (typeof child === 'string') continue
      if (++this.context.blocks > DOCX_LIMITS.maxBlocks) throw new LiveFormatError('too_large', 'This document has too many paragraphs to edit')
      const name = child[0]
      if (name === 'w:sectPr' && sectPrOut) {
        sectPrOut.sectPr = child
        continue
      }
      if (DROPPED_ELEMENTS.has(name)) continue
      if (BLOCK_MARKERS.has(name)) {
        lead.push(child)
        continue
      }
      let block: ProseMirrorNode
      if (name === 'w:p') block = this.paragraph(child)
      else if (name === 'w:tbl') block = this.table(child, tableDepth + 1)
      else if (name === 'w:sdt' || name === 'w:customXml') {
        const { shell, content } = wrapperShell(child)
        const inner = this.blocks(content, tableDepth)
        block = inner.length
          ? this.schema.node('blockWrapper', { v: packJml(shell) }, inner)
          : this.schema.node('blockXml', { v: packJml(child) })
      } else {
        block = this.schema.node('blockXml', { v: packJml(child) })
      }
      blocks.push(withLead(block))
    }
    if (lead.length) {
      const last = blocks.pop()
      if (last) blocks.push(last.type.create({ ...last.attrs, trail: packJml(lead) }, last.content, last.marks))
      else if (sectPrOut) sectPrOut.trail = lead
      else blocks.push(this.schema.node('paragraph', { trail: packJml(lead) }))
    }
    return blocks
  }

  paragraph(element: JmlElement): ProseMirrorNode {
    const attrs: Record<string, unknown> = { xmlAttrs: attrsOrNull(element[1]) }
    const pPr = jmlChild(element, 'w:pPr')
    if (pPr) {
      const rest: JmlElement[] = []
      for (const child of jmlElements(pPr)) {
        const name = child[0]
        const attr = PARAGRAPH_ATTR_BY_ELEMENT[name]
        if (name === 'w:pStyle') attrs.pStyle = jmlAttr(child, 'w:val') ?? null
        else if (attr) attrs[attr] = packJml(child)
        else if (name === 'w:rPr') attrs.markRPr = packJml(child)
        else if (name === 'w:sectPr') attrs.sectPr = packJml(child)
        else if (name === 'w:pPrChange') attrs.pPrChange = packJml(child)
        else rest.push(child)
      }
      if (rest.length) attrs.pPrRest = packJml(rest)
    }
    const inline = new InlineBuilder(this.context)
    inline.content(element.slice(2) as JmlNode[], Mark.none)
    return this.schema.node('paragraph', attrs, inline.nodes)
  }

  table(element: JmlElement, depth: number): ProseMirrorNode {
    if (depth > DOCX_LIMITS.maxTableDepth) throw new LiveFormatError('corrupt', 'This document nests tables too deeply')
    const tblPr = jmlChild(element, 'w:tblPr')
    const tblGrid = jmlChild(element, 'w:tblGrid')
    const gridCount = tblGrid ? jmlElements(tblGrid).filter((col) => col[0] === 'w:gridCol').length : 0
    const tooWide = () => new LiveFormatError('too_large', 'This table has too many columns')
    if (gridCount > DOCX_LIMITS.maxColumns) throw tooWide()
    interface RawCell { tc: JmlElement; col: number; span: number; vMerge?: string; wrap?: string; lead: JmlElement[] }
    interface RawRow { tr: JmlElement; cells: RawCell[]; before: number; after: number; wrap?: string; lead: JmlElement[]; cellTrail: JmlElement[] }
    const rows: RawRow[] = []
    let pendingLead: JmlElement[] = []
    const addRow = (tr: JmlElement, wrap?: string) => {
      const trPr = jmlChild(tr, 'w:trPr')
      const before = Math.max(0, jmlNumber(jmlChild(trPr, 'w:gridBefore'), 'w:val') ?? 0)
      const after = Math.max(0, jmlNumber(jmlChild(trPr, 'w:gridAfter'), 'w:val') ?? 0)
      if (before > DOCX_LIMITS.maxColumns || after > DOCX_LIMITS.maxColumns) throw tooWide()
      const cells: RawCell[] = []
      // Bookmarks, empty content controls, and the like between cells ride on the next cell.
      let cellLead: JmlElement[] = []
      let col = before
      const addCell = (tc: JmlElement, cellWrap?: string) => {
        const tcPr = jmlChild(tc, 'w:tcPr')
        const span = Math.max(1, Math.min(DOCX_LIMITS.maxColumns, jmlNumber(jmlChild(tcPr, 'w:gridSpan'), 'w:val') ?? 1))
        const vMergeElement = jmlChild(tcPr, 'w:vMerge')
        cells.push({ tc, col, span, vMerge: vMergeElement ? (jmlAttr(vMergeElement, 'w:val') ?? 'continue') : undefined, wrap: cellWrap, lead: cellLead })
        cellLead = []
        col += span
        if (col > DOCX_LIMITS.maxColumns) throw tooWide()
      }
      for (const child of jmlElements(tr)) {
        if (child[0] === 'w:tc') addCell(child)
        else if (child[0] === 'w:sdt' || child[0] === 'w:customXml') {
          const count = cells.length
          const before = cellLead.length
          const outside: JmlElement[] = []
          unwrap(child, 'w:tc', (tc, shell) => addCell(tc, packJml(shell)), (extra) => outside.push(extra))
          // A wrapper without cells stays whole; otherwise its loose markers go before its first cell.
          if (cells.length === count) cellLead.push(child)
          else if (outside.length) insertAll(cells[count]!.lead, before, outside)
        } else if (child[0] !== 'w:trPr' && child[0] !== 'w:tblPrEx') cellLead.push(child)
      }
      if (col + after > DOCX_LIMITS.maxColumns) throw tooWide()
      rows.push({ tr, cells, before, after, wrap, lead: pendingLead, cellTrail: cellLead })
      pendingLead = []
    }
    for (const child of jmlElements(element)) {
      if (child[0] === 'w:tr') addRow(child)
      else if (child[0] === 'w:sdt' || child[0] === 'w:customXml') {
        const count = rows.length
        const outside: JmlElement[] = []
        unwrap(child, 'w:tr', (tr, shell) => addRow(tr, packJml(shell)), (extra) => outside.push(extra))
        if (rows.length === count) pendingLead.push(child)
        else insertAll(rows[count]!.lead, 0, outside)
      }
      else if (BLOCK_MARKERS.has(child[0])) pendingLead.push(child)
    }
    let width = gridCount
    for (const row of rows) {
      const last = row.cells.at(-1)
      width = Math.max(width, (last ? last.col + last.span : row.before) + row.after)
    }
    if (width * Math.max(1, rows.length) > DOCX_LIMITS.maxTableCells) throw new LiveFormatError('too_large', 'This table is too large')

    // Vertical merges become rowspans, as prosemirror-tables models them, when every row keeps a
    // cell of its own; otherwise the table keeps its continuation cells as they are.
    const merged = new Set<RawCell>()
    const continuations = new Map<RawCell, JmlElement[]>()
    const rowSpans = new Map<RawCell, number>()
    const open = new Map<number, RawCell>()
    for (const row of rows) {
      const seen = new Set<number>()
      for (const cell of row.cells) {
        seen.add(cell.col)
        const above = open.get(cell.col)
        if (cell.vMerge === 'continue' && above && above.span === cell.span && !cell.wrap && !above.wrap) {
          merged.add(cell)
          continuations.get(above)!.push(cell.tc)
          rowSpans.set(above, rowSpans.get(above)! + 1)
          continue
        }
        if (cell.vMerge === 'restart') {
          open.set(cell.col, cell)
          continuations.set(cell, [])
          rowSpans.set(cell, 1)
        } else {
          open.delete(cell.col)
        }
      }
      for (const col of [...open.keys()]) if (!seen.has(col)) open.delete(col)
    }

    // Columns each row has covered by rowspans that start above it.
    const covered = rows.map(() => 0)
    rows.forEach((row, index) => {
      for (const cell of row.cells) {
        const span = rowSpans.get(cell)
        if (span) for (let below = index + 1; below < index + span && below < rows.length; below++) covered[below]! += cell.span
      }
    })

    const rowNodes = rows.map((row, index) => {
      const cellNodes: ProseMirrorNode[] = []
      const phantom = (kind: string, span: number) => this.schema.node('tableCell', { phantom: kind, colspan: span }, [this.schema.node('paragraph')])
      let own = 0
      if (row.before > 0) {
        cellNodes.push(phantom('before', row.before))
        own += row.before
      }
      for (const cell of row.cells) {
        if (merged.has(cell)) continue
        own += cell.span
        const tcPr = jmlChild(cell.tc, 'w:tcPr')
        const keptTcPr = tcPr ? ([tcPr[0], tcPr[1], ...jmlElements(tcPr).filter((child) => child[0] !== 'w:gridSpan' && !(child[0] === 'w:vMerge' && rowSpans.has(cell)))] as JmlElement) : undefined
        const content = this.blocks(cell.tc.slice(2).filter((child) => !(Array.isArray(child) && child[0] === 'w:tcPr')) as JmlNode[], depth)
        const extra = continuations.get(cell)
        cellNodes.push(this.schema.node('tableCell', {
          colspan: cell.span,
          rowspan: rowSpans.get(cell) ?? 1,
          tcPr: keptTcPr ? packJml(keptTcPr) : null,
          vMergeCells: extra?.length ? packJml(extra) : null,
          xmlAttrs: attrsOrNull(cell.tc[1]),
          wrap: cell.wrap ?? null,
          lead: cell.lead.length ? packJml(cell.lead) : null,
        }, content.length ? content : [this.schema.node('paragraph')]))
      }
      if (row.after > 0) {
        cellNodes.push(phantom('after', row.after))
        own += row.after
      }
      // Rows short of the grid are padded so prosemirror-tables sees a rectangle.
      const missing = width - own - covered[index]!
      if (missing > 0 || (!cellNodes.length && !covered[index])) cellNodes.push(phantom('pad', Math.max(1, missing)))
      const trPr = jmlChild(row.tr, 'w:trPr')
      const tblPrEx = jmlChild(row.tr, 'w:tblPrEx')
      return this.schema.node('tableRow', {
        trPr: trPr ? packJml(trPr) : null,
        tblPrEx: tblPrEx ? packJml(tblPrEx) : null,
        xmlAttrs: attrsOrNull(row.tr[1]),
        wrap: row.wrap ?? null,
        lead: row.lead.length ? packJml(row.lead) : null,
        cellTrail: row.cellTrail.length ? packJml(row.cellTrail) : null,
      }, cellNodes)
    })
    const trailing = pendingLead
    return this.schema.node('table', {
      tblPr: tblPr ? packJml(tblPr) : null,
      tblGrid: tblGrid ? packJml(tblGrid) : null,
      xmlAttrs: attrsOrNull(element[1]),
      rowTrail: trailing.length ? packJml(trailing) : null,
    }, rowNodes)
  }

}

function readTheme(pkg: OoxmlPackage, main: string): ThemeInfo | undefined {
  const path = pkg.relatedParts(main, REL.theme)[0]
  if (!path) return undefined
  const theme = readXml(pkg, path)
  if (!theme) return undefined
  const info: ThemeInfo = { colors: {}, fonts: {} }
  walkJml(theme, (element) => {
    if (element[0] === 'a:clrScheme') {
      for (const color of jmlElements(element)) {
        const key = color[0].slice(2)
        const srgb = jmlChild(color, 'a:srgbClr')
        const sys = jmlChild(color, 'a:sysClr')
        const value = jmlAttr(srgb, 'val') ?? jmlAttr(sys, 'lastClr')
        if (value && /^[0-9a-fA-F]{6}$/.test(value)) info.colors[key] = `#${value.toLowerCase()}`
      }
      return false
    }
    if (element[0] === 'a:majorFont' || element[0] === 'a:minorFont') {
      const major = element[0] === 'a:majorFont'
      const latin = jmlAttr(jmlChild(element, 'a:latin'), 'typeface')
      const ea = jmlAttr(jmlChild(element, 'a:ea'), 'typeface')
      const cs = jmlAttr(jmlChild(element, 'a:cs'), 'typeface')
      if (latin) info.fonts[major ? 'major' : 'minor'] = latin
      if (ea) info.fonts[major ? 'majorEastAsia' : 'minorEastAsia'] = ea
      if (cs) info.fonts[major ? 'majorCs' : 'minorCs'] = cs
      return false
    }
    return undefined
  })
  return info
}

/** Reads `bytes` into a model; every part's bytes go to `assets`. */
export async function importDocx(bytes: Uint8Array, assets: LiveAssetStore): Promise<DocxModel> {
  const pkg = OoxmlPackage.read(bytes)
  const main = pkg.mainPart()
  if (!main || !pkg.has(main)) throw new LiveFormatError('corrupt', 'This package has no main document')
  const contentType = pkg.contentType(main)
  if (!contentType || !MAIN_CONTENT_TYPES.has(contentType)) throw new LiveFormatError('corrupt', 'This package is not a Word document')

  const maps = emptyMaps()
  const hashes = new Map<string, string>()
  for (const path of pkg.paths()) {
    const data = pkg.get(path)!
    const ref = await assets.put(data, mimeTypeForPart(path))
    hashes.set(path, ref.hash)
    maps.parts.set(path, JSON.stringify({ hash: ref.hash, size: ref.sizeBytes }))
  }

  const documentElement = readXml(pkg, main)
  if (!documentElement) throw new LiveFormatError('corrupt', 'The main document is empty')
  const namespace = documentElement[1]['xmlns:w']
  if (namespace === STRICT_NS) throw new LiveFormatError('unsupported', 'Strict Open XML documents are not supported yet')
  if (documentElement[0] !== 'w:document' || namespace !== W_NS) throw new LiveFormatError('corrupt', 'The main document is not WordprocessingML')

  const context = (part: string): PartContext => ({ pkg, part, rels: relationshipMap(pkg, part), hashes, blocks: 0 })
  const mainContext = context(main)
  const builder = new BlockBuilder(mainContext)
  const meta = maps.docx
  meta.set('mainPart', main)
  meta.set('documentAttrs', JSON.stringify(documentElement[1]))
  const body = jmlChild(documentElement, 'w:body')
  // Anything beside the body (a background before it, a stray second body after it) stays put.
  const documentChildren = jmlElements(documentElement)
  const bodyIndex = body ? documentChildren.indexOf(body) : documentChildren.length
  const extra = documentChildren.slice(0, bodyIndex)
  const tail = documentChildren.slice(bodyIndex + 1)
  if (extra.length) meta.set('documentExtra', packJml(extra))
  if (tail.length) meta.set('documentTail', packJml(tail))
  if (body && Object.keys(body[1]).length) meta.set('bodyAttrs', JSON.stringify(body[1]))
  const sectOut: { sectPr?: JmlElement; trail?: JmlElement[] } = {}
  const blocks = builder.blocks(body ? (body.slice(2) as JmlNode[]) : [], 0, sectOut)
  const schema = docxSchema()
  if (!blocks.length) {
    blocks.push(schema.node('paragraph'))
    meta.set('emptyBody', '1')
  }
  if (sectOut.sectPr) meta.set('sectPr', packJml(sectOut.sectPr))
  if (sectOut.trail?.length) meta.set('bodyTrail', packJml(sectOut.trail))
  const theme = readTheme(pkg, main)
  if (theme) meta.set('theme', JSON.stringify(theme))

  for (const rel of mainContext.rels.values()) {
    maps.rels.set(rel.id, JSON.stringify({ type: rel.type, target: rel.target, ...(rel.targetMode ? { targetMode: rel.targetMode } : {}) }))
  }

  const stories: DocxModel['stories'] = new Map()
  const storyDoc = (part: string, children: JmlNode[]) => {
    const storyBlocks = new BlockBuilder(context(part)).blocks(children, 0)
    return schema.node('doc', null, storyBlocks.length ? storyBlocks : [schema.node('paragraph')])
  }

  // Headers and footers.
  for (const rel of mainContext.rels.values()) {
    if (rel.targetMode === 'External' || (rel.type !== REL.header && rel.type !== REL.footer)) continue
    const part = resolveTarget(main, rel.target)
    const root = readXml(pkg, part)
    if (!root) continue
    const kind: StoryMeta['kind'] = rel.type === REL.header ? 'header' : 'footer'
    const id = `${kind}:${part}`
    if (stories.has(id)) continue
    const empty = !jmlElements(root).length
    stories.set(id, { meta: { kind, part, attrs: root[1], ...(empty ? { empty } : {}) }, doc: storyDoc(part, root.slice(2) as JmlNode[]) })
  }

  // Footnotes and endnotes.
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = pkg.relatedParts(main, kind === 'footnote' ? REL.footnotes : REL.endnotes)[0]
    if (!part) continue
    const root = readXml(pkg, part)
    if (!root) continue
    meta.set(`root:${kind}s`, JSON.stringify(root[1]))
    for (const note of jmlElements(root)) {
      if (note[0] !== `w:${kind}`) continue
      const id = jmlAttr(note, 'w:id')
      if (id === undefined) continue
      stories.set(`${kind}:${id}`, { meta: { kind, attrs: note[1] }, doc: storyDoc(part, note.slice(2) as JmlNode[]) })
    }
  }

  // Comments, with replies and resolution from commentsExtended.
  const commentsPart = pkg.relatedParts(main, REL.comments)[0]
  if (commentsPart) {
    const root = readXml(pkg, commentsPart)
    const extendedPart = pkg.relatedParts(main, REL.commentsExtended)[0]
    const extended = extendedPart ? readXml(pkg, extendedPart) : undefined
    const byParaId = new Map<string, JmlElement>()
    if (extended) for (const entry of jmlElements(extended)) {
      const paraId = jmlAttr(entry, 'w15:paraId')
      if (paraId) byParaId.set(paraId.toUpperCase(), entry)
    }
    const commentByParaId = new Map<string, string>()
    const pending: { id: string; meta: CommentMeta; parentParaId?: string }[] = []
    if (root) {
      meta.set('root:comments', JSON.stringify(root[1]))
      for (const comment of jmlElements(root)) {
        if (comment[0] !== 'w:comment') continue
        const id = jmlAttr(comment, 'w:id')
        if (id === undefined) continue
        const { 'w:id': _id, 'w:author': author, 'w:initials': initials, 'w:date': date, ...rest } = comment[1]
        const commentMeta: CommentMeta = { author, initials, date, ...(Object.keys(rest).length ? { attrs: rest } : {}) }
        const paragraphs = jmlElements(comment).filter((child) => child[0] === 'w:p')
        const lastParaId = jmlAttr(paragraphs.at(-1), 'w14:paraId')?.toUpperCase()
        let parentParaId: string | undefined
        if (lastParaId) {
          commentByParaId.set(lastParaId, id)
          const entry = byParaId.get(lastParaId)
          if (entry) {
            if (jmlAttr(entry, 'w15:done') === '1') commentMeta.done = true
            parentParaId = jmlAttr(entry, 'w15:paraIdParent')?.toUpperCase()
          }
        }
        pending.push({ id, meta: commentMeta, parentParaId })
        stories.set(`comment:${id}`, { meta: { kind: 'comment' }, doc: storyDoc(commentsPart, comment.slice(2) as JmlNode[]) })
      }
    }
    for (const entry of pending) {
      if (entry.parentParaId) {
        const parentId = commentByParaId.get(entry.parentParaId)
        if (parentId !== undefined && parentId !== entry.id) entry.meta.parentId = parentId
      }
      maps.comments.set(entry.id, JSON.stringify(entry.meta))
    }
  }

  // Styles.
  const stylesPart = pkg.relatedParts(main, REL.styles)[0]
  const styles = stylesPart ? readXml(pkg, stylesPart) : undefined
  if (styles) {
    for (const child of jmlElements(styles)) {
      if (child[0] === 'w:style') {
        const id = jmlAttr(child, 'w:styleId')
        if (id !== undefined && !maps.styles.has(`style:${id}`)) maps.styles.set(`style:${id}`, packJml(child))
      } else if (child[0] === 'w:docDefaults') maps.styles.set('docDefaults', packJml(child))
      else if (child[0] === 'w:latentStyles') maps.styles.set('latentStyles', packJml(child))
    }
  }

  // Numbering.
  const numberingPart = pkg.relatedParts(main, REL.numbering)[0]
  const numbering = numberingPart ? readXml(pkg, numberingPart) : undefined
  if (numbering) {
    for (const child of jmlElements(numbering)) {
      if (child[0] === 'w:abstractNum') {
        const id = jmlAttr(child, 'w:abstractNumId')
        if (id !== undefined) maps.numbering.set(`abstract:${id}`, packJml(child))
      } else if (child[0] === 'w:num') {
        const id = jmlAttr(child, 'w:numId')
        if (id !== undefined) maps.numbering.set(`num:${id}`, packJml(child))
      } else if (child[0] === 'w:numPicBullet') {
        const id = jmlAttr(child, 'w:numPicBulletId')
        if (id !== undefined) maps.numbering.set(`picBullet:${id}`, packJml(child))
      }
    }
  }

  // Settings Pulpo reads or writes.
  const settingsPart = pkg.relatedParts(main, REL.settings)[0]
  const settings = settingsPart ? readXml(pkg, settingsPart) : undefined
  for (const name of MODELED_SETTINGS) maps.settings.set(name, '')
  if (settings) {
    for (const child of jmlElements(settings)) {
      if ((MODELED_SETTINGS as readonly string[]).includes(child[0])) maps.settings.set(child[0], packJml(child))
    }
  }

  return { body: schema.node('doc', null, blocks), stories, maps }
}

/** `w:settings` children the model reads (layout) or writes (track changes). */
export const MODELED_SETTINGS = ['w:trackRevisions', 'w:evenAndOddHeaders', 'w:defaultTabStop', 'w:updateFields', 'w:mirrorMargins', 'w:gutterAtTop', 'w:footnotePr', 'w:endnotePr'] as const

export { relationshipsPathFor }
