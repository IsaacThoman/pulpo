import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'
import { LiveFormatError } from '../live-format.js'

/**
 * Small DOM helpers shared by the presentation codec and renderer. They only use the DOM Level 2
 * subset that @xmldom/xmldom and browsers both implement, so the same code reads parts in Node and
 * in the editor.
 */

export type { XmlDocument, XmlElement, XmlNode }

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  dgm: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  dsp: 'http://schemas.microsoft.com/office/drawing/2008/diagram',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  a16: 'http://schemas.microsoft.com/office/drawing/2014/main',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
} as const

/** Namespaces declared on every element we create from scratch, so templates parse on their own. */
export const DEFAULT_PREFIXES: Record<string, string> = { a: NS.a, p: NS.p, r: NS.r }

/** Strict OOXML uses other namespace URIs for the same vocabulary; we only edit the transitional form. */
export const STRICT_NAMESPACE_PREFIX = 'http://purl.oclc.org/ooxml/'

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const REL_TYPES = {
  officeDocument: `${REL}/officeDocument`,
  slide: `${REL}/slide`,
  slideLayout: `${REL}/slideLayout`,
  slideMaster: `${REL}/slideMaster`,
  notesSlide: `${REL}/notesSlide`,
  notesMaster: `${REL}/notesMaster`,
  handoutMaster: `${REL}/handoutMaster`,
  theme: `${REL}/theme`,
  image: `${REL}/image`,
  hyperlink: `${REL}/hyperlink`,
  chart: `${REL}/chart`,
  video: `${REL}/video`,
  audio: `${REL}/audio`,
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
  diagramData: `${REL}/diagramData`,
  diagramLayout: `${REL}/diagramLayout`,
  diagramStyle: `${REL}/diagramQuickStyle`,
  diagramColors: `${REL}/diagramColors`,
  diagramDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
  tableStyles: `${REL}/tableStyles`,
  comments: `${REL}/comments`,
  tags: `${REL}/tags`,
  vbaProject: 'http://schemas.microsoft.com/office/2006/relationships/vbaProject',
} as const

export const CONTENT_TYPES = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  template: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
  slideshow: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  macroPresentation: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  macroTemplate: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
  macroSlideshow: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
} as const

/** Elements nested deeper than this are refused: no real deck comes close, and it bounds recursion. */
export const MAX_XML_DEPTH = 256

export function parseXmlDocument(source: string): XmlDocument {
  const errors: string[] = []
  let document: XmlDocument
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') errors.push(message)
      },
    }).parseFromString(source, 'application/xml')
  } catch (error) {
    throw new LiveFormatError('corrupt', `Malformed XML: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (errors.length || !document.documentElement) throw new LiveFormatError('corrupt', `Malformed XML: ${errors[0] ?? 'no root element'}`)
  checkDepth(document.documentElement)
  return document
}

/** Throws for trees deeper than MAX_XML_DEPTH, iteratively so hostile input cannot overflow the stack. */
export function checkDepth(root: XmlElement): void {
  const stack: Array<[XmlNode, number]> = [[root, 1]]
  while (stack.length) {
    const [node, depth] = stack.pop()!
    if (depth > MAX_XML_DEPTH) throw new LiveFormatError('corrupt', 'This file nests XML too deeply')
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) stack.push([child, depth + 1])
    }
  }
}

export function serializeNode(node: XmlNode): string {
  return new XMLSerializer().serializeToString(node)
}

/**
 * Parses a template (an element serialized on its own) with `prefixes` in scope, so prefixes its
 * source declared only on an ancestor still resolve.
 */
export function parseFragment(xml: string, prefixes: Record<string, string> = DEFAULT_PREFIXES): XmlElement {
  const declarations = Object.entries({ ...DEFAULT_PREFIXES, ...prefixes })
    .map(([prefix, uri]) => ` xmlns:${prefix}="${escapeAttribute(uri)}"`)
    .join('')
  const wrapper = parseXmlDocument(`<pulpo-fragment${declarations}>${xml}</pulpo-fragment>`).documentElement!
  const element = firstElement(wrapper)
  if (!element) throw new LiveFormatError('corrupt', 'Empty XML fragment')
  return element
}

/** The namespace declarations (`xmlns:x` attributes) on an element, by prefix. */
export function namespaceDeclarations(element: XmlElement): Record<string, string> {
  const prefixes: Record<string, string> = {}
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index)!
    if (attribute.name.startsWith('xmlns:')) prefixes[attribute.name.slice(6)] = attribute.value
  }
  return prefixes
}

/** Removes `xmlns:x` declarations that repeat one already in scope from an ancestor. */
export function pruneRedundantNamespaces(element: XmlElement): void {
  const inherited = new Map<string, string>()
  for (let ancestor = element.parentNode; ancestor && ancestor.nodeType === 1; ancestor = ancestor.parentNode) {
    const declarations = namespaceDeclarations(ancestor as XmlElement)
    for (const [prefix, uri] of Object.entries(declarations)) if (!inherited.has(prefix)) inherited.set(prefix, uri)
  }
  const visit = (node: XmlElement, scope: Map<string, string>) => {
    const local = new Map(scope)
    for (const [prefix, uri] of Object.entries(namespaceDeclarations(node))) {
      if (scope.get(prefix) === uri) node.removeAttribute(`xmlns:${prefix}`)
      else local.set(prefix, uri)
    }
    for (const child of childElements(node)) visit(child, local)
  }
  visit(element, inherited)
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

export function childElements(parent: XmlNode | null | undefined): XmlElement[] {
  const children: XmlElement[] = []
  for (let child = parent?.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) children.push(child as XmlElement)
  return children
}

export function firstElement(parent: XmlNode | null | undefined): XmlElement | undefined {
  for (let child = parent?.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) return child as XmlElement
  return undefined
}

/** The first child element with this local name (and namespace, when given). */
export function child(parent: XmlNode | null | undefined, localName: string, namespace?: string): XmlElement | undefined {
  for (let node = parent?.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    const element = node as XmlElement
    if (element.localName === localName && (!namespace || element.namespaceURI === namespace)) return element
  }
  return undefined
}

export function children(parent: XmlNode | null | undefined, localName: string, namespace?: string): XmlElement[] {
  return childElements(parent).filter((element) => element.localName === localName && (!namespace || element.namespaceURI === namespace))
}

/** Follows a path of local names (`['p:cSld', 'p:spTree']` without prefixes). */
export function path(parent: XmlNode | null | undefined, ...names: string[]): XmlElement | undefined {
  let current: XmlNode | null | undefined = parent
  for (const name of names) {
    current = child(current, name)
    if (!current) return undefined
  }
  return current as XmlElement | undefined
}

export function attr(element: XmlElement | null | undefined, name: string): string | undefined {
  if (!element || !element.hasAttribute(name)) return undefined
  return element.getAttribute(name) ?? undefined
}

/** An `r:` (relationships namespace) attribute, whatever prefix the file used for it. */
export function relAttr(element: XmlElement | null | undefined, localName: string): string | undefined {
  if (!element) return undefined
  const value = element.getAttributeNS(NS.r, localName)
  return value || undefined
}

/** Integer attribute; garbage reads as undefined rather than NaN so it never poisons layout math. */
export function intAttr(element: XmlElement | null | undefined, name: string): number | undefined {
  const value = attr(element, name)
  if (value === undefined) return undefined
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : undefined
}

export function boolAttr(element: XmlElement | null | undefined, name: string): boolean | undefined {
  const value = attr(element, name)
  if (value === undefined) return undefined
  return value === '1' || value === 'true' || value === 'on'
}

/** Creates an element in `document` with a qualified name whose prefix is one of DEFAULT_PREFIXES. */
export function createElement(document: XmlDocument, qualifiedName: string): XmlElement {
  const prefix = qualifiedName.includes(':') ? qualifiedName.slice(0, qualifiedName.indexOf(':')) : ''
  const namespace = DEFAULT_PREFIXES[prefix]
  if (!namespace) throw new Error(`Unknown prefix in ${qualifiedName}`)
  return document.createElementNS(namespace, qualifiedName)
}

/** Replaces `existing` (or appends to `parent` before the first of `before`) with `replacement`. */
export function replaceOrInsert(
  parent: XmlElement,
  existing: XmlElement | undefined,
  replacement: XmlElement | undefined,
  before: readonly string[] = [],
): void {
  if (existing && replacement) {
    parent.replaceChild(replacement, existing)
  } else if (existing) {
    parent.removeChild(existing)
  } else if (replacement) {
    const anchor = childElements(parent).find((element) => before.includes(element.localName ?? ''))
    parent.insertBefore(replacement, anchor ?? null)
  }
}

/** Imports a template string into `document`, ready to insert, without redundant declarations. */
export function importFragment(document: XmlDocument, xml: string, prefixes?: Record<string, string>): XmlElement {
  return document.importNode(parseFragment(xml, prefixes), true) as XmlElement
}

/** Stable JSON for comparisons: object keys sorted, undefined dropped. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value instanceof Uint8Array) return Array.from(value)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) sorted[key] = sortKeys(entry)
    }
    return sorted
  }
  return value
}

export function bytesEqual(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.byteLength !== b.byteLength) return false
  for (let index = 0; index < a.byteLength; index++) if (a[index] !== b[index]) return false
  return true
}
