import { Lexer, type Token } from 'marked'
import type * as Y from 'yjs'
import { cellSourceText, cellType, orderedCells } from './layout.js'

/**
 * A notebook's table of contents: the headings of its Markdown cells, as JupyterLab's and
 * Colab's are built. Headings are found by Markdown's own rules (marked's lexer), so `#` in a
 * code fence is not one, setext (`Title` over `===`) and HTML (`<h2>`) headings are, and inline
 * markup is reduced to its text.
 */

export interface NotebookHeading {
  /** 1 for `#`, up to 6. */
  level: number
  text: string
}

export interface NotebookOutlineEntry extends NotebookHeading {
  /** The cell's key, and its place in the notebook. */
  key: string
  index: number
}

/** Markdown longer than this is scanned line by line instead of parsed (marked is slow on huge, hostile cells). */
const MAX_PARSED_CHARACTERS = 100_000

/** Decodes the character references headings are commonly written with. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name: string) => {
    const lower = name.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 0xfffd)
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)) || 0xfffd)
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower] ?? whole
  })
}

/** The plain text of inline tokens: emphasis, links and code reduced to their words, HTML tags dropped. */
function inlineText(tokens: readonly Token[] | undefined, fallback: string): string {
  if (!tokens) return fallback
  return tokens.map((token) => {
    switch (token.type) {
      case 'html': return token.text.replace(/<[^>]*>/g, '')
      case 'br': return ' '
      case 'image': return token.text
      case 'codespan':
      case 'escape': return token.text
      default: return 'tokens' in token && Array.isArray(token.tokens) ? inlineText(token.tokens as Token[], token.raw) : 'text' in token ? String(token.text) : token.raw
    }
  }).join('')
}

function clean(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

/** HTML headings in an HTML block (`<h2>Results</h2>`). */
function htmlHeadings(html: string, out: NotebookHeading[], maxLevel: number): void {
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const level = Number(match[1])
    const text = clean(match[2]!.replace(/<[^>]*>/g, ''))
    if (level <= maxLevel && text) out.push({ level, text })
  }
}

/** ATX headings outside code fences, line by line, for cells too long to parse. */
function scanHeadings(source: string, maxLevel: number): NotebookHeading[] {
  const out: NotebookHeading[] = []
  let fence: string | null = null
  for (const line of source.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (marker) {
      fence = marker
      continue
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)
    if (heading && heading[1]!.length <= maxLevel && heading[2]!.trim()) out.push({ level: heading[1]!.length, text: clean(heading[2]!) })
  }
  return out
}

/** The headings of one Markdown source, in order. */
export function markdownHeadings(source: string, maxLevel = 6): NotebookHeading[] {
  if (!source.includes('#') && !source.includes('=') && !source.includes('-') && !/<h[1-6]/i.test(source)) return []
  if (source.length > MAX_PARSED_CHARACTERS) return scanHeadings(source, maxLevel)
  const out: NotebookHeading[] = []
  let tokens: Token[]
  try {
    tokens = new Lexer({ gfm: true }).lex(source)
  } catch {
    return scanHeadings(source, maxLevel)
  }
  for (const token of tokens) {
    if (token.type === 'heading') {
      const text = clean(inlineText(token.tokens, token.text))
      if (token.depth <= maxLevel && text) out.push({ level: token.depth, text })
    } else if (token.type === 'html') {
      htmlHeadings(token.raw, out, maxLevel)
    }
  }
  return out
}

/** Headings already found, by cell, kept while its source is the same (outlines are rebuilt as people type). */
export type NotebookOutlineCache = Map<string, { source: string; headings: NotebookHeading[] }>

/** The notebook's outline: every Markdown cell's headings, in notebook order. */
export function notebookOutline(doc: Y.Doc, options: { maxLevel?: number; cache?: NotebookOutlineCache } = {}): NotebookOutlineEntry[] {
  const maxLevel = options.maxLevel ?? 6
  const entries: NotebookOutlineEntry[] = []
  const seen = new Set<string>()
  orderedCells(doc).forEach(({ key, cell }, index) => {
    if (cellType(cell) !== 'markdown') return
    const source = cellSourceText(cell)
    seen.add(key)
    let cached = options.cache?.get(key)
    if (!cached || cached.source !== source) {
      cached = { source, headings: markdownHeadings(source, 6) }
      options.cache?.set(key, cached)
    }
    for (const heading of cached.headings) if (heading.level <= maxLevel) entries.push({ ...heading, key, index })
  })
  if (options.cache) for (const key of options.cache.keys()) if (!seen.has(key)) options.cache.delete(key)
  return entries
}
