import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { jmlAttr, jmlChild, jmlOn, unpackJml, type JmlElement } from '../jsonml.js'
import { noteInventory } from '../notes.js'
import { effectiveParagraphProperties } from './commands.js'
import type { DocxViewContext } from './context.js'
import { PX_PER_PT, layoutPages, pageSetup, type LayoutResult, type LayoutUnit, type PageSetup } from './layout.js'

/**
 * Measures the editor's continuous column into layout units and turns layout breaks into
 * decorations: a block spacer before a paragraph or table, an inline spacer at the start of a
 * line inside a paragraph, and a padded row in a table.
 */

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

export interface Section {
  sectPr: JmlElement | undefined
  setup: PageSetup
}

/** Sections in order: each paragraph with a `w:sectPr` ends one; the document's own ends the last. */
export function documentSections(doc: ProseMirrorNode, finalSectPr: JmlElement | undefined): { sections: Section[]; sectionOfBlock: number[] } {
  const sections: Section[] = []
  const sectionOfBlock: number[] = []
  doc.forEach((node) => {
    sectionOfBlock.push(sections.length)
    let ends: JmlElement | undefined
    if (node.type.name === 'paragraph') ends = jml(node.attrs.sectPr)
    else node.descendants((child) => {
      if (child.type.name === 'paragraph' && child.attrs.sectPr && !ends) ends = jml(child.attrs.sectPr)
      return !ends
    })
    if (ends) sections.push({ sectPr: ends, setup: pageSetup(ends) })
  })
  sections.push({ sectPr: finalSectPr, setup: pageSetup(finalSectPr) })
  return { sections, sectionOfBlock }
}

/** Where a unit's spacer goes. */
export type UnitAnchor =
  | { kind: 'block'; pos: number }
  | { kind: 'line'; paragraph: HTMLElement; paragraphPos: number; top: number }
  | { kind: 'row'; table: ProseMirrorNode; tablePos: number; row: number }

interface Measured {
  units: LayoutUnit[]
  anchors: UnitAnchor[]
}

interface Frame {
  top: number
  scale: number
}

function rectIn(frame: Frame, rect: DOMRect): { top: number; bottom: number } {
  return { top: (rect.top - frame.top) / frame.scale, bottom: (rect.bottom - frame.top) / frame.scale }
}

/** Line boxes of a paragraph, top to bottom, from the boxes of its inline content. */
export function lineBoxes(paragraph: HTMLElement, frame: Frame): { top: number; bottom: number }[] {
  const range = paragraph.ownerDocument.createRange()
  range.selectNodeContents(paragraph)
  const lines: { top: number; bottom: number }[] = []
  for (const rect of range.getClientRects()) {
    if (rect.height < 1) continue
    const box = rectIn(frame, rect)
    const last = lines[lines.length - 1]
    if (last && box.top < last.bottom - 1) {
      last.top = Math.min(last.top, box.top)
      last.bottom = Math.max(last.bottom, box.bottom)
    } else if (!last || box.top >= last.bottom - 1) {
      lines.push({ ...box })
    }
  }
  return lines
}

/** The document position where the line starting at `top` begins. */
export function lineStartPosition(view: EditorView, paragraph: HTMLElement, top: number, frame: Frame): number | undefined {
  const document = paragraph.ownerDocument
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const range = document.createRange()
  const above = (rect: DOMRect) => rectIn(frame, rect).top < top - 1
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.classList.contains('docx-page-spacer')) continue
      if (element.getAttribute('contenteditable') === 'false' && element.getClientRects().length) {
        if (!above(element.getBoundingClientRect())) return view.posAtDOM(element, 0)
      }
      continue
    }
    const text = node as Text
    if (!text.length || text.parentElement?.closest('[contenteditable="false"]')) continue
    range.selectNodeContents(text)
    const rects = range.getClientRects()
    const last = rects[rects.length - 1]
    if (!last || above(last)) continue
    // Binary search for the first character on the line.
    let low = 0
    let high = text.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      range.setStart(text, middle)
      range.setEnd(text, middle + 1)
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
      if (above(rect)) low = middle + 1
      else high = middle
    }
    return view.posAtDOM(text, low)
  }
  return undefined
}

function measureParagraph(view: EditorView, node: ProseMirrorNode, pos: number, block: number, section: number, columns: number, context: DocxViewContext, frame: Frame, out: Measured): void {
  const dom = view.nodeDOM(pos) as HTMLElement | null
  if (!dom || !(dom instanceof HTMLElement)) return
  const props = effectiveParagraphProperties(node, context)
  const box = rectIn(frame, dom.getBoundingClientRect())
  let lines = lineBoxes(dom, frame)
  if (!lines.length) lines = [box]
  // The first line takes the space before the paragraph; the last its space after.
  lines[0] = { top: box.top, bottom: lines[0]!.bottom }
  if (lines.length === 1) lines[0] = { top: box.top, bottom: Math.max(lines[0]!.bottom, box.bottom) }
  // A raised note mark sits above its line's top; place it by its middle.
  const notes = [...dom.querySelectorAll<HTMLElement>('.docx-noteref[data-note^="footnote:"]')].map((element) => {
    const box = rectIn(frame, element.getBoundingClientRect())
    return { id: element.dataset.note!, middle: (box.top + box.bottom) / 2 }
  })
  const lineOf = (middle: number) => {
    let found = 0
    lines.forEach((line, index) => { if (line.top <= middle + 2) found = index })
    return found
  }
  // Columns are drawn as one, so a column break only starts a page in single-column sections.
  const breaks = [...dom.querySelectorAll<HTMLElement>(columns > 1 ? '.docx-page-break' : '.docx-page-break,.docx-column-break')].map((element) => rectIn(frame, element.getBoundingClientRect()).bottom)
  const keepNext = jmlOn(props.get('w:keepNext')) === true
  const keepLines = jmlOn(props.get('w:keepLines')) === true
  const widowControl = props.has('w:widowControl') ? jmlOn(props.get('w:widowControl')) === true : true
  const pageBreakBefore = jmlOn(props.get('w:pageBreakBefore')) === true
  lines.forEach((line, index) => {
    out.units.push({
      top: line.top,
      bottom: line.bottom,
      block,
      kind: 'line',
      line: index,
      lines: lines.length,
      keepNext,
      keepLines,
      widowControl,
      breakBefore: (index === 0 && pageBreakBefore) || breaks.some((bottom) => bottom <= line.top + 1 && bottom > (lines[index - 1]?.top ?? -Infinity)),
      section,
      notes: notes.filter((note) => lineOf(note.middle) === index).map((note) => note.id),
    })
    out.anchors.push(index === 0 ? { kind: 'block', pos } : { kind: 'line', paragraph: dom, paragraphPos: pos, top: line.top })
  })
}

function measureTable(view: EditorView, node: ProseMirrorNode, pos: number, block: number, section: number, frame: Frame, out: Measured): void {
  const dom = view.nodeDOM(pos) as HTMLElement | null
  const table = dom instanceof HTMLTableElement ? dom : dom?.querySelector<HTMLTableElement>(':scope > table') ?? null
  if (!table) return
  const rows = [...table.querySelectorAll(':scope > tbody > tr')] as HTMLElement[]
  // Header rows repeat at the top of every page the table continues on.
  let header = 0
  let headerRows = 0
  for (let index = 0; index < node.childCount; index++) {
    const tblHeader = jmlChild(jml(node.child(index).attrs.trPr), 'w:tblHeader')
    if (!tblHeader || jmlOn(tblHeader) === false) break
    headerRows++
    const row = rows[index]
    if (row) header += row.getBoundingClientRect().height / frame.scale
  }
  rows.forEach((row, index) => {
    const box = rectIn(frame, row.getBoundingClientRect())
    const notes = [...row.querySelectorAll<HTMLElement>('.docx-noteref[data-note^="footnote:"]')].map((element) => element.dataset.note!)
    out.units.push({ top: box.top, bottom: box.bottom, block, kind: index === 0 ? 'block' : 'row', section, notes, repeatHeader: index >= headerRows ? header : 0 })
    out.anchors.push(index === 0 ? { kind: 'block', pos } : { kind: 'row', table: node, tablePos: pos, row: index })
  })
}

/** Layout units of the whole document, top-level blocks and those inside wrappers. */
export function measureDocument(view: EditorView, context: DocxViewContext, sectionOfBlock: number[], sections: Section[] = []): Measured {
  const flow = view.dom as HTMLElement
  const rect = flow.getBoundingClientRect()
  const frame: Frame = { top: rect.top, scale: flow.offsetWidth ? rect.width / flow.offsetWidth : 1 }
  const out: Measured = { units: [], anchors: [] }
  let block = 0
  const visit = (node: ProseMirrorNode, pos: number, section: number) => {
    const index = block++
    if (node.type.name === 'paragraph') measureParagraph(view, node, pos, index, section, sections[section]?.setup.columns ?? 1, context, frame, out)
    else if (node.type.name === 'table') measureTable(view, node, pos, index, section, frame, out)
    else if (node.type.name === 'blockWrapper') node.forEach((child, offset) => visit(child, pos + 1 + offset, section))
    else {
      const dom = view.nodeDOM(pos) as HTMLElement | null
      if (!dom) return
      const box = rectIn(frame, dom.getBoundingClientRect())
      out.units.push({ top: box.top, bottom: box.bottom, block: index, kind: 'block', section })
      out.anchors.push({ kind: 'block', pos })
    }
  }
  let top = 0
  view.state.doc.forEach((node, offset) => {
    visit(node, offset, sectionOfBlock[top] ?? 0)
    top++
  })
  const notes = noteInventory(view.state.doc)
  for (const unit of out.units) if (unit.notes) unit.notes = unit.notes.filter((id) => notes.has(id))
  return out
}

/** Header rows to draw again at the top of a page a table continues on. */
export interface RepeatedHeader {
  tablePos: number
  rows: number
  page: number
}

export interface PaginationResult {
  units: LayoutUnit[]
  repeats: RepeatedHeader[]
  layout: LayoutResult
  sections: Section[]
  decorations: Decoration[]
}

function spacer(height: number): HTMLElement {
  const element = document.createElement('span')
  element.className = 'docx-page-spacer'
  element.style.height = `${height}px`
  element.contentEditable = 'false'
  element.setAttribute('aria-hidden', 'true')
  return element
}

/** Decorations that open the layout's page breaks in the column. */
export function breakDecorations(view: EditorView, measured: Measured, layout: LayoutResult): Decoration[] {
  const decorations: Decoration[] = []
  const flow = view.dom as HTMLElement
  const rect = flow.getBoundingClientRect()
  const frame: Frame = { top: rect.top, scale: flow.offsetWidth ? rect.width / flow.offsetWidth : 1 }
  for (const { unit, height, stub } of layout.breaks) {
    const unitIndex = unit
    const anchor = measured.anchors[unit]
    if (!anchor || height <= 0) continue
    if (anchor.kind === 'block') {
      decorations.push(Decoration.widget(anchor.pos, () => spacer(height), { side: -1, key: `page-${anchor.pos}-${Math.round(height)}`, ignoreSelection: true }))
    } else if (anchor.kind === 'line') {
      const pos = lineStartPosition(view, anchor.paragraph, anchor.top, frame)
      if (pos !== undefined) decorations.push(Decoration.widget(pos, () => spacer(height), { side: -1, key: `line-${pos}-${Math.round(height)}`, ignoreSelection: true, marks: [] }))
    } else {
      let map: TableMap
      try {
        map = TableMap.get(anchor.table)
      } catch {
        continue
      }
      const seen = new Set<number>()
      for (let col = 0; col < map.width; col++) {
        const offset = map.map[anchor.row * map.width + col]!
        if (seen.has(offset)) continue
        seen.add(offset)
        if (map.findCell(offset).top !== anchor.row) continue
        const cell = anchor.table.nodeAt(offset)!
        const from = anchor.tablePos + 1 + offset
        // The row grows by exactly the spacer: a minimum row height would otherwise absorb part of it.
        const unit = measured.units[unitIndex]
        const rowHeight = unit ? unit.bottom - unit.top : 0
        // The stub left on the page before stays blank: the moved row's borders and shading are masked there.
        decorations.push(Decoration.node(from, from + cell.nodeSize, { class: 'docx-row-spacer', style: `--docx-row-spacer:${height}px;--docx-row-stub:${Math.min(stub, height)}px;height:${rowHeight + height}px` }))
      }
    }
  }
  return decorations
}

/** Measures and lays out the document; callers clear old spacers first. */
export function paginate(view: EditorView, context: DocxViewContext, noteHeight: (id: string) => number, adjust?: (setup: PageSetup, index: number, sections: Section[]) => PageSetup, trailing = 0): PaginationResult {
  const { sections: raw, sectionOfBlock } = documentSections(view.state.doc, context.finalSectPr)
  const sections = adjust ? raw.map((section, index) => ({ ...section, setup: adjust(section.setup, index, raw) })) : raw
  const measured = measureDocument(view, context, sectionOfBlock, sections)
  // Room after the text (for endnotes), as one more block at the end.
  const last = measured.units[measured.units.length - 1]
  if (trailing > 0 && last) {
    measured.units.push({ top: last.bottom, bottom: last.bottom + trailing, block: last.block + 1, kind: 'block', section: last.section })
    measured.anchors.push({ kind: 'block', pos: view.state.doc.content.size })
  }
  const layout = layoutPages(measured.units, { sections: sections.map((section) => section.setup), noteHeight, noteSeparator: 9 * PX_PER_PT })
  const repeats: RepeatedHeader[] = []
  for (const { unit, page } of layout.breaks) {
    const anchor = measured.anchors[unit]
    if (anchor?.kind !== 'row' || !measured.units[unit]?.repeatHeader) continue
    let rows = 0
    while (rows < anchor.table.childCount && jmlChild(jml(anchor.table.child(rows).attrs.trPr), 'w:tblHeader')) rows++
    repeats.push({ tablePos: anchor.tablePos, rows, page })
  }
  return { units: measured.units, repeats, layout, sections, decorations: breakDecorations(view, measured, layout) }
}

/** Which header or footer reference a page uses: first, even, or default (inheriting from earlier sections). */
export function storyReference(sections: Section[], sectionIndex: number, kind: 'header' | 'footer', page: { firstOfSection: boolean; number: number }, evenAndOdd: boolean): { relId: string; type: string } | undefined {
  const wanted = page.firstOfSection && sections[sectionIndex]?.setup.titlePage ? 'first' : evenAndOdd && page.number % 2 === 0 ? 'even' : 'default'
  for (let index = sectionIndex; index >= 0; index--) {
    const sectPr = sections[index]?.sectPr
    if (!sectPr) continue
    for (const child of sectPr.slice(2) as JmlElement[]) {
      if (!Array.isArray(child) || child[0] !== `w:${kind}Reference`) continue
      if ((jmlAttr(child, 'w:type') ?? 'default') === wanted) {
        const relId = jmlAttr(child, 'r:id')
        if (relId) return { relId, type: wanted }
      }
    }
  }
  return undefined
}
