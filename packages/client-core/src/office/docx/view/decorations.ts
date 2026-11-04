import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { borderCss, cssIdent, cssText, fontStack, latinFont, runPropertiesCss, shadingColor, twipsToPt, type CssProps } from '../css.js'
import { jmlAttr, jmlChild, jmlNumber, unpackJml, type JmlElement } from '../jsonml.js'
import { ListCounter, effectiveNumPr, formatNumber } from '../numbering.js'
import { inlineMarks } from '../schema.js'
import { cellConditions, mergeElement, propertyMap, tableLook, type PropertyMap } from '../styles.js'
import type { DocxViewContext } from './context.js'
import { tableConditionChain } from './stylesheet.js'

/**
 * Formatting that depends on more than one node: list labels (counted in document order), note
 * numbers, comment highlights, table-style borders and shading per cell position, and paragraph
 * revision marks. Computed as decorations so the document itself stays as Word wrote it.
 */

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

export interface DecorationInput {
  context: DocxViewContext
  /** Numbers of notes by `footnote:<id>`/`endnote:<id>`, counted over the body. */
  noteNumbers: Map<string, number>
  /** The note this story is (for its `w:footnoteRef` mark). */
  noteNumber?: number
  activeComment?: string | null
  showResolvedComments?: boolean
}

/** Note numbers in reading order of the body. */
export function countNotes(body: ProseMirrorNode): Map<string, number> {
  const numbers = new Map<string, number>()
  const counts = { footnote: 0, endnote: 0 }
  body.descendants((node) => {
    if (node.type.name !== 'noteRef') return true
    const kind = node.attrs.kind === 'endnote' ? 'endnote' : 'footnote'
    const key = `${kind}:${node.attrs.id}`
    if (!numbers.has(key) && !jmlAttr(jml(node.attrs.v), 'w:customMarkFollows')) numbers.set(key, ++counts[kind])
    return false
  })
  return numbers
}

function noteLabel(number: number | undefined, format: string | undefined): string {
  return number === undefined ? '' : formatNumber(number, format ?? 'decimal')
}

function pt(value: number): string {
  return `${Math.round(value * 100) / 100}pt`
}

/** A paragraph's indentation after style, numbering level, and direct formatting. */
function mergedIndent(
  styleInd: JmlElement | undefined,
  levelInd: JmlElement | undefined,
  directInd: JmlElement | undefined,
  numberingFromStyle: boolean,
): JmlElement | undefined {
  return numberingFromStyle
    ? mergeElement(mergeElement(levelInd, styleInd), directInd)
    : mergeElement(mergeElement(styleInd, levelInd), directInd)
}

function listDecoration(node: ProseMirrorNode, pos: number, counter: ListCounter, input: DecorationInput): Decoration | undefined {
  const { styles } = input.context
  const direct = jml(node.attrs.numPr)
  const list = effectiveNumPr(direct, node.attrs.pStyle as string | null, styles)
  if (!list) return undefined
  const label = counter.next(list.numId, list.ilvl)
  if (!label) return undefined
  const level = label.level
  const styleInd = styles.resolve(styles.paragraphStyle(node.attrs.pStyle as string | null)?.id).pPr.get('w:ind')
  const ind = mergedIndent(styleInd, jmlChild(level.pPr, 'w:ind'), jml(node.attrs.ind), !jmlChild(direct, 'w:numId'))
  const props: CssProps = {}
  const left = jmlNumber(ind, 'w:left') ?? jmlNumber(ind, 'w:start') ?? 0
  const hanging = jmlNumber(ind, 'w:hanging')
  const firstLine = jmlNumber(ind, 'w:firstLine')
  props['--docx-ind-l'] = pt(twipsToPt(left))
  if (hanging !== undefined) props['text-indent'] = pt(-twipsToPt(hanging))
  else if (firstLine !== undefined) props['text-indent'] = pt(twipsToPt(firstLine))
  // The label runs from the first line's start to the next tab stop: the left indent when hanging.
  const labelWidth = hanging !== undefined && hanging > 0 ? twipsToPt(hanging) : input.context.defaultTabStop
  props['--docx-label-w'] = pt(labelWidth)
  const labelRun = runPropertiesCss(level.rPr, input.context.theme)
  const font = latinFont(jmlChild(level.rPr, 'w:rFonts'), input.context.theme)
  if (font && !/symbol|wingdings/i.test(font)) props['--docx-label-font'] = font.startsWith('var(') ? font : fontStack(font)
  if (labelRun['font-weight']) props['--docx-label-weight'] = labelRun['font-weight']
  if (labelRun.color) props['--docx-label-color'] = labelRun.color
  if (labelRun['font-size']) props['--docx-label-size'] = labelRun['font-size']
  if (level.lvlJc === 'right' || level.lvlJc === 'end') props['--docx-label-align'] = 'right'
  else if (level.lvlJc === 'center') props['--docx-label-align'] = 'center'
  const attrs: Record<string, string> = { style: cssText(props) }
  if (label.text) {
    attrs['data-label'] = label.text
    attrs['data-label-suffix'] = level.suff
  }
  return Decoration.node(pos, pos + node.nodeSize, attrs)
}

function paragraphRevision(node: ProseMirrorNode): Record<string, string> | undefined {
  const markRPr = jml(node.attrs.markRPr)
  const attrs: Record<string, string> = {}
  if (jmlChild(markRPr, 'w:ins') || jmlChild(markRPr, 'w:moveTo')) attrs['data-para-rev'] = 'ins'
  else if (jmlChild(markRPr, 'w:del') || jmlChild(markRPr, 'w:moveFrom')) attrs['data-para-rev'] = 'del'
  if (node.attrs.pPrChange) attrs['data-rev-bar'] = 'true'
  return Object.keys(attrs).length ? attrs : undefined
}

const SIDES = ['top', 'left', 'bottom', 'right'] as const

/** Borders, shading, margins, and condition classes of every cell of a table. */
function tableDecorations(table: ProseMirrorNode, start: number, input: DecorationInput, decorations: Decoration[]): void {
  const { styles, theme } = input.context
  const tblPr = jml(table.attrs.tblPr)
  const styleId = jmlAttr(jmlChild(tblPr, 'w:tblStyle'), 'w:val') ?? styles.defaultStyle('table')?.id
  const resolved = styles.resolve(styleId)
  const tableProps: PropertyMap = new Map(resolved.tblPr)
  for (const [name, element] of propertyMap(tblPr)) tableProps.set(name, mergeElement(tableProps.get(name), element)!)
  const look = tableLook(tableProps.get('w:tblLook'))
  const bandRows = jmlNumber(tableProps.get('w:tblStyleRowBandSize'), 'w:val') ?? 1
  const bandCols = jmlNumber(tableProps.get('w:tblStyleColBandSize'), 'w:val') ?? 1
  const borders = tableProps.get('w:tblBorders')
  const margins = tableProps.get('w:tblCellMar')
  let map: TableMap
  try {
    map = TableMap.get(table)
  } catch {
    return
  }
  let headerRows = 0
  for (let row = 0; row < table.childCount; row++) {
    const trPr = jml(table.child(row).attrs.trPr)
    if (jmlChild(trPr, 'w:tblHeader')) headerRows = row + 1
    else break
  }
  const conditionSets = new Map<string, ReturnType<typeof tableConditionChain>>()
  const conditionSet = (condition: Parameters<typeof tableConditionChain>[2]) => {
    let set = conditionSets.get(condition)
    if (!set && styleId) {
      set = tableConditionChain(styles, styleId, condition)
      conditionSets.set(condition, set)
    }
    return set
  }
  const seen = new Set<number>()
  for (let index = 0; index < map.map.length; index++) {
    const cellOffset = map.map[index]!
    if (seen.has(cellOffset)) continue
    seen.add(cellOffset)
    const cell = table.nodeAt(cellOffset)
    if (!cell || cell.attrs.phantom) continue
    const rect = map.findCell(cellOffset)
    const conditions = cellConditions(look, { row: rect.top, rows: map.height, col: rect.left, cols: map.width, headerRows }, { rows: bandRows, cols: bandCols })
    const props: CssProps = {}
    const edges: Record<(typeof SIDES)[number], JmlElement | undefined> = {
      top: jmlChild(borders, rect.top === 0 ? 'w:top' : 'w:insideH'),
      bottom: jmlChild(borders, rect.bottom === map.height ? 'w:bottom' : 'w:insideH'),
      left: jmlChild(borders, rect.left === 0 ? 'w:left' : 'w:insideV') ?? jmlChild(borders, rect.left === 0 ? 'w:start' : 'w:insideV'),
      right: jmlChild(borders, rect.right === map.width ? 'w:right' : 'w:insideV') ?? jmlChild(borders, rect.right === map.width ? 'w:end' : 'w:insideV'),
    }
    let shading: JmlElement | undefined
    let cellMargins = margins
    const classes = styleId ? [`docx-tc-${cssIdent(styleId)}-base`] : []
    const applyTcPr = (tcPr: PropertyMap | JmlElement | undefined) => {
      const map_ = tcPr instanceof Map ? tcPr : propertyMap(tcPr)
      const tcBorders = map_.get('w:tcBorders')
      if (tcBorders) for (const side of SIDES) {
        const element = jmlChild(tcBorders, `w:${side}`) ?? jmlChild(tcBorders, side === 'left' ? 'w:start' : side === 'right' ? 'w:end' : '')
        const inside = side === 'top' || side === 'bottom' ? jmlChild(tcBorders, 'w:insideH') : jmlChild(tcBorders, 'w:insideV')
        const isInner = (side === 'top' && rect.top > 0) || (side === 'bottom' && rect.bottom < map.height) || (side === 'left' && rect.left > 0) || (side === 'right' && rect.right < map.width)
        if (element) edges[side] = element
        else if (inside && isInner) edges[side] = inside
      }
      const shd = map_.get('w:shd')
      if (shd) shading = shd
      const tcMar = map_.get('w:tcMar')
      if (tcMar) cellMargins = mergeElement(cellMargins, tcMar)
    }
    applyTcPr(resolved.tcPr)
    for (const condition of conditions) {
      const set = conditionSet(condition)
      if (!set) continue
      if (set.tcPr.size) applyTcPr(set.tcPr)
      if (set.tblPr.size) {
        const conditionBorders = set.tblPr.get('w:tblBorders')
        if (conditionBorders) for (const side of SIDES) {
          const element = jmlChild(conditionBorders, `w:${side}`)
          if (element) edges[side] = element
        }
      }
      if (set.rPr.size || set.pPr.size) classes.push(`docx-tc-${cssIdent(styleId!)}-${condition}`)
    }
    applyTcPr(jml(cell.attrs.tcPr))
    for (const side of SIDES) {
      const css = borderCss(edges[side], theme)
      if (css) props[`border-${side}`] = css
    }
    if (shading) {
      const fill = shadingColor(shading, theme)
      if (fill) props['background-color'] = fill
    }
    if (cellMargins) for (const side of SIDES) {
      const margin = jmlChild(cellMargins, `w:${side}`) ?? jmlChild(cellMargins, side === 'left' ? 'w:start' : side === 'right' ? 'w:end' : '')
      const value = jmlNumber(margin, 'w:w')
      if (value !== undefined && jmlAttr(margin, 'w:type') !== 'pct') props[`padding-${side}`] = pt(twipsToPt(value))
    }
    const trPr = jml(table.child(rect.top).attrs.trPr)
    const height = jmlChild(trPr, 'w:trHeight')
    const heightValue = jmlNumber(height, 'w:val')
    if (heightValue) props.height = pt(twipsToPt(heightValue))
    decorations.push(Decoration.node(start + 1 + cellOffset, start + 1 + cellOffset + cell.nodeSize, { style: cssText(props), class: classes.join(' ') }))
  }
}

/** Inline decorations of comment ranges, which may span paragraphs. */
function commentDecorations(doc: ProseMirrorNode, input: DecorationInput, decorations: Decoration[]): void {
  const open = new Set<string>()
  doc.descendants((node, pos) => {
    if (node.type.name === 'commentMark') {
      const id = String(node.attrs.id)
      if (node.attrs.edge === 'start') open.add(id)
      else if (node.attrs.edge === 'end') open.delete(id)
      return false
    }
    if (!node.isInline || !open.size) return true
    const ids = [...open].filter((id) => input.context.comments.has(id))
    if (!ids.length) return false
    const resolved = ids.every((id) => input.context.comments.get(id)?.done)
    const attrs: Record<string, string> = { class: 'docx-comment-range', 'data-comments': ids.join(' ') }
    if (input.activeComment && ids.includes(input.activeComment)) attrs['data-active'] = 'true'
    if (resolved && !input.showResolvedComments) attrs['data-resolved'] = 'true'
    decorations.push(Decoration.inline(pos, pos + node.nodeSize, attrs))
    return false
  })
}

export function computeDecorations(doc: ProseMirrorNode, input: DecorationInput): DecorationSet {
  const decorations: Decoration[] = []
  const counter = new ListCounter(input.context.numbering)
  const footnoteFormat = jmlAttr(jmlChild(jmlChild(input.context.finalSectPr, 'w:footnotePr'), 'w:numFmt'), 'w:val')
  doc.descendants((node, pos) => {
    switch (node.type.name) {
      case 'paragraph': {
        const list = listDecoration(node, pos, counter, input)
        if (list) decorations.push(list)
        const revision = paragraphRevision(node)
        if (revision) decorations.push(Decoration.node(pos, pos + node.nodeSize, revision))
        return true
      }
      case 'table':
        tableDecorations(node, pos, input, decorations)
        return true
      case 'noteRef': {
        const kind = node.attrs.kind === 'endnote' ? 'endnote' : 'footnote'
        const custom = jmlAttr(jml(node.attrs.v), 'w:customMarkFollows')
        const label = custom ? '' : noteLabel(input.noteNumbers.get(`${kind}:${node.attrs.id}`), kind === 'footnote' ? footnoteFormat : 'lowerRoman')
        decorations.push(Decoration.node(pos, pos + 1, { 'data-label': label }))
        return false
      }
      case 'inlineXml': {
        const name = jml(node.attrs.v)?.[0]
        if ((name === 'w:footnoteRef' || name === 'w:endnoteRef') && input.noteNumber !== undefined) {
          decorations.push(Decoration.node(pos, pos + 1, { 'data-label': String(input.noteNumber) }))
        }
        return false
      }
      default:
        return true
    }
  })
  commentDecorations(doc, input, decorations)
  return DecorationSet.create(doc, decorations)
}

/** Whether a node carries a mark by name, including atoms' stored marks. */
export function hasMark(node: ProseMirrorNode, name: string): boolean {
  return inlineMarks(node).some((mark) => mark.type.name === name)
}

