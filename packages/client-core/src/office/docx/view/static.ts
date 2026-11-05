import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { jmlAttr, jmlText, unpackJml, type JmlElement } from '../jsonml.js'
import { formatNumber } from '../numbering.js'
import { inlineMarks } from '../schema.js'
import type { AssetUrls } from './assets.js'
import type { DocxViewContext } from './context.js'
import { computeDecorations } from './decorations.js'
import { layoutTabs, paragraphTabs, type ParagraphTabs } from './tabs.js'
import type { DocxLabels } from './labels.js'
import { DrawingView, MathView } from './nodeviews.js'

/**
 * Headers, footers, and notes drawn without an editor: once per page, with PAGE and NUMPAGES
 * fields showing that page's numbers (the field codes stay in the document untouched).
 */

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

export interface FieldValues {
  page: number
  pages: number
  sectionPages?: number
  /** `w:pgNumType w:fmt` of the page's section. */
  format?: string
}

function fieldValue(code: string, values: FieldValues): string | undefined {
  const name = code.trim().split(/\s+/)[0]?.toUpperCase()
  const format = /\\\*\s*(roman|ROMAN|alphabetic|ALPHABETIC|Arabic)/.exec(code)?.[1]
  const formatted = (value: number) => {
    if (format === 'roman') return formatNumber(value, 'lowerRoman')
    if (format === 'ROMAN') return formatNumber(value, 'upperRoman')
    if (format === 'alphabetic') return formatNumber(value, 'lowerLetter')
    if (format === 'ALPHABETIC') return formatNumber(value, 'upperLetter')
    return formatNumber(value, name === 'PAGE' ? (values.format ?? 'decimal') : 'decimal')
  }
  if (name === 'PAGE') return formatted(values.page)
  if (name === 'NUMPAGES') return formatted(values.pages)
  if (name === 'SECTIONPAGES') return formatted(values.sectionPages ?? values.pages)
  return undefined
}

/** A paragraph with page fields showing `values`. */
function withFieldValues(paragraph: ProseMirrorNode, values: FieldValues): ProseMirrorNode {
  const schema = paragraph.type.schema
  const children: ProseMirrorNode[] = []
  let code = ''
  let state: 'none' | 'code' | 'result' = 'none'
  let replaced = false
  let changed = false
  paragraph.forEach((child) => {
    const simple = inlineMarks(child).find((mark) => mark.type.name === 'fldSimple')
    if (simple && child.isText) {
      const value = fieldValue(jmlAttr(jml(simple.attrs.v), 'w:instr') ?? '', values)
      if (value !== undefined) {
        const previous = children[children.length - 1]
        if (previous?.isText && previous.marks.some((mark) => mark.eq(simple))) return
        children.push(schema.text(value, child.marks))
        changed = true
        return
      }
    }
    if (child.type.name === 'fieldChar') {
      const type = child.attrs.charType as string
      if (type === 'begin') {
        state = 'code'
        code = ''
        replaced = false
      } else if (type === 'separate') state = 'result'
      else if (type === 'end') {
        // A field with no cached result still shows its value.
        if (state === 'code' && !replaced) {
          const value = fieldValue(code, values)
          if (value !== undefined) {
            children.push(schema.text(value))
            changed = true
          }
        }
        state = 'none'
      }
      children.push(child)
      return
    }
    if (state === 'code') {
      if (child.type.name === 'fieldCode') code += jmlText(jml(child.attrs.v) ?? ['', {}])
      children.push(child)
      return
    }
    if (state === 'result') {
      const value = fieldValue(code, values)
      if (value !== undefined && child.isText) {
        if (!replaced) children.push(schema.text(value, child.marks))
        replaced = true
        changed = true
        return
      }
    }
    children.push(child)
  })
  return changed ? paragraph.type.create(paragraph.attrs, children, paragraph.marks) : paragraph
}

function withFields(node: ProseMirrorNode, values: FieldValues): ProseMirrorNode {
  if (node.type.name === 'paragraph') return withFieldValues(node, values)
  if (node.isLeaf || node.isTextblock) return node
  const children: ProseMirrorNode[] = []
  let changed = false
  node.forEach((child) => {
    const next = withFields(child, values)
    changed ||= next !== child
    children.push(next)
  })
  return changed ? node.type.create(node.attrs, children, node.marks) : node
}

export interface StaticOptions {
  urls: AssetUrls
  labels: DocxLabels
  fields?: FieldValues
  /** The number a note's own mark shows. */
  noteNumber?: number | string
  noteNumbers?: Map<string, number>
  /** For tab stops, which `layoutStaticTabs` reads back from the paragraphs. */
  context?: DocxViewContext
}

const serializers = new WeakMap<object, DOMSerializer>()

function serializer(doc: ProseMirrorNode, options: StaticOptions): DOMSerializer {
  const base = serializers.get(doc.type.schema) ?? DOMSerializer.fromSchema(doc.type.schema)
  serializers.set(doc.type.schema, base)
  const custom = new DOMSerializer({
    ...base.nodes,
    paragraph: (node) => {
      const spec = base.nodes.paragraph!(node)
      const element = (spec instanceof HTMLElement ? spec : DOMSerializer.renderSpec(document, spec)) as HTMLElement | { dom: HTMLElement; contentDOM?: HTMLElement }
      const rendered = element instanceof HTMLElement ? { dom: element, contentDOM: element } : element
      if (options.context && node.childCount) rendered.dom.dataset.docxTabs = JSON.stringify(paragraphTabs(node, options.context))
      return rendered
    },
    drawing: (node) => new DrawingView(node, null as never, () => undefined, { urls: options.urls, labels: options.labels, readOnly: () => true }).dom,
    math: (node) => new MathView(node, options.labels).dom,
    noteRef: (node) => {
      const element = document.createElement('sup')
      element.className = 'docx-noteref'
      element.dataset.label = String(options.noteNumbers?.get(`${node.attrs.kind}:${node.attrs.id}`) ?? '')
      return element
    },
    inlineXml: (node) => {
      const spec = base.nodes.inlineXml!(node)
      const element = (spec instanceof HTMLElement ? spec : DOMSerializer.renderSpec(document, spec).dom) as HTMLElement
      const name = jml(node.attrs.v)?.[0]
      if ((name === 'w:footnoteRef' || name === 'w:endnoteRef') && options.noteNumber !== undefined) element.dataset.label = String(options.noteNumber)
      return element
    },
  }, base.marks)
  if (!options.context) return custom
  const attributes = new Map<number, Record<string, string>>()
  computeDecorations(doc, { context: options.context, noteNumbers: options.noteNumbers ?? new Map(), noteNumber: options.noteNumber, nodeAttributes: attributes })
  // A node may occur several times in a fragment; keep its attributes per occurrence.
  const occurrences = new Map<ProseMirrorNode, { attrs: (Record<string, string> | undefined)[]; next: number }>()
  doc.descendants((node, pos) => {
    if (node.isText) return
    const entry = occurrences.get(node) ?? { attrs: [], next: 0 }
    entry.attrs.push(attributes.get(pos))
    occurrences.set(node, entry)
  })
  const nodes = Object.fromEntries(Object.entries(custom.nodes).map(([name, render]) => [name, (node: ProseMirrorNode) => {
    const entry = occurrences.get(node)
    const attrs = entry?.attrs[entry.next++]
    const spec = render(node)
    if (!attrs) return spec
    const rendered = DOMSerializer.renderSpec(document, spec)
    if (!(rendered.dom instanceof HTMLElement)) return rendered
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'style') rendered.dom.style.cssText += value
      else if (key === 'class') rendered.dom.classList.add(...value.split(/\s+/).filter(Boolean))
      else rendered.dom.setAttribute(key, value)
    }
    return rendered
  }]))
  return new DOMSerializer(nodes, custom.marks)
}

/** A story as static DOM inside a `.docx-flow` container, so the document's styles apply. */
export function renderStory(doc: ProseMirrorNode, options: StaticOptions): HTMLElement {
  const container = document.createElement('div')
  container.className = 'docx-flow'
  const content = options.fields ? withFields(doc, options.fields) : doc
  container.appendChild(serializer(content, options).serializeFragment(content.content))
  return container
}

/** Sizes the tabs of a rendered story from the stops `renderStory` recorded. */
export function layoutStaticTabs(container: HTMLElement): void {
  layoutTabs(container, (paragraph) => {
    const data = paragraph.dataset.docxTabs
    if (!data) return undefined
    try {
      return JSON.parse(data) as ParagraphTabs
    } catch {
      return undefined
    }
  })
}
