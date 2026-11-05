import type { Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom'
import { LiveFormatError } from '../live-format.js'

/**
 * XML kept inside the model as JsonML: `[qualifiedName, attributes, ...children]`, children being
 * elements or text. Properties the editor does not model (and whole opaque elements) travel as
 * JSON strings of this shape, so they compare by value in Yjs, parse without a DOM, and write back
 * exactly: names keep their prefixes and attributes keep namespace declarations.
 */
export type JmlNode = JmlElement | string
export type JmlElement = [name: string, attrs: Record<string, string>, ...children: JmlNode[]]

/** Deeper XML than this is refused: real documents nest a few dozen levels, hostile ones millions. */
export const MAX_XML_DEPTH = 200

/**
 * Stands in, inside a wrapper element (hyperlink, content control, revision…), for the content
 * the editor models itself.
 */
export const CONTENT_SLOT = '\u0000'

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4

/**
 * Converts a parsed element. Whitespace-only text beside child elements is indentation and is
 * dropped; text in an element without child elements is kept as written (`<w:t> </w:t>`).
 */
export function elementToJml(element: XmlElement, depth = 0): JmlElement {
  if (depth > MAX_XML_DEPTH) throw new LiveFormatError('corrupt', 'This document nests XML too deeply')
  const attrs: Record<string, string> = {}
  const attributes = element.attributes
  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes.item(index)!
    attrs[attribute.nodeName] = attribute.value
  }
  const result: JmlElement = [element.nodeName, attrs]
  let hasElements = false
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE) {
      hasElements = true
      break
    }
  }
  for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE) result.push(elementToJml(child as XmlElement, depth + 1))
    else if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) {
      const text = child.nodeValue ?? ''
      if (hasElements && !text.trim()) continue
      const last = result[result.length - 1]
      if (result.length > 2 && typeof last === 'string') result[result.length - 1] = last + text
      else result.push(text)
    }
  }
  return result
}

export function jmlName(node: JmlNode | undefined): string | undefined {
  return Array.isArray(node) ? node[0] : undefined
}

/** The local part of a qualified name (`w:p` → `p`). */
export function localName(name: string): string {
  const index = name.indexOf(':')
  return index < 0 ? name : name.slice(index + 1)
}

export function jmlChildren(element: JmlElement): JmlNode[] {
  return element.slice(2) as JmlNode[]
}

export function jmlElements(element: JmlElement): JmlElement[] {
  return jmlChildren(element).filter((child): child is JmlElement => Array.isArray(child))
}

export function jmlChild(element: JmlElement | undefined, name: string): JmlElement | undefined {
  if (!element) return undefined
  for (let index = 2; index < element.length; index++) {
    const child = element[index]
    if (Array.isArray(child) && child[0] === name) return child
  }
  return undefined
}

export function jmlAttr(element: JmlElement | undefined, name: string): string | undefined {
  return element?.[1][name]
}

/** Concatenated text of an element and its descendants. */
export function jmlText(node: JmlNode): string {
  if (typeof node === 'string') return node
  let text = ''
  for (let index = 2; index < node.length; index++) text += jmlText(node[index] as JmlNode)
  return text
}

/** Visits every element, depth first, until `visit` returns false. */
export function walkJml(node: JmlNode, visit: (element: JmlElement) => boolean | void): void {
  if (typeof node === 'string') return
  if (visit(node) === false) return
  for (let index = 2; index < node.length; index++) walkJml(node[index] as JmlNode, visit)
}

export function escapeXmlText(text: string): string {
  return text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))
}

export function escapeXmlAttr(text: string): string {
  return text.replace(/[&<>"\n\r\t]/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case '\n': return '&#10;'
      case '\r': return '&#13;'
      default: return '&#9;'
    }
  })
}

/** Characters XML 1.0 cannot carry at all; a document holding them would not open. */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g

export function stripInvalidXmlChars(text: string): string {
  return text.replace(INVALID_XML_CHARS, '')
}

/** XML names as WordprocessingML uses them (ASCII, at most one prefix). */
const XML_NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/

/**
 * Names that can be written: valid XML, and not the editor's own `pulpo:` markers (an undeclared
 * prefix would make the file unreadable). Values come from documents and collaborators.
 */
export function writableXmlName(name: string): boolean {
  return XML_NAME.test(name) && !name.startsWith('pulpo:')
}

export function openTag(name: string, attrs: Record<string, string> | undefined, selfClose = false, internal = false): string {
  let tag = `<${name}`
  if (attrs) for (const key in attrs) if ((internal ? XML_NAME.test(key) : writableXmlName(key)) && typeof attrs[key] === 'string') tag += ` ${key}="${escapeXmlAttr(stripInvalidXmlChars(attrs[key]!))}"`
  return tag + (selfClose ? '/>' : '>')
}

/**
 * Writes JsonML as XML. `slot` fills the content slot of a wrapper (see CONTENT_SLOT).
 */
export function jmlToXml(node: JmlNode, slot?: string, internal = false): string {
  if (typeof node === 'string') return node === CONTENT_SLOT ? (slot ?? '') : escapeXmlText(stripInvalidXmlChars(node))
  const [name, attrs] = node
  // An element that cannot be named is left out, with its content.
  if (typeof name !== 'string' || !(internal ? XML_NAME.test(name) : writableXmlName(name))) return ''
  if (node.length <= 2) return openTag(name, attrs, true, internal)
  let body = ''
  for (let index = 2; index < node.length; index++) body += jmlToXml(node[index] as JmlNode, slot, internal)
  return `${openTag(name, attrs, false, internal)}${body}</${name}>`
}

/** JsonML as the string stored in node and mark attributes. */
export function packJml(node: JmlNode | JmlNode[]): string {
  return JSON.stringify(node)
}

const unpacked = new Map<string, unknown>()

/**
 * Parses a stored JsonML string. Results are cached and shared, so callers must not mutate them
 * (clone with `structuredClone` first).
 */
export function unpackJml<T extends JmlNode | JmlNode[] = JmlElement>(packed: string | null | undefined): T | undefined {
  if (!packed) return undefined
  let value = unpacked.get(packed)
  if (value === undefined) {
    try {
      value = JSON.parse(packed)
    } catch {
      return undefined
    }
    if (unpacked.size > 20_000) unpacked.clear()
    unpacked.set(packed, value)
  }
  return value as T
}

export function cloneJml<T extends JmlNode | JmlNode[]>(node: T): T {
  return structuredClone(node)
}

/** Twips, half-points, and other integer attributes; undefined when absent or malformed. */
export function jmlNumber(element: JmlElement | undefined, name: string): number | undefined {
  const value = element?.[1][name]
  if (value === undefined) return undefined
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : undefined
}

/**
 * Whether an on/off property is on: present without `w:val`, or with a true value. Word writes
 * `0`, `false`, and `off` to turn one off explicitly over a style.
 */
export function jmlOn(element: JmlElement | undefined): boolean | undefined {
  if (!element) return undefined
  const value = element[1]['w:val']
  return value === undefined || !(value === '0' || value === 'false' || value === 'off')
}
