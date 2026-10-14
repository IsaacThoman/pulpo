import { flattenExtensions, getExtensionField, getSchema, type AnyExtension, type JSONContent, type MarkdownTokenizer } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { MarkdownManager } from '@tiptap/markdown'
import type { Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'

// Re-exporting these types keeps the extensions' command typings (toggleBold, insertTable, …)
// visible to editors that build on this schema through the emitted declarations.
export type { StarterKitOptions } from '@tiptap/starter-kit'
export type { TaskListOptions } from '@tiptap/extension-list'
export type { TableKitOptions } from '@tiptap/extension-table'

/**
 * Bump whenever the editor's node or mark set changes. Servers refuse collaborative joins from
 * other versions, because y-prosemirror silently drops content an older schema cannot represent.
 */
export const DOC_SCHEMA_VERSION = 1
/** The Y.XmlFragment that holds a document; matches TipTap Collaboration's default field. */
export const DOC_FRAGMENT_NAME = 'default'

/** The schema-defining extensions shared by the web editor and the server. */
export function createDocExtensions(): AnyExtension[] {
  return [
    // History comes from Yjs, so ProseMirror's own undo stack stays off.
    StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
  ]
}

let schema: Schema | undefined
let markdown: MarkdownManager | undefined

export function docSchema(): Schema {
  schema ??= getSchema(createDocExtensions())
  return schema
}

const ORDERED_LIST_ITEM = /^\s*[0-9A-Za-z]+[.)]\s/
const TASK_LIST_ITEM = /^\s*[-+*]\s+\[[ xX]\]\s/

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
 * TipTap's ordered list, task list, and table tokenizers split the entire rest of the document
 * into lines at every block, which makes parsing quadratic (seconds for a few thousand
 * paragraphs). These skip them, or hand them only the lines they read, wherever the leading
 * lines rule out a match.
 */
function withLinearTokenizer(flattened: AnyExtension): AnyExtension {
  // Kits must not add their (unguarded) extensions a second time.
  const extension = getExtensionField(flattened, 'addExtensions') ? flattened.extend({ addExtensions: () => [] }) : flattened
  const tokenizer = getExtensionField<MarkdownTokenizer | undefined>(extension, 'markdownTokenizer')
  if (!tokenizer) return extension
  const { start, tokenize } = tokenizer
  const guard = (applies: (src: string) => boolean): MarkdownTokenizer => ({
    ...tokenizer,
    tokenize: (src, tokens, lexer) => applies(src) ? tokenize(src, tokens, lexer) : undefined,
  })
  switch (extension.name) {
    case 'orderedList':
      return extension.extend({ markdownTokenizer: guard((src) => ORDERED_LIST_ITEM.test(leadingLines(src, 1))) })
    case 'taskList':
      return extension.extend({ markdownTokenizer: guard((src) => TASK_LIST_ITEM.test(firstNonBlankLine(src))) })
    case 'table':
      // `start` only reads the header and delimiter rows.
      if (typeof start !== 'function') return extension
      return extension.extend({ markdownTokenizer: { ...tokenizer, start: (src: string) => start(leadingLines(src, 2)) } satisfies MarkdownTokenizer })
    default:
      return extension
  }
}

function markdownManager(): MarkdownManager {
  markdown ??= new MarkdownManager({ extensions: flattenExtensions(createDocExtensions()).map(withLinearTokenizer) })
  return markdown
}

export function markdownToDocJSON(source: string): JSONContent {
  return markdownManager().parse(source)
}

export function docJSONToMarkdown(json: JSONContent): string {
  return markdownManager().serialize(json)
}
