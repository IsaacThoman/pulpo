import { decodePartText } from '../ooxml/package.js'
import type { SlideSnapshot } from './model.js'
import type { DeckResources } from './render/deck.js'
import { NS, parseFragment, REL_TYPES, stableStringify, type XmlElement } from './xml.js'

/** Expanded names ignore namespace prefixes; attribute order, comments and indentation are benign. */
function xmlNode(element: XmlElement, preserveSpace = false): unknown {
  const name = (namespace: string | null, local: string) => `${namespace ?? ''}:${local}`
  const attributes = Array.from({ length: element.attributes.length }, (_, index) => element.attributes.item(index)!)
    .filter((attribute) => attribute.namespaceURI !== NS.xmlns && attribute.name !== 'xmlns')
    .map((attribute) => [name(attribute.namespaceURI, attribute.localName ?? attribute.name), attribute.value])
    .sort(([a], [b]) => a!.localeCompare(b!))
  const space = element.getAttributeNS(NS.xml, 'space')
  const preserve = space === 'preserve' || (space !== 'default' && preserveSpace)
  const hasElements = Array.from(element.childNodes).some((node) => node.nodeType === 1)
  const children: unknown[] = []
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) children.push(xmlNode(child as XmlElement, preserve))
    else if (child.nodeType === 3 || child.nodeType === 4) {
      const text = child.nodeValue ?? ''
      if (!text || (!preserve && hasElements && !text.trim())) continue
      if (typeof children.at(-1) === 'string') children[children.length - 1] += text
      else children.push(text)
    }
  }
  // OPC relationship order does not affect resolution.
  if (element.localName === 'Relationships' && element.namespaceURI === 'http://schemas.openxmlformats.org/package/2006/relationships') children.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
  return [name(element.namespaceURI, element.localName ?? element.nodeName), attributes, children]
}

const PLAIN_STRINGS = new Set(['text', 'name', 'descr', 'target', 'key', 'part', 'hash', 'mimeType', 'contentType'])

/** All modeled properties participate, including XML nested in text marks and table cells. */
export function canonicalValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && !PLAIN_STRINGS.has(key) && /^\s*</.test(value)) {
    try { return xmlNode(parseFragment(value.replace(/^\s*<\?xml[^?]*\?>/, ''))) } catch { return value }
  }
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'source' && key !== 'relsSource').map(([key, entry]) => [key, canonicalValue(entry, key)]))
  return value
}

/** Per-comparison caches avoid reparsing shared masters, layouts, charts and diagrams per slide. */
export class CanonicalPresentation {
  private readonly parts = new Map<string, unknown>()

  constructor(readonly deck: DeckResources) {}

  part(path: string): unknown {
    if (this.parts.has(path)) return this.parts.get(path)
    const part = this.deck.parts[path]
    const result = part ? {
      contentType: part.contentType,
      ...(part.asset ? { hash: part.asset.hash, mimeType: part.asset.mimeType } : {}),
      ...(part.bytes ? { content: /\.(xml|rels)$/.test(path) || /xml/.test(part.contentType ?? '') ? canonicalValue(decodePartText(part.bytes), 'xml') : Array.from(part.bytes) } : {}),
    } : null
    this.parts.set(path, result)
    return result
  }

  slide(slide: SlideSnapshot): string {
    const roots = new Set<string>([slide.layout])
    const add = (rels: SlideSnapshot['rels']) => Object.values(rels).forEach((rel) => { if (!rel.external && rel.type !== REL_TYPES.slide) roots.add(rel.target) })
    add(slide.rels)
    const shapes = (entries: SlideSnapshot['shapes']) => entries.forEach((shape) => { add(shape.rels); shapes(shape.children ?? []) })
    shapes(slide.shapes)
    if (slide.notes) { add(slide.notes.rels); if (slide.notes.part) roots.add(slide.notes.part) }
    const seen = new Set<string>()
    const queue = [...roots].filter(Boolean)
    for (let index = 0; index < queue.length; index++) {
      const part = queue[index]!
      if (seen.has(part)) continue
      seen.add(part)
      for (const rel of this.deck.rels(part).values()) {
        // Masters list every layout, but only this slide's layout affects its appearance.
        if (rel.external || rel.type === REL_TYPES.slide || (rel.type === REL_TYPES.slideLayout && rel.target !== slide.layout)) continue
        queue.push(rel.target)
      }
    }
    const { key: _key, part: _part, sldId: _id, source: _source, relsSource: _relsSource, ...model } = slide
    return stableStringify({ model: canonicalValue(model), parts: [...seen].sort().map((part) => [part, this.part(part), this.part(part.replace(/\/([^/]+)$/, '/_rels/$1.rels'))]) })
  }
}
