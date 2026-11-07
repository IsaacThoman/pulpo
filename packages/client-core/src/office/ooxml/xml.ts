import type { Element, Node } from '@xmldom/xmldom'

/** Small namespace-aware helpers for walking parsed OOXML parts. */

export type { Element }

export const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

const ELEMENT_NODE = 1

export function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === ELEMENT_NODE
}

/** Direct element children, optionally only those with `localName` in namespace `ns`. */
export function childElements(parent: Element | null | undefined, ns?: string, localName?: string): Element[] {
  const result: Element[] = []
  if (!parent) return result
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (!isElement(node)) continue
    if (ns !== undefined && node.namespaceURI !== ns) continue
    if (localName !== undefined && node.localName !== localName) continue
    result.push(node)
  }
  return result
}

/** The first direct child with `localName` in namespace `ns`. */
export function childElement(parent: Element | null | undefined, ns: string, localName: string): Element | undefined {
  if (!parent) return undefined
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (isElement(node) && node.localName === localName && node.namespaceURI === ns) return node
  }
  return undefined
}

/** An attribute's value, or undefined when it is missing. */
export function attribute(element: Element | null | undefined, name: string): string | undefined {
  if (!element || !element.hasAttribute(name)) return undefined
  return element.getAttribute(name) ?? undefined
}

/** A finite numeric attribute, or undefined. */
export function numberAttribute(element: Element | null | undefined, name: string): number | undefined {
  const text = attribute(element, name)
  if (text === undefined || text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** An `xsd:boolean` attribute (`1`/`true`/`0`/`false`), or `fallback` when missing or invalid. */
export function booleanAttribute(element: Element | null | undefined, name: string, fallback: boolean): boolean {
  const text = attribute(element, name)
  if (text === '1' || text === 'true') return true
  if (text === '0' || text === 'false') return false
  return fallback
}

/** The text of an element's direct text and CDATA children (no recursion, so deep nesting is harmless). */
export function ownText(element: Element | null | undefined): string {
  if (!element) return ''
  let text = ''
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3 || node.nodeType === 4) text += node.nodeValue ?? ''
  }
  return text
}
