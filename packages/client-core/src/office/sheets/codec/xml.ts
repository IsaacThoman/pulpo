import { XMLSerializer, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'

/** Small helpers over @xmldom/xmldom for SpreadsheetML. */

export type { XmlElement }

export const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
export const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
export const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'

export const REL_TYPES = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  chartsheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet',
  dialogsheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet',
  macrosheet: 'http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  sharedStrings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings',
  calcChain: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  vmlDrawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing',
  drawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
  table: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  threadedComments: 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment',
} as const

export const CONTENT_TYPES = {
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  workbookMacro: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  template: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  templateMacro: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  comments: 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml',
  vmlDrawing: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  table: 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml',
  coreProps: 'application/vnd.openxmlformats-package.core-properties+xml',
  appProps: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  relationships: 'application/vnd.openxmlformats-package.relationships+xml',
} as const

/** Element children of a node, optionally with one local name. */
export function children(node: XmlNode | null | undefined, localName?: string): XmlElement[] {
  const found: XmlElement[] = []
  if (!node) return found
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue
    const element = child as XmlElement
    if (!localName || element.localName === localName) found.push(element)
  }
  return found
}

export function child(node: XmlNode | null | undefined, localName: string): XmlElement | undefined {
  if (!node) return undefined
  for (let current = node.firstChild; current; current = current.nextSibling) {
    if (current.nodeType === 1 && (current as XmlElement).localName === localName) return current as XmlElement
  }
  return undefined
}

/** Every attribute of an element by qualified name. */
export function attributes(element: XmlElement): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index)!
    result[attribute.name] = attribute.value
  }
  return result
}

/** Attributes except the given ones (namespace declarations included, so prefixes stay valid). */
export function otherAttributes(element: XmlElement, modeled: readonly string[]): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  let any = false
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index)!
    if (modeled.includes(attribute.name)) continue
    result[attribute.name] = attribute.value
    any = true
  }
  return any ? result : undefined
}

export function attr(element: XmlElement | undefined, name: string): string | undefined {
  if (!element) return undefined
  return element.hasAttribute(name) ? element.getAttribute(name)! : undefined
}

export function numberAttr(element: XmlElement | undefined, name: string): number | undefined {
  const value = attr(element, name)
  if (value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** OOXML booleans: `1`/`true` (and a bare attribute default supplied by the caller). */
export function boolAttr(element: XmlElement | undefined, name: string, fallback = false): boolean {
  const value = attr(element, name)
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
}

export function serializeNode(node: XmlNode): string {
  return new XMLSerializer().serializeToString(node)
}

/** The XML of an element's children (its inner XML). */
export function innerXml(element: XmlElement): string {
  let xml = ''
  for (let node = element.firstChild; node; node = node.nextSibling) xml += serializeNode(node)
  return xml
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]!)
}

/**
 * Text as SpreadsheetML stores it: characters XML 1.0 can't carry become `_xHHHH_` escapes, and
 * a literal `_xHHHH_` is protected as `_x005F_xHHHH_`.
 */
export function encodeSheetText(text: string): string {
  return escapeXml(
    text
      .replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, (char) => `_x${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`),
  )
}

export function decodeSheetText(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/** Renders attributes for hand-built XML, skipping undefined values. */
export function xmlAttrs(values: Record<string, string | number | boolean | undefined | null>): string {
  let out = ''
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
    out += ` ${name}="${escapeXml(text)}"`
  }
  return out
}

/** Whether text needs `xml:space="preserve"` to keep its whitespace. */
export function needsPreserve(text: string): boolean {
  return /^\s|\s$|\n|\t| {2}/.test(text)
}

/** Text content of an element (concatenated descendant text). */
export function textOf(element: XmlElement | undefined): string {
  return element?.textContent ?? ''
}
