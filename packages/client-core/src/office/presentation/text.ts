import { Node as ProseMirrorNode, Schema, type MarkSpec, type NodeSpec } from '@tiptap/pm/model'
import {
  attr,
  child,
  childElements,
  createElement,
  importFragment,
  NS,
  parseFragment,
  relAttr,
  serializeNode,
  type XmlDocument,
  type XmlElement,
} from './xml.js'

/**
 * Text bodies (`a:txBody`) as ProseMirror documents, stored in Y.XmlFragments so several people
 * can type in one shape at once.
 *
 * Paragraph properties stay one raw `a:pPr` string per paragraph: they rarely conflict. Run
 * properties are split into one mark per property (bold, size, color, …) plus a mark holding
 * whatever is left of `a:rPr`, so one person making a range bold while another makes it italic
 * keeps both. Elements we do not model (math, unknown extensions) ride along as opaque inline
 * nodes and are written back verbatim.
 */

export interface TextJSON {
  type: string
  attrs?: Record<string, unknown>
  content?: TextJSON[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

/** Run property attributes that have their own mark. */
const VALUE_MARKS = {
  b: 'b',
  i: 'i',
  u: 'u',
  strike: 'strike',
  sz: 'sz',
  baseline: 'baseline',
  cap: 'cap',
  spc: 'spc',
} as const

/** Run property children that have their own mark, as raw XML. */
const FILL_ELEMENTS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

/** CT_TextCharacterProperties child order, for inserting modeled children back. */
const RPR_CHILD_ORDER = [
  'ln',
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
  'effectLst',
  'effectDag',
  'highlight',
  'uLnTx',
  'uLn',
  'uFillTx',
  'uFill',
  'latin',
  'ea',
  'cs',
  'sym',
  'hlinkClick',
  'hlinkMouseOver',
  'rtl',
  'extLst',
]

const valueMark = (): MarkSpec => ({ attrs: { value: {} } })

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'paragraph+' },
  paragraph: {
    content: 'inline*',
    attrs: { pPr: { default: null }, endRPr: { default: null } },
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  text: { group: 'inline' },
  /** `a:br`: a line break inside a paragraph (Shift+Enter). */
  br: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    attrs: { rPr: { default: null } },
    toDOM: () => ['br'],
  },
  /** `a:fld`: slide number, date, … The cached text is shown until the renderer computes a fresh one. */
  field: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { id: { default: null }, fieldType: { default: null }, text: { default: '' }, rPr: { default: null }, pPr: { default: null } },
    toDOM: (node) => ['span', { 'data-field': String(node.attrs.fieldType ?? '') }, String(node.attrs.text ?? '')],
  },
  /** Anything else inside `a:p` (equations in mc:AlternateContent, extensions), kept verbatim. */
  opaque: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { xml: { default: '' }, text: { default: '' } },
    toDOM: (node) => ['span', { 'data-opaque': '' }, String(node.attrs.text ?? '')],
  },
}

const marks: Record<string, MarkSpec> = {
  b: valueMark(),
  i: valueMark(),
  u: valueMark(),
  strike: valueMark(),
  sz: valueMark(),
  baseline: valueMark(),
  cap: valueMark(),
  spc: valueMark(),
  /** Latin typeface (`a:latin/@typeface`). */
  font: valueMark(),
  /** The run's fill element (`a:solidFill`, …) as XML. */
  fill: valueMark(),
  highlight: valueMark(),
  /** `a:hlinkClick` as XML, with its relationship resolved into `target`. */
  link: { attrs: { xml: {}, target: { default: null }, external: { default: true } }, inclusive: false },
  /** Whatever else `a:rPr` holds (lang, effects, east Asian fonts, …), as XML. */
  rPr: valueMark(),
}

let schema: Schema | undefined

export function slideTextSchema(): Schema {
  schema ??= new Schema({ nodes, marks })
  return schema
}

export const EMPTY_TEXT: TextJSON = { type: 'doc', content: [{ type: 'paragraph', attrs: { pPr: null, endRPr: null } }] }

/** Canonical JSON for a text document, so values from files and from Y.XmlFragments compare equal. */
export function normalizeText(json: TextJSON): TextJSON {
  const normalized = slideTextSchema().nodeFromJSON(json).toJSON() as TextJSON
  for (const paragraph of normalized.content ?? []) {
    if (!paragraph.content) continue
    const merged: TextJSON[] = []
    for (const inline of paragraph.content) {
      const previous = merged[merged.length - 1]
      // Runs with the same formatting are one run to Yjs, so they must be one here too.
      if (inline.type === 'text' && previous?.type === 'text' && JSON.stringify(previous.marks ?? []) === JSON.stringify(inline.marks ?? [])) {
        merged[merged.length - 1] = { ...previous, text: (previous.text ?? '') + (inline.text ?? '') }
      } else merged.push(inline)
    }
    paragraph.content = merged
  }
  return normalized
}

export function textNode(json: TextJSON): ProseMirrorNode {
  return slideTextSchema().nodeFromJSON(json)
}

export interface RelationshipResolver {
  /** The target of a relationship of the part the text lives in. */
  target(id: string): { target: string; external: boolean } | undefined
}

/** Reads an `a:txBody` (or `p:txBody`) as a text document. */
export function readTextBody(txBody: XmlElement, rels?: RelationshipResolver): TextJSON {
  const paragraphs = childElements(txBody)
    .filter((element) => element.localName === 'p' && element.namespaceURI === NS.a)
    .map((paragraph) => readParagraph(paragraph, rels))
  return normalizeText({ type: 'doc', content: paragraphs.length ? paragraphs : EMPTY_TEXT.content })
}

function readParagraph(paragraph: XmlElement, rels?: RelationshipResolver): TextJSON {
  const pPr = child(paragraph, 'pPr', NS.a)
  const endRPr = child(paragraph, 'endParaRPr', NS.a)
  const content: TextJSON[] = []
  for (const element of childElements(paragraph)) {
    const name = element.localName
    if (element.namespaceURI === NS.a && (name === 'pPr' || name === 'endParaRPr')) continue
    if (element.namespaceURI === NS.a && name === 'r') {
      const text = child(element, 't', NS.a)?.textContent ?? ''
      if (text) content.push({ type: 'text', text, marks: readRunMarks(child(element, 'rPr', NS.a), rels) })
    } else if (element.namespaceURI === NS.a && name === 'br') {
      const rPr = child(element, 'rPr', NS.a)
      content.push({ type: 'br', attrs: { rPr: rPr ? serializeNode(rPr) : null } })
    } else if (element.namespaceURI === NS.a && name === 'fld') {
      const rPr = child(element, 'rPr', NS.a)
      const fieldPPr = child(element, 'pPr', NS.a)
      content.push({
        type: 'field',
        attrs: {
          id: attr(element, 'id') ?? null,
          fieldType: attr(element, 'type') ?? null,
          text: child(element, 't', NS.a)?.textContent ?? '',
          rPr: rPr ? serializeNode(rPr) : null,
          pPr: fieldPPr ? serializeNode(fieldPPr) : null,
        },
      })
    } else {
      content.push({ type: 'opaque', attrs: { xml: serializeNode(element), text: opaqueText(element) } })
    }
  }
  return {
    type: 'paragraph',
    attrs: { pPr: pPr ? serializeNode(pPr) : null, endRPr: endRPr ? serializeNode(endRPr) : null },
    ...(content.length ? { content } : {}),
  }
}

/** Visible text of an opaque element: an equation's fallback runs, for example. */
function opaqueText(element: XmlElement): string {
  const fallback = childElements(element).find((entry) => entry.localName === 'Fallback') ?? element
  const texts: string[] = []
  const walk = (node: XmlElement, depth: number) => {
    if (depth > 64) return
    for (const entry of childElements(node)) {
      if (entry.localName === 't') texts.push(entry.textContent ?? '')
      else walk(entry, depth + 1)
    }
  }
  walk(fallback, 0)
  return texts.join('')
}

function readRunMarks(rPr: XmlElement | undefined, rels?: RelationshipResolver): TextJSON['marks'] {
  if (!rPr) return undefined
  const result: NonNullable<TextJSON['marks']> = []
  const rest = rPr.cloneNode(true) as XmlElement
  for (const [mark, attribute] of Object.entries(VALUE_MARKS)) {
    const value = attr(rPr, attribute)
    if (value === undefined) continue
    result.push({ type: mark, attrs: { value: markValue(attribute, value) } })
    rest.removeAttribute(attribute)
  }
  for (const element of childElements(rest)) {
    const name = element.localName ?? ''
    if (element.namespaceURI !== NS.a) continue
    if (FILL_ELEMENTS.has(name)) {
      result.push({ type: 'fill', attrs: { value: serializeNode(element) } })
      rest.removeChild(element)
    } else if (name === 'highlight') {
      result.push({ type: 'highlight', attrs: { value: serializeNode(element) } })
      rest.removeChild(element)
    } else if (name === 'latin') {
      const typeface = attr(element, 'typeface')
      if (typeface !== undefined && element.attributes.length === 1 && !element.firstChild) {
        result.push({ type: 'font', attrs: { value: typeface } })
        rest.removeChild(element)
      }
    } else if (name === 'hlinkClick') {
      const id = relAttr(element, 'id')
      const resolved = id ? rels?.target(id) : undefined
      result.push({ type: 'link', attrs: { xml: serializeNode(element), target: resolved?.target ?? null, external: resolved?.external ?? true } })
      rest.removeChild(element)
    }
  }
  if (rest.attributes.length || rest.firstChild) result.push({ type: 'rPr', attrs: { value: serializeNode(rest) } })
  return result.length ? result : undefined
}

function markValue(attribute: string, value: string): string | number | boolean {
  if (attribute === 'b' || attribute === 'i') return value === '1' || value === 'true'
  if (attribute === 'sz' || attribute === 'baseline' || attribute === 'spc') {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) ? number : value
  }
  return value
}

export interface RelationshipAllocator {
  /** A relationship id for `target`, reusing one the part already has where possible. */
  allocate(type: string, target: string, external: boolean, preferredId?: string): string
}

/**
 * Replaces the paragraphs of `txBody` with `json`. `bodyPr` and `lstStyle` stay as they are, and
 * the new paragraphs go where the old ones were.
 */
export function writeParagraphs(txBody: XmlElement, json: TextJSON, rels?: RelationshipAllocator): void {
  const document = txBody.ownerDocument as unknown as XmlDocument
  const existing = childElements(txBody).filter((element) => element.localName === 'p' && element.namespaceURI === NS.a)
  const anchor = existing.length ? existing[existing.length - 1]!.nextSibling : null
  for (const paragraph of existing) txBody.removeChild(paragraph)
  for (const paragraph of json.content ?? []) txBody.insertBefore(writeParagraph(document, paragraph, rels), anchor)
}

function writeParagraph(document: XmlDocument, paragraph: TextJSON, rels?: RelationshipAllocator): XmlElement {
  const element = createElement(document, 'a:p')
  const pPr = paragraph.attrs?.pPr
  if (typeof pPr === 'string' && pPr) element.appendChild(importFragment(document, pPr))
  for (const inline of paragraph.content ?? []) {
    if (inline.type === 'text') element.appendChild(writeRun(document, inline, rels))
    else if (inline.type === 'br') {
      const br = createElement(document, 'a:br')
      const rPr = inline.attrs?.rPr
      if (typeof rPr === 'string' && rPr) br.appendChild(importFragment(document, rPr))
      element.appendChild(br)
    } else if (inline.type === 'field') {
      element.appendChild(writeField(document, inline))
    } else if (inline.type === 'opaque') {
      const xml = inline.attrs?.xml
      if (typeof xml === 'string' && xml) element.appendChild(importFragment(document, xml))
    }
  }
  const endRPr = paragraph.attrs?.endRPr
  if (typeof endRPr === 'string' && endRPr) element.appendChild(importFragment(document, endRPr))
  return element
}

function writeField(document: XmlDocument, field: TextJSON): XmlElement {
  const element = createElement(document, 'a:fld')
  const attrs = field.attrs ?? {}
  if (typeof attrs.id === 'string') element.setAttribute('id', attrs.id)
  if (typeof attrs.fieldType === 'string') element.setAttribute('type', attrs.fieldType)
  if (typeof attrs.rPr === 'string' && attrs.rPr) element.appendChild(importFragment(document, attrs.rPr))
  if (typeof attrs.pPr === 'string' && attrs.pPr) element.appendChild(importFragment(document, attrs.pPr))
  const text = createElement(document, 'a:t')
  text.appendChild(document.createTextNode(String(attrs.text ?? '')))
  element.appendChild(text)
  return element
}

function writeRun(document: XmlDocument, run: TextJSON, rels?: RelationshipAllocator): XmlElement {
  const element = createElement(document, 'a:r')
  const rPr = buildRunProperties(document, run.marks ?? [], rels)
  if (rPr) element.appendChild(rPr)
  const text = createElement(document, 'a:t')
  text.appendChild(document.createTextNode(run.text ?? ''))
  element.appendChild(text)
  return element
}

/** Builds `a:rPr` from marks: the raw remainder first, then each modeled property in schema order. */
export function buildRunProperties(document: XmlDocument, runMarks: NonNullable<TextJSON['marks']>, rels?: RelationshipAllocator): XmlElement | undefined {
  if (!runMarks.length) return undefined
  const raw = runMarks.find((mark) => mark.type === 'rPr')?.attrs?.value
  const rPr = typeof raw === 'string' && raw ? importFragment(document, raw) : createElement(document, 'a:rPr')
  const insertChild = (childElement: XmlElement) => {
    const rank = RPR_CHILD_ORDER.indexOf(childElement.localName ?? '')
    const after = childElements(rPr).find((existing) => RPR_CHILD_ORDER.indexOf(existing.localName ?? '') > rank)
    rPr.insertBefore(childElement, after ?? null)
  }
  for (const mark of runMarks) {
    const value = mark.attrs?.value
    if (mark.type in VALUE_MARKS) {
      const attribute = VALUE_MARKS[mark.type as keyof typeof VALUE_MARKS]
      rPr.setAttribute(attribute, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
    } else if ((mark.type === 'fill' || mark.type === 'highlight') && typeof value === 'string') {
      insertChild(importFragment(document, value))
    } else if (mark.type === 'font' && typeof value === 'string') {
      const latin = createElement(document, 'a:latin')
      latin.setAttribute('typeface', value)
      insertChild(latin)
    } else if (mark.type === 'link' && typeof mark.attrs?.xml === 'string') {
      const link = importFragment(document, mark.attrs.xml)
      const target = mark.attrs.target
      if (typeof target === 'string' && rels) {
        const external = mark.attrs.external !== false
        const type = external ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
        link.setAttributeNS(NS.r, 'r:id', rels.allocate(type, target, external, relAttr(link, 'id')))
      }
      insertChild(link)
    }
  }
  return rPr
}

/** Plain text: paragraphs on their own lines, line breaks as newlines, fields as their text. */
export function textToPlain(json: TextJSON): string {
  return (json.content ?? [])
    .map((paragraph) =>
      (paragraph.content ?? [])
        .map((inline) => {
          if (inline.type === 'text') return inline.text ?? ''
          if (inline.type === 'br') return '\n'
          return String(inline.attrs?.text ?? '')
        })
        .join(''),
    )
    .join('\n')
}

/** A text document holding `text`, one paragraph per line. */
export function plainToText(text: string, pPr: string | null = null): TextJSON {
  const lines = text.split(/\r?\n/)
  return normalizeText({
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', attrs: { pPr, endRPr: null }, ...(line ? { content: [{ type: 'text', text: line }] } : {}) })),
  })
}

/** Parses a raw `a:pPr`/`a:rPr` value, or undefined when the value is empty. */
export function parseProperties(xml: unknown): XmlElement | undefined {
  return typeof xml === 'string' && xml ? parseFragment(xml) : undefined
}
