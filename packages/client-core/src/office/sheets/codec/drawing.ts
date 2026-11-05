import { MAX_COLS, MAX_ROWS } from '../address.js'
import { randomId } from '../model/axis.js'
import type { AnchorPoint, DrawingKind, DrawingObject } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import { orderedEntries } from './order.js'
import type { ReadContext } from './read-worksheet.js'
import { attr, child, children, escapeXml, numberAttr, otherAttributes, serializeNode, type XmlElement } from './xml.js'

/**
 * Sheet drawings (`xl/drawings/drawingN.xml`): pictures, charts, and shapes anchored to cells.
 * Each anchor becomes a DrawingObject whose corners name rows and columns by id, so objects move
 * with the cells under them; the object XML itself is kept as read.
 */

const ANCHORS = ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor']

function readPoint(sheet: SheetModel, element: XmlElement | undefined): AnchorPoint | undefined {
  if (!element) return undefined
  const value = (name: string) => Number(child(element, name)?.textContent ?? 0)
  const row = value('row')
  const col = value('col')
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return undefined
  const offset = (name: string) => Number.isFinite(value(name)) ? Math.max(0, Math.floor(value(name))) : 0
  sheet.ensure(row, col)
  return { row: sheet.rows.idAt(row), col: sheet.cols.idAt(col), rowOff: offset('rowOff'), colOff: offset('colOff') }
}

function kindOf(element: XmlElement): DrawingKind {
  switch (element.localName) {
    case 'pic':
      return 'image'
    case 'graphicFrame':
      return element.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart').length ? 'chart' : 'other'
    case 'sp':
    case 'cxnSp':
      return 'shape'
    case 'grpSp':
      return 'group'
    default:
      return 'other'
  }
}

/** Reads a drawing part's anchors into `sheet.drawings`. */
export function readDrawing(sheet: SheetModel, path: string, context: ReadContext): void {
  const document = context.pkg.xml(path)
  const root = document?.documentElement
  if (!root) return
  const resolve = (id: string) => context.pkg.relationshipTarget(path, id)
  let z = 0
  for (const node of children(root)) {
    z++
    if (!ANCHORS.includes(node.localName ?? '')) {
      // mc:AlternateContent and the like: kept verbatim, without moving with cells.
      sheet.drawings.set(randomId(), { kind: 'other', anchor: 'absolute', xml: serializeNode(node), verbatim: true, z } satisfies DrawingObject)
      continue
    }
    const objectNodes = children(node).filter((entry) => !['from', 'to', 'ext', 'pos'].includes(entry.localName ?? ''))
    const content = objectNodes.find((entry) => entry.localName !== 'clientData')
    const drawing: DrawingObject = {
      kind: content ? kindOf(content) : 'other',
      anchor: node.localName === 'twoCellAnchor' ? 'twoCell' : node.localName === 'oneCellAnchor' ? 'oneCell' : 'absolute',
      xml: objectNodes.map((entry) => serializeNode(entry)).join(''),
      z,
    }
    const from = readPoint(sheet, child(node, 'from'))
    const to = readPoint(sheet, child(node, 'to'))
    if (drawing.anchor !== 'absolute' && !from || drawing.anchor === 'twoCell' && !to) continue
    if (from) drawing.from = from
    if (to) drawing.to = to
    const ext = child(node, 'ext')
    if (ext) drawing.ext = { cx: numberAttr(ext, 'cx') ?? 0, cy: numberAttr(ext, 'cy') ?? 0 }
    const pos = child(node, 'pos')
    if (pos) drawing.pos = { x: numberAttr(pos, 'x') ?? 0, y: numberAttr(pos, 'y') ?? 0 }
    const keep = otherAttributes(node, [])
    if (keep) drawing.keep = keep
    const name = content && content.getElementsByTagNameNS('*', 'cNvPr').item(0)
    if (name) drawing.name = attr(name, 'name') ?? ''
    if (content) {
      const links: Record<string, string> = {}
      const blips = content.getElementsByTagNameNS('*', 'blip')
      for (let index = 0; index < blips.length; index++) {
        const id = blips.item(index)!.getAttribute('r:embed')
        const target = id ? resolve(id) : undefined
        if (id && target) {
          links[id] = target
          if (drawing.kind === 'image' && !drawing.image) {
            const image = context.asset(target)
            if (image) drawing.image = image
          }
        }
      }
      const charts = content.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart')
      for (let index = 0; index < charts.length; index++) {
        const id = charts.item(index)!.getAttribute('r:id')
        const target = id ? resolve(id) : undefined
        if (id && target) {
          links[id] = target
          drawing.chart ??= target
        }
      }
      if (Object.keys(links).length) drawing.links = links
    }
    sheet.drawings.set(randomId(), drawing)
  }
  // The part is rebuilt on export from the skeleton and the anchors.
  for (const node of children(root)) root.removeChild(node)
  sheet.raw.set('drawingPart', path)
  sheet.raw.set('drawingXml', serializeNode(root))
  const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels')
  const relsText = context.pkg.text(relsPath)
  if (relsText !== undefined) sheet.raw.set('drawingRels', relsText)
  context.regenerated.add(path)
  context.regenerated.add(relsPath)
}

function writePoint(prefix: string, name: string, row: number, col: number, point: AnchorPoint): string {
  const tag = (element: string, value: number) => `<${prefix}${element}>${value}</${prefix}${element}>`
  return `<${prefix}${name}>${tag('col', col)}${tag('colOff', point.colOff)}${tag('row', row)}${tag('rowOff', point.rowOff)}</${prefix}${name}>`
}

/** Rebuilds a drawing part from its skeleton and the sheet's drawing objects, in z-order. */
export function writeDrawing(sheet: SheetModel, skeleton: string, imageRelationship: (hash: string) => string | undefined = () => undefined): string {
  const open = /^<([\w.-]+:)?wsDr\b[^>]*?(\/?)>/.exec(skeleton)
  // The skeleton's own prefix (openpyxl writes none); new drawings use Excel's `xdr:`.
  const prefix = open ? (open[1] ?? '') : 'xdr:'
  let start = open ? open[0] : `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
  if (start.endsWith('/>')) start = `${start.slice(0, -2)}>`
  const objects = orderedEntries(sheet, sheet.drawings, (value) => {
    const from = (value as DrawingObject).from
    return from ? { top: from.row, left: from.col } : undefined
  }).map(([, value]) => value) as DrawingObject[]
  objects.sort((a, b) => a.z - b.z)
  // New picture ids follow every preserved object id in this part, independently of export history.
  let nextPictureId = 1
  for (const xml of [skeleton, ...objects.map((drawing) => drawing.xml)]) {
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?cNvPr\b[^>]*\bid=["'](\d+)["']/g)) nextPictureId = Math.max(nextPictureId, Number(match[1]) + 1)
  }
  let body = ''
  for (const drawing of objects) {
    if (drawing.verbatim) {
      body += drawing.xml
      continue
    }
    let content = drawing.xml
    if (!content && drawing.image) {
      // A picture placed in the editor.
      const relId = imageRelationship(drawing.image.hash)
      if (!relId) continue
      content = pictureXml(prefix, drawing, relId, nextPictureId++)
    }
    const attrs = Object.entries(drawing.keep ?? {})
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('')
    const element = drawing.anchor === 'twoCell' ? 'twoCellAnchor' : drawing.anchor === 'oneCell' ? 'oneCellAnchor' : 'absoluteAnchor'
    let anchor = ''
    const point = (name: string, value: AnchorPoint | undefined) => {
      if (!value) return true
      const row = sheet.rows.indexOf(value.row)
      const col = sheet.cols.indexOf(value.col)
      if (row < 0 || col < 0) return false
      anchor += writePoint(prefix, name, row, col, value)
      return true
    }
    if (drawing.anchor !== 'absolute' && !point('from', drawing.from)) continue
    if (drawing.anchor === 'twoCell' && !point('to', drawing.to)) continue
    if (drawing.anchor === 'absolute' && drawing.pos) anchor += `<${prefix}pos x="${drawing.pos.x}" y="${drawing.pos.y}"/>`
    if (drawing.anchor !== 'twoCell' && drawing.ext) anchor += `<${prefix}ext cx="${drawing.ext.cx}" cy="${drawing.ext.cy}"/>`
    body += `<${prefix}${element}${attrs}>${anchor}${content}</${prefix}${element}>`
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${start}${body}</${prefix}wsDr>`
}

function pictureXml(prefix: string, drawing: DrawingObject, relId: string, id: number): string {
  const name = escapeXml(drawing.name ?? `Picture ${id}`)
  const cx = drawing.ext?.cx ?? 0
  const cy = drawing.ext?.cy ?? 0
  return (
    `<${prefix}pic><${prefix}nvPicPr><${prefix}cNvPr id="${id}" name="${name}"/><${prefix}cNvPicPr><a:picLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></${prefix}cNvPicPr></${prefix}nvPicPr>` +
    `<${prefix}blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/><a:stretch xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fillRect/></a:stretch></${prefix}blipFill>` +
    `<${prefix}spPr><a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="rect"><a:avLst/></a:prstGeom></${prefix}spPr></${prefix}pic><${prefix}clientData/>`
  )
}
