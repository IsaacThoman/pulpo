import * as Y from 'yjs'
import { cellsMap, cellSource, orderedCells } from '../layout.js'
import type { NotebookController } from './controller.js'

/**
 * Find and replace across every cell of a notebook, as JupyterLab and VS Code do it: matches in
 * notebook order, a current match that steps from the active cell's cursor, and replacements
 * that are each one undo step of this session (the controller's undo manager). Matches follow
 * everyone's edits, recounted a moment after the notebook changes.
 */

export interface NotebookSearchQuery {
  text: string
  matchCase?: boolean
  wholeWord?: boolean
  /** The text is a regular expression (JavaScript syntax); replacements may use `$1`, `$<name>`, and `$&`. */
  regexp?: boolean
}

export interface NotebookSearchMatch {
  key: string
  /** Offsets in the cell's source. */
  from: number
  to: number
}

export interface NotebookSearchState {
  query: NotebookSearchQuery
  matches: readonly NotebookSearchMatch[]
  /** The current match's index, or -1. */
  current: number
  /** The query is a regular expression that does not parse. */
  invalid: boolean
  /** There are more matches than `MAX_SEARCH_MATCHES`; only that many are listed. */
  capped: boolean
  /** Grows when the current match is moved to (not when edits recount), so views scroll to it only then. */
  revealed: number
}

/** Matches listed at most; replace all still replaces every one. */
export const MAX_SEARCH_MATCHES = 10_000
/** Recounts wait this long after the last change to the notebook. */
const RECOUNT_MS = 150

const WORD = '[\\p{L}\\p{N}_]'
const EMPTY_QUERY: NotebookSearchQuery = { text: '' }
const NO_MATCHES: readonly NotebookSearchMatch[] = []

/** The query as a global, multiline regular expression; null when empty, 'invalid' when it does not parse. */
export function searchPattern(query: NotebookSearchQuery): RegExp | null | 'invalid' {
  if (!query.text) return null
  let source = query.regexp ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (query.wholeWord) source = `(?<!${WORD})(?:${source})(?!${WORD})`
  try {
    return new RegExp(source, `gmu${query.matchCase ? '' : 'i'}`)
  } catch {
    return 'invalid'
  }
}

/** Adds a text's matches, empty ones skipped; returns false when there are more than `limit` in all. */
function collect(pattern: RegExp, text: string, key: string, limit: number, out: NotebookSearchMatch[]): boolean {
  pattern.lastIndex = 0
  for (;;) {
    const found = pattern.exec(text)
    if (!found) return true
    if (!found[0].length) {
      // Step past an empty match by a whole code point.
      const code = text.codePointAt(pattern.lastIndex)
      pattern.lastIndex += code !== undefined && code > 0xffff ? 2 : 1
      if (pattern.lastIndex > text.length) return true
      continue
    }
    if (out.length >= limit) return false
    out.push({ key, from: found.index, to: found.index + found[0].length })
  }
}

/** The matches of a query in a notebook, in notebook order (code, Markdown, and raw cells alike). */
export function findInNotebook(doc: Y.Doc, query: NotebookSearchQuery, limit = MAX_SEARCH_MATCHES): { matches: NotebookSearchMatch[]; invalid: boolean; capped: boolean } {
  const pattern = searchPattern(query)
  if (pattern === 'invalid') return { matches: [], invalid: true, capped: false }
  const matches: NotebookSearchMatch[] = []
  if (!pattern) return { matches, invalid: false, capped: false }
  for (const { key, cell } of orderedCells(doc)) {
    const text = cellSource(cell)?.toString() ?? ''
    if (text && !collect(pattern, text, key, limit, matches)) return { matches, invalid: false, capped: true }
  }
  return { matches, invalid: false, capped: false }
}

/** A replacement for one regular-expression match, with `$&`, `$1`…`$99`, `$<name>`, and `$$` filled in. */
function expandReplacement(pattern: RegExp, text: string, match: NotebookSearchMatch, replacement: string): string {
  if (!replacement.includes('$')) return replacement
  const sticky = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}y`)
  sticky.lastIndex = match.from
  const found = sticky.exec(text)
  if (!found) return replacement
  return replacement.replace(/\$(\$|&|<([^>]*)>|\d{1,2})/g, (whole, token: string, name: string | undefined) => {
    if (token === '$') return '$'
    if (token === '&') return found[0]
    if (name !== undefined) return found.groups?.[name] ?? ''
    const number = Number(token)
    if (number > 0 && number < found.length) return found[number] ?? ''
    // `$12` with fewer groups is `$1` then `2`, as String.prototype.replace reads it.
    const first = Number(token[0])
    if (token.length === 2 && first > 0 && first < found.length) return `${found[first] ?? ''}${token[1]}`
    return whole
  })
}

function sameQuery(a: NotebookSearchQuery, b: NotebookSearchQuery): boolean {
  return a.text === b.text && Boolean(a.matchCase) === Boolean(b.matchCase) && Boolean(a.wholeWord) === Boolean(b.wholeWord) && Boolean(a.regexp) === Boolean(b.regexp)
}

export class NotebookSearch {
  private state: NotebookSearchState = { query: EMPTY_QUERY, matches: NO_MATCHES, current: -1, invalid: false, capped: false, revealed: 0 }
  private readonly listeners = new Set<(state: NotebookSearchState) => void>()
  /** Each cell's matches, and where they start in the list. */
  private byKey = new Map<string, { start: number; matches: NotebookSearchMatch[] }>()
  /** Each cell's place in the notebook. */
  private order = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(private readonly controller: NotebookController) {
    cellsMap(controller.doc).observeDeep(this.onChange)
  }

  getState = (): NotebookSearchState => this.state

  subscribe = (listener: (state: NotebookSearchState) => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** One cell's matches, and the index among them of the current match (-1 when it is elsewhere). */
  matchesIn(key: string): { matches: readonly NotebookSearchMatch[]; current: number } {
    const entry = this.byKey.get(key)
    if (!entry) return { matches: NO_MATCHES, current: -1 }
    const current = this.state.current - entry.start
    return { matches: entry.matches, current: current >= 0 && current < entry.matches.length ? current : -1 }
  }

  /**
   * Searches for a query. The current match becomes the first at or after the cursor or, while
   * the query is being typed, at or after where the current match starts, so it stays put as long
   * as the longer query still matches there (as a browser's find does).
   */
  setQuery(query: NotebookSearchQuery): void {
    if (this.destroyed) return
    if (sameQuery(query, this.state.query)) {
      this.flush()
      return
    }
    const previous = this.state.matches[this.state.current]
    this.recount(query, previous ? { key: previous.key, offset: previous.from } : null)
    if (!query.text) return
    const next = previous ? this.state.current : this.nearest(1)
    if (next >= 0) this.moveTo(next)
  }

  /** Forgets the query and its marks (the find bar closed). */
  clear(): void {
    this.setQuery(EMPTY_QUERY)
  }

  /** Moves to the next (1) or previous (-1) match, wrapping around; selects its cell. */
  step(direction: 1 | -1): NotebookSearchMatch | null {
    this.flush()
    const { matches, current } = this.state
    if (!matches.length) return null
    const next = current < 0 ? this.nearest(direction) : (current + direction + matches.length) % matches.length
    this.moveTo(next)
    return this.state.matches[next] ?? null
  }

  /**
   * Replaces the current match and moves to the next; with no current match, moves to the next
   * one first, as editors do. One undo step. Returns whether text was replaced.
   */
  replace(replacement: string): boolean {
    if (this.controller.getState().readOnly) return false
    this.flush()
    const match = this.state.matches[this.state.current]
    const pattern = searchPattern(this.state.query)
    if (!match || !pattern || pattern === 'invalid') {
      this.step(1)
      return false
    }
    const text = this.controller.sourceOf(match.key)
    if (!text) return false
    const value = this.state.query.regexp ? expandReplacement(pattern, text.toString(), match, replacement) : replacement
    this.controller.undoManager.stopCapturing()
    this.controller.doc.transact(() => {
      text.delete(match.from, match.to - match.from)
      if (value) text.insert(match.from, value)
    }, this.controller.origin)
    this.controller.undoManager.stopCapturing()
    // The next match is the first after what was put in, so a replacement holding the query is not found again.
    this.recount(this.state.query, { key: match.key, offset: match.from + value.length })
    if (this.state.current >= 0) this.moveTo(this.state.current)
    return true
  }

  /** Replaces every match in the notebook as one undo step; returns how many. */
  replaceAll(replacement: string): number {
    if (this.controller.getState().readOnly) return 0
    this.flush()
    const pattern = searchPattern(this.state.query)
    if (!pattern || pattern === 'invalid') return 0
    const { matches } = findInNotebook(this.controller.doc, this.state.query, Number.POSITIVE_INFINITY)
    if (!matches.length) return 0
    const byCell = new Map<string, NotebookSearchMatch[]>()
    for (const match of matches) {
      const list = byCell.get(match.key)
      if (list) list.push(match)
      else byCell.set(match.key, [match])
    }
    this.controller.undoManager.stopCapturing()
    this.controller.doc.transact(() => {
      for (const [key, list] of byCell) {
        const text = this.controller.sourceOf(key)
        if (!text) continue
        const source = text.toString()
        // From the end, so earlier offsets stay where they were found.
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const match = list[index]!
          const value = this.state.query.regexp ? expandReplacement(pattern, source, match, replacement) : replacement
          text.delete(match.from, match.to - match.from)
          if (value) text.insert(match.from, value)
        }
      }
    }, this.controller.origin)
    this.controller.undoManager.stopCapturing()
    this.recount(this.state.query, null)
    return matches.length
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.timer) clearTimeout(this.timer)
    cellsMap(this.controller.doc).unobserveDeep(this.onChange)
    this.listeners.clear()
  }

  private onChange = () => {
    if (!this.state.query.text || this.destroyed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.destroyed) this.recount(this.state.query, 'keep')
    }, RECOUNT_MS)
  }

  /** Recounts now if a recount is waiting, so commands act on what the notebook holds. */
  private flush(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
    this.recount(this.state.query, 'keep')
  }

  /**
   * Finds the query's matches again. The current match becomes the first at or after `from`, or
   * (with 'keep') the one it was, or the next after it when edits removed it.
   */
  private recount(query: NotebookSearchQuery, from: { key: string; offset: number } | 'keep' | null): void {
    // A recount waiting for edits (this session's own among them) is this one.
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const previous = this.state.matches[this.state.current]
    const { matches, invalid, capped } = findInNotebook(this.controller.doc, query)
    this.order = new Map(orderedCells(this.controller.doc).map((entry, index) => [entry.key, index]))
    this.byKey = new Map()
    matches.forEach((match, index) => {
      const entry = this.byKey.get(match.key)
      if (entry) entry.matches.push(match)
      else this.byKey.set(match.key, { start: index, matches: [match] })
    })
    const anchor = from === 'keep' ? (previous ? { key: previous.key, offset: previous.from } : null) : from
    let current = -1
    if (anchor && matches.length) {
      current = this.firstAtOrAfter(matches, anchor.key, anchor.offset)
      if (current < 0) current = 0
    }
    this.emit({ ...this.state, query, matches, invalid, capped, current })
  }

  /** The first match at or after a place in the notebook, or -1. */
  private firstAtOrAfter(matches: readonly NotebookSearchMatch[], key: string, offset: number): number {
    const place = this.order.get(key) ?? -1
    return matches.findIndex((match) => {
      const at = this.order.get(match.key) ?? -1
      return at > place || (at === place && match.from >= offset)
    })
  }

  /** The match nearest the active cell's cursor in a direction, wrapping around. */
  private nearest(direction: 1 | -1): number {
    const { matches } = this.state
    if (!matches.length) return -1
    const { active } = this.controller.getState()
    if (!active) return direction === 1 ? 0 : matches.length - 1
    const offset = this.controller.cursorIn(active) ?? 0
    const after = this.firstAtOrAfter(matches, active, offset)
    if (direction === 1) return after < 0 ? 0 : after
    // The last match ending before the cursor.
    const place = this.order.get(active) ?? -1
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index]!
      const at = this.order.get(match.key) ?? -1
      if (at < place || (at === place && match.to <= offset)) return index
    }
    return matches.length - 1
  }

  private moveTo(index: number): void {
    const match = this.state.matches[index]
    if (!match) return
    this.emit({ ...this.state, current: index, revealed: this.state.revealed + 1 })
    this.controller.select(match.key)
  }

  private emit(state: NotebookSearchState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}
