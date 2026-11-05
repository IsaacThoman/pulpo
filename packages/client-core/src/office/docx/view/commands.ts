import { chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlock } from '@tiptap/pm/commands'
import type { Attrs, Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap, isInTable } from '@tiptap/pm/tables'
import { canSplit } from '@tiptap/pm/transform'
import { jmlAttr, jmlChild, jmlElements, jmlNumber, jmlOn, packJml, unpackJml, type JmlElement } from '../jsonml.js'
import { effectiveNumPr } from '../numbering.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_PROPERTY_MARKS, inlineMarks, packMarks, textAreaWidth, type ParagraphPropertyAttr } from '../schema.js'
import { mergeProperties, styleDisplayName, type PropertyMap } from '../styles.js'
import { inlineText } from '../text.js'
import type { DocxViewContext } from './context.js'
import { changeMarks, clearMark, propertyMark, selectionMarks, setMark } from './marks.js'

/**
 * Editing commands as ProseMirror commands over the docx schema. Each takes the state and the
 * view context and returns a transaction (or null when it does not apply), so hosts, tests, and
 * agents' scripted edits share them.
 */

export type Command = (state: EditorState, context: DocxViewContext) => Transaction | null

/** A change to one of the document's Y maps that goes with a transaction (null deletes). */
export type MapEdit = [map: 'numbering' | 'docx' | 'styles' | 'comments' | 'stories' | 'rels' | 'settings', key: string, value: string | null]

export interface EditResult {
  tr: Transaction
  maps?: MapEdit[]
}

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

/** Paragraphs the selection touches, with positions, in order. */
export function selectedParagraphs(state: EditorState): { node: ProseMirrorNode; pos: number }[] {
  const result: { node: ProseMirrorNode; pos: number }[] = []
  const { selection } = state
  const ranges = selection instanceof CellSelection ? selection.ranges : [{ $from: selection.$from, $to: selection.$to }]
  for (const range of ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (node.type.name === 'paragraph') {
        if (!result.some((entry) => entry.pos === pos)) result.push({ node, pos })
        return false
      }
      return true
    })
  }
  if (!result.length) {
    const $from = selection.$from
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.name === 'paragraph') return [{ node, pos: $from.before(depth) }]
    }
  }
  return result
}

/** A split creates a fresh mark before the original end, without duplicating revisions or section ends. */
export function splitParagraphAttrs(attrs: Attrs, endAttrs: Attrs = attrs): [Attrs, Attrs] {
  return [
    { ...attrs, markRPr: null, sectPr: null, trail: null },
    { ...attrs, markRPr: endAttrs.markRPr, sectPr: endAttrs.sectPr, trail: endAttrs.trail, lead: null, xmlAttrs: null },
  ]
}

/** Share Enter's mark ownership with commands that split an existing paragraph. */
function splitParagraph(tr: Transaction, pos: number): void {
  const $pos = tr.doc.resolve(pos)
  if ($pos.parent.type.name !== 'paragraph' || !canSplit(tr.doc, pos)) return
  const [first, second] = splitParagraphAttrs($pos.parent.attrs)
  tr.split(pos, 1, [{ type: $pos.parent.type, attrs: second }])
  tr.setNodeMarkup($pos.before(), undefined, first)
  tr.setMeta('docx-paragraph-split-cleanup', [tr.steps.length - 1])
}

/** A new paragraph mark precedes the original mark, which retains its section end and markers. */
export const insertParagraphBreak: Command = (state, context) => {
  const paragraph = selectedParagraphs(state)[0]
  if (!paragraph) return null
  const { $from, $to } = state.selection
  const endAttrs = $to.parent.type.name === 'paragraph' ? $to.parent.attrs : paragraph.node.attrs
  const atEnd = $from.parentOffset === $from.parent.content.size
  let result: Transaction | null = null
  chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock)(state, (tr) => {
    const first = tr.doc.nodeAt(paragraph.pos)
    const secondPos = first ? paragraph.pos + first.nodeSize : -1
    const second = secondPos >= 0 ? tr.doc.nodeAt(secondPos) : null
    if (first && second?.type.name === 'paragraph') {
      const attrs = paragraph.node.attrs
      const nextStyle = atEnd ? context.styles.get(attrs.pStyle as string | null)?.next : undefined
      const [firstAttrs, secondAttrs] = splitParagraphAttrs(attrs, endAttrs)
      tr.setNodeMarkup(paragraph.pos, undefined, firstAttrs)
      tr.setNodeMarkup(secondPos, undefined, {
        ...secondAttrs,
        ...(nextStyle && nextStyle !== attrs.pStyle ? { pStyle: nextStyle, outlineLvl: null } : {}),
      })
      tr.setSelection(TextSelection.create(tr.doc, secondPos + 1))
      // Typing continues with the formatting at the split.
      tr.setStoredMarks(selectionMarks(state).filter((mark) => mark.type.name !== 'link' && mark.type.name !== 'ins' && mark.type.name !== 'del'))
    }
    result = tr.setMeta('docx-paragraph-split', true)
  })
  return result
}

/** Effective run properties at the selection: document defaults, styles, then direct formatting. */
export function effectiveRunProperties(state: EditorState, context: DocxViewContext): PropertyMap {
  const { styles } = context
  const paragraph = selectedParagraphs(state)[0]?.node
  let props = new Map(styles.docDefaults.rPr)
  props = mergeProperties(props, styles.resolve(styles.paragraphStyle(paragraph?.attrs.pStyle as string | null)?.id).rPr)
  const marks = selectionMarks(state)
  const charStyle = jmlAttr(jml(marks.find((mark) => mark.type.name === 'rStyle')?.attrs.v), 'w:val')
  if (charStyle) props = mergeProperties(props, styles.resolve(charStyle).rPr)
  for (const mark of marks) {
    if (mark.type.name === 'rPrRest') for (const element of unpackJml<JmlElement[]>(mark.attrs.v as string) ?? []) props.set(element[0], element)
    else if (mark.type.name in RUN_PROPERTY_MARKS) {
      const element = jml(mark.attrs.v)
      if (element) props = mergeProperties(props, new Map([[element[0], element]]))
    }
  }
  return props
}

/** Effective paragraph properties of a paragraph: defaults, style chain, then direct. */
export function effectiveParagraphProperties(node: ProseMirrorNode, context: DocxViewContext): PropertyMap {
  const { styles } = context
  let props = new Map(styles.docDefaults.pPr)
  props = mergeProperties(props, styles.resolve(styles.paragraphStyle(node.attrs.pStyle as string | null)?.id).pPr)
  for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS) as ParagraphPropertyAttr[]) {
    const element = jml(node.attrs[key])
    if (element) props = mergeProperties(props, new Map([[element[0], element]]))
  }
  return props
}

export type ToggleProperty = 'b' | 'i' | 'strike' | 'dstrike' | 'caps' | 'smallCaps' | 'vanish'

/** Bold, italic, and the other on/off run properties, toggled against what the styles say. */
export const toggleRunProperty = (name: ToggleProperty): Command => (state, context) => {
  const on = jmlOn(effectiveRunProperties(state, context).get(`w:${name}`)) === true
  const tr = state.tr
  const markType = state.schema.marks[name]!
  // Turning off what a style turns on needs an explicit `w:val="0"`; otherwise just drop the mark.
  const styleOn = (() => {
    const { styles } = context
    const paragraph = selectedParagraphs(state)[0]?.node
    const props = mergeProperties(new Map(styles.docDefaults.rPr), styles.resolve(styles.paragraphStyle(paragraph?.attrs.pStyle as string | null)?.id).rPr)
    return jmlOn(props.get(`w:${name}`)) === true
  })()
  if (on) {
    if (styleOn) setMark(state, tr, propertyMark(state, name, [`w:${name}`, { 'w:val': '0' }]))
    else clearMark(state, tr, markType)
  } else if (styleOn) {
    clearMark(state, tr, markType)
  } else {
    setMark(state, tr, propertyMark(state, name, [`w:${name}`, {}]))
  }
  return tr
}

/** Sets a run property mark, or clears it with `element` undefined. */
export const setRunProperty = (name: keyof typeof RUN_PROPERTY_MARKS, element: JmlElement | undefined): Command => (state) => {
  const tr = state.tr
  if (element) setMark(state, tr, propertyMark(state, name, element))
  else clearMark(state, tr, state.schema.marks[name]!)
  return tr
}

export const setFontFamily = (font: string | null): Command =>
  setRunProperty('rFonts', font ? ['w:rFonts', { 'w:ascii': font, 'w:hAnsi': font, 'w:eastAsia': font, 'w:cs': font }] : undefined)

/** Font size in points (half points are kept, as Word allows). */
export const setFontSize = (points: number | null): Command =>
  setRunProperty('sz', points ? ['w:sz', { 'w:val': String(Math.round(points * 2)) }] : undefined)

export const setTextColor = (hex: string | null): Command =>
  setRunProperty('color', hex ? ['w:color', { 'w:val': hex.replace('#', '').toUpperCase() }] : undefined)

export const setHighlight = (name: string | null): Command =>
  setRunProperty('highlight', name ? ['w:highlight', { 'w:val': name }] : undefined)

export const setUnderline = (style: string | null): Command =>
  setRunProperty('u', style ? ['w:u', { 'w:val': style }] : undefined)

export const setVerticalAlign = (value: 'superscript' | 'subscript' | null): Command => (state, context) => {
  const current = jmlAttr(effectiveRunProperties(state, context).get('w:vertAlign'), 'w:val')
  return setRunProperty('vertAlign', value && current !== value ? ['w:vertAlign', { 'w:val': value }] : undefined)(state, context)
}

export const setCharacterStyle = (styleId: string | null): Command =>
  setRunProperty('rStyle', styleId ? ['w:rStyle', { 'w:val': styleId }] : undefined)

const DIRECT_RUN_MARKS = [...Object.keys(RUN_PROPERTY_MARKS), 'rPrRest']

/** Clear formatting: plain text in the default paragraph style, keeping revisions and links. */
export const clearFormatting: Command = (state) => {
  const tr = state.tr
  const names = new Set(DIRECT_RUN_MARKS)
  if (!state.selection.empty) for (const range of state.selection.ranges) changeMarks(tr, range.$from.pos, range.$to.pos, (marks) => marks.filter((mark) => !names.has(mark.type.name)))
  else tr.setStoredMarks((state.storedMarks ?? state.selection.$from.marks()).filter((mark) => !names.has(mark.type.name)))
  for (const { node, pos } of selectedParagraphs(state)) {
    const attrs: Record<string, unknown> = { ...node.attrs, pStyle: null }
    for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) if (key !== 'numPr') attrs[key] = null
    tr.setNodeMarkup(tr.mapping.map(pos), undefined, attrs)
  }
  return tr
}

function setParagraphAttrs(state: EditorState, change: (node: ProseMirrorNode) => Record<string, unknown> | null): Transaction | null {
  const paragraphs = selectedParagraphs(state)
  if (!paragraphs.length) return null
  const tr = state.tr
  for (const { node, pos } of paragraphs) {
    const attrs = change(node)
    if (attrs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
  }
  return tr.docChanged ? tr : null
}

export const setParagraphStyle = (styleId: string | null): Command => (state, context) => {
  const style = styleId ? context.styles.get(styleId) : undefined
  return setParagraphAttrs(state, () => ({ pStyle: style?.id ?? styleId ?? null }))
}

export type Alignment = 'left' | 'center' | 'right' | 'both'

export const setAlignment = (alignment: Alignment): Command => (state) =>
  setParagraphAttrs(state, () => ({ jc: packJml(['w:jc', { 'w:val': alignment }]) }))

/** Line spacing as a multiple (1, 1.15, 1.5, 2) or an exact height in points. */
export const setLineSpacing = (spacing: { multiple: number } | { exact: number } | { atLeast: number }): Command => (state) =>
  setParagraphAttrs(state, (node) => {
    const current = jml(node.attrs.spacing)
    const attrs: Record<string, string> = { ...current?.[1] }
    if ('multiple' in spacing) {
      attrs['w:line'] = String(Math.round(spacing.multiple * 240))
      attrs['w:lineRule'] = 'auto'
    } else if ('exact' in spacing) {
      attrs['w:line'] = String(Math.round(spacing.exact * 20))
      attrs['w:lineRule'] = 'exact'
    } else {
      attrs['w:line'] = String(Math.round(spacing.atLeast * 20))
      attrs['w:lineRule'] = 'atLeast'
    }
    return { spacing: packJml(['w:spacing', attrs]) }
  })

/** Space before and after paragraphs, in points (undefined keeps a side as is). */
export const setParagraphSpacing = (before: number | undefined, after: number | undefined): Command => (state) =>
  setParagraphAttrs(state, (node) => {
    const current = jml(node.attrs.spacing)
    const attrs: Record<string, string> = { ...current?.[1] }
    if (before !== undefined) {
      attrs['w:before'] = String(Math.round(before * 20))
      delete attrs['w:beforeAutospacing']
    }
    if (after !== undefined) {
      attrs['w:after'] = String(Math.round(after * 20))
      delete attrs['w:afterAutospacing']
    }
    return { spacing: packJml(['w:spacing', attrs]) }
  })

/** A paragraph property on/off (`keepNext`, `keepLines`, `pageBreakBefore`, `widowControl`). */
export const setParagraphFlag = (name: 'keepNext' | 'keepLines' | 'pageBreakBefore' | 'widowControl', on: boolean): Command => (state) =>
  setParagraphAttrs(state, () => ({ [name]: packJml([`w:${name}`, on ? {} : { 'w:val': '0' }]) }))

/** Increase or decrease indent: list paragraphs change level, others move by half an inch. */
export const changeIndent = (direction: 1 | -1): Command => (state, context) =>
  setParagraphAttrs(state, (node) => {
    const list = effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, context.styles)
    if (list) {
      const ilvl = Math.max(0, Math.min(8, list.ilvl + direction))
      return { numPr: packJml(['w:numPr', {}, ['w:ilvl', { 'w:val': String(ilvl) }], ['w:numId', { 'w:val': list.numId }]]), ind: null }
    }
    const ind = effectiveParagraphProperties(node, context).get('w:ind')
    const left = jmlNumber(ind, 'w:left') ?? jmlNumber(ind, 'w:start') ?? 0
    const next = Math.max(0, (Math.floor(left / 720) + direction) * 720)
    const own = jml(node.attrs.ind)
    const attrs: Record<string, string> = { ...own?.[1], 'w:left': String(next) }
    delete attrs['w:start']
    return { ind: packJml(['w:ind', attrs]) }
  })

export type ListKind = 'bullet' | 'decimal' | 'multilevel'

const BULLETS = [['', 'Symbol'], ['o', 'Courier New'], ['', 'Wingdings']] as const

/** A nine-level list definition like the ones Word's toolbar buttons create. */
export function listDefinition(kind: ListKind, abstractId: string): JmlElement {
  const levels: JmlElement[] = []
  const decimalFormats = ['decimal', 'lowerLetter', 'lowerRoman']
  for (let level = 0; level < 9; level++) {
    const left = 720 * (level + 1)
    const children: JmlElement[] = [['w:start', { 'w:val': '1' }]]
    if (kind === 'bullet') {
      const [char, font] = BULLETS[level % 3]!
      children.push(['w:numFmt', { 'w:val': 'bullet' }], ['w:lvlText', { 'w:val': char }], ['w:lvlJc', { 'w:val': 'left' }],
        ['w:pPr', {}, ['w:ind', { 'w:left': String(left), 'w:hanging': '360' }]],
        ['w:rPr', {}, ['w:rFonts', { 'w:ascii': font, 'w:hAnsi': font, 'w:hint': 'default' }]])
    } else if (kind === 'decimal') {
      children.push(['w:numFmt', { 'w:val': decimalFormats[level % 3]! }], ['w:lvlText', { 'w:val': `%${level + 1}.` }], ['w:lvlJc', { 'w:val': level % 3 === 2 ? 'right' : 'left' }],
        ['w:pPr', {}, ['w:ind', { 'w:left': String(left), 'w:hanging': level % 3 === 2 ? '180' : '360' }]])
    } else {
      const text = Array.from({ length: level + 1 }, (_, index) => `%${index + 1}`).join('.') + '.'
      children.push(['w:numFmt', { 'w:val': 'decimal' }], ['w:lvlText', { 'w:val': text }], ['w:lvlJc', { 'w:val': 'left' }],
        ['w:pPr', {}, ['w:ind', { 'w:left': String(360 + level * 432), 'w:hanging': String(360 + level * 72) }]])
    }
    levels.push(['w:lvl', { 'w:ilvl': String(level), ...(kind === 'decimal' || kind === 'bullet' ? { 'w15:tentative': '1' } : {}) }, ...children])
  }
  if (levels[0]) delete levels[0][1]['w15:tentative']
  return ['w:abstractNum', { 'w:abstractNumId': abstractId }, ['w:multiLevelType', { 'w:val': kind === 'multilevel' ? 'multilevel' : 'hybridMultilevel' }], ...levels]
}

/** Which kind of list a num is, for toggling list buttons. */
export function listKind(numId: string, context: DocxViewContext): ListKind | undefined {
  const level = context.numbering.level(numId, 0)
  if (!level) return undefined
  if (level.numFmt === 'bullet') return 'bullet'
  return /%2/.test(context.numbering.level(numId, 1)?.lvlText ?? '') ? 'multilevel' : 'decimal'
}

/** Spread replica allocations beyond imported ids without retrying occupied ranges indefinitely. */
export function freshId(keys: Iterable<string>, prefix: string): string {
  const used = new Set(keys)
  let largest = 0
  for (const key of used) {
    if (!key.startsWith(`${prefix}:`)) continue
    const id = key.slice(prefix.length + 1)
    if (/^\d+$/.test(id)) largest = Math.max(largest, Number(id))
  }
  for (let attempt = 0; attempt < 16; attempt++) {
    const candidate = String(largest + 1 + Math.floor(Math.random() * 2 ** 20))
    if (!used.has(`${prefix}:${candidate}`)) return candidate
  }
  return String(largest + 1)
}

/**
 * Toggles a list on the selected paragraphs. Returns the numbering entries to add (written to
 * the `numbering` map by the editor in the same transaction).
 */
export function toggleList(kind: ListKind, state: EditorState, context: DocxViewContext): EditResult | null {
  const paragraphs = selectedParagraphs(state)
  if (!paragraphs.length) return null
  const lists = paragraphs.map(({ node }) => effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, context.styles))
  const allThisKind = lists.every((list) => list && listKind(list.numId, context) === kind)
  const tr = state.tr
  const maps: MapEdit[] = []
  if (allThisKind) {
    for (const { node, pos } of paragraphs) {
      // A list from the paragraph's style is turned off with numId 0.
      const fromStyle = !jmlChild(jml(node.attrs.numPr), 'w:numId')
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, numPr: fromStyle ? packJml(['w:numPr', {}, ['w:ilvl', { 'w:val': '0' }], ['w:numId', { 'w:val': '0' }]]) : null, ind: null })
    }
    return { tr, maps }
  }
  // Continue a list of this kind right above the selection, as Word does; else start one.
  let numId: string | undefined
  const first = paragraphs[0]!
  const before = state.doc.resolve(first.pos).nodeBefore
  if (before?.type.name === 'paragraph') {
    const previous = effectiveNumPr(jml(before.attrs.numPr), before.attrs.pStyle as string | null, context.styles)
    if (previous && listKind(previous.numId, context) === kind) numId = previous.numId
  }
  if (!numId) {
    const abstractId = freshId(context.doc.getMap('numbering').keys(), 'abstract')
    numId = freshId(context.doc.getMap('numbering').keys(), 'num')
    maps.push(['numbering', `abstract:${abstractId}`, packJml(listDefinition(kind, abstractId))])
    maps.push(['numbering', `num:${numId}`, packJml(['w:num', { 'w:numId': numId }, ['w:abstractNumId', { 'w:val': abstractId }]])])
  }
  const listParagraph = context.styles.get('ListParagraph') ? 'ListParagraph' : undefined
  for (const { node, pos } of paragraphs) {
    const current = effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, context.styles)
    const ilvl = current?.ilvl ?? 0
    const isDefault = !node.attrs.pStyle || node.attrs.pStyle === context.styles.defaultStyle('paragraph')?.id
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      pStyle: isDefault && listParagraph ? listParagraph : node.attrs.pStyle,
      numPr: packJml(['w:numPr', {}, ['w:ilvl', { 'w:val': String(ilvl) }], ['w:numId', { 'w:val': numId }]]),
      ind: null,
    })
  }
  return { tr, maps }
}

/** A new table filling the text width, in the Table Grid style when the document has it. */
export function createTable(schema: Schema, rows: number, cols: number, context: DocxViewContext, sectPr?: JmlElement): ProseMirrorNode {
  const width = Math.round(textAreaWidth(sectPr ?? context.finalSectPr) * 20)
  const colWidth = Math.floor(width / cols)
  const tblPr: JmlElement = ['w:tblPr', {}]
  if (context.styles.get('TableGrid')) tblPr.push(['w:tblStyle', { 'w:val': 'TableGrid' }])
  tblPr.push(['w:tblW', { 'w:w': '0', 'w:type': 'auto' }])
  if (!context.styles.get('TableGrid')) {
    const border = (name: string): JmlElement => [`w:${name}`, { 'w:val': 'single', 'w:sz': '4', 'w:space': '0', 'w:color': 'auto' }]
    tblPr.push(['w:tblBorders', {}, border('top'), border('left'), border('bottom'), border('right'), border('insideH'), border('insideV')])
  }
  tblPr.push(['w:tblLook', { 'w:val': '04A0', 'w:firstRow': '1', 'w:lastRow': '0', 'w:firstColumn': '1', 'w:lastColumn': '0', 'w:noHBand': '0', 'w:noVBand': '1' }])
  const grid: JmlElement = ['w:tblGrid', {}, ...Array.from({ length: cols }, (): JmlElement => ['w:gridCol', { 'w:w': String(colWidth) }])]
  const cell = () => schema.node('tableCell', { tcPr: packJml(['w:tcPr', {}, ['w:tcW', { 'w:w': String(colWidth), 'w:type': 'dxa' }]]) }, [schema.node('paragraph')])
  const rowNodes = Array.from({ length: rows }, () => schema.node('tableRow', null, Array.from({ length: cols }, cell)))
  return schema.node('table', { tblPr: packJml(tblPr), tblGrid: packJml(grid) }, rowNodes)
}

export const insertTable = (rows: number, cols: number): Command => (state, context) => {
  const table = createTable(state.schema, rows, cols, context)
  const tr = state.tr
  const { $from } = state.selection
  // Tables go between paragraphs: after the current one (or replacing it when empty).
  let depth = $from.depth
  while (depth > 0 && $from.node(depth).type.name !== 'paragraph') depth--
  const paragraph = depth > 0 ? $from.node(depth) : undefined
  if (paragraph && paragraph.content.size === 0) {
    tr.replaceWith($from.before(depth), $from.after(depth), [table, state.schema.node('paragraph', splitParagraphAttrs(paragraph.attrs)[1])])
  } else {
    const at = depth > 0 ? $from.after(depth) : $from.pos
    tr.insert(at, [table, state.schema.node('paragraph')])
  }
  const tablePos = tr.mapping.map($from.pos)
  const $cell = tr.doc.resolve(Math.min(tr.doc.content.size, tablePos))
  const found = findFirstCell(tr.doc, $cell.pos)
  if (found !== undefined) tr.setSelection(TextSelection.create(tr.doc, found))
  return tr.scrollIntoView()
}

function findFirstCell(doc: ProseMirrorNode, from: number): number | undefined {
  let result: number | undefined
  doc.nodesBetween(Math.max(0, from - 2), doc.content.size, (node, pos) => {
    if (result !== undefined) return false
    if (node.type.name === 'tableCell' && !node.attrs.phantom) {
      result = pos + 2
      return false
    }
    return true
  })
  return result
}

/** Sets a property on the selected cells' `w:tcPr` (shading, vertical alignment). */
export const setCellProperty = (name: 'w:shd' | 'w:vAlign' | 'w:tcBorders', element: JmlElement | undefined): Command => (state) => {
  if (!isInTable(state)) return null
  const tr = state.tr
  const cells: { node: ProseMirrorNode; pos: number }[] = []
  if (state.selection instanceof CellSelection) state.selection.forEachCell((node, pos) => cells.push({ node, pos }))
  else {
    const $from = state.selection.$from
    for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'tableCell') {
      cells.push({ node: $from.node(depth), pos: $from.before(depth) })
      break
    }
  }
  for (const { node, pos } of cells) {
    const tcPr = jml(node.attrs.tcPr) ?? ['w:tcPr', {}]
    const children = jmlElements(tcPr).filter((child) => child[0] !== name)
    if (element) children.push(element)
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, tcPr: packJml([tcPr[0], tcPr[1], ...children]) })
  }
  return tr
}

export const setCellShading = (hex: string | null): Command =>
  setCellProperty('w:shd', hex ? ['w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': hex.replace('#', '').toUpperCase() }] : undefined)

export type BorderPreset = 'all' | 'none' | 'outside' | 'inside'

/** Borders of the selected cells, like Word's border dropdown. */
export const setCellBorders = (preset: BorderPreset): Command => (state, context) => {
  const line = (side: string, on: boolean): JmlElement => [`w:${side}`, on ? { 'w:val': 'single', 'w:sz': '4', 'w:space': '0', 'w:color': 'auto' } : { 'w:val': 'nil' }]
  if (!(state.selection instanceof CellSelection)) {
    const on = preset !== 'none' && preset !== 'inside'
    return setCellProperty('w:tcBorders', ['w:tcBorders', {}, line('top', on), line('left', on), line('bottom', on), line('right', on)])(state, context)
  }
  const selection = state.selection
  const table = selection.$anchorCell.node(-1)
  const map = TableMap.get(table)
  const tableStart = selection.$anchorCell.start(-1)
  const rect = map.rectBetween(selection.$anchorCell.pos - tableStart, selection.$headCell.pos - tableStart)
  const tr = state.tr
  selection.forEachCell((node, pos) => {
    const cellRect = map.findCell(pos - tableStart)
    const outer = { top: cellRect.top === rect.top, bottom: cellRect.bottom === rect.bottom, left: cellRect.left === rect.left, right: cellRect.right === rect.right }
    const want = (side: 'top' | 'bottom' | 'left' | 'right') => preset === 'all' || (preset === 'outside' && outer[side]) || (preset === 'inside' && !outer[side])
    const tcPr = jml(node.attrs.tcPr) ?? ['w:tcPr', {}]
    const children = jmlElements(tcPr).filter((child) => child[0] !== 'w:tcBorders')
    children.push(['w:tcBorders', {}, line('top', want('top')), line('left', want('left')), line('bottom', want('bottom')), line('right', want('right'))])
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, tcPr: packJml([tcPr[0], tcPr[1], ...children]) })
  })
  return tr
}

/** Inserts inline content at the selection, carrying the marks there onto atoms. */
export function insertInline(state: EditorState, node: ProseMirrorNode): Transaction {
  const marks = selectionMarks(state).filter((mark) => mark.type.name !== 'link')
  const placed = node.isText ? node.mark(marks) : node.type.create({ ...node.attrs, marks: node.attrs.marks ?? packMarks(marks) }, node.content)
  return state.tr.replaceSelectionWith(placed, false).scrollIntoView()
}

export const insertSymbol = (text: string): Command => (state) => insertInline(state, state.schema.text(text))

/** Inserts a page break and starts a new paragraph after it, as Word's Ctrl+Enter does. */
export const insertPageBreak: Command = (state) => {
  const tr = insertInline(state, state.schema.node('break', { type: 'page', v: packJml(['w:br', { 'w:type': 'page' }]) }))
  const pos = tr.selection.from
  splitParagraph(tr, pos)
  return tr.scrollIntoView()
}

/** The section properties governing a paragraph: the next section end at or after it. */
export function sectionOf(doc: ProseMirrorNode, pos: number, finalSectPr: JmlElement | undefined): { sectPr: JmlElement | undefined; endPos: number | null } {
  let found: { sectPr: JmlElement | undefined; endPos: number | null } | undefined
  doc.forEach((node, offset) => {
    if (found) return
    if (offset + node.nodeSize <= pos) return
    let inner: { sectPr: JmlElement; pos: number } | undefined
    node.descendants((child, childPos) => {
      if (inner) return false
      if (child.type.name === 'paragraph' && child.attrs.sectPr && offset + 1 + childPos >= pos - 1) inner = { sectPr: jml(child.attrs.sectPr)!, pos: offset + 1 + childPos }
      return true
    })
    if (node.type.name === 'paragraph' && node.attrs.sectPr) found = { sectPr: jml(node.attrs.sectPr), endPos: offset }
    else if (inner) found = { sectPr: inner.sectPr, endPos: inner.pos }
  })
  return found ?? { sectPr: finalSectPr, endPos: null }
}

/** Ends the section at the cursor: the paragraph before the break carries a copy of the section's properties. */
export function insertSectionBreak(type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage', state: EditorState, context: DocxViewContext): EditResult | null {
  const { $from } = state.selection
  let depth = $from.depth
  while (depth > 0 && $from.node(depth).type.name !== 'paragraph') depth--
  if (depth !== 1) return null
  const section = sectionOf(state.doc, $from.pos, context.finalSectPr)
  const base = section.sectPr ?? ['w:sectPr', {}]
  // The new section (after the break) gets the type; the ended one keeps its own.
  const tr = state.tr
  splitParagraph(tr, $from.pos)
  const paragraphPos = $from.before(depth)
  const paragraph = tr.doc.nodeAt(paragraphPos)!
  const ended: JmlElement = [base[0], base[1], ...jmlElements(base).filter((child) => child[0] !== 'w:type')]
  const original = jmlChild(base, 'w:type')
  if (original) ended.push(original)
  tr.setNodeMarkup(paragraphPos, undefined, { ...paragraph.attrs, sectPr: packJml(sortSect(ended)) })
  // The following section's type lives in its own sectPr.
  const nextType: JmlElement = ['w:type', { 'w:val': type }]
  if (section.endPos === null) {
    return { tr, maps: [['docx', 'sectPr', packJml(sortSect([base[0], base[1], ...jmlElements(base).filter((child) => child[0] !== 'w:type'), nextType]))]] }
  }
  const originalEnd = section.endPos + state.doc.nodeAt(section.endPos)!.nodeSize - 1
  const endPos = tr.doc.resolve(tr.mapping.map(originalEnd)).before()
  const endNode = tr.doc.nodeAt(endPos)
  if (endNode?.attrs.sectPr) {
    const next = jml(endNode.attrs.sectPr)!
    tr.setNodeMarkup(endPos, undefined, { ...endNode.attrs, sectPr: packJml(sortSect([next[0], next[1], ...jmlElements(next).filter((child) => child[0] !== 'w:type'), nextType])) })
  }
  return { tr }
}

const SECT_ORDER = ['w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr', 'w:type', 'w:pgSz', 'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols', 'w:formProt', 'w:vAlign', 'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid', 'w:printerSettings', 'w:sectPrChange']

function sortSect(element: JmlElement): JmlElement {
  const children = jmlElements(element).map((child, index) => ({ child, index, rank: SECT_ORDER.indexOf(child[0]) }))
  children.sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank) || a.index - b.index)
  return [element[0], element[1], ...children.map((entry) => entry.child)]
}

/** A hyperlink over the selection (or new text at a cursor). */
export const setLink = (href: string | null, text?: string): Command => (state) => {
  const type = state.schema.marks.link!
  const tr = state.tr
  if (!href) {
    clearMark(state, tr, type)
    return tr
  }
  const mark = type.create({ v: packJml(['w:hyperlink', { 'w:history': '1' }, '\u0000']), href })
  const styleMark = state.schema.marks.rStyle!.create({ v: packJml(['w:rStyle', { 'w:val': 'Hyperlink' }]) })
  if (state.selection.empty) {
    const content = state.schema.text(text || href, [...selectionMarks(state).filter((existing) => existing.type !== type), mark, styleMark])
    tr.replaceSelectionWith(content, false)
    return tr
  }
  for (const range of state.selection.ranges) changeMarks(tr, range.$from.pos, range.$to.pos, (marks) => styleMark.addToSet(mark.addToSet(marks)))
  return tr
}

/** Find matches as [from, to) positions, in document order. */
export interface FindOptions {
  matchCase?: boolean
  wholeWord?: boolean
}

export function findMatches(doc: ProseMirrorNode, query: string, options: FindOptions = {}): { from: number; to: number }[] {
  if (!query) return []
  const results: { from: number; to: number }[] = []
  const needle = options.matchCase ? query : query.toLocaleLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Text with a position for each character; atoms break words but not matches of text.
    let text = ''
    const positions: number[] = []
    node.forEach((child, offset) => {
      if (child.isText) {
        const deleted = child.marks.some((mark) => mark.type.name === 'del')
        for (let index = 0; index < child.text!.length; index++) {
          text += deleted ? '\u0000' : child.text![index]
          positions.push(pos + 1 + offset + index)
        }
      } else {
        text += '\u0000'
        positions.push(pos + 1 + offset)
      }
    })
    const haystack = options.matchCase ? text : text.toLocaleLowerCase()
    let index = haystack.indexOf(needle)
    while (index >= 0 && results.length < 10_000) {
      const end = index + needle.length
      const word = /[\p{L}\p{N}_]/u
      const boundary = !options.wholeWord || ((index === 0 || !word.test(haystack[index - 1]!)) && (end >= haystack.length || !word.test(haystack[end]!)))
      if (boundary) results.push({ from: positions[index]!, to: positions[end - 1]! + 1 })
      index = haystack.indexOf(needle, index + Math.max(1, needle.length))
    }
    return false
  })
  return results
}

/** Replaces matches (all, or the one at `only`) keeping the formatting of each match's start. */
export function replaceMatches(state: EditorState, matches: { from: number; to: number }[], replacement: string): Transaction {
  const tr = state.tr
  for (const match of [...matches].reverse()) {
    const marks = [...inlineMarks(state.doc.nodeAt(match.from) ?? state.schema.text(' '))]
    if (replacement) tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks))
    else tr.delete(match.from, match.to)
  }
  return tr
}

/** Words and characters, counted like Word's status bar over the body (tracked deletions excluded). */
export function wordCount(doc: ProseMirrorNode): { words: number; characters: number; charactersWithSpaces: number; paragraphs: number } {
  let words = 0
  let characters = 0
  let withSpaces = 0
  let paragraphs = 0
  doc.descendants((node) => {
    if (node.type.name !== 'paragraph') return true
    const text = inlineText(node)
    if (text.trim()) paragraphs++
    words += text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
    characters += text.replace(/\s/gu, '').length
    withSpaces += text.replace(/[\n]/g, '').length
    return false
  })
  return { words, characters, charactersWithSpaces: withSpaces, paragraphs }
}

export interface OutlineEntry {
  level: number
  text: string
  pos: number
}

/** Headings by outline level, for the navigation pane and the table of contents. */
export function documentOutline(doc: ProseMirrorNode, context: DocxViewContext, maxLevel = 9): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') return false
    if (node.type.name !== 'paragraph') return true
    const direct = jmlAttr(jml(node.attrs.outlineLvl), 'w:val')
    const level = direct !== undefined ? Number(direct) : context.styles.outlineLevel(node.attrs.pStyle as string | null)
    if (level !== undefined && level < maxLevel) {
      const text = inlineText(node).replace(/\s+/g, ' ').trim()
      if (text) entries.push({ level, text, pos })
    }
    return false
  })
  return entries
}

/** Style names for the picker: the document's paragraph styles, most used first. */
export function paragraphStyleOptions(context: DocxViewContext): { id: string; name: string }[] {
  return context.styles.pickerStyles().map((style) => ({ id: style.id, name: styleDisplayName(style) }))
}

/**
 * The format painter's copy: run marks and paragraph properties at the selection, applied to
 * another selection later.
 */
export interface CopiedFormat {
  marks: readonly Mark[]
  paragraph: Record<string, unknown>
}

export function copyFormat(state: EditorState): CopiedFormat {
  const paragraph = selectedParagraphs(state)[0]?.node
  const attrs: Record<string, unknown> = {}
  if (paragraph) {
    attrs.pStyle = paragraph.attrs.pStyle
    for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) if (key !== 'numPr') attrs[key] = paragraph.attrs[key]
  }
  const names = new Set([...DIRECT_RUN_MARKS])
  return { marks: selectionMarks(state).filter((mark) => names.has(mark.type.name)), paragraph: attrs }
}

export const pasteFormat = (format: CopiedFormat): Command => (state) => {
  const tr = state.tr
  const names = new Set(DIRECT_RUN_MARKS)
  if (!state.selection.empty) {
    for (const range of state.selection.ranges) {
      changeMarks(tr, range.$from.pos, range.$to.pos, (marks) => {
        let next: readonly Mark[] = marks.filter((mark) => !names.has(mark.type.name))
        for (const mark of format.marks) next = mark.addToSet(next)
        return next
      })
    }
  }
  // Whole paragraphs selected (or a cursor) take the paragraph format too, as in Word.
  for (const { node, pos } of selectedParagraphs(state)) tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, ...format.paragraph })
  return tr
}

/** Selects a node (an image) by position. */
export function selectNode(state: EditorState, pos: number): Transaction {
  return state.tr.setSelection(NodeSelection.create(state.doc, pos))
}

