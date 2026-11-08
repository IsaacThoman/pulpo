import { pushAll } from '../../../collections.js'
import { originalCaseOffsets } from '../../../case-offsets.js'
import { chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlock } from '@tiptap/pm/commands'
import type { Attrs, Mark, Node as ProseMirrorNode, ResolvedPos, Schema } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap, isInTable } from '@tiptap/pm/tables'
import { canSplit } from '@tiptap/pm/transform'
import { jmlAttr, jmlChild, jmlElements, jmlNumber, jmlOn, packJml, unpackJml, type JmlElement } from '../jsonml.js'
import { effectiveNumPr } from '../numbering.js'
import { PARAGRAPH_PROPERTY_ATTRS, RUN_PROPERTY_MARKS, inlineMarks, packMarks, textAreaWidth, type ParagraphPropertyAttr } from '../schema.js'
import { mergeProperties, styleDisplayName, type PropertyMap } from '../styles.js'
import { TBLPR_ORDER, TRPR_ORDER, sortByOrder } from '../names.js'
import { revisionProjection } from '../revisions.js'
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

/** Run properties inherited at the selection, before direct formatting overrides them. */
function inheritedRunProperties(state: EditorState, context: DocxViewContext): PropertyMap {
  const { styles } = context
  const paragraph = selectedParagraphs(state)[0]?.node
  let props = new Map(styles.docDefaults.rPr)
  props = mergeProperties(props, styles.resolve(styles.paragraphStyle(paragraph?.attrs.pStyle as string | null)?.id).rPr)
  const marks = selectionMarks(state)
  const charStyle = jmlAttr(jml(marks.find((mark) => mark.type.name === 'rStyle')?.attrs.v), 'w:val')
  if (charStyle) props = mergeProperties(props, styles.resolve(charStyle).rPr)
  return props
}

/** Effective run properties at the selection: document defaults, styles, then direct formatting. */
export function effectiveRunProperties(state: EditorState, context: DocxViewContext): PropertyMap {
  let props = inheritedRunProperties(state, context)
  for (const mark of selectionMarks(state)) {
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
  const styleOn = jmlOn(inheritedRunProperties(state, context).get(`w:${name}`)) === true
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

/**
 * Word's Ctrl+Space: removes direct character formatting only. Character styles (Hyperlink and
 * the like), links, revisions, and the paragraph's style and format stay.
 */
export const clearCharacterFormatting: Command = (state) => {
  const tr = state.tr
  const names = new Set(DIRECT_RUN_MARKS.filter((name) => name !== 'rStyle'))
  if (!state.selection.empty) for (const range of state.selection.ranges) changeMarks(tr, range.$from.pos, range.$to.pos, (marks) => marks.filter((mark) => !names.has(mark.type.name)))
  else tr.setStoredMarks((state.storedMarks ?? state.selection.$from.marks()).filter((mark) => !names.has(mark.type.name)))
  return tr
}

/** The paragraph style of a heading level: `Heading1`, or a localized id named `heading 1` as Word names its built-ins. */
export function headingStyleId(context: DocxViewContext, level: number): string | undefined {
  const direct = context.styles.get(`Heading${level}`)
  if (direct?.type === 'paragraph') return direct.id
  const named = context.styles.findByName(`heading ${level}`)
  return named?.type === 'paragraph' ? named.id : undefined
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

export type LineSpacing = { multiple: number } | { exact: number } | { atLeast: number }
export type ParagraphFlag = 'keepNext' | 'keepLines' | 'pageBreakBefore' | 'widowControl'

/** A paragraph's effective format, in points, as Word's Paragraph dialog shows it. */
export interface ParagraphFormat {
  alignment: Alignment
  indent: { left: number; right: number; firstLine: number; hanging: number }
  spacing: { before: number; after: number; beforeAuto: boolean; afterAuto: boolean; line: LineSpacing }
  keepNext: boolean
  keepLines: boolean
  pageBreakBefore: boolean
  widowControl: boolean
  /** The bottom, top, or box border presets, `none`, or `custom` for anything else. */
  border: ParagraphBorder | 'custom'
}

export type ParagraphBorder = 'bottom' | 'top' | 'box' | 'none'

const onValue = (value: string | undefined) => value !== undefined && !['0', 'false', 'off'].includes(value)
const flagOn = (props: PropertyMap, name: string, fallback = false) => props.has(name) ? jmlOn(props.get(name)) === true : fallback

function alignmentOf(jc: string | undefined): Alignment {
  return jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'both' : 'left'
}

function borderPreset(pBdr: JmlElement | undefined): ParagraphBorder | 'custom' {
  const sides = ['top', 'left', 'bottom', 'right'].filter((side) => {
    const value = jmlAttr(jmlChild(pBdr, `w:${side}`), 'w:val')
    return value !== undefined && value !== 'nil' && value !== 'none'
  })
  if (!sides.length) return 'none'
  if (sides.length === 4) return 'box'
  if (sides.length === 1 && (sides[0] === 'top' || sides[0] === 'bottom')) return sides[0]
  return 'custom'
}

export function readParagraphFormat(node: ProseMirrorNode, context: DocxViewContext): ParagraphFormat {
  const props = effectiveParagraphProperties(node, context)
  const ind = props.get('w:ind')
  const spacing = props.get('w:spacing')
  const pt = (element: JmlElement | undefined, ...names: string[]) => {
    for (const name of names) {
      const value = jmlNumber(element, name)
      if (value !== undefined) return value / 20
    }
    return 0
  }
  const line = jmlNumber(spacing, 'w:line')
  const rule = jmlAttr(spacing, 'w:lineRule') ?? 'auto'
  return {
    alignment: alignmentOf(jmlAttr(props.get('w:jc'), 'w:val')),
    indent: { left: pt(ind, 'w:left', 'w:start'), right: pt(ind, 'w:right', 'w:end'), firstLine: pt(ind, 'w:firstLine'), hanging: pt(ind, 'w:hanging') },
    spacing: {
      before: pt(spacing, 'w:before'),
      after: pt(spacing, 'w:after'),
      beforeAuto: onValue(jmlAttr(spacing, 'w:beforeAutospacing')),
      afterAuto: onValue(jmlAttr(spacing, 'w:afterAutospacing')),
      line: line === undefined ? { multiple: 1 } : rule === 'exact' ? { exact: line / 20 } : rule === 'atLeast' ? { atLeast: line / 20 } : { multiple: Math.round((line / 240) * 100) / 100 },
    },
    keepNext: flagOn(props, 'w:keepNext'),
    keepLines: flagOn(props, 'w:keepLines'),
    pageBreakBefore: flagOn(props, 'w:pageBreakBefore'),
    // Layout treats a missing setting as on, as Word does for its own documents.
    widowControl: flagOn(props, 'w:widowControl', true),
    border: borderPreset(props.get('w:pBdr')),
  }
}

/** Changes to a paragraph's format; lengths in points, undefined keeps a setting. */
export interface ParagraphFormatChange {
  alignment?: Alignment
  indent?: Partial<ParagraphFormat['indent']>
  spacing?: { before?: number; after?: number; line?: LineSpacing }
  keepNext?: boolean
  keepLines?: boolean
  pageBreakBefore?: boolean
  widowControl?: boolean
}

const twips = (points: number) => String(Math.round(points * 20))

/** Word's Paragraph dialog in one step: indents, spacing, line spacing, alignment, and line and page breaks. */
export const setParagraphFormat = (change: ParagraphFormatChange): Command => (state, context) =>
  setParagraphAttrs(state, (node) => {
    const attrs: Record<string, unknown> = {}
    if (change.alignment) attrs.jc = packJml(['w:jc', { 'w:val': change.alignment }])
    if (change.spacing) {
      const next: Record<string, string> = { ...jml(node.attrs.spacing)?.[1] }
      const { before, after, line } = change.spacing
      if (before !== undefined) {
        next['w:before'] = twips(Math.max(0, before))
        delete next['w:beforeAutospacing']
        delete next['w:beforeLines']
      }
      if (after !== undefined) {
        next['w:after'] = twips(Math.max(0, after))
        delete next['w:afterAutospacing']
        delete next['w:afterLines']
      }
      if (line) {
        if ('multiple' in line) {
          next['w:line'] = String(Math.round(Math.max(0.06, line.multiple) * 240))
          next['w:lineRule'] = 'auto'
        } else {
          next['w:line'] = twips(Math.max(0.7, 'exact' in line ? line.exact : line.atLeast))
          next['w:lineRule'] = 'exact' in line ? 'exact' : 'atLeast'
        }
      }
      attrs.spacing = packJml(['w:spacing', next])
    }
    if (change.indent) {
      const next: Record<string, string> = { ...jml(node.attrs.ind)?.[1] }
      const { left, right, firstLine, hanging } = change.indent
      if (left !== undefined) {
        next['w:left'] = twips(left)
        delete next['w:start']
        delete next['w:leftChars']
        delete next['w:startChars']
      }
      if (right !== undefined) {
        next['w:right'] = twips(right)
        delete next['w:end']
        delete next['w:rightChars']
        delete next['w:endChars']
      }
      // A first-line indent and a hanging indent exclude each other.
      if (hanging !== undefined && hanging > 0) {
        next['w:hanging'] = twips(hanging)
        delete next['w:firstLine']
      } else if (firstLine !== undefined || hanging !== undefined) {
        next['w:firstLine'] = twips(Math.max(0, firstLine ?? 0))
        delete next['w:hanging']
      }
      for (const name of ['w:firstLineChars', 'w:hangingChars']) if (firstLine !== undefined || hanging !== undefined) delete next[name]
      attrs.ind = packJml(['w:ind', next])
    }
    for (const flag of ['keepNext', 'keepLines', 'pageBreakBefore', 'widowControl'] as const) {
      const on = change[flag]
      if (on === undefined) continue
      // Off is written only where a style (or the default) would turn the property on.
      const inherited = flagOn(effectiveParagraphProperties(node.type.create({ ...node.attrs, [flag]: null }), context), `w:${flag}`, flag === 'widowControl')
      attrs[flag] = on === inherited && !(flag === 'widowControl' && on) ? null : packJml([`w:${flag}`, on ? {} : { 'w:val': '0' }])
    }
    return attrs
  })

const BORDER_LINE = { 'w:val': 'single', 'w:sz': '6', 'w:space': '1', 'w:color': 'auto' }

function paragraphBorder(preset: ParagraphBorder): string | null {
  if (preset === 'none') return null
  const sides = preset === 'box' ? ['top', 'left', 'bottom', 'right'] : [preset]
  return packJml(['w:pBdr', {}, ...sides.map((side): JmlElement => [`w:${side}`, { ...BORDER_LINE, 'w:space': side === 'left' || side === 'right' ? '4' : '1' }])])
}

/** Borders around the selected paragraphs: a line under or over them, a box, or none. */
export const setParagraphBorder = (preset: ParagraphBorder): Command => (state) =>
  setParagraphAttrs(state, () => ({ pBdr: paragraphBorder(preset) }))

/**
 * A horizontal line, as Word draws one: an empty paragraph with a bottom border, after the
 * current paragraph (or the current one when it is empty), with the cursor in a new paragraph
 * below it.
 */
export const insertHorizontalLine: Command = (state) => {
  const { $from } = state.selection
  let depth = $from.depth
  while (depth > 0 && $from.node(depth).type.name !== 'paragraph') depth--
  if (depth === 0) return null
  const paragraph = $from.node(depth)
  const schema = state.schema
  const line = (lead: unknown, xmlAttrs: unknown = null) => schema.node('paragraph', { pBdr: paragraphBorder('bottom'), lead, xmlAttrs })
  const tr = state.tr
  let start: number
  if (paragraph.content.size === 0) {
    start = $from.before(depth)
    // Split like Enter and make the upper half the line: the lower half keeps the paragraph mark,
    // its section, and its list. Replacing the paragraph instead would lose the border in
    // Suggesting mode, which tracks that as typing into the empty paragraph.
    splitParagraph(tr, $from.pos)
    const upper = tr.docChanged ? tr.doc.nodeAt(start) : null
    if (upper) tr.setNodeMarkup(start, undefined, line(upper.attrs.lead, upper.attrs.xmlAttrs).attrs)
    else tr.replaceWith(start, $from.after(depth), [line(paragraph.attrs.lead), schema.node('paragraph', { ...paragraph.attrs, lead: null })])
  } else {
    start = $from.after(depth)
    const [kept, moved] = splitParagraphAttrs(paragraph.attrs)
    // A section the paragraph ends moves to the new paragraph, so the line stays in that section.
    const endsSection = Boolean(paragraph.attrs.sectPr || paragraph.attrs.trail)
    if (endsSection) tr.setNodeMarkup($from.before(depth), undefined, kept)
    tr.insert(start, [line(null), schema.node('paragraph', endsSection ? moved : { ...kept, xmlAttrs: null, lead: null, pPrChange: null })])
  }
  tr.setSelection(TextSelection.create(tr.doc, start + tr.doc.nodeAt(start)!.nodeSize + 1))
  return tr.scrollIntoView()
}

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
  return /%1/.test(context.numbering.level(numId, 1)?.lvlText ?? '') ? 'multilevel' : 'decimal'
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
      const fromStyle = effectiveNumPr(undefined, node.attrs.pStyle as string | null, context.styles)
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
  applyList(tr, paragraphs, numId, context)
  return { tr, maps }
}

/** Puts paragraphs in a list, in List Paragraph when they had the default style. */
function applyList(tr: Transaction, paragraphs: { node: ProseMirrorNode; pos: number }[], numId: string, context: DocxViewContext): void {
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
}

/**
 * Starts a new numbered list on the selected paragraphs whose first level counts in `format`
 * from `start`, labelled with `suffix` (what typing `a) ` or `4. ` asks for).
 */
export function startNumberedList(state: EditorState, context: DocxViewContext, format: string, start: number, suffix: string): EditResult | null {
  const paragraphs = selectedParagraphs(state)
  if (!paragraphs.length) return null
  const abstractId = freshId(context.doc.getMap('numbering').keys(), 'abstract')
  const numId = freshId(context.doc.getMap('numbering').keys(), 'num')
  const definition = listDefinition('decimal', abstractId)
  const first = jmlElements(definition).find((child) => child[0] === 'w:lvl' && child[1]['w:ilvl'] === '0')!
  const values: Record<string, string> = { 'w:start': String(start), 'w:numFmt': format, 'w:lvlText': `%1${suffix}` }
  for (const child of jmlElements(first)) if (values[child[0]] !== undefined) child[1]['w:val'] = values[child[0]]!
  const tr = state.tr
  applyList(tr, paragraphs, numId, context)
  return {
    tr,
    maps: [
      ['numbering', `abstract:${abstractId}`, packJml(definition)],
      ['numbering', `num:${numId}`, packJml(['w:num', { 'w:numId': numId }, ['w:abstractNumId', { 'w:val': abstractId }]])],
    ],
  }
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
  const empty = paragraph?.content.size === 0
  const tablePos = depth > 0 ? (empty ? $from.before(depth) : $from.after(depth)) : $from.pos
  if (paragraph && empty) {
    tr.replaceWith(tablePos, $from.after(depth), [table, state.schema.node('paragraph', splitParagraphAttrs(paragraph.attrs)[1])])
  } else {
    tr.insert(tablePos, [table, state.schema.node('paragraph')])
  }
  // The new table starts with a row, cell, and paragraph; anchor inside that paragraph.
  tr.setSelection(TextSelection.create(tr.doc, tablePos + 4))
  return tr.scrollIntoView()
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

export type CellVerticalAlign = 'top' | 'center' | 'bottom'

/** Vertical alignment of the selected cells' text; top, Word's default, writes nothing. */
export const setCellVerticalAlign = (value: CellVerticalAlign): Command =>
  setCellProperty('w:vAlign', value === 'top' ? undefined : ['w:vAlign', { 'w:val': value }])

/** The table, row, and cell around the selection's start. */
function tableAround(state: EditorState): { table: ProseMirrorNode; tablePos: number; row: number; cell: ProseMirrorNode; $cell: ResolvedPos } | undefined {
  const $cell = state.selection instanceof CellSelection ? state.selection.$anchorCell : cellAround(state)
  const cell = $cell?.nodeAfter
  if (!$cell || !cell) return undefined
  // A cell position's parent is the row, and the row's parent the table.
  const depth = $cell.depth - 1
  return { table: $cell.node(depth), tablePos: $cell.before(depth), row: $cell.index(depth), cell, $cell }
}

/** Cell and row settings at the selection, for the Table menu. */
export function tableFormat(state: EditorState): { verticalAlign: CellVerticalAlign; headerRow: boolean; alignment: 'left' | 'center' | 'right' } | null {
  const around = tableAround(state)
  if (!around) return null
  const vAlign = jmlAttr(jmlChild(jml(around.cell.attrs.tcPr), 'w:vAlign'), 'w:val')
  const header = jmlChild(jml(around.table.child(around.row).attrs.trPr), 'w:tblHeader')
  const jc = jmlAttr(jmlChild(jml(around.table.attrs.tblPr), 'w:jc'), 'w:val')
  return {
    verticalAlign: vAlign === 'center' ? 'center' : vAlign === 'bottom' ? 'bottom' : 'top',
    headerRow: header !== undefined && jmlOn(header) !== false,
    alignment: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left',
  }
}

/**
 * Word's "Repeat as header row": header rows must run from the table's top, so turning it on
 * covers every row from the first to the last selected one, and turning it off clears the
 * selected rows and those below them.
 */
export const setHeaderRows = (on: boolean): Command => (state) => {
  const around = tableAround(state)
  if (!around) return null
  let last = around.row
  if (state.selection instanceof CellSelection) {
    const map = TableMap.get(around.table)
    const start = around.tablePos + 1
    const rect = map.rectBetween(state.selection.$anchorCell.pos - start, state.selection.$headCell.pos - start)
    last = rect.bottom - 1
    if (!on) last = rect.top
  }
  const tr = state.tr
  around.table.forEach((row, offset, index) => {
    if (on ? index > last : index < last) return
    const trPr = jml(row.attrs.trPr) ?? ['w:trPr', {}]
    const children = jmlElements(trPr).filter((child) => child[0] !== 'w:tblHeader')
    if (on) children.push(['w:tblHeader', {}])
    const next = children.length || Object.keys(trPr[1]).length ? packJml([trPr[0], trPr[1], ...sortByOrder(children, TRPR_ORDER)]) : null
    if (next !== row.attrs.trPr) tr.setNodeMarkup(around.tablePos + 1 + offset, undefined, { ...row.attrs, trPr: next })
  })
  return tr.docChanged ? tr : null
}

/** Where the table sits between the margins (`w:jc` of its properties); left clears it. */
export const setTableAlignment = (alignment: 'left' | 'center' | 'right'): Command => (state) => {
  const around = tableAround(state)
  if (!around) return null
  const tblPr = jml(around.table.attrs.tblPr) ?? ['w:tblPr', {}]
  const children = jmlElements(tblPr).filter((child) => child[0] !== 'w:jc')
  if (alignment !== 'left') children.push(['w:jc', { 'w:val': alignment }])
  const next = packJml([tblPr[0], tblPr[1], ...sortByOrder(children, TBLPR_ORDER)])
  if (next === around.table.attrs.tblPr) return null
  return state.tr.setNodeMarkup(around.tablePos, undefined, { ...around.table.attrs, tblPr: next })
}

/** Selects the row, column, or whole table around the selection, as cells. */
export const selectTablePart = (part: 'row' | 'column' | 'table'): Command => (state) => {
  const around = tableAround(state)
  if (!around) return null
  if (part === 'row') return state.tr.setSelection(CellSelection.rowSelection(around.$cell))
  if (part === 'column') return state.tr.setSelection(CellSelection.colSelection(around.$cell))
  const map = TableMap.get(around.table)
  const start = around.tablePos + 1
  return state.tr.setSelection(CellSelection.create(state.doc, start + map.map[0]!, start + map.map[map.map.length - 1]!))
}

function cellAround(state: EditorState): ResolvedPos | undefined {
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'tableCell') return state.doc.resolve($from.before(depth))
  return undefined
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

/** A line break within the paragraph (Shift+Enter), Word's `w:br`: the list number and paragraph format stay. */
export const insertLineBreak: Command = (state) => insertInline(state, state.schema.node('break', { v: packJml(['w:br', {}]) }))

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
/** Editing only: the caller must refuse Suggesting mode before applying these untracked section maps. */
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

/** Whether a top-level block ends a section: a paragraph with its own `w:sectPr`, or a block holding one. */
function sectionEnd(node: ProseMirrorNode, offset: number): { sectPr: JmlElement | undefined; pos: number } | undefined {
  if (node.type.name === 'paragraph') return node.attrs.sectPr ? { sectPr: jml(node.attrs.sectPr), pos: offset } : undefined
  let found: { sectPr: JmlElement | undefined; pos: number } | undefined
  node.descendants((child, childPos) => {
    if (!found && child.type.name === 'paragraph' && child.attrs.sectPr) found = { sectPr: jml(child.attrs.sectPr), pos: offset + 1 + childPos }
    return !found
  })
  return found
}

/**
 * Where each section's properties live, in order, numbered as layout numbers sections: the
 * paragraph ending it (by position), or the document's own (`pos` null) for the last.
 */
export function sectionHolders(doc: ProseMirrorNode, finalSectPr: JmlElement | undefined): { sectPr: JmlElement | undefined; pos: number | null }[] {
  const holders: { sectPr: JmlElement | undefined; pos: number | null }[] = []
  doc.forEach((node, offset) => {
    const end = sectionEnd(node, offset)
    if (end) holders.push(end)
  })
  holders.push({ sectPr: finalSectPr, pos: null })
  return holders
}

/** The section a position is in. */
export function sectionIndexAt(doc: ProseMirrorNode, pos: number): number {
  const block = doc.resolve(Math.max(0, Math.min(pos, doc.content.size))).index(0)
  let section = 0
  doc.forEach((node, offset, index) => {
    if (index < block && sectionEnd(node, offset)) section++
  })
  return section
}

/**
 * Rewrites the properties of some sections (all, or by index): paragraph section ends change in
 * the transaction, the document's own section through the `docx` map. `edit` returning null
 * refuses the whole change.
 */
export function editSections(state: EditorState, context: DocxViewContext, indexes: readonly number[] | 'all', edit: (sectPr: JmlElement, index: number) => JmlElement | null): EditResult | null {
  const holders = sectionHolders(state.doc, context.finalSectPr)
  const tr = state.tr
  const maps: MapEdit[] = []
  for (const [index, holder] of holders.entries()) {
    if (indexes !== 'all' && !indexes.includes(index)) continue
    const current = holder.sectPr ?? ['w:sectPr', {}]
    const next = edit(structuredClone(current), index)
    if (!next) return null
    const packed = packJml(sortSect(next))
    // Unchanged sections are left as written, even when their children are out of order.
    if (packed === packJml(sortSect(current))) continue
    if (holder.pos === null) maps.push(['docx', 'sectPr', packed])
    else {
      const node = tr.doc.nodeAt(holder.pos)!
      tr.setNodeMarkup(holder.pos, undefined, { ...node.attrs, sectPr: packed })
    }
  }
  return tr.docChanged || maps.length ? { tr, maps } : null
}

export interface PageMargins { top: number; bottom: number; left: number; right: number; header: number; footer: number; gutter: number }

/** A section's page, in points. */
export interface PageSetupInfo {
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  margins: PageMargins
}

/** Paper size (either way round: orientation decides which side is longer), orientation, and margins, in points. */
export interface PageSetupChange {
  width?: number
  height?: number
  orientation?: 'portrait' | 'landscape'
  margins?: Partial<PageMargins>
}

const MARGINS: Record<keyof PageMargins, [attribute: string, fallback: number]> = {
  top: ['w:top', 1440], bottom: ['w:bottom', 1440], left: ['w:left', 1440], right: ['w:right', 1440], header: ['w:header', 720], footer: ['w:footer', 720], gutter: ['w:gutter', 0],
}

export function readPageSetup(sectPr: JmlElement | undefined): PageSetupInfo {
  const pgSz = jmlChild(sectPr, 'w:pgSz')
  const pgMar = jmlChild(sectPr, 'w:pgMar')
  const width = (jmlNumber(pgSz, 'w:w') ?? 12240) / 20
  const height = (jmlNumber(pgSz, 'w:h') ?? 15840) / 20
  const margins = Object.fromEntries(Object.entries(MARGINS).map(([key, [name, fallback]]) => [key, Math.abs(jmlNumber(pgMar, name) ?? fallback) / 20])) as unknown as PageMargins
  const landscape = width > height || (width === height && jmlAttr(pgSz, 'w:orient') === 'landscape')
  return { width, height, orientation: landscape ? 'landscape' : 'portrait', margins }
}

/** New page size and margins on a section's properties, keeping everything else; null when they leave no room for text. */
export function applyPageSetup(sectPr: JmlElement, change: PageSetupChange): JmlElement | null {
  const current = readPageSetup(sectPr)
  let width = change.width ?? current.width
  let height = change.height ?? current.height
  const orientation = change.orientation ?? current.orientation
  if (orientation === 'landscape' ? width < height : width > height) [width, height] = [height, width]
  const margins: PageMargins = { ...current.margins, ...change.margins }
  const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  // Word's limits: pages of 0.1 to 22 inches, with at least half an inch left for text each way.
  if (!within(width, 7.2, 1584) || !within(height, 7.2, 1584)) return null
  if (Object.values(margins).some((value) => !within(value, 0, 1584))) return null
  if (width - margins.left - margins.right - margins.gutter < 36 || height - margins.top - margins.bottom < 36) return null
  const pgSz = jmlChild(sectPr, 'w:pgSz')
  const size: Record<string, string> = { ...pgSz?.[1], 'w:w': twips(width), 'w:h': twips(height) }
  if (orientation === 'landscape') size['w:orient'] = 'landscape'
  else delete size['w:orient']
  // Word requires every margin attribute; unchanged ones keep their written value (a negative top stays negative).
  const pgMar = jmlChild(sectPr, 'w:pgMar')
  const margin: Record<string, string> = { ...pgMar?.[1] }
  for (const [key, [name]] of Object.entries(MARGINS) as [keyof PageMargins, [string, number]][]) {
    if (change.margins?.[key] !== undefined || margin[name] === undefined) margin[name] = twips(margins[key])
  }
  const others = jmlElements(sectPr).filter((child) => child[0] !== 'w:pgSz' && child[0] !== 'w:pgMar')
  return sortSect([sectPr[0], sectPr[1], ...others, ['w:pgSz', size], ['w:pgMar', margin]])
}

/** Page size, orientation, and margins for the whole document or the section at the cursor. */
export function setPageSetup(change: PageSetupChange, scope: 'document' | 'section', state: EditorState, context: DocxViewContext): EditResult | null {
  const indexes = scope === 'document' ? 'all' : [sectionIndexAt(state.doc, state.selection.from)]
  return editSections(state, context, indexes, (sectPr) => applyPageSetup(sectPr, change))
}

export type HeaderFooterKind = 'header' | 'footer'
export type HeaderFooterType = 'default' | 'first' | 'even'

/** The relationship id of a section's own header or footer of a type. */
export function sectionReference(sectPr: JmlElement | undefined, kind: HeaderFooterKind, type: HeaderFooterType): string | undefined {
  for (const child of sectPr ? jmlElements(sectPr) : []) {
    if (child[0] === `w:${kind}Reference` && (jmlAttr(child, 'w:type') ?? 'default') === type) return jmlAttr(child, 'r:id')
  }
  return undefined
}

/** A section's properties with a header or footer reference set (or removed with `relId` null). */
export function withSectionReference(sectPr: JmlElement, kind: HeaderFooterKind, type: HeaderFooterType, relId: string | null): JmlElement {
  const others = jmlElements(sectPr).filter((child) => !(child[0] === `w:${kind}Reference` && (jmlAttr(child, 'w:type') ?? 'default') === type))
  if (relId) others.push([`w:${kind}Reference`, { 'w:type': type, 'r:id': relId }])
  return sortSect([sectPr[0], sectPr[1], ...others])
}

/** Word's "Different first page" (`w:titlePg`) on a section's properties. */
export function withTitlePage(sectPr: JmlElement, on: boolean): JmlElement {
  const others = jmlElements(sectPr).filter((child) => child[0] !== 'w:titlePg')
  if (on) others.push(['w:titlePg', {}])
  return sortSect([sectPr[0], sectPr[1], ...others])
}

export function hasTitlePage(sectPr: JmlElement | undefined): boolean {
  const element = jmlChild(sectPr, 'w:titlePg')
  return element !== undefined && jmlOn(element) !== false
}

/** A whole link, across the bookmarks and comment ranges inside it. */
export interface LinkRange {
  from: number
  to: number
  /** An external target; null for a link to a bookmark. */
  href: string | null
  /** The bookmark an internal link goes to. */
  anchor: string | null
  text: string
  mark: Mark
}

/** Markers that sit inside links without carrying their mark. */
const LINK_TRANSPARENT = new Set(['commentMark', 'bookmark'])

/**
 * The link around a position: one the position is inside or at the end of (the caret there types
 * with the link's formatting, so Word edits that link), or with `after` also one starting there
 * (a point on a link's first character).
 */
export function linkAround(doc: ProseMirrorNode, pos: number, after = false): LinkRange | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  const parent = $pos.parent
  const type = parent.type.schema.marks.link
  if (!parent.inlineContent || !type) return null
  const nodes: { node: ProseMirrorNode; start: number }[] = []
  parent.forEach((node, offset) => { nodes.push({ node, start: offset }) })
  const linkOf = (index: number) => (index >= 0 && index < nodes.length ? inlineMarks(nodes[index]!.node).find((mark) => mark.type === type) : undefined)
  const offset = $pos.parentOffset
  let index = nodes.findIndex(({ node, start }) => start < offset && offset <= start + node.nodeSize)
  if (!linkOf(index) && after) index = nodes.findIndex(({ start }) => start === offset)
  const mark = linkOf(index)
  if (!mark) return null
  const transparent = (at: number) => LINK_TRANSPARENT.has(nodes[at]?.node.type.name ?? '')
  let first = index
  let last = index
  for (let at = index - 1; at >= 0; at--) {
    if (linkOf(at)?.eq(mark)) first = at
    else if (!transparent(at)) break
  }
  for (let at = index + 1; at < nodes.length; at++) {
    if (linkOf(at)?.eq(mark)) last = at
    else if (!transparent(at)) break
  }
  const base = $pos.start()
  const from = base + nodes[first]!.start
  const to = base + nodes[last]!.start + nodes[last]!.node.nodeSize
  const leaf = (node: ProseMirrorNode) => (node.type.name === 'tab' ? '\t' : node.type.name === 'break' ? '\n' : '')
  return {
    from,
    to,
    href: (mark.attrs.href as string | null) ?? null,
    anchor: jmlAttr(jml(mark.attrs.v), 'w:anchor') ?? null,
    text: doc.textBetween(from, to, '', leaf),
    mark,
  }
}

/** A link mark to `href`: `#name` links to a bookmark, as Word's `w:anchor`. */
function linkMark(schema: Schema, href: string, base?: Mark): Mark {
  const shell = jml(base?.attrs.v) ?? ['w:hyperlink', { 'w:history': '1' }, '\u0000']
  const attrs: Record<string, string> = { ...shell[1] }
  delete attrs['w:anchor']
  delete attrs['w:docLocation']
  if (href.startsWith('#')) {
    // The bookmark name as written, as the link dialog shows it: decoding would throw on a
    // stray '%' and turn "a%20b" into another name when an existing link is applied again.
    attrs['w:anchor'] = href.slice(1)
    delete attrs['r:id']
  }
  return schema.marks.link!.create({ v: packJml([shell[0], attrs, ...(shell.slice(2) as JmlElement[])]), href: href.startsWith('#') ? null : href })
}

/** The marks new link text gets: the link and Word's Hyperlink character style. */
export function hyperlinkMarks(schema: Schema, href: string): Mark[] {
  return [linkMark(schema, href), schema.marks.rStyle!.create({ v: packJml(['w:rStyle', { 'w:val': 'Hyperlink' }]) })]
}

function isHyperlinkStyle(mark: Mark): boolean {
  return mark.type.name === 'rStyle' && jmlAttr(jml(mark.attrs.v), 'w:val') === 'Hyperlink'
}

/** Takes links out of a range, with the Hyperlink style they brought (other character styles stay). */
function removeLinks(tr: Transaction, from: number, to: number, only?: Mark): void {
  changeMarks(tr, from, to, (marks) => {
    const linked = marks.some((mark) => mark.type.name === 'link' && (!only || mark.eq(only)))
    return linked ? marks.filter((mark) => !(mark.type.name === 'link' && (!only || mark.eq(only))) && !isHyperlinkStyle(mark)) : marks
  })
}

/**
 * A hyperlink over the selection, or new text at a cursor. At a cursor in a link, it edits that
 * whole link instead, as Word's Edit Hyperlink does: a new target, new text when given (and the
 * link is plain text), or with `href` null no link at all.
 */
export const setLink = (href: string | null, text?: string): Command => (state) => {
  const type = state.schema.marks.link!
  const tr = state.tr
  const existing = state.selection.empty ? linkAround(state.doc, state.selection.from) : null
  if (existing) {
    if (!href) {
      removeLinks(tr, existing.from, existing.to, existing.mark)
      return tr.docChanged ? tr : null
    }
    const mark = linkMark(state.schema, href, existing.mark)
    changeMarks(tr, existing.from, existing.to, (marks) => (marks.some((current) => current.eq(existing.mark)) ? marks.map((current) => (current.eq(existing.mark) ? mark : current)) : marks))
    let plain = true
    state.doc.nodesBetween(existing.from, existing.to, (node) => {
      if (node.isInline && !node.isText) plain = false
      return true
    })
    if (text && text !== existing.text && plain) {
      const first = tr.doc.nodeAt(existing.from)
      tr.replaceWith(existing.from, existing.to, state.schema.text(text, first?.marks ?? [mark]))
      tr.setSelection(TextSelection.create(tr.doc, existing.from + text.length))
    }
    return tr.docChanged ? tr : null
  }
  if (!href) {
    if (state.selection.empty) clearMark(state, tr, type)
    else for (const range of state.selection.ranges) removeLinks(tr, range.$from.pos, range.$to.pos)
    return tr
  }
  const mark = linkMark(state.schema, href)
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

export interface FindMatch { from: number; to: number }

function textblockMatches(node: ProseMirrorNode, pos: number, needle: string, options: FindOptions, limit = 10_000): FindMatch[] {
  // Preserve ProseMirror's UTF-16 footprint without a per-character offset array.
  const pieces: string[] = []
  node.forEach((child) => {
    pieces.push(child.isText ? child.text! : '\u0000'.repeat(child.nodeSize))
  })
  const text = pieces.join('')
  const haystack = options.matchCase ? text : text.toLowerCase()
  const originalOffset = haystack.length === text.length ? null : originalCaseOffsets(text)
  const results: FindMatch[] = []
  let index = haystack.indexOf(needle)
  while (index >= 0 && results.length < limit) {
    const end = index + needle.length
    const from = originalOffset ? originalOffset(index, false) : index
    const to = originalOffset ? originalOffset(end - 1, true) : end
    const boundary = !options.wholeWord || (!/[\p{L}\p{N}_]$/u.test(text.slice(Math.max(0, from - 2), from)) && !/^[\p{L}\p{N}_]/u.test(text.slice(to, to + 2)))
    if (boundary) results.push({ from: pos + 1 + from, to: pos + 1 + to })
    index = haystack.indexOf(needle, index + Math.max(1, needle.length))
  }
  return results
}

export function findMatches(doc: ProseMirrorNode, query: string, options: FindOptions = {}): FindMatch[] {
  if (!query) return []
  const projection = revisionProjection(doc)
  const results: FindMatch[] = []
  const needle = options.matchCase ? query : query.toLowerCase()
  projection.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' && node.attrs.phantom) return false
    if (!node.isTextblock) return true
    if (results.length < 10_000) pushAll(results, textblockMatches(node, pos, needle, options, 10_000 - results.length))
    return false
  })
  return results.map(({ from, to }) => ({ from: projection.sourcePosition(from, 1), to: projection.sourcePosition(to, -1) })).filter(({ from, to }) => from < to)
}

/** Validate source ranges with the same Unicode and boundary rules used to find them. */
export function validFindMatches(doc: ProseMirrorNode, matches: FindMatch[], query: string, options: FindOptions = {}): FindMatch[] {
  const ranges = new Set(findMatches(doc, query, options).map(({ from, to }) => `${from}:${to}`))
  return matches.filter(({ from, to }) => ranges.has(`${from}:${to}`))
}

/** Replaces matches (all, or the one at `only`) keeping the formatting of each match's start. */
export function replaceMatches(state: EditorState, matches: { from: number; to: number }[], replacement: string, query?: string, options: FindOptions = {}): Transaction {
  const tr = state.tr
  const valid = query === undefined ? matches : validFindMatches(state.doc, matches, query, options)
  // Accepted traversal can move rowspan cells ahead of earlier source positions.
  for (const match of [...valid].sort((a, b) => b.from - a.from || b.to - a.to)) {
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
  revisionProjection(doc).doc.descendants((node) => {
    if (node.type.name === 'tableCell' && node.attrs.phantom) return false
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

export type WordCount = ReturnType<typeof wordCount>

/** Word counts of the selection (each cell of a cell selection), tracked deletions excluded. */
export function selectionWordCount(state: EditorState): WordCount {
  const total: WordCount = { words: 0, characters: 0, charactersWithSpaces: 0, paragraphs: 0 }
  for (const range of state.selection.ranges) {
    if (range.$from.pos >= range.$to.pos) continue
    const counted = wordCount(state.doc.cut(range.$from.pos, range.$to.pos))
    for (const key of Object.keys(total) as (keyof WordCount)[]) total[key] += counted[key]
  }
  return total
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’-]/u

/** The word around a position (Word acts on it when nothing is selected), or null between words. */
export function wordAt(doc: ProseMirrorNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.inlineContent) return null
  const text = parent.textBetween(0, parent.content.size, undefined, '￼')
  let start = $pos.parentOffset
  let end = start
  while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--
  while (end < text.length && WORD_CHAR.test(text[end]!)) end++
  return start < end ? { from: $pos.start() + start, to: $pos.start() + end } : null
}

export type CaseChange = 'lower' | 'upper' | 'title' | 'sentence' | 'toggle' | 'cycle'

/** The language of a run, for case mapping (Turkish dotted i and the like). */
function runLanguage(marks: readonly Mark[], fallback: string | undefined): string | undefined {
  for (const mark of marks) {
    if (mark.type.name !== 'rPrRest') continue
    const lang = jmlAttr((unpackJml<JmlElement[]>(mark.attrs.v as string) ?? []).find((element) => element[0] === 'w:lang'), 'w:val')
    if (lang) return lang
  }
  return fallback
}

function locale(lang: string | undefined): string | undefined {
  if (!lang) return undefined
  try {
    return Intl.getCanonicalLocales(lang)[0]
  } catch {
    return undefined
  }
}

/**
 * Word's Change Case over the selection (the word at a cursor): lowercase, UPPERCASE,
 * Capitalize Each Word, Sentence case, tOGGLE cASE, or `cycle` for Shift+F3 (lower, then
 * Title, then UPPER). Word and sentence boundaries come from the whole paragraph, across runs;
 * tracked deletions are left alone.
 */
export const changeCase = (change: CaseChange): Command => (state, context) => {
  let ranges = state.selection.ranges.map((range) => ({ from: range.$from.pos, to: range.$to.pos })).filter((range) => range.from < range.to)
  if (!ranges.length) {
    const word = wordAt(state.doc, state.selection.from)
    if (!word) return null
    ranges = [word]
  }
  const fallbackLang = jmlAttr(context.styles.docDefaults.rPr.get('w:lang'), 'w:val')
  interface Segment { from: number; text: string; lang: string | undefined; context: number }
  const paragraphs: { text: string; segments: Segment[] }[] = []
  const seen = new Set<number>()
  for (const range of ranges) {
    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isTextblock) return true
      if (seen.has(pos)) return false
      seen.add(pos)
      // The paragraph's visible text gives the context; only text inside the ranges changes.
      let text = ''
      const segments: Segment[] = []
      node.forEach((child, offset) => {
        const start = pos + 1 + offset
        const deleted = inlineMarks(child).some((mark) => mark.type.name === 'del' || mark.type.name === 'moveFrom')
        if (deleted) return
        if (!child.isText) {
          text += child.type.name === 'tab' || child.type.name === 'break' ? ' ' : LINK_TRANSPARENT.has(child.type.name) ? '' : '￼'
          return
        }
        for (const { from, to } of ranges) {
          const a = Math.max(from, start)
          const b = Math.min(to, start + child.nodeSize)
          if (a < b) segments.push({ from: a, text: child.text!.slice(a - start, b - start), lang: locale(runLanguage(child.marks, fallbackLang)), context: text.length + (a - start) })
        }
        text += child.text!
      })
      paragraphs.push({ text, segments })
      return false
    })
  }
  const letters = paragraphs.flatMap((paragraph) => paragraph.segments.map((segment) => segment.text)).join('').replace(/[^\p{L}]/gu, '')
  let mode: Exclude<CaseChange, 'cycle'> = change === 'cycle' ? 'upper' : change
  if (change === 'cycle' && letters) mode = letters === letters.toUpperCase() ? 'lower' : letters === letters.toLowerCase() ? 'title' : 'upper'
  const edits: { from: number; to: number; text: string }[] = []
  for (const paragraph of paragraphs) {
    // Word and sentence starts by offset in the paragraph's text.
    const wordStarts = new Set<number>()
    const sentenceStarts = new Set<number>()
    let capitalize = true
    let ended = false
    let inWord = false
    let index = 0
    for (const char of paragraph.text) {
      if (/\p{L}/u.test(char)) {
        if (capitalize) sentenceStarts.add(index)
        if (!inWord) wordStarts.add(index)
        capitalize = false
        ended = false
      } else if (/[.!?]/.test(char)) ended = true
      else if (/\s/.test(char)) { if (ended) capitalize = true }
      else if (/\p{N}/u.test(char)) capitalize = false
      inWord = /[\p{L}\p{N}\p{M}'’]/u.test(char)
      index += char.length
    }
    for (const segment of paragraph.segments) {
      const upper = (value: string) => value.toLocaleUpperCase(segment.lang)
      const lower = (value: string) => value.toLocaleLowerCase(segment.lang)
      let offset = 0
      let spanStart = -1
      let spanText = ''
      const flush = (end: number) => {
        if (spanStart >= 0) edits.push({ from: segment.from + spanStart, to: segment.from + end, text: spanText })
        spanStart = -1
        spanText = ''
      }
      for (const char of segment.text) {
        const at = segment.context + offset
        const wordStart = wordStarts.has(at)
        const next = mode === 'lower' ? lower(char)
          : mode === 'upper' ? upper(char)
          : mode === 'toggle' ? (char === upper(char) ? lower(char) : upper(char))
          : mode === 'title' ? (wordStart ? upper(char) : lower(char))
          : sentenceStarts.has(at) ? upper(char) : lower(char)
        if (next !== char) {
          if (spanStart < 0) spanStart = offset
          spanText += next
        } else {
          flush(offset)
        }
        offset += char.length
      }
      flush(offset)
    }
  }
  if (!edits.length) return null
  const tr = state.tr
  const { selection } = state
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    const node = state.doc.nodeAt(edit.from)
    tr.replaceWith(edit.from, edit.to, state.schema.text(edit.text, node?.marks ?? []))
  }
  // Case changes rarely change lengths; when they do not, the selection stays exactly where it was.
  if (selection instanceof TextSelection && edits.every((edit) => edit.text.length === edit.to - edit.from)) tr.setSelection(TextSelection.create(tr.doc, selection.anchor, selection.head))
  return tr
}

export interface OutlineEntry {
  level: number
  text: string
  storyId?: string
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
  // As in Word, the paragraph's format comes along only with its paragraph mark: from a cursor, a
  // whole paragraph, or a selection past a paragraph's end. Part of a paragraph copies the text format.
  const { selection } = state
  const { $from, $to } = selection
  const withMark = selection.empty || $from.parent !== $to.parent || ($from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size)
  const paragraph = withMark ? selectedParagraphs(state)[0]?.node : undefined
  const attrs: Record<string, unknown> = {}
  if (paragraph) {
    attrs.pStyle = paragraph.attrs.pStyle
    for (const key of Object.keys(PARAGRAPH_PROPERTY_ATTRS)) if (key !== 'numPr') attrs[key] = paragraph.attrs[key]
  }
  const names = new Set([...DIRECT_RUN_MARKS])
  return { marks: selectionMarks(state).filter((mark) => names.has(mark.type.name)), paragraph: attrs }
}

/** Applies a copied format to the selection, or to `range` (the word a format painter click lands on). */
export const pasteFormat = (format: CopiedFormat, range?: { from: number; to: number }): Command => (state) => {
  const tr = state.tr
  const names = new Set(DIRECT_RUN_MARKS)
  const ranges = range ? [{ from: range.from, to: range.to }] : state.selection.ranges.map((entry) => ({ from: entry.$from.pos, to: entry.$to.pos }))
  for (const { from, to } of ranges) {
    if (from >= to) continue
    changeMarks(tr, from, to, (marks) => {
      let next: readonly Mark[] = marks.filter((mark) => !names.has(mark.type.name))
      for (const mark of format.marks) next = mark.addToSet(next)
      return next
    })
  }
  // The paragraphs painted (or the cursor's) take a copied paragraph format too, as in Word.
  let paragraphs = Object.keys(format.paragraph).length ? selectedParagraphs(state) : []
  if (range && paragraphs.length) {
    const $from = state.doc.resolve(range.from)
    paragraphs = $from.parent.type.name === 'paragraph' ? [{ node: $from.parent, pos: $from.before() }] : []
  }
  for (const { node, pos } of paragraphs) tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, ...format.paragraph })
  return tr
}

/** Selects a node (an image) by position. */
export function selectNode(state: EditorState, pos: number): Transaction {
  return state.tr.setSelection(NodeSelection.create(state.doc, pos))
}

