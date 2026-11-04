import type { Element, ElementContent, Root, RootContent, Text } from 'hast'
import { common, createLowlight } from 'lowlight'

/**
 * Syntax highlighting shared by the web app, the mobile viewers, and generated documents. Tokens
 * are highlight.js `hljs-*` classes in a hast tree; each client colors them with the GitHub Light
 * and Dark palettes below (the web reads them from CSS variables of the same values).
 */

const lowlight = createLowlight(common)

/** Larger inputs render as plain text so huge previews stay responsive. */
export const MAX_HIGHLIGHT_CHARACTERS = 100_000
/** Guessing runs every candidate grammar, so it gets a tighter budget. */
export const MAX_AUTO_HIGHLIGHT_CHARACTERS = 20_000
const MIN_AUTO_RELEVANCE = 5

const AUTO_DETECT_SUBSET = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'go', 'java', 'javascript', 'json', 'kotlin', 'php',
  'python', 'ruby', 'rust', 'sql', 'swift', 'typescript', 'xml', 'yaml',
]

// Fence tags models commonly emit that highlight.js doesn't know as aliases.
const LANGUAGE_ALIASES: Record<string, string> = {
  react: 'javascript',
  vue: 'xml',
  'objective-c': 'objectivec',
  jsonc: 'json',
  json5: 'json',
  console: 'bash',
  shellscript: 'bash',
  golang: 'go',
  'c#': 'csharp',
  toml: 'ini',
  kts: 'kotlin',
  ipython: 'python',
  ipython3: 'python',
  python3: 'python',
}

const PLAIN_LANGUAGES = new Set(['text', 'txt', 'plain', 'plaintext', 'log'])

/** Maps a fence tag or kernel language to a registered grammar name or alias, or null for plain text. */
export function normalizeLanguage(tag: string | null | undefined): string | null {
  const normalized = tag?.trim().toLowerCase()
  if (!normalized || PLAIN_LANGUAGES.has(normalized)) return null
  const language = LANGUAGE_ALIASES[normalized] ?? normalized
  return lowlight.registered(language) ? language : null
}

/** A highlighted tree; `data` says which grammar was used (and how sure a guess was). */
export type HighlightRoot = Root & { data?: Root['data'] & { language?: string; relevance?: number } }

/**
 * Tokenizes code into a hast tree of `hljs-*` spans. `language` is a fence tag or grammar name;
 * `undefined` guesses the language, `null` means plain text. Returns null when there is nothing
 * worth colouring so callers can render the raw string.
 */
export function highlightTree(code: string, language?: string | null, maxCharacters = MAX_HIGHLIGHT_CHARACTERS): HighlightRoot | null {
  if (!code || code.length > maxCharacters || language === null) return null
  try {
    const grammar = normalizeLanguage(language)
    if (grammar) return lowlight.highlight(grammar, code)
    if (language?.trim() || code.length > MAX_AUTO_HIGHLIGHT_CHARACTERS) return null
    const tree = lowlight.highlightAuto(code, { subset: AUTO_DETECT_SUBSET })
    return (tree.data?.relevance ?? 0) >= MIN_AUTO_RELEVANCE ? tree : null
  } catch {
    return null
  }
}

/** One source line as highlighted nodes: text and `hljs-*` spans, none of them crossing a line break. */
export type HighlightedLine = ElementContent[]

function textNode(value: string): Text {
  return { type: 'text', value }
}

/**
 * Splits highlighted code into lines, re-opening the spans a line break interrupts (a multi-line
 * comment or string), so each line renders on its own and long files can be virtualized.
 */
export function splitHighlightedLines(code: string, tree: Root | null): HighlightedLine[] {
  if (!tree) return code.split(/\r\n|\n|\r/).map((line) => (line ? [textNode(line)] : []))
  const lines: HighlightedLine[] = [[]]
  // The spans open at the current position, outermost first, and this line's copies of them.
  const stack: Element[] = []
  let copies: Element[] = []
  const target = (): ElementContent[] => {
    for (let depth = copies.length; depth < stack.length; depth += 1) {
      const source = stack[depth]!
      const copy: Element = { type: 'element', tagName: source.tagName, properties: source.properties, children: [] }
      ;(depth === 0 ? lines[lines.length - 1]! : copies[depth - 1]!.children).push(copy)
      copies.push(copy)
    }
    return copies.length ? copies[copies.length - 1]!.children : lines[lines.length - 1]!
  }
  const visit = (nodes: readonly (RootContent | ElementContent)[]) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        node.value.split(/\r\n|\n|\r/).forEach((part, index) => {
          if (index > 0) {
            lines.push([])
            copies = []
          }
          if (part) target().push(textNode(part))
        })
      } else if (node.type === 'element') {
        stack.push(node)
        visit(node.children)
        stack.pop()
        if (copies.length > stack.length) copies = copies.slice(0, stack.length)
      }
    }
  }
  visit(tree.children)
  return lines
}

/** Plain-text length of a line's nodes. */
function nodesText(nodes: readonly ElementContent[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.value : node.type === 'element' ? nodesText(node.children) : '')).join('')
}

export function lineText(line: HighlightedLine): string {
  return nodesText(line)
}

/**
 * Wraps character ranges of a line (find matches) in `<mark>` elements, splitting token spans
 * where a range starts or ends inside them. `current` marks one range as the selected match.
 */
export function markLineRanges(line: HighlightedLine, ranges: readonly { start: number; end: number; current?: boolean }[]): HighlightedLine {
  if (!ranges.length) return line
  let offset = 0
  const mark = (nodes: readonly ElementContent[]): ElementContent[] => {
    const result: ElementContent[] = []
    for (const node of nodes) {
      if (node.type === 'element') {
        result.push({ ...node, children: mark(node.children) })
        continue
      }
      if (node.type !== 'text') {
        result.push(node)
        continue
      }
      const start = offset
      const end = offset + node.value.length
      offset = end
      let cursor = start
      for (const range of ranges) {
        if (range.end <= cursor || range.start >= end) continue
        const from = Math.max(range.start, cursor)
        const to = Math.min(range.end, end)
        if (from > cursor) result.push(textNode(node.value.slice(cursor - start, from - start)))
        result.push({
          type: 'element',
          tagName: 'mark',
          properties: { className: range.current ? ['find-match', 'find-match-current'] : ['find-match'] },
          children: [textNode(node.value.slice(from - start, to - start))],
        })
        cursor = to
      }
      if (cursor < end) result.push(textNode(node.value.slice(cursor - start)))
    }
    return result
  }
  return mark(line)
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!)
}

/** Serializes highlighted nodes as HTML: only text and spans with classes, all escaped. */
export function highlightedHtml(nodes: readonly (RootContent | ElementContent)[]): string {
  let html = ''
  for (const node of nodes) {
    if (node.type === 'text') html += escapeHtml(node.value)
    else if (node.type === 'element') {
      const className = node.properties?.className
      const classes = Array.isArray(className) ? className.filter((value) => typeof value === 'string' && /^[\w-]+$/.test(value)).join(' ') : ''
      const tag = node.tagName === 'mark' ? 'mark' : 'span'
      html += `<${tag}${classes ? ` class="${classes}"` : ''}>${highlightedHtml(node.children)}</${tag}>`
    }
  }
  return html
}

/** Code as escaped HTML with `hljs-*` spans, or just escaped when it cannot be highlighted. */
export function highlightHtml(code: string, language?: string | null): string {
  const tree = highlightTree(code, language)
  return tree ? highlightedHtml(tree.children) : escapeHtml(code)
}

export type HighlightToken =
  | 'keyword' | 'title' | 'constant' | 'string' | 'builtin' | 'comment' | 'tag' | 'section' | 'bullet' | 'addition' | 'deletion'

/** The `hljs-*` classes behind each token color, as the web's `.code-highlight` styles group them. */
export const HIGHLIGHT_TOKEN_CLASSES: Record<HighlightToken, readonly string[]> = {
  keyword: ['hljs-doctag', 'hljs-keyword', 'hljs-template-tag', 'hljs-template-variable', 'hljs-type', 'hljs-variable language_'],
  title: ['hljs-title', 'hljs-title class_', 'hljs-title function_'],
  constant: ['hljs-attr', 'hljs-attribute', 'hljs-literal', 'hljs-meta', 'hljs-number', 'hljs-operator', 'hljs-property', 'hljs-selector-attr', 'hljs-selector-class', 'hljs-selector-id', 'hljs-variable'],
  string: ['hljs-regexp', 'hljs-string'],
  builtin: ['hljs-built_in', 'hljs-symbol'],
  comment: ['hljs-code', 'hljs-comment', 'hljs-formula'],
  tag: ['hljs-name', 'hljs-quote', 'hljs-selector-pseudo', 'hljs-selector-tag'],
  section: ['hljs-section'],
  bullet: ['hljs-bullet'],
  addition: ['hljs-addition'],
  deletion: ['hljs-deletion'],
}

/** GitHub Light and Dark token colors, matching the web's `--code-*` variables. */
export const HIGHLIGHT_COLORS: Record<'light' | 'dark', Record<HighlightToken, string>> = {
  light: {
    keyword: '#cf222e', title: '#8250df', constant: '#0550ae', string: '#0a3069', builtin: '#953800',
    comment: '#6e7781', tag: '#116329', section: '#0550ae', bullet: '#953800', addition: '#116329', deletion: '#82071e',
  },
  dark: {
    keyword: '#ff7b72', title: '#d2a8ff', constant: '#79c0ff', string: '#a5d6ff', builtin: '#ffa657',
    comment: '#8b949e', tag: '#7ee787', section: '#1f6feb', bullet: '#f2cc60', addition: '#aff5b4', deletion: '#ffdcd7',
  },
}

const CLASS_TOKENS = new Map<string, HighlightToken>()
for (const [token, classes] of Object.entries(HIGHLIGHT_TOKEN_CLASSES) as [HighlightToken, readonly string[]][]) {
  for (const value of classes) if (!value.includes(' ')) CLASS_TOKENS.set(value, token)
}

/** The token color an element's classes call for, for clients that color without CSS. */
export function highlightTokenOf(classNames: readonly unknown[]): HighlightToken | null {
  // `hljs-title function_` and the like color as their first class.
  for (const value of classNames) {
    if (typeof value !== 'string') continue
    const token = CLASS_TOKENS.get(value)
    if (token) return token
  }
  return null
}

/** CSS for highlighted HTML outside the app (generated documents), scoped under `selector`. */
export function highlightCss(selector: string, scheme: 'light' | 'dark'): string {
  const colors = HIGHLIGHT_COLORS[scheme]
  return (Object.entries(HIGHLIGHT_TOKEN_CLASSES) as [HighlightToken, readonly string[]][]).map(([token, classes]) => {
    const selectors = classes.map((value) => `${selector} .${value.split(' ').join('.')}`).join(',')
    const extra = token === 'comment' ? 'font-style:italic;' : token === 'section' ? 'font-weight:600;' : ''
    return `${selectors}{color:${colors[token]};${extra}}`
  }).join('\n')
}

/** A run of text in one token color, for clients that draw text without HTML (React Native). */
export interface HighlightRun {
  text: string
  token: HighlightToken | null
  /** Inside a find match; `current` is the selected one. */
  match?: 'match' | 'current'
}

/**
 * Flattens a highlighted line into runs, each colored by its innermost token that has a color,
 * with find ranges applied (see `markLineRanges`).
 */
export function highlightRuns(line: HighlightedLine, ranges: readonly { start: number; end: number; current?: boolean }[] = []): HighlightRun[] {
  const runs: HighlightRun[] = []
  const visit = (nodes: readonly ElementContent[], token: HighlightToken | null, match: HighlightRun['match']) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const last = runs[runs.length - 1]
        if (last && last.token === token && last.match === match) last.text += node.value
        else runs.push(match ? { text: node.value, token, match } : { text: node.value, token })
      } else if (node.type === 'element') {
        const classes = Array.isArray(node.properties?.className) ? node.properties.className : []
        if (node.tagName === 'mark') visit(node.children, token, classes.includes('find-match-current') ? 'current' : 'match')
        else visit(node.children, highlightTokenOf(classes) ?? token, match)
      }
    }
  }
  visit(ranges.length ? markLineRanges(line, ranges) : line, null, undefined)
  return runs
}

export interface LineMatch {
  line: number
  start: number
  end: number
}

/** Case-insensitive matches of `query` in each line, up to `limit`, for find in code views. */
export function findInLines(lines: readonly string[], query: string, limit = 10_000): LineMatch[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  const matches: LineMatch[] = []
  for (let line = 0; line < lines.length && matches.length < limit; line += 1) {
    const lowered = lines[line]!.toLowerCase()
    // Lower-casing can change length (İ); such lines are searched as written.
    const text = lowered.length === lines[line]!.length ? lowered : lines[line]!
    let from = 0
    while (matches.length < limit) {
      const found = text.indexOf(needle, from)
      if (found < 0) break
      matches.push({ line, start: found, end: found + needle.length })
      from = found + needle.length
    }
  }
  return matches
}
