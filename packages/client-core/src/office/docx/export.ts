import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { strToU8 } from 'fflate'
import { LiveFormatError, type LiveAssetStore } from '../live-format.js'
import { CONTENT_TYPES_PATH, OoxmlPackage, relativeTarget, relationshipsPathFor, resolveTarget } from '../ooxml/package.js'
import { elementToJml, jmlAttr, jmlChild, jmlElements, jmlToXml, openTag, packJml, unpackJml, walkJml, type JmlElement, type JmlNode } from './jsonml.js'
import { mimeTypeForPart } from './import.js'
import { parseJson, type CommentMeta, type DocxModel, type PartRef, type StoryMeta } from './model.js'
import {
  CONTENT_TYPE,
  KNOWN_NAMESPACES,
  NEW_PART_NAMESPACES,
  PPR_ORDER,
  REL,
  RPR_ORDER,
  SETTINGS_ORDER,
  TCPR_ORDER,
  TRPR_ORDER,
  sortByOrder,
} from './names.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_PROPERTY_MARKS, WRAPPER_MARKS, inlineMarks, type ParagraphPropertyAttr } from './schema.js'

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

const WRAPPER_MARK_NAMES = new Set<string>(Object.keys(WRAPPER_MARKS))
const RUN_MARK_NAMES = new Set<string>([...Object.keys(RUN_PROPERTY_MARKS), 'rPrRest', 'rPrChange'])
const RUN_LEVEL_NODES = new Set(['text', 'tab', 'break', 'drawing', 'noteRef', 'fieldChar', 'fieldCode', 'sym'])

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

function jmlList(value: unknown): JmlElement[] {
  return typeof value === 'string' ? unpackJml<JmlElement[]>(value) ?? [] : []
}

function attrsOf(value: unknown): Record<string, string> | undefined {
  return typeof value === 'string' ? parseJson<Record<string, string>>(value) : undefined
}

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const data = typeof text === 'string' ? strToU8(text) : text
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Detects an image format from its leading bytes, for images inserted in the editor. */
export function sniffImage(bytes: Uint8Array): { extension: string; mimeType: string } {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { extension: 'png', mimeType: 'image/png' }
  if (starts(0xff, 0xd8, 0xff)) return { extension: 'jpeg', mimeType: 'image/jpeg' }
  if (starts(0x47, 0x49, 0x46, 0x38)) return { extension: 'gif', mimeType: 'image/gif' }
  if (starts(0x42, 0x4d)) return { extension: 'bmp', mimeType: 'image/bmp' }
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return { extension: 'webp', mimeType: 'image/webp' }
  if (starts(0x01, 0x00, 0x00, 0x00)) return { extension: 'emf', mimeType: 'image/x-emf' }
  if (starts(0xd7, 0xcd, 0xc6, 0x9a)) return { extension: 'wmf', mimeType: 'image/x-wmf' }
  const head = new TextDecoder().decode(bytes.subarray(0, 256))
  if (/<svg[\s>]/i.test(head)) return { extension: 'svg', mimeType: 'image/svg+xml' }
  return { extension: 'png', mimeType: 'image/png' }
}

/** Number every comment and note keeps in the file: its own, or the next free one for new ones. */
export interface IdMaps {
  comments: Map<string, string>
  footnote: Map<string, string>
  endnote: Map<string, string>
}

function numericIds(ids: Iterable<string>): Map<string, string> {
  const all = [...ids]
  const result = new Map<string, string>()
  let next = 0
  for (const id of all) if (/^-?\d+$/.test(id)) {
    result.set(id, id)
    next = Math.max(next, Number(id) + 1)
  }
  for (const id of all) if (!result.has(id)) result.set(id, String(next++))
  return result
}

export function idMaps(model: DocxModel): IdMaps {
  const notes = (kind: string) => [...model.stories.keys()].filter((id) => id.startsWith(`${kind}:`)).map((id) => id.slice(kind.length + 1))
  return { comments: numericIds(model.maps.comments.keys()), footnote: numericIds(notes('footnote')), endnote: numericIds(notes('endnote')) }
}

/** Relationships and media a part's content needs, allocated while it is written. */
class PartWriter {
  readonly paraIds = new Set<string>()
  private allocated = 0

  constructor(
    readonly export_: DocxExport,
    readonly part: string,
  ) {}

  private relationships() {
    return this.export_.pkg.relationships(this.part)
  }

  /** The relationship id for an external link to `href`, reusing `current` when it still points there. */
  linkRel(href: string, current: string | undefined): string {
    const rels = this.relationships()
    const existing = rels.find((rel) => rel.id === current)
    if (existing && existing.type === REL.hyperlink && existing.target === href) return existing.id
    const reuse = rels.find((rel) => rel.type === REL.hyperlink && rel.target === href && rel.targetMode === 'External')
    if (reuse) return reuse.id
    this.allocated++
    return this.export_.pkg.addRelationship(this.part, REL.hyperlink, href, 'External')
  }

  /** The relationship id for the image with asset `hash`, adding the media part when it is new. */
  imageRel(hash: string, current: string | undefined): string {
    const rels = this.relationships()
    const existing = rels.find((rel) => rel.id === current)
    if (existing && existing.targetMode !== 'External' && this.export_.hashOf(resolveTarget(this.part, existing.target)) === hash) return existing.id
    const mediaPath = this.export_.mediaFor(hash)
    const target = relativeTarget(this.part, mediaPath)
    const reuse = rels.find((rel) => rel.type === REL.image && rel.targetMode !== 'External' && resolveTarget(this.part, rel.target) === mediaPath)
    if (reuse) return reuse.id
    this.allocated++
    return this.export_.pkg.addRelationship(this.part, REL.image, target)
  }

  get changedRelationships(): boolean {
    return this.allocated > 0
  }
}

interface InlineItem {
  node: ProseMirrorNode
  wrappers: Mark[]
  run: Mark[]
}

/** Text Word writes as `w:delText`: deleted text (moved-away text keeps `w:t`). */
function isDeleted(item: InlineItem): boolean {
  return item.wrappers.some((mark) => mark.type.name === 'del')
}

const rankOf = (mark: Mark) => (mark.type as unknown as { rank: number }).rank

/** Nesting level of same-type wrappers (smart tags in smart tags), outermost first. */
function wrapperOrder(marks: Mark[]): Mark[] {
  return marks
    .map((mark, index) => ({ mark, index }))
    .sort((a, b) => rankOf(a.mark) - rankOf(b.mark) || (Number(a.mark.attrs.level) || 0) - (Number(b.mark.attrs.level) || 0) || a.index - b.index)
    .map((entry) => entry.mark)
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, index) => mark.eq(b[index]!))
}

/** Writes the XML of stories. */
export class StoryWriter {
  constructor(
    readonly writer: PartWriter,
    readonly ids: IdMaps,
  ) {}

  blocks(content: ProseMirrorNode | readonly ProseMirrorNode[]): string {
    let xml = ''
    const nodes: ProseMirrorNode[] = []
    if (Array.isArray(content)) nodes.push(...content)
    else (content as ProseMirrorNode).forEach((child) => { nodes.push(child) })
    for (const node of nodes) xml += this.block(node)
    return xml
  }

  private markers(value: unknown): string {
    return jmlList(value).map((element) => jmlToXml(this.mapIds(element))).join('')
  }

  block(node: ProseMirrorNode): string {
    const lead = this.markers(node.attrs.lead)
    const trail = this.markers(node.attrs.trail)
    switch (node.type.name) {
      case 'paragraph':
        return lead + this.paragraph(node) + trail
      case 'table':
        return lead + this.table(node) + trail
      case 'blockWrapper': {
        const shell = jml(node.attrs.v)
        const inner = this.blocks(node)
        return lead + (shell ? jmlToXml(shell, inner) : inner) + trail
      }
      case 'blockXml': {
        const element = jml(node.attrs.v)
        return lead + (element ? jmlToXml(element) : '') + trail
      }
      default:
        return lead + trail
    }
  }

  private paragraphAttrs(node: ProseMirrorNode): Record<string, string> | undefined {
    const attrs = attrsOf(node.attrs.xmlAttrs)
    if (!attrs) return undefined
    const paraId = attrs['w14:paraId']
    if (paraId) {
      // Splitting a paragraph copies its id; Word wants them unique.
      if (this.writer.paraIds.has(paraId)) {
        const { 'w14:paraId': _p, 'w14:textId': _t, ...rest } = attrs
        return rest
      }
      this.writer.paraIds.add(paraId)
    }
    return attrs
  }

  paragraphProperties(node: ProseMirrorNode): JmlElement[] {
    const elements: JmlElement[] = []
    if (node.attrs.pStyle) elements.push(['w:pStyle', { 'w:val': String(node.attrs.pStyle) }])
    for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS) as ParagraphPropertyAttr[]) {
      const element = jml(node.attrs[key])
      if (element) elements.push(element)
    }
    elements.push(...jmlList(node.attrs.pPrRest))
    for (const key of ['markRPr', 'sectPr', 'pPrChange']) {
      const element = jml(node.attrs[key])
      if (element) elements.push(element)
    }
    return sortByOrder(elements, PPR_ORDER)
  }

  paragraph(node: ProseMirrorNode, extraAttrs?: Record<string, string>): string {
    const attrs = { ...this.paragraphAttrs(node), ...extraAttrs }
    const properties = this.paragraphProperties(node)
    let xml = openTag('w:p', attrs)
    if (properties.length) xml += `<w:pPr>${properties.map((element) => jmlToXml(element)).join('')}</w:pPr>`
    xml += this.inline(node)
    return `${xml}</w:p>`
  }

  inline(node: ProseMirrorNode): string {
    const items: InlineItem[] = []
    node.forEach((child) => {
      const wrappers: Mark[] = []
      const run: Mark[] = []
      for (const mark of inlineMarks(child)) {
        if (WRAPPER_MARK_NAMES.has(mark.type.name)) wrappers.push(mark)
        else if (RUN_MARK_NAMES.has(mark.type.name)) run.push(mark)
      }
      items.push({ node: child, wrappers: wrapperOrder(wrappers), run })
    })
    return this.inlineItems(items, 0)
  }

  private inlineItems(items: InlineItem[], depth: number): string {
    let xml = ''
    let index = 0
    while (index < items.length) {
      const item = items[index]!
      const wrapper = item.wrappers[depth]
      if (wrapper) {
        let end = index + 1
        while (end < items.length && items[end]!.wrappers[depth]?.eq(wrapper)) end++
        xml += this.wrapper(wrapper, this.inlineItems(items.slice(index, end), depth + 1))
        index = end
        continue
      }
      if (this.isRunItem(item)) {
        let end = index + 1
        while (end < items.length && !items[end]!.wrappers[depth] && this.isRunItem(items[end]!) && sameMarks(items[end]!.run, item.run) && isDeleted(items[end]!) === isDeleted(item)) end++
        xml += this.run(items.slice(index, end))
        index = end
        continue
      }
      xml += this.bare(item)
      index++
    }
    return xml
  }

  private isRunItem(item: InlineItem): boolean {
    const name = item.node.type.name
    if (name === 'commentMark') return item.node.attrs.edge === 'ref'
    if (name === 'inlineXml') return item.node.attrs.inRun === true
    return RUN_LEVEL_NODES.has(name)
  }

  private wrapper(mark: Mark, inner: string): string {
    let shell = jml(mark.attrs.v)
    if (!shell) {
      const name = WRAPPER_MARKS[mark.type.name as keyof typeof WRAPPER_MARKS]
      if (!name) return inner
      shell = [name, {}, '\u0000']
    }
    if (mark.type.name === 'link') {
      const href = mark.attrs.href as string | null
      if (href) {
        const relId = this.writer.linkRel(href, jmlAttr(shell, 'r:id'))
        if (relId !== jmlAttr(shell, 'r:id')) shell = [shell[0], { ...shell[1], 'r:id': relId }, ...(shell.slice(2) as JmlNode[])]
      }
    }
    return jmlToXml(shell, inner)
  }

  runProperties(marks: readonly Mark[]): JmlElement[] {
    const elements: JmlElement[] = []
    for (const mark of marks) {
      if (mark.type.name === 'rPrRest') elements.push(...jmlList(mark.attrs.v))
      else {
        const element = jml(mark.attrs.v)
        if (element) elements.push(element)
      }
    }
    return sortByOrder(elements, RPR_ORDER, ['w:rPrChange'])
  }

  private run(items: InlineItem[]): string {
    const deleted = isDeleted(items[0]!)
    const properties = this.runProperties(items[0]!.run)
    let xml = '<w:r>'
    if (properties.length) xml += `<w:rPr>${properties.map((element) => jmlToXml(element)).join('')}</w:rPr>`
    for (const item of items) xml += this.runContent(item.node, deleted)
    return `${xml}</w:r>`
  }

  private runContent(node: ProseMirrorNode, deleted: boolean): string {
    const element = jml(node.attrs?.v)
    switch (node.type.name) {
      case 'text': {
        const text = node.text ?? ''
        const tag = deleted ? 'w:delText' : 'w:t'
        const preserve = /^\s|\s$|\s\s|\t/.test(text) ? ' xml:space="preserve"' : ''
        return `<${tag}${preserve}>${jmlToXml(text)}</${tag}>`
      }
      case 'tab':
        return element ? jmlToXml(element) : '<w:tab/>'
      case 'break': {
        if (element) return jmlToXml(element)
        const type = node.attrs.type as string
        return type === 'textWrapping' ? '<w:br/>' : `<w:br w:type="${type}"/>`
      }
      case 'drawing':
        return element ? jmlToXml(this.drawingElement(element, node.attrs.src as string | null)) : ''
      case 'noteRef': {
        const kind = node.attrs.kind === 'endnote' ? 'endnote' : 'footnote'
        const id = this.ids[kind].get(String(node.attrs.id)) ?? String(node.attrs.id)
        const base: JmlElement = element ?? [`w:${kind}Reference`, {}]
        return jmlToXml([base[0], { ...base[1], 'w:id': id }, ...(base.slice(2) as JmlNode[])])
      }
      case 'commentMark':
        return jmlToXml(this.mapIds(element ?? ['w:commentReference', { 'w:id': String(node.attrs.id) }]))
      case 'fieldCode': {
        const base: JmlElement = element ?? ['w:instrText', {}]
        const name = deleted ? 'w:delInstrText' : 'w:instrText'
        return jmlToXml([name, base[1], ...(base.slice(2) as JmlNode[])])
      }
      default:
        return element ? jmlToXml(element) : ''
    }
  }

  /** Points a drawing's picture at the right relationship for this part. */
  private drawingElement(element: JmlElement, src: string | null): JmlElement {
    if (!src) return element
    let current: string | undefined
    walkJml(element, (child) => {
      if (current) return false
      if (child[0] === 'a:blip') current = jmlAttr(child, 'r:embed')
      return undefined
    })
    if (!current) return element
    const relId = this.writer.imageRel(src, current)
    if (relId === current) return element
    const copy = structuredClone(element)
    walkJml(copy, (child) => {
      if (child[0] === 'a:blip' && child[1]['r:embed'] === current) child[1]['r:embed'] = relId
      if (child[0] === 'v:imagedata' && child[1]['r:id'] === current) child[1]['r:id'] = relId
    })
    return copy
  }

  /** Replaces comment ids with their file numbers. */
  private mapIds(element: JmlElement): JmlElement {
    if (!/^w:comment(RangeStart|RangeEnd|Reference)$/.test(element[0])) return element
    const id = element[1]['w:id']
    const mapped = id === undefined ? undefined : this.ids.comments.get(id)
    if (mapped === undefined || mapped === id) return element
    return [element[0], { ...element[1], 'w:id': mapped }, ...(element.slice(2) as JmlNode[])]
  }

  private bare(item: InlineItem): string {
    const element = jml(item.node.attrs?.v)
    if (item.node.type.name === 'commentMark') {
      const edge = item.node.attrs.edge === 'end' ? 'End' : 'Start'
      return jmlToXml(this.mapIds(element ?? [`w:commentRange${edge}`, { 'w:id': String(item.node.attrs.id) }]))
    }
    if (item.node.type.name === 'bookmark' && !element) {
      return item.node.attrs.edge === 'end'
        ? openTag('w:bookmarkEnd', { 'w:id': String(item.node.attrs.id) }, true)
        : openTag('w:bookmarkStart', { 'w:id': String(item.node.attrs.id), 'w:name': String(item.node.attrs.name ?? '') }, true)
    }
    return element ? jmlToXml(element) : ''
  }

  private table(node: ProseMirrorNode): string {
    const map = TableMap.get(node)
    const tblPr = jml(node.attrs.tblPr)
    let xml = openTag('w:tbl', attrsOf(node.attrs.xmlAttrs))
    if (tblPr) xml += jmlToXml(tblPr)
    xml += this.grid(jml(node.attrs.tblGrid), map.width)
    let pendingWrap: string | null = null
    let wrapped = ''
    const flushWrap = () => {
      if (pendingWrap === null) return
      const shell = jml(pendingWrap)
      xml += shell ? jmlToXml(shell, wrapped) : wrapped
      pendingWrap = null
      wrapped = ''
    }
    for (let row = 0; row < map.height; row++) {
      const rowNode = node.child(row)
      const rowXml = this.markers(rowNode.attrs.lead) + this.row(node, rowNode, row, map)
      const wrap = rowNode.attrs.wrap as string | null
      if (wrap !== pendingWrap) flushWrap()
      if (wrap) {
        pendingWrap = wrap
        wrapped += rowXml
      } else {
        xml += rowXml
      }
    }
    flushWrap()
    xml += this.markers(node.attrs.rowTrail)
    return `${xml}</w:tbl>`
  }

  /** The table grid, kept as written unless the editor changed the number of columns. */
  private grid(tblGrid: JmlElement | undefined, width: number): string {
    const cols = tblGrid ? jmlElements(tblGrid).filter((col) => col[0] === 'w:gridCol') : []
    if (tblGrid && cols.length === width) return jmlToXml(tblGrid)
    const total = cols.reduce((sum, col) => sum + (Number(jmlAttr(col, 'w:w')) || 0), 0) || 9360
    const each = Math.max(1, Math.round(total / Math.max(1, width)))
    const rest = tblGrid ? jmlElements(tblGrid).filter((child) => child[0] !== 'w:gridCol') : []
    const grid: JmlElement = ['w:tblGrid', tblGrid?.[1] ?? {}, ...Array.from({ length: width }, (): JmlElement => ['w:gridCol', { 'w:w': String(each) }]), ...rest]
    return jmlToXml(grid)
  }

  private row(table: ProseMirrorNode, rowNode: ProseMirrorNode, row: number, map: TableMap): string {
    let before = 0
    let after = 0
    let cells = ''
    let pendingWrap: string | null = null
    let wrapped = ''
    const flushWrap = () => {
      if (pendingWrap === null) return
      const shell = jml(pendingWrap)
      cells += shell ? jmlToXml(shell, wrapped) : wrapped
      pendingWrap = null
      wrapped = ''
    }
    const emit = (cellXml: string, wrap: string | null) => {
      if (wrap !== pendingWrap) flushWrap()
      if (wrap) {
        pendingWrap = wrap
        wrapped += cellXml
      } else {
        cells += cellXml
      }
    }
    let seenOwn = false
    for (let col = 0; col < map.width;) {
      const pos = map.map[row * map.width + col]!
      const rect = map.findCell(pos)
      const cell = table.nodeAt(pos)!
      const span = rect.right - rect.left
      if (rect.top === row) {
        const phantom = cell.attrs.phantom as string | null
        if (phantom === 'before' && !seenOwn) before += span
        else if (phantom === 'after') after += span
        else if (!phantom) {
          seenOwn = true
          const lead = this.markers(cell.attrs.lead)
          if (lead) {
            flushWrap()
            cells += lead
          }
          emit(this.cell(cell, span), cell.attrs.wrap as string | null)
        }
      } else {
        seenOwn = true
        emit(this.continuation(cell, row - rect.top - 1, span), null)
      }
      col = rect.right
    }
    flushWrap()
    cells += this.markers(rowNode.attrs.cellTrail)
    const trPr = jml(rowNode.attrs.trPr)
    const trPrChildren = (trPr ? jmlElements(trPr) : []).filter((child) => child[0] !== 'w:gridBefore' && child[0] !== 'w:gridAfter')
    if (before) trPrChildren.push(['w:gridBefore', { 'w:val': String(before) }])
    if (after) trPrChildren.push(['w:gridAfter', { 'w:val': String(after) }])
    let xml = openTag('w:tr', attrsOf(rowNode.attrs.xmlAttrs))
    const tblPrEx = jml(rowNode.attrs.tblPrEx)
    if (tblPrEx) xml += jmlToXml(tblPrEx)
    if (trPr || trPrChildren.length) xml += jmlToXml(['w:trPr', trPr?.[1] ?? {}, ...sortByOrder(trPrChildren, TRPR_ORDER)])
    // Word refuses rows without cells.
    if (!cells) cells = '<w:tc><w:p/></w:tc>'
    return `${xml}${cells}</w:tr>`
  }

  private cellProperties(base: JmlElement | undefined, span: number, vMerge: string | undefined, keepVMerge: boolean): string {
    const children = (base ? jmlElements(base) : []).filter((child) => child[0] !== 'w:gridSpan' && (keepVMerge || child[0] !== 'w:vMerge'))
    if (span > 1) children.push(['w:gridSpan', { 'w:val': String(span) }])
    if (vMerge !== undefined) children.push(['w:vMerge', vMerge ? { 'w:val': vMerge } : {}])
    if (!children.length && !base) return ''
    return jmlToXml(['w:tcPr', base?.[1] ?? {}, ...sortByOrder(children, TCPR_ORDER)])
  }

  private cell(cell: ProseMirrorNode, span: number): string {
    const rowspan = cell.attrs.rowspan as number
    const tcPr = jml(cell.attrs.tcPr)
    const properties = this.cellProperties(tcPr, span, rowspan > 1 ? 'restart' : undefined, rowspan <= 1)
    const content = this.blocks(cell)
    return `${openTag('w:tc', attrsOf(cell.attrs.xmlAttrs))}${properties}${content || '<w:p/>'}</w:tc>`
  }

  /** A cell hidden under a vertical merge: the original one, or a new one like its restart cell. */
  private continuation(cell: ProseMirrorNode, index: number, span: number): string {
    const kept = jmlList(cell.attrs.vMergeCells)[index]
    if (kept) {
      const tcPr = jmlChild(kept, 'w:tcPr')
      const content = jmlElements(kept).filter((child) => child[0] !== 'w:tcPr')
      return `${openTag('w:tc', kept[1])}${this.cellProperties(tcPr, span, '', false)}${content.map((child) => jmlToXml(child)).join('') || '<w:p/>'}</w:tc>`
    }
    const restart = jml(cell.attrs.tcPr)
    const width = jmlChild(restart, 'w:tcW')
    const base: JmlElement = ['w:tcPr', {}, ...(width ? [width] : [])]
    return `<w:tc>${this.cellProperties(base, span, '', false)}<w:p/></w:tc>`
  }
}

/** Prefixes used in `xml` that `attrs` does not declare but Word's namespaces define. */
export function withNamespaces(attrs: Record<string, string>, xml: string): Record<string, string> {
  const result = { ...attrs }
  const used = new Set<string>()
  for (const match of xml.matchAll(/[<\s]([A-Za-z][\w-]*):[A-Za-z]/g)) used.add(match[1]!)
  for (const prefix of used) {
    if (prefix === 'xml' || prefix === 'xmlns' || result[`xmlns:${prefix}`]) continue
    const uri = KNOWN_NAMESPACES[prefix]
    if (uri) result[`xmlns:${prefix}`] = uri
  }
  return result
}

function rootXml(name: string, attrs: Record<string, string>, inner: string): string {
  return `${XML_DECLARATION}${openTag(name, withNamespaces(attrs, inner))}${inner}</${name}>`
}

/** Export state: the package being rebuilt and the parts regenerated from the model. */
export class DocxExport {
  /** Regenerated XML by part path, before fingerprints decide whether to use it. */
  readonly generated = new Map<string, string>()
  private readonly hashes = new Map<string, string>()
  private readonly media = new Map<string, string>()
  private readonly pendingMedia = new Map<string, string>()
  readonly writers: PartWriter[] = []

  constructor(
    readonly pkg: OoxmlPackage,
    readonly model: DocxModel,
  ) {
    for (const [path, json] of model.maps.parts) {
      const ref = parseJson<PartRef>(json)
      if (!ref) continue
      this.hashes.set(path, ref.hash)
      if (path.startsWith('word/media/') && !this.media.has(ref.hash)) this.media.set(ref.hash, path)
    }
  }

  hashOf(path: string): string | undefined {
    return this.hashes.get(path)
  }

  /** The media part holding the asset `hash`, reserving a new one when there is none. */
  mediaFor(hash: string): string {
    const existing = this.media.get(hash) ?? this.pendingMedia.get(hash)
    if (existing) return existing
    const path = `word/media/pulpo-${hash.slice(0, 16)}`
    this.pendingMedia.set(hash, path)
    return path
  }

  /** Media reserved during generation, to be fetched from assets. */
  newMedia(): Map<string, string> {
    return this.pendingMedia
  }

  writer(part: string): PartWriter {
    const writer = new PartWriter(this, part)
    this.writers.push(writer)
    return writer
  }
}

/** The single empty paragraph the importer gives an empty story, still untouched. */
function isPlaceholder(doc: ProseMirrorNode): boolean {
  if (doc.childCount !== 1) return false
  const only = doc.firstChild!
  return only.type.name === 'paragraph' && only.content.size === 0 && Object.values(only.attrs).every((value) => value === null)
}

function mainPart(model: DocxModel): string {
  return model.maps.docx.get('mainPart') ?? 'word/document.xml'
}

/** Comments in file order: existing numbers first, as they were, then new ones. */
function orderedComments(model: DocxModel, ids: IdMaps): [string, CommentMeta][] {
  return [...model.maps.comments]
    .map(([id, json]) => [id, parseJson<CommentMeta>(json) ?? {}] as [string, CommentMeta])
    .sort((a, b) => Number(ids.comments.get(a[0])) - Number(ids.comments.get(b[0])))
}

/** A stable paragraph id (8 hex digits below 0x80000000) for comments that lack one. */
function newParaId(seed: string): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  return ((hash >>> 1) | 1).toString(16).toUpperCase().padStart(8, '0')
}

function lastParagraphId(doc: ProseMirrorNode): string | undefined {
  const last = doc.lastChild
  return last?.type.name === 'paragraph' ? attrsOf(last.attrs.xmlAttrs)?.['w14:paraId'] : undefined
}

/** Writes the comment paragraphs, giving the last one a paraId for commentsExtended. */
function commentBlocks(story: StoryWriter, doc: ProseMirrorNode, paraId: string): string {
  let xml = ''
  doc.forEach((child, _offset, index) => {
    if (index === doc.childCount - 1 && child.type.name === 'paragraph' && !attrsOf(child.attrs.xmlAttrs)?.['w14:paraId']) {
      xml += story.block(child.type.create({ ...child.attrs, xmlAttrs: JSON.stringify({ ...attrsOf(child.attrs.xmlAttrs), 'w14:paraId': paraId, 'w14:textId': '77777777' }) }, child.content))
    } else {
      xml += story.block(child)
    }
  })
  return xml
}

function readRoot(pkg: OoxmlPackage, path: string): JmlElement | undefined {
  const document = pkg.has(path) ? pkg.xml(path) : undefined
  return document?.documentElement ? elementToJml(document.documentElement) : undefined
}

/**
 * Regenerates every modeled part into `state.generated` and adds relationships, parts, and
 * content types the content now needs.
 */
export function generateParts(state: DocxExport): void {
  const { model, pkg } = state
  const main = mainPart(model)
  const ids = idMaps(model)
  const meta = model.maps.docx

  // Relationships the editor added to the main part (new headers and footers).
  const existingRels = new Set(pkg.relationships(main).map((rel) => rel.id))
  const relsPath = relationshipsPathFor(main)
  for (const [id, json] of model.maps.rels) {
    if (existingRels.has(id)) continue
    const rel = parseJson<{ type: string; target: string; targetMode?: 'External' }>(json)
    if (!rel) continue
    let relsDoc = pkg.xml(relsPath)
    if (!relsDoc) {
      pkg.setXml(relsPath, `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
      relsDoc = pkg.xml(relsPath)!
    }
    const element = relsDoc.createElementNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship')
    element.setAttribute('Id', id)
    element.setAttribute('Type', rel.type)
    element.setAttribute('Target', rel.target)
    if (rel.targetMode) element.setAttribute('TargetMode', rel.targetMode)
    relsDoc.documentElement!.appendChild(element)
  }

  // The main document.
  {
    const story = new StoryWriter(state.writer(main), ids)
    const documentAttrs = parseJson<Record<string, string>>(meta.get('documentAttrs')) ?? NEW_PART_NAMESPACES
    const extra = unpackJml<JmlElement[]>(meta.get('documentExtra')) ?? []
    const tail = unpackJml<JmlElement[]>(meta.get('documentTail')) ?? []
    const bodyTrail = unpackJml<JmlElement[]>(meta.get('bodyTrail')) ?? []
    const sectPr = unpackJml<JmlElement>(meta.get('sectPr'))
    let body = meta.get('emptyBody') && isPlaceholder(model.body) ? '' : story.blocks(model.body)
    body += bodyTrail.map((element) => jmlToXml(element)).join('')
    if (sectPr) body += jmlToXml(sectPr)
    const bodyAttrs = parseJson<Record<string, string>>(meta.get('bodyAttrs'))
    const inner = extra.map((element) => jmlToXml(element)).join('') + openTag('w:body', bodyAttrs) + body + '</w:body>' + tail.map((element) => jmlToXml(element)).join('')
    state.generated.set(main, rootXml('w:document', documentAttrs, inner))
  }

  // Headers and footers.
  for (const [id, story] of model.stories) {
    if (story.meta.kind !== 'header' && story.meta.kind !== 'footer') continue
    const part = story.meta.part
    if (!part) continue
    const writer = new StoryWriter(state.writer(part), ids)
    const inner = story.meta.empty && isPlaceholder(story.doc) ? '' : writer.blocks(story.doc) || '<w:p/>'
    state.generated.set(part, rootXml(story.meta.kind === 'header' ? 'w:hdr' : 'w:ftr', story.meta.attrs ?? NEW_PART_NAMESPACES, inner))
    if (!pkg.has(part)) pkg.setContentType(part, story.meta.kind === 'header' ? CONTENT_TYPE.header : CONTENT_TYPE.footer)
    void id
  }

  // Footnotes and endnotes.
  for (const kind of ['footnote', 'endnote'] as const) {
    const notes = [...model.stories].filter(([, story]) => story.meta.kind === kind)
    const relType = kind === 'footnote' ? REL.footnotes : REL.endnotes
    let part = pkg.relatedParts(main, relType)[0]
    if (!notes.length && !part) continue
    if (!part) {
      part = `word/${kind}s.xml`
      pkg.addRelationship(main, relType, relativeTarget(main, part))
      pkg.setContentType(part, kind === 'footnote' ? CONTENT_TYPE.footnotes : CONTENT_TYPE.endnotes)
    }
    const writer = new StoryWriter(state.writer(part), ids)
    const ordered = notes
      .map(([id, story]) => ({ number: ids[kind].get(id.slice(kind.length + 1))!, story }))
      .sort((a, b) => Number(a.number) - Number(b.number))
    let inner = ''
    const hasSeparators = ordered.some((note) => note.story.meta.attrs?.['w:type'] === 'separator')
    if (!hasSeparators) {
      inner += `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}>`
      inner += `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`
    }
    for (const note of ordered) {
      inner += openTag(`w:${kind}`, { ...note.story.meta.attrs, 'w:id': note.number }) + (writer.blocks(note.story.doc) || '<w:p/>') + `</w:${kind}>`
    }
    const rootAttrs = parseJson<Record<string, string>>(meta.get(`root:${kind}s`)) ?? NEW_PART_NAMESPACES
    state.generated.set(part, rootXml(`w:${kind}s`, rootAttrs, inner))
  }

  // Comments, with commentsExtended for replies and resolution.
  {
    const comments = orderedComments(model, ids)
    let part = pkg.relatedParts(main, REL.comments)[0]
    if (comments.length || part) {
      if (!part) {
        part = 'word/comments.xml'
        pkg.addRelationship(main, REL.comments, relativeTarget(main, part))
        pkg.setContentType(part, CONTENT_TYPE.comments)
      }
      const writer = new StoryWriter(state.writer(part), ids)
      const paraIds = new Map<string, string>()
      let inner = ''
      for (const [id, comment] of comments) {
        const story = model.stories.get(`comment:${id}`)
        const number = ids.comments.get(id)!
        const doc = story?.doc
        const paraId = (doc && lastParagraphId(doc)) ?? newParaId(`comment-${id}`)
        paraIds.set(id, paraId)
        const attrs: Record<string, string> = { 'w:id': number }
        if (comment.author !== undefined) attrs['w:author'] = comment.author
        if (comment.date !== undefined) attrs['w:date'] = comment.date
        if (comment.initials !== undefined) attrs['w:initials'] = comment.initials
        inner += openTag('w:comment', { ...attrs, ...comment.attrs }) + (doc ? commentBlocks(writer, doc, paraId) : `<w:p w14:paraId="${paraId}" w14:textId="77777777"/>`) + '</w:comment>'
      }
      const rootAttrs = parseJson<Record<string, string>>(meta.get('root:comments')) ?? NEW_PART_NAMESPACES
      state.generated.set(part, rootXml('w:comments', rootAttrs, inner))

      const needsExtended = comments.some(([, comment]) => comment.parentId || comment.done)
      let extendedPart = pkg.relatedParts(main, REL.commentsExtended)[0]
      if (needsExtended || extendedPart) {
        if (!extendedPart) {
          extendedPart = 'word/commentsExtended.xml'
          pkg.addRelationship(main, REL.commentsExtended, relativeTarget(main, extendedPart))
          pkg.setContentType(extendedPart, CONTENT_TYPE.commentsExtended)
        }
        const original = readRoot(pkg, extendedPart)
        let entries = ''
        for (const [id, comment] of comments) {
          const attrs: Record<string, string> = { 'w15:paraId': paraIds.get(id)! }
          const parent = comment.parentId ? paraIds.get(comment.parentId) : undefined
          if (parent) attrs['w15:paraIdParent'] = parent
          attrs['w15:done'] = comment.done ? '1' : '0'
          entries += openTag('w15:commentEx', attrs, true)
        }
        const rootAttrs = original?.[1] ?? {
          'xmlns:mc': KNOWN_NAMESPACES.mc!,
          'xmlns:w15': KNOWN_NAMESPACES.w15!,
          'mc:Ignorable': 'w15',
        }
        state.generated.set(extendedPart, rootXml(original?.[0] ?? 'w15:commentsEx', rootAttrs, entries))
      }
      // Durable ids of deleted comments would point at nothing.
      const keep = new Set(paraIds.values())
      const idsPart = pkg.relatedParts(main, REL.commentsIds)[0]
      const durable = new Set<string>()
      if (idsPart) {
        const root = readRoot(pkg, idsPart)
        if (root) {
          const kept = jmlElements(root).filter((entry) => {
            const paraId = jmlAttr(entry, 'w16cid:paraId')
            const keepEntry = !paraId || keep.has(paraId)
            if (keepEntry) {
              const durableId = jmlAttr(entry, 'w16cid:durableId')
              if (durableId) durable.add(durableId)
            }
            return keepEntry
          })
          state.generated.set(idsPart, rootXml(root[0], root[1], kept.map((entry) => jmlToXml(entry)).join('')))
        }
      }
      const extensiblePart = pkg.relatedParts(main, REL.commentsExtensible)[0]
      if (extensiblePart && idsPart) {
        const root = readRoot(pkg, extensiblePart)
        if (root) {
          const kept = jmlElements(root).filter((entry) => {
            const durableId = jmlAttr(entry, 'w16cex:durableId')
            return !durableId || entry[0] !== 'w16cex:commentExtensible' || durable.has(durableId)
          })
          state.generated.set(extensiblePart, rootXml(root[0], root[1], kept.map((entry) => jmlToXml(entry)).join('')))
        }
      }
    }
  }

  // Styles: the original part with the model's styles in place of its own.
  {
    let part = pkg.relatedParts(main, REL.styles)[0]
    const styles = model.maps.styles
    if (part || styles.size) {
      if (!part) {
        part = 'word/styles.xml'
        pkg.addRelationship(main, REL.styles, relativeTarget(main, part))
        pkg.setContentType(part, CONTENT_TYPE.styles)
      }
      const root = readRoot(pkg, part) ?? ['w:styles', { 'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'xmlns:r': KNOWN_NAMESPACES.r! }]
      const used = new Set<string>()
      const children: JmlNode[] = []
      for (const child of root.slice(2) as JmlNode[]) {
        if (!Array.isArray(child)) continue
        let key: string | undefined
        if (child[0] === 'w:style' && jmlAttr(child, 'w:styleId') !== undefined) key = `style:${jmlAttr(child, 'w:styleId')}`
        else if (child[0] === 'w:docDefaults') key = 'docDefaults'
        else if (child[0] === 'w:latentStyles') key = 'latentStyles'
        if (!key) {
          children.push(child)
          continue
        }
        if (used.has(key)) continue
        used.add(key)
        const replacement = unpackJml<JmlElement>(styles.get(key))
        if (replacement) children.push(replacement)
      }
      const firstStyle = children.findIndex((child) => Array.isArray(child) && child[0] === 'w:style')
      for (const key of ['docDefaults', 'latentStyles']) {
        if (used.has(key)) continue
        const element = unpackJml<JmlElement>(styles.get(key))
        if (element) children.splice(firstStyle < 0 ? children.length : firstStyle, 0, element)
      }
      for (const [key, value] of styles) {
        if (!key.startsWith('style:') || used.has(key)) continue
        const element = unpackJml<JmlElement>(value)
        if (element) children.push(element)
      }
      state.generated.set(part, rootXml(root[0], root[1], children.map((child) => jmlToXml(child)).join('')))
    }
  }

  // Numbering: pictures, abstract definitions, then instances, as the schema orders them.
  {
    let part = pkg.relatedParts(main, REL.numbering)[0]
    const numbering = model.maps.numbering
    if (part || numbering.size) {
      if (!part) {
        part = 'word/numbering.xml'
        pkg.addRelationship(main, REL.numbering, relativeTarget(main, part))
        pkg.setContentType(part, CONTENT_TYPE.numbering)
      }
      const root = readRoot(pkg, part) ?? ['w:numbering', { ...NEW_PART_NAMESPACES }]
      const keyOf = (child: JmlElement) =>
        child[0] === 'w:abstractNum' ? `abstract:${jmlAttr(child, 'w:abstractNumId')}`
          : child[0] === 'w:num' ? `num:${jmlAttr(child, 'w:numId')}`
            : child[0] === 'w:numPicBullet' ? `picBullet:${jmlAttr(child, 'w:numPicBulletId')}` : undefined
      const used = new Set<string>()
      const groups: Record<'picBullet' | 'abstract' | 'num' | 'other', JmlElement[]> = { picBullet: [], abstract: [], num: [], other: [] }
      for (const child of jmlElements(root)) {
        const key = keyOf(child)
        if (!key) {
          groups.other.push(child)
          continue
        }
        if (used.has(key)) continue
        used.add(key)
        const replacement = unpackJml<JmlElement>(numbering.get(key))
        if (replacement) groups[key.slice(0, key.indexOf(':')) as 'picBullet' | 'abstract' | 'num'].push(replacement)
      }
      const added = [...numbering].filter(([key]) => !used.has(key)).sort(([a], [b]) => {
        const number = (key: string) => Number(key.slice(key.indexOf(':') + 1))
        return (number(a) || 0) - (number(b) || 0)
      })
      for (const [key, value] of added) {
        const element = unpackJml<JmlElement>(value)
        if (element) groups[key.slice(0, key.indexOf(':')) as 'picBullet' | 'abstract' | 'num'].push(element)
      }
      const children = [...groups.picBullet, ...groups.abstract, ...groups.num, ...groups.other]
      state.generated.set(part, rootXml(root[0], root[1], children.map((child) => jmlToXml(child)).join('')))
    }
  }

  // Settings Pulpo writes, in place.
  {
    const part = pkg.relatedParts(main, REL.settings)[0]
    if (part) {
      const root = readRoot(pkg, part)
      if (root) {
        const children = jmlElements(root)
        const result = children.filter((child) => !model.maps.settings.has(child[0]))
        for (const [name, value] of model.maps.settings) {
          const element = unpackJml<JmlElement>(value)
          if (element) result.push(element)
        }
        const sorted = sortByOrder(result, SETTINGS_ORDER)
        state.generated.set(part, rootXml(root[0], root[1], sorted.map((child) => jmlToXml(child)).join('')))
      }
    }
  }
}

function mainContentType(extension: string): string {
  switch (extension) {
    case 'dotx': return CONTENT_TYPE.template
    case 'docm': return CONTENT_TYPE.macroDocument
    case 'dotm': return CONTENT_TYPE.macroTemplate
    default: return CONTENT_TYPE.document
  }
}

/** Drops macros from a package saved as a macro-free type, as Word does. */
function removeMacros(pkg: OoxmlPackage, main: string): void {
  const relsPath = relationshipsPathFor(main)
  for (const rel of pkg.relationships(main)) {
    if (!/vbaProject|wordVbaData/i.test(rel.type)) continue
    const target = resolveTarget(main, rel.target)
    for (const sub of pkg.relationships(target)) if (sub.targetMode !== 'External') pkg.delete(resolveTarget(target, sub.target))
    pkg.delete(relationshipsPathFor(target))
    pkg.delete(target)
    pkg.removeRelationship(main, rel.id)
  }
  void relsPath
}

/** Builds the package the model describes, as file bytes. */
export interface ExportOptions {
  /** Writes every modeled part from the model even when it is unchanged (for tests). */
  regenerate?: boolean
}

export async function exportDocx(model: DocxModel, assets: LiveAssetStore, extension = 'docx', options: ExportOptions = {}): Promise<Uint8Array> {
  const parts = new Map<string, Uint8Array>()
  for (const [path, json] of model.maps.parts) {
    const ref = parseJson<PartRef>(json)
    if (!ref) continue
    parts.set(path, await assets.get(ref.hash))
  }
  if (!parts.has(CONTENT_TYPES_PATH)) throw new LiveFormatError('corrupt', 'This document has lost its package')
  const pkg = new OoxmlPackage(parts)
  const state = new DocxExport(pkg, model)
  generateParts(state)
  for (const [hash, path] of state.newMedia()) {
    const bytes = await assets.get(hash)
    const { extension: imageExtension, mimeType } = sniffImage(bytes)
    const finalPath = `${path}.${imageExtension}`
    pkg.set(finalPath, bytes)
    pkg.ensureDefaultContentType(imageExtension, mimeType)
    renameMediaTarget(pkg, path, finalPath)
  }
  for (const [path, xml] of state.generated) {
    const fingerprint = model.maps.docx.get(`fingerprint:${path}`)
    if (!options.regenerate && fingerprint && parts.has(path) && fingerprint === (await sha256Hex(xml))) continue
    pkg.set(path, strToU8(xml))
  }
  const main = mainPart(model)
  const contentType = mainContentType(extension)
  if (pkg.contentType(main) !== contentType) pkg.setContentType(main, contentType)
  if (extension === 'docx' || extension === 'dotx') removeMacros(pkg, main)
  return pkg.write()
}

/** Relationship targets were written before the image's extension was known. */
function renameMediaTarget(pkg: OoxmlPackage, from: string, to: string): void {
  for (const path of pkg.paths()) {
    if (!path.endsWith('.rels')) continue
    const document = pkg.xml(path)
    if (!document) continue
    const elements = document.getElementsByTagName('Relationship')
    const source = path.replace(/_rels\/([^/]+)\.rels$/, '$1')
    for (let index = 0; index < elements.length; index++) {
      const element = elements.item(index)!
      const target = element.getAttribute('Target')
      if (target && element.getAttribute('TargetMode') !== 'External' && resolveTarget(source, target) === from) {
        element.setAttribute('Target', relativeTarget(source, to))
      }
    }
  }
}

/** Fingerprints of the parts the model regenerates, so unchanged ones export byte for byte. */
export async function fingerprintParts(model: DocxModel, assets: LiveAssetStore): Promise<Map<string, string>> {
  const parts = new Map<string, Uint8Array>()
  for (const [path, json] of model.maps.parts) {
    const ref = parseJson<PartRef>(json)
    if (ref) parts.set(path, await assets.get(ref.hash))
  }
  const state = new DocxExport(new OoxmlPackage(parts), model)
  generateParts(state)
  const result = new Map<string, string>()
  for (const [path, xml] of state.generated) result.set(path, await sha256Hex(xml))
  return result
}

export type { StoryMeta }
export { mimeTypeForPart }
