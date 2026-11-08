import type { Mark, MarkType, Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { buildRunProperties, normalizeText, slideTextSchema, type TextJSON } from './text.js'
import { attr, childElements, createElement, importFragment, NS, parseFragment, parseXmlDocument, serializeNode, type XmlDocument, type XmlElement } from './xml.js'

/**
 * Text formatting as the toolbar applies it: run properties are marks (one per property, so
 * concurrent formatting merges), paragraph properties are edits to each paragraph's `a:pPr`.
 * The same operations work on a live editor selection and on a whole text body (formatting
 * selected shapes without entering them).
 */

export type RunMark = 'b' | 'i' | 'u' | 'strike' | 'sz' | 'font' | 'fill' | 'highlight' | 'baseline' | 'cap' | 'spc'

/** A mark value: `undefined` removes the mark (back to the inherited formatting). */
export type MarkValue = string | number | boolean | undefined

// ---------------------------------------------------------------------------------------------
// Paragraph properties

const PPR_ORDER = ['lnSpc', 'spcBef', 'spcAft', 'buClrTx', 'buClr', 'buSzTx', 'buSzPct', 'buSzPts', 'buFontTx', 'buFont', 'buNone', 'buAutoNum', 'buChar', 'buBlip', 'tabLst', 'defRPr', 'extLst']
const BULLET_KINDS = ['buNone', 'buAutoNum', 'buChar', 'buBlip']

export type ParagraphEdit = (pPr: XmlElement) => void

/** Applies `edit` to a raw `a:pPr` value (creating one when absent); returns the new value or null when empty. */
export function editParagraphProperties(pPr: unknown, edit: ParagraphEdit): string | null {
  const element = typeof pPr === 'string' && pPr ? parseFragment(pPr) : parseFragment(`<a:pPr xmlns:a="${NS.a}"/>`)
  edit(element)
  const attributes = Array.from({ length: element.attributes.length }, (_, index) => element.attributes.item(index)!)
  if (!attributes.some((attribute) => !attribute.name.startsWith('xmlns')) && !childElements(element).length) return null
  return serializeNode(element)
}

function replaceChild(pPr: XmlElement, names: readonly string[], replacement: XmlElement | undefined): void {
  for (const existing of childElements(pPr)) if (names.includes(existing.localName ?? '')) pPr.removeChild(existing)
  if (!replacement) return
  const rank = PPR_ORDER.indexOf(replacement.localName ?? '')
  const after = childElements(pPr).find((existing) => PPR_ORDER.indexOf(existing.localName ?? '') > rank)
  pPr.insertBefore(replacement, after ?? null)
}

function element(pPr: XmlElement, qualifiedName: string, attributes: Record<string, string> = {}, child?: XmlElement): XmlElement {
  const created = createElement(pPr.ownerDocument as unknown as XmlDocument, qualifiedName)
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value)
  if (child) created.appendChild(child)
  return created
}

export const paragraphEdits = {
  align(algn: 'l' | 'ctr' | 'r' | 'just'): ParagraphEdit {
    return (pPr) => pPr.setAttribute('algn', algn)
  },
  /** Moves list levels by `delta` (0–8), as Tab and Shift+Tab do in a list. */
  level(delta: number): ParagraphEdit {
    return (pPr) => {
      const level = Math.min(8, Math.max(0, (Number.parseInt(attr(pPr, 'lvl') ?? '0', 10) || 0) + delta))
      if (level) pPr.setAttribute('lvl', String(level))
      else pPr.removeAttribute('lvl')
    }
  },
  /** Line spacing as a multiple (1, 1.15, 1.5, 2…). */
  lineSpacing(multiple: number): ParagraphEdit {
    return (pPr) => {
      const percent = element(pPr, 'a:spcPct', { val: String(Math.round(multiple * 100000)) })
      replaceChild(pPr, ['lnSpc'], element(pPr, 'a:lnSpc', {}, percent))
    }
  },
  spaceBefore(points: number): ParagraphEdit {
    return (pPr) => replaceChild(pPr, ['spcBef'], element(pPr, 'a:spcBef', {}, element(pPr, 'a:spcPts', { val: String(Math.round(points * 100)) })))
  },
  spaceAfter(points: number): ParagraphEdit {
    return (pPr) => replaceChild(pPr, ['spcAft'], element(pPr, 'a:spcAft', {}, element(pPr, 'a:spcPts', { val: String(Math.round(points * 100)) })))
  },
  /**
   * Bullets on or off. `inherited` says whether the list style already gives this level a
   * bullet (body placeholders do), in which case "on" only needs to drop an explicit `buNone`.
   */
  bullets(kind: 'none' | 'char' | 'number', inherited: boolean): ParagraphEdit {
    return (pPr) => {
      if (kind === 'none') {
        replaceChild(pPr, BULLET_KINDS, element(pPr, 'a:buNone'))
        return
      }
      if (kind === 'char' && inherited) {
        replaceChild(pPr, BULLET_KINDS, undefined)
        return
      }
      replaceChild(pPr, ['buFontTx', 'buFont'], kind === 'char' ? element(pPr, 'a:buFont', { typeface: 'Arial' }) : undefined)
      replaceChild(pPr, BULLET_KINDS, kind === 'char' ? element(pPr, 'a:buChar', { char: '•' }) : element(pPr, 'a:buAutoNum', { type: 'arabicPeriod' }))
      if (!inherited && !pPr.hasAttribute('indent')) {
        pPr.setAttribute('marL', String(285750 + (Number.parseInt(attr(pPr, 'lvl') ?? '0', 10) || 0) * 457200))
        pPr.setAttribute('indent', '-285750')
      }
    }
  },
}

/** Which bullet a paragraph's own `a:pPr` asks for, if any. */
export function ownBullet(pPr: unknown): 'none' | 'char' | 'number' | undefined {
  if (typeof pPr !== 'string' || !pPr) return undefined
  const kind = childElements(parseFragment(pPr)).find((entry) => BULLET_KINDS.includes(entry.localName ?? ''))?.localName
  return kind === 'buNone' ? 'none' : kind === 'buAutoNum' ? 'number' : kind === 'buChar' || kind === 'buBlip' ? 'char' : undefined
}

// ---------------------------------------------------------------------------------------------
// Whole text bodies

export function markAll(json: TextJSON, type: RunMark, value: MarkValue): TextJSON {
  const apply = (node: TextJSON): TextJSON => {
    if (node.type === 'text') {
      const marks = (node.marks ?? []).filter((mark) => mark.type !== type)
      if (value !== undefined) marks.push({ type, attrs: { value } })
      return { ...node, marks }
    }
    if (node.type === 'paragraph') {
      // Empty paragraphs keep the formatting for text typed into them later in endParaRPr.
      return { ...node, content: node.content?.map(apply) }
    }
    return node.content ? { ...node, content: node.content.map(apply) } : node
  }
  return normalizeText(apply(json))
}

export function editAllParagraphs(json: TextJSON, edit: ParagraphEdit): TextJSON {
  return normalizeText({
    ...json,
    content: (json.content ?? []).map((paragraph) => ({ ...paragraph, attrs: { ...paragraph.attrs, pPr: editParagraphProperties(paragraph.attrs?.pPr, edit) } })),
  })
}

// ---------------------------------------------------------------------------------------------
// Editor selections

export type Command = (state: EditorState, dispatch?: (transaction: Transaction) => void) => boolean

export function setMarkCommand(type: RunMark, value: MarkValue): Command {
  return (state, dispatch) => {
    const markType = slideTextSchema().marks[type]!
    const { from, to, empty } = state.selection
    const transaction = state.tr
    if (empty) {
      const stored = (state.storedMarks ?? state.selection.$from.marks()).filter((mark) => mark.type !== markType)
      transaction.setStoredMarks(value === undefined ? stored : [...stored, markType.create({ value })])
    } else {
      transaction.removeMark(from, to, markType)
      if (value !== undefined) transaction.addMark(from, to, markType.create({ value }))
    }
    dispatch?.(transaction.scrollIntoView())
    return true
  }
}

export function paragraphCommand(edit: ParagraphEdit): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection
    const transaction = state.tr
    state.doc.nodesBetween(from, to, (node, position) => {
      if (node.type.name !== 'paragraph') return true
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, pPr: editParagraphProperties(node.attrs.pPr, edit) })
      return false
    })
    dispatch?.(transaction)
    return true
  }
}

/** The mark value at the selection: the same everywhere, or undefined when mixed or unset. */
export function markValueAt(state: EditorState, type: RunMark): MarkValue {
  const markType = slideTextSchema().marks[type]!
  const { from, to, empty } = state.selection
  if (empty) return (state.storedMarks ?? state.selection.$from.marks()).find((mark) => mark.type === markType)?.attrs.value as MarkValue
  let value: MarkValue
  let first = true
  let mixed = false
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    const current = node.marks.find((mark) => mark.type === markType)?.attrs.value as MarkValue
    if (first) {
      value = current
      first = false
    } else if (current !== value) mixed = true
    return false
  })
  return mixed ? undefined : value
}

/** The first selected paragraph, for paragraph-level toolbar state. */
export function paragraphAt(state: EditorState): ProseMirrorNode | undefined {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth--) if ($from.node(depth).type.name === 'paragraph') return $from.node(depth)
  return undefined
}

/** The first text's value of a mark in a whole text body (formatting state of a selected shape). */
export function markValueIn(json: TextJSON, type: RunMark): MarkValue {
  for (const paragraph of json.content ?? []) {
    for (const inline of paragraph.content ?? []) {
      if (inline.type === 'text') return inline.marks?.find((mark) => mark.type === type)?.attrs?.value as MarkValue
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Font size steps, clearing, highlight, and baseline

/** PowerPoint's font size ladder for Increase and Decrease Font Size (points). */
export const FONT_SIZE_STEPS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96] as const

/** The next size up or down the ladder; past its ends, steps of 12 pt up and 1 pt down (1–4000 pt). */
export function steppedFontSize(points: number, delta: 1 | -1): number {
  const top = FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1]!
  if (delta > 0) return Math.min(4000, FONT_SIZE_STEPS.find((size) => size > points + 0.001) ?? (Math.floor(points / 12) + 1) * 12)
  if (points > top + 12.001) return Math.ceil(points / 12) * 12 - 12
  const lower = [...FONT_SIZE_STEPS].reverse().find((size) => size < points - 0.001)
  return lower ?? Math.max(1, Math.ceil(points) - 1)
}

/** Run marks Clear Formatting removes; links and the rest of `a:rPr` (language, effects) stay. */
export const CLEARABLE_MARKS: readonly RunMark[] = ['b', 'i', 'u', 'strike', 'sz', 'font', 'fill', 'highlight', 'baseline', 'cap', 'spc']

/** Removes marks from the selection (or from what typing at the caret would use), in one step. */
export function clearMarksCommand(types: readonly RunMark[]): Command {
  return (state, dispatch) => {
    const markTypes = types.map((type) => slideTextSchema().marks[type]!)
    const { from, to, empty } = state.selection
    const transaction = state.tr
    if (empty) transaction.setStoredMarks((state.storedMarks ?? state.selection.$from.marks()).filter((mark) => !markTypes.includes(mark.type)))
    else for (const type of markTypes) transaction.removeMark(from, to, type)
    dispatch?.(transaction)
    return true
  }
}

export function clearMarksAll(json: TextJSON, types: readonly RunMark[]): TextJSON {
  return mapTextRuns(json, (node) => ({ ...node, marks: (node.marks ?? []).filter((mark) => !types.includes(mark.type as RunMark)) }))
}

/**
 * Steps every run's size along the ladder from its own size, explicit or inherited (`inherited`
 * gives a paragraph's default size in hundredths of a point from its `a:pPr`), so mixed sizes
 * keep their proportions, as in PowerPoint.
 */
export function stepFontSizeCommand(delta: 1 | -1, inherited: (pPr: unknown) => number): Command {
  return (state, dispatch) => {
    const size = slideTextSchema().marks.sz!
    const { from, to, empty, $from } = state.selection
    const transaction = state.tr
    const next = (current: unknown, pPr: unknown) => Math.round(steppedFontSize((typeof current === 'number' ? current : inherited(pPr)) / 100, delta) * 100)
    if (empty) {
      const stored = state.storedMarks ?? $from.marks()
      const current = stored.find((mark) => mark.type === size)?.attrs.value
      transaction.setStoredMarks([...stored.filter((mark) => mark.type !== size), size.create({ value: next(current, $from.parent.attrs.pPr) })])
    } else {
      state.doc.nodesBetween(from, to, (node, position, parent) => {
        if (!node.isText) return true
        const current = node.marks.find((mark) => mark.type === size)?.attrs.value
        transaction.addMark(Math.max(from, position), Math.min(to, position + node.nodeSize), size.create({ value: next(current, parent?.attrs.pPr) }))
        return false
      })
    }
    dispatch?.(transaction.scrollIntoView())
    return true
  }
}

export function stepFontSizesAll(json: TextJSON, delta: 1 | -1, inherited: (pPr: unknown) => number): TextJSON {
  return mapTextRuns(json, (node, paragraph) => {
    const current = node.marks?.find((mark) => mark.type === 'sz')?.attrs?.value
    const points = (typeof current === 'number' ? current : inherited(paragraph.attrs?.pPr)) / 100
    return { ...node, marks: [...(node.marks ?? []).filter((mark) => mark.type !== 'sz'), { type: 'sz', attrs: { value: Math.round(steppedFontSize(points, delta) * 100) } }] }
  })
}

/** The `highlight` mark value for a color: a fill (`a:solidFill`) or a bare color element, as XML. */
export function highlightXml(color: string): string {
  const element = parseFragment(color)
  const source = element.localName === 'solidFill' ? childElements(element)[0] : element
  if (!source) throw new Error('A highlight needs a color')
  const highlight = createElement(element.ownerDocument as unknown as XmlDocument, 'a:highlight')
  highlight.appendChild(source.cloneNode(true))
  return serializeNode(highlight)
}

/** `a:rPr/@baseline` for superscript and subscript (PowerPoint's 30% and −25%). */
export const BASELINE = { sup: 30000, sub: -25000 } as const

function mapTextRuns(json: TextJSON, map: (node: TextJSON, paragraph: TextJSON) => TextJSON): TextJSON {
  return normalizeText({
    ...json,
    content: (json.content ?? []).map((paragraph) => (paragraph.content ? { ...paragraph, content: paragraph.content.map((node) => (node.type === 'text' ? map(node, paragraph) : node)) } : paragraph)),
  })
}

// ---------------------------------------------------------------------------------------------
// Links and fields

/** The `link` mark for a URL; the relationship id is allocated when the slide is written. */
export function linkAttrs(href: string): Record<string, unknown> {
  return { xml: `<a:hlinkClick xmlns:a="${NS.a}" xmlns:r="${NS.r}"/>`, target: href, external: true, relType: null }
}

/** The run of equal `type` marks at a position: the text after it, else the text before it. */
function markExtent($position: ResolvedPos, type: MarkType): { from: number; to: number; mark: Mark } | undefined {
  const parent = $position.parent
  const start = $position.start()
  const children: { node: ProseMirrorNode; from: number }[] = []
  parent.forEach((node, offset) => children.push({ node, from: start + offset }))
  const has = (index: number) => index >= 0 && index < children.length && children[index]!.node.marks.some((mark) => mark.type === type)
  const after = children.findIndex(({ node, from }) => from <= $position.pos && $position.pos < from + node.nodeSize)
  const before = children.findIndex(({ node, from }) => from < $position.pos && $position.pos <= from + node.nodeSize)
  const index = has(after) ? after : has(before) ? before : -1
  if (index < 0) return undefined
  const mark = children[index]!.node.marks.find((entry) => entry.type === type)!
  let first = index
  let last = index
  while (first > 0 && mark.isInSet(children[first - 1]!.node.marks)) first--
  while (last < children.length - 1 && mark.isInSet(children[last + 1]!.node.marks)) last++
  return { from: children[first]!.from, to: children[last]!.from + children[last]!.node.nodeSize, mark }
}

/**
 * Links the selection to `href`, or removes links with undefined. At a caret, the link around it
 * is edited or removed; with none there, a new link inserts `text` (or the URL itself).
 */
export function setLinkCommand(href: string | undefined, text?: string): Command {
  return (state, dispatch) => {
    const type = slideTextSchema().marks.link!
    let { from, to } = state.selection
    const transaction = state.tr
    if (state.selection.empty) {
      const around = markExtent(state.selection.$from, type)
      if (around) ({ from, to } = around)
      else if (!href) return false
      else {
        const marks = (state.storedMarks ?? state.selection.$from.marks()).filter((mark) => mark.type !== type)
        transaction.insert(from, slideTextSchema().text(text || href, [...marks, type.create(linkAttrs(href))]))
        dispatch?.(transaction.scrollIntoView())
        return true
      }
    }
    transaction.removeMark(from, to, type)
    if (href) transaction.addMark(from, to, type.create(linkAttrs(href)))
    dispatch?.(transaction.scrollIntoView())
    return true
  }
}

export function linkAll(json: TextJSON, href: string | undefined): TextJSON {
  return mapTextRuns(json, (node) => ({ ...node, marks: [...(node.marks ?? []).filter((mark) => mark.type !== 'link'), ...(href ? [{ type: 'link', attrs: linkAttrs(href) }] : [])] }))
}

/** The link target at the selection: the same everywhere in it, or around the caret. */
export function linkAt(state: EditorState): string | undefined {
  const type = slideTextSchema().marks.link!
  const target = (mark: Mark | undefined) => (typeof mark?.attrs.target === 'string' ? mark.attrs.target : undefined)
  if (state.selection.empty) return target(markExtent(state.selection.$from, type)?.mark)
  let value: string | undefined
  let first = true
  let mixed = false
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (!node.isText) return true
    const current = target(node.marks.find((mark) => mark.type === type))
    if (first) value = current
    else if (current !== value) mixed = true
    first = false
    return false
  })
  return mixed ? undefined : value
}

/** The first run's link in a whole text body. */
export function linkIn(json: TextJSON): string | undefined {
  for (const paragraph of json.content ?? []) {
    for (const inline of paragraph.content ?? []) {
      if (inline.type !== 'text') continue
      const target = inline.marks?.find((mark) => mark.type === 'link')?.attrs?.target
      return typeof target === 'string' ? target : undefined
    }
  }
  return undefined
}

const scratch = parseXmlDocument('<w/>')

/**
 * Inserts a field (`slidenum`, `datetime1`, …) at the selection, formatted like the text around
 * it. `text` is the cached value other apps show until they compute their own; `id` is a GUID.
 */
export function insertFieldCommand(fieldType: string, text: string, id: string): Command {
  return (state, dispatch) => {
    const marks = (state.storedMarks ?? state.selection.$from.marks()).filter((mark) => mark.type.name !== 'link')
    const rPr = buildRunProperties(scratch, marks.map((mark) => ({ type: mark.type.name, attrs: mark.attrs })))
    const field = slideTextSchema().nodes.field!.create({ id, fieldType, text, rPr: rPr ? serializeNode(rPr) : null, pPr: null })
    dispatch?.(state.tr.replaceSelectionWith(field, false).scrollIntoView())
    return true
  }
}

// ---------------------------------------------------------------------------------------------
// Outlines (`a:ln`) and text boxes (`a:bodyPr`): edits change one attribute or child and keep
// the rest (arrowheads, caps, joins, gradient lines, columns, warps) as the file had them.

/** Puts `replacement` where `names` were, in schema order (`order`), or just removes them. */
function replaceIn(parent: XmlElement, names: readonly string[], order: readonly string[], replacement: XmlElement | undefined): void {
  for (const existing of childElements(parent)) if (names.includes(existing.localName ?? '')) parent.removeChild(existing)
  if (!replacement) return
  const rank = order.indexOf(replacement.localName ?? '')
  const after = childElements(parent).find((existing) => order.indexOf(existing.localName ?? '') > rank)
  parent.insertBefore(replacement, after ?? null)
}

const LN_ORDER = ['noFill', 'solidFill', 'gradFill', 'pattFill', 'prstDash', 'custDash', 'round', 'bevel', 'miter', 'headEnd', 'tailEnd', 'extLst']
const LINE_FILLS = ['noFill', 'solidFill', 'gradFill', 'pattFill']

export type LineEdit = (ln: XmlElement) => void

/** Arrowhead shapes (`a:headEnd/@type`, `a:tailEnd/@type`). */
export type Arrowhead = 'none' | 'triangle' | 'stealth' | 'arrow' | 'oval' | 'diamond'
export type ArrowheadSize = 'sm' | 'med' | 'lg'

/** Applies edits to a shape's own `a:ln` (creating one when it has none, so the style's line still shows through). */
export function editLineProperties(line: string | undefined, ...edits: LineEdit[]): string {
  const element = line ? parseFragment(line) : parseFragment(`<a:ln xmlns:a="${NS.a}"/>`)
  for (const edit of edits) edit(element)
  return serializeNode(element)
}

function arrowEnd(name: 'headEnd' | 'tailEnd', type: Arrowhead | undefined, size?: { w?: ArrowheadSize; len?: ArrowheadSize }): LineEdit {
  return (ln) => {
    if (!type) return replaceIn(ln, [name], LN_ORDER, undefined)
    const end = element(ln, `a:${name}`, { type })
    if (size?.w) end.setAttribute('w', size.w)
    if (size?.len) end.setAttribute('len', size.len)
    replaceIn(ln, [name], LN_ORDER, end)
  }
}

export const lineEdits = {
  /** Line width in EMU (12700 per point). */
  width(emu: number): LineEdit {
    return (ln) => ln.setAttribute('w', String(Math.round(Math.min(20_116_800, Math.max(0, Number.isFinite(emu) ? emu : 0)))))
  },
  /** The line's fill: a fill element as XML (`<a:noFill/>` for no line), or undefined for the style's. */
  fill(xml: string | undefined): LineEdit {
    return (ln) => replaceIn(ln, LINE_FILLS, LN_ORDER, xml ? importFragment(ln.ownerDocument as unknown as XmlDocument, xml) : undefined)
  },
  /** A preset dash (`dash`, `sysDot`, …); `solid` or undefined draws a solid line. */
  dash(preset: string | undefined): LineEdit {
    return (ln) => replaceIn(ln, ['prstDash', 'custDash'], LN_ORDER, preset && preset !== 'solid' ? element(ln, 'a:prstDash', { val: preset }) : undefined)
  },
  /** The arrowhead at the line's start; undefined removes it (no arrowhead unless the style has one). */
  headEnd(type: Arrowhead | undefined, size?: { w?: ArrowheadSize; len?: ArrowheadSize }): LineEdit {
    return arrowEnd('headEnd', type, size)
  },
  /** The arrowhead at the line's end. */
  tailEnd(type: Arrowhead | undefined, size?: { w?: ArrowheadSize; len?: ArrowheadSize }): LineEdit {
    return arrowEnd('tailEnd', type, size)
  },
}

const BODY_ORDER = ['prstTxWarp', 'noAutofit', 'normAutofit', 'spAutoFit', 'scene3d', 'sp3d', 'flatTx', 'extLst']
const AUTOFITS = ['noAutofit', 'normAutofit', 'spAutoFit']

export type BodyEdit = (bodyPr: XmlElement) => void

/** Applies edits to a shape's own `a:bodyPr` (creating one: unset properties keep inheriting). */
export function editBodyProperties(bodyPr: string | undefined, ...edits: BodyEdit[]): string {
  const element = bodyPr ? parseFragment(bodyPr) : parseFragment(`<a:bodyPr xmlns:a="${NS.a}"/>`)
  for (const edit of edits) edit(element)
  return serializeNode(element)
}

export const bodyEdits = {
  /** Vertical alignment of the text in its box. */
  anchor(value: 't' | 'ctr' | 'b'): BodyEdit {
    return (bodyPr) => bodyPr.setAttribute('anchor', value)
  },
  /**
   * Do not Autofit, Shrink text on overflow (`norm`, with the scale the canvas measured), or
   * Resize shape to fit text (`shape`).
   */
  autofit(mode: 'none' | 'norm' | 'shape', scale?: { fontScale: number; lineReduction: number }): BodyEdit {
    return (bodyPr) => {
      const name = mode === 'none' ? 'a:noAutofit' : mode === 'norm' ? 'a:normAutofit' : 'a:spAutoFit'
      const replacement = element(bodyPr, name)
      if (mode === 'norm' && scale && scale.fontScale < 100_000) {
        replacement.setAttribute('fontScale', String(Math.round(scale.fontScale)))
        replacement.setAttribute('lnSpcReduction', String(Math.round(scale.lineReduction)))
      }
      replaceIn(bodyPr, AUTOFITS, BODY_ORDER, replacement)
    }
  },
  /** Margins between the box and its text, in EMU. */
  insets(insets: Partial<Record<'l' | 't' | 'r' | 'b', number>>): BodyEdit {
    return (bodyPr) => {
      for (const [side, value] of Object.entries(insets)) if (value !== undefined && Number.isFinite(value)) bodyPr.setAttribute(`${side}Ins`, String(Math.round(Math.max(0, value))))
    }
  },
  /** Wrap text in shape. */
  wrap(on: boolean): BodyEdit {
    return (bodyPr) => bodyPr.setAttribute('wrap', on ? 'square' : 'none')
  },
}
