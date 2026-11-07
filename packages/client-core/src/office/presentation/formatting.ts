import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { normalizeText, slideTextSchema, type TextJSON } from './text.js'
import { attr, childElements, createElement, NS, parseFragment, serializeNode, type XmlDocument, type XmlElement } from './xml.js'

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
