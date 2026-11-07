import { MAX_COLS, MAX_ROWS, type CellRange } from '../address.js'
import { formatA1Reference, scanReferences } from '../model/references.js'

/** A function's documentation for autocomplete and argument hints. */
export interface FunctionDoc {
  name: string
  description?: string
  args: { name: string; optional?: boolean; repeating?: boolean }[]
}

/** Colors Excel cycles through for references in a formula being edited. */
export const REFERENCE_COLORS = ['#1A73E8', '#D93025', '#7B1FA2', '#188038', '#E37400', '#00838F', '#C2185B', '#5F6368']

export interface FormulaReference {
  start: number
  end: number
  range: CellRange
  sheet?: string
  color: string
}

/** References in formula text (with the leading `=`), with positions and colors. */
export function formulaReferences(text: string): FormulaReference[] {
  if (!text.startsWith('=')) return []
  const body = text.slice(1)
  const colors = new Map<string, string>()
  const found: FormulaReference[] = []
  for (const ref of scanReferences(body)) {
    if (ref.kind !== 'ref' || ref.external) continue
    const range: CellRange = {
      top: Math.min(ref.from.row ?? 0, ref.to?.row ?? ref.from.row ?? 0),
      left: Math.min(ref.from.col ?? 0, ref.to?.col ?? ref.from.col ?? 0),
      bottom: ref.from.row === undefined ? MAX_ROWS - 1 : Math.max(ref.from.row, ref.to?.row ?? ref.from.row),
      right: ref.from.col === undefined ? MAX_COLS - 1 : Math.max(ref.from.col, ref.to?.col ?? ref.from.col),
    }
    const key = body.slice(ref.start, ref.end).replace(/\$/g, '').toUpperCase()
    let color = colors.get(key)
    if (!color) {
      color = REFERENCE_COLORS[colors.size % REFERENCE_COLORS.length]!
      colors.set(key, color)
    }
    found.push({ start: ref.start + 1, end: ref.end + 1, range, ...(ref.sheet ? { sheet: ref.sheet.first } : {}), color })
  }
  return found
}

/** Whether a reference can be inserted at the caret (after `=`, an operator, `(` or `,`). */
export function canInsertReference(text: string, caret: number): boolean {
  if (!text.startsWith('=')) return false
  const before = text.slice(0, caret).trimEnd()
  return /[=+\-*/^&(,:<> ]$/.test(before) || before === '='
}

/**
 * Inserts or replaces a reference at the caret while pointing (clicking or using arrows while
 * editing a formula). If the caret is right after a reference inserted by pointing, it is
 * replaced, so moving the pointer updates it.
 */
export function insertReference(text: string, caret: number, range: CellRange, sheetPrefix: string | undefined, replace?: { start: number; end: number }): { text: string; caret: number; inserted: { start: number; end: number } } {
  const reference = (sheetPrefix ?? '') + formatA1Reference({ from: { row: range.top, col: range.left }, ...(range.bottom !== range.top || range.right !== range.left ? { to: { row: range.bottom, col: range.right } } : {}) })
  const start = replace ? replace.start : caret
  const end = replace ? replace.end : caret
  const next = text.slice(0, start) + reference + text.slice(end)
  return { text: next, caret: start + reference.length, inserted: { start, end: start + reference.length } }
}

/** The function name being typed at the caret, if any (for autocomplete). */
export function partialFunctionName(text: string, caret: number): { prefix: string; start: number } | undefined {
  if (!text.startsWith('=')) return undefined
  const before = text.slice(0, caret)
  if (insideString(before)) return undefined
  const match = /(?:^=|[=+\-*/^&(,:<> ])([A-Za-z_][A-Za-z0-9_.]*)$/.exec(before)
  if (!match) return undefined
  // A cell reference being typed (`A1`) is not a function name.
  if (/^[A-Za-z]{1,3}\d+$/.test(match[1]!)) return undefined
  return { prefix: match[1]!, start: caret - match[1]!.length }
}

function insideString(text: string): boolean {
  let inside = false
  for (const char of text) if (char === '"') inside = !inside
  return inside
}

/** Functions whose names start with the prefix, best matches first. */
export function completions(prefix: string, docs: readonly FunctionDoc[], limit = 12): FunctionDoc[] {
  const upper = prefix.toUpperCase().replace(/^_XLFN\./, '')
  if (!upper) return []
  return docs
    .filter((doc) => doc.name.startsWith(upper))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Applies a completion: the name plus an opening parenthesis. */
export function applyCompletion(text: string, caret: number, start: number, name: string): { text: string; caret: number } {
  const after = text.slice(caret)
  const insert = after.startsWith('(') ? name : `${name}(`
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length }
}

/** The innermost function call around the caret and which argument the caret is in. */
export function activeCall(text: string, caret: number): { name: string; argument: number } | undefined {
  if (!text.startsWith('=')) return undefined
  const stack: { name: string; argument: number }[] = []
  let inString = false
  let brace = 0
  for (let index = 1; index < caret; index++) {
    const char = text[index]!
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') brace++
    else if (char === '}') brace--
    else if (char === '(') {
      const name = /([A-Za-z_][A-Za-z0-9_.]*)$/.exec(text.slice(1, index))?.[1]
      stack.push({ name: (name ?? '').toUpperCase().replace(/^_XLFN\.(_XLWS\.)?/, ''), argument: 0 })
    } else if (char === ')') stack.pop()
    else if (char === ',' && !brace && stack.length) stack[stack.length - 1]!.argument++
  }
  const call = stack[stack.length - 1]
  return call && call.name ? call : undefined
}

/** A hint like `VLOOKUP(lookup_value, table_array, [col_index_num], …)` split around the active argument. */
export function argumentHint(text: string, caret: number, docs: readonly FunctionDoc[]): { name: string; parts: { text: string; active: boolean }[]; description?: string } | undefined {
  const call = activeCall(text, caret)
  if (!call) return undefined
  const doc = docs.find((entry) => entry.name === call.name)
  if (!doc) return undefined
  const parts: { text: string; active: boolean }[] = [{ text: `${doc.name}(`, active: false }]
  const last = doc.args.length - 1
  doc.args.forEach((arg, index) => {
    const repeating = arg.repeating && index === last
    const active = index === call.argument || (!!repeating && call.argument >= index)
    const label = arg.optional ? `[${arg.name}]` : arg.name
    parts.push({ text: label, active })
    if (repeating) parts.push({ text: ', …', active: false })
    if (index < last) parts.push({ text: ', ', active: false })
  })
  parts.push({ text: ')', active: false })
  return { name: doc.name, parts, ...(doc.description ? { description: doc.description } : {}) }
}
