import {
  Extension,
  flattenExtensions,
  getExtensionField,
  getSchema,
  type AnyConfig,
  type AnyExtension,
  type JSONContent,
  type MarkdownTokenizer,
} from '@tiptap/core'
import { Code } from '@tiptap/extension-code'
import { CodeBlock } from '@tiptap/extension-code-block'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { MarkdownManager } from '@tiptap/markdown'
import { Fragment, Mark, Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { createSuggestionExtensions, SUGGESTION_DELETE_MARK, SUGGESTION_INSERT_MARK } from './suggestions.js'

// Re-exporting these types keeps the extensions' command typings (toggleBold, insertTable, …)
// visible to editors that build on this schema through the emitted declarations.
export type { StarterKitOptions } from '@tiptap/starter-kit'
export type { TaskListOptions } from '@tiptap/extension-list'
export type { TableKitOptions } from '@tiptap/extension-table'
export type { CodeOptions } from '@tiptap/extension-code'
export type { CodeBlockOptions } from '@tiptap/extension-code-block'

export { DOC_FRAGMENT_NAME, DOC_SCHEMA_VERSION } from './version.js'

/** The schema-defining extensions shared by the web editor and the server. */
export function createDocExtensions(): AnyExtension[] {
  return [
    // History comes from Yjs, so ProseMirror's own undo stack stays off.
    StarterKit.configure({ undoRedo: false, code: false, codeBlock: false, link: { openOnClick: false, autolink: true } }),
    // Inline code still excludes every formatting mark (TipTap's default is all marks), but it
    // and code blocks must be able to carry suggestions.
    Code.extend({ excludes: 'bold code italic link strike underline' }),
    CodeBlock.extend({ marks: `${SUGGESTION_INSERT_MARK} ${SUGGESTION_DELETE_MARK}` }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    ...createSuggestionExtensions(),
  ]
}

let schema: Schema | undefined
let markdown: MarkdownManager | undefined

export function docSchema(): Schema {
  schema ??= getSchema(createDocExtensions())
  return schema
}

const ORDERED_LIST_ITEM = /^(\s*)[0-9A-Za-z]+([.)])\s/
const TASK_LIST_ITEM = /^\s*[-+*]\s+\[[ xX]\]\s/
/** Marks every other one of adjacent same-kind lists in JSON headed for the serializer. */
const ALTERNATE_LIST_MARKER = 'markdownAlternateMarker'

/** `src` up to (not including) its `count`th line break. */
function leadingLines(src: string, count: number): string {
  let end = -1
  for (let line = 0; line < count; line++) {
    end = src.indexOf('\n', end + 1)
    if (end < 0) return src
  }
  return src.slice(0, end)
}

function firstNonBlankLine(src: string): string {
  for (let start = 0; ;) {
    const end = src.indexOf('\n', start)
    const line = src.slice(start, end < 0 ? undefined : end)
    if (line.trim() || end < 0) return line
    start = end + 1
  }
}

/**
 * An ordered list ends where an item at its own indentation switches between `1.` and `1)`, as
 * in CommonMark, so adjacent lists (serialized that way) stay apart. TipTap's tokenizer would
 * read on, so it only gets the source up to that item.
 */
function upToDelimiterChange(src: string): string {
  const first = ORDERED_LIST_ITEM.exec(leadingLines(src, 1))
  if (!first) return src
  for (let start = src.indexOf('\n') + 1; start > 0;) {
    const end = src.indexOf('\n', start)
    const line = src.slice(start, end < 0 ? undefined : end)
    const item = ORDERED_LIST_ITEM.exec(line)
    if (item && item[1] === first[1] && item[2] !== first[2]) return src.slice(0, start - 1)
    // Unindented text other than an item ends the list (or continues an item lazily).
    if (!item && line.trim() && !/^\s/.test(line)) return src
    start = end + 1
  }
  return src
}

/**
 * Markdown-only adjustments to the extensions:
 * - TipTap's ordered list, task list, and table tokenizers split the entire rest of the
 *   document into lines at every block, which makes parsing quadratic (seconds for a few
 *   thousand paragraphs). They are skipped, or handed only the lines they read, wherever the
 *   leading lines rule out a match.
 * - Items of a list marked with `ALTERNATE_LIST_MARKER` use `*` or `1)`, so adjacent lists of
 *   one kind do not merge into one when read back.
 */
function forMarkdown(flattened: AnyExtension): AnyExtension {
  // Kits must not add their (unguarded) extensions a second time.
  const extension = getExtensionField(flattened, 'addExtensions') ? flattened.extend({ addExtensions: () => [] }) : flattened
  if (extension.name === 'listItem') {
    const render = getExtensionField<NonNullable<MarkdownRender>>(extension, 'renderMarkdown')
    return extension.extend({
      renderMarkdown: ((node, helpers, context) => {
        const rendered = render(node, helpers, context)
        if (!context.meta?.parentAttrs?.[ALTERNATE_LIST_MARKER]) return rendered
        return context.parentType === 'orderedList' ? rendered.replace(/^([0-9A-Za-z]+)\. /, '$1) ') : rendered.replace(/^- /, '* ')
      }) satisfies MarkdownRender,
    })
  }
  const tokenizer = getExtensionField<MarkdownTokenizer | undefined>(extension, 'markdownTokenizer')
  if (!tokenizer) return extension
  const { start, tokenize } = tokenizer
  switch (extension.name) {
    case 'orderedList':
      return extension.extend({
        markdownTokenizer: {
          ...tokenizer,
          tokenize: (src, tokens, lexer) => ORDERED_LIST_ITEM.test(leadingLines(src, 1)) ? tokenize(upToDelimiterChange(src), tokens, lexer) : undefined,
        } satisfies MarkdownTokenizer,
      })
    case 'taskList':
      return extension.extend({
        markdownTokenizer: {
          ...tokenizer,
          tokenize: (src, tokens, lexer) => TASK_LIST_ITEM.test(firstNonBlankLine(src)) ? tokenize(src, tokens, lexer) : undefined,
        } satisfies MarkdownTokenizer,
      })
    case 'table':
      // `start` only reads the header and delimiter rows.
      if (typeof start !== 'function') return extension
      return extension.extend({ markdownTokenizer: { ...tokenizer, start: (src: string) => start(leadingLines(src, 2)) } satisfies MarkdownTokenizer })
    default:
      return extension
  }
}

type MarkdownRender = AnyConfig['renderMarkdown']

/**
 * A line break Markdown has no syntax for: at either end of a paragraph, after whitespace or
 * another break, in a heading, in a table cell. These are written and read back as `<br>`.
 */
const HtmlBreak = Extension.create({
  name: 'htmlBreak',
  markdownTokenName: 'htmlBreak',
  markdownTokenizer: {
    name: 'htmlBreak',
    level: 'inline',
    start: (src) => src.search(/<br\s*\/?>/i),
    tokenize: (src) => {
      const match = /^<br\s*\/?>/i.exec(src)
      return match ? { type: 'htmlBreak', raw: match[0] } : undefined
    },
  },
  parseMarkdown: () => ({ type: 'hardBreak' }),
  renderMarkdown: () => '<br>',
})

/** A paragraph of nothing but line breaks, which Markdown would otherwise read as an HTML block. */
const HtmlBreakParagraph = Extension.create({
  name: 'htmlBreakParagraph',
  markdownTokenName: 'htmlBreakParagraph',
  markdownTokenizer: {
    name: 'htmlBreakParagraph',
    level: 'block',
    // Like an HTML block, this never interrupts a paragraph.
    start: () => -1,
    tokenize: (src) => {
      const match = /^(?:<br\s*\/?>)+[ \t]*(?:\n|$)/i.exec(src)
      return match ? { type: 'htmlBreakParagraph', raw: match[0], breaks: match[0].match(/<br/gi)!.length } : undefined
    },
  },
  parseMarkdown: (token) => ({ type: 'paragraph', content: Array.from({ length: token.breaks as number }, () => ({ type: 'hardBreak' })) }),
})

function markdownManager(): MarkdownManager {
  markdown ??= new MarkdownManager({ extensions: [...flattenExtensions(createDocExtensions()).map(forMarkdown), HtmlBreak, HtmlBreakParagraph, MarkdownRaw] })
  return markdown
}

/**
 * Gives invalid nodes what they lack (an empty list item or quote gets an empty paragraph, …).
 * TipTap's parser produces some from unusual Markdown, and documents may already hold them.
 */
function repaired(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isLeaf) return node
  if (node.isTextblock) {
    // Nested Markdown emphasis (`****a****`) can stack a mark twice.
    let fixed = false
    const inline: ProseMirrorNode[] = []
    node.forEach((child) => {
      const marks = child.marks.reduce<readonly Mark[]>((set, mark) => node.type.allowsMarkType(mark.type) ? mark.addToSet(set) : set, Mark.none)
      fixed ||= !Mark.sameSet(marks, child.marks)
      inline.push(child.mark(marks))
    })
    return fixed ? node.copy(Fragment.fromArray(inline)) : node
  }
  let children: ProseMirrorNode[] | undefined
  node.forEach((child, _, index) => {
    const fixed = repaired(child)
    if (fixed === child && !children) return
    children ??= Array.from({ length: index }, (_, kept) => node.child(kept))
    children.push(fixed)
  })
  const content = children ? Fragment.from(children) : node.content
  if (node.type.validContent(content)) return children ? node.copy(content) : node
  return node.type.createAndFill(node.attrs, content, node.marks) ?? node.copy(content)
}

/**
 * The document `source` describes, valid for the schema (except that blank Markdown gives an
 * empty document, like a new Y.Doc).
 */
export function markdownToDoc(source: string, schema: Schema = docSchema()): ProseMirrorNode {
  const parsed = ProseMirrorNode.fromJSON(schema, markdownManager().parse(source))
  const doc = parsed.childCount ? repaired(parsed) : parsed
  try {
    if (doc.childCount) doc.check()
  } catch (error) {
    throw new Error(`The Markdown does not fit a document's structure: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  return doc
}

export function markdownToDocJSON(source: string): JSONContent {
  return markdownToDoc(source).toJSON()
}

/** Text written exactly as is, for escapes the serializer would otherwise double. */
const MarkdownRaw = Extension.create({
  name: 'markdownRaw',
  renderMarkdown: (node) => String(node.attrs?.text ?? ''),
})

/**
 * Starts of a paragraph line the parser would read as a block: a list item, a heading, a
 * thematic break, or a setext underline (`*` and `>` are already escaped). The backslash goes
 * before the captured character.
 */
const BLOCK_START = /^[ \t]*(?:[-+](?=[ \t]|$)|\d{1,9}(?=[.)](?:[ \t]|$))|#{1,6}(?=[ \t]|$)|-{3,}[ \t]*$|=+[ \t]*$|- *- *-[ \t-]*$)/

/** Whether `<br>` must stand in for the hard break at `index` of a textblock's content. */
function needsHtmlBreak(parent: JSONContent, content: JSONContent[], index: number): boolean {
  if (parent.type !== 'paragraph') return true
  const before = content[index - 1]
  const after = content[index + 1]
  return before?.type !== 'text' || /\s$/.test(before.text ?? '') || !after || (after.type === 'text' && /^\n/.test(after.text ?? ''))
}

/**
 * A textblock's inline content as the serializer must see it: line breaks Markdown cannot
 * express become `<br>`, and paragraph lines that would start a block get escaped.
 */
function inlineForSerializer(parent: JSONContent, content: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = []
  let lineStart = true
  content.forEach((child, index) => {
    if (child.type === 'hardBreak') {
      const html = needsHtmlBreak(parent, content, index)
      result.push(html ? { ...child, type: 'htmlBreak' } : child)
      lineStart = !html
      return
    }
    if (child.type !== 'text' || parent.type !== 'paragraph') {
      result.push(child)
      lineStart = false
      return
    }
    const lines = (child.text ?? '').split('\n')
    lines.forEach((line, lineIndex) => {
      const text = lineIndex < lines.length - 1 ? `${line}\n` : line
      const marker = (lineStart || lineIndex > 0) && BLOCK_START.exec(line)
      if (!marker) {
        if (text) result.push({ ...child, text })
        return
      }
      // Escape the first character after the indentation, or an ordered item's delimiter.
      const at = /^\d/.test(marker[0].trimStart()) ? marker[0].length : marker[0].length - marker[0].trimStart().length
      result.push({ type: 'markdownRaw', attrs: { text: `${line.slice(0, at)}\\${line[at]}` }, marks: child.marks })
      const rest = text.slice(at + 1)
      if (rest) result.push({ ...child, text: rest })
    })
    lineStart = (child.text ?? '').endsWith('\n')
  })
  return result
}

/** JSON the serializer reads back as the same document (see `ALTERNATE_LIST_MARKER`, `HtmlBreak`). */
function forSerializer(json: JSONContent): JSONContent {
  const content = json.content
  if (!content) return json
  if (content.some((child) => child.type === 'text' || child.type === 'hardBreak')) return { ...json, content: inlineForSerializer(json, content) }
  let changed = false
  let previousList: string | undefined
  let alternate = false
  const next = content.map((child) => {
    let prepared = forSerializer(child)
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      alternate = previousList === child.type && !alternate
      previousList = child.type
      if (alternate) prepared = { ...prepared, attrs: { ...prepared.attrs, [ALTERNATE_LIST_MARKER]: true } }
    } else {
      previousList = undefined
    }
    if (prepared !== child) changed = true
    return prepared
  })
  return changed ? { ...json, content: next } : json
}

/** Serializes a node without suggestions; resolve them first (see `docView`). */
export function docToMarkdown(node: ProseMirrorNode): string {
  return markdownManager().serialize(forSerializer((node.childCount ? repaired(node) : node).toJSON()))
}

/** Serializes a document without suggestions; resolve them first (see `docView`). */
export function docJSONToMarkdown(json: JSONContent): string {
  return docToMarkdown(ProseMirrorNode.fromJSON(docSchema(), json))
}
