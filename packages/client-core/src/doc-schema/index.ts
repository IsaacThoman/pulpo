import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { MarkdownManager } from '@tiptap/markdown'
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { updateYFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'

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

function markdownManager(): MarkdownManager {
  markdown ??= new MarkdownManager({ extensions: createDocExtensions() })
  return markdown
}

export function markdownToDocJSON(source: string): JSONContent {
  return markdownManager().parse(source)
}

export function docJSONToMarkdown(json: JSONContent): string {
  return markdownManager().serialize(json)
}

export function ydocToMarkdown(doc: Y.Doc): string {
  return docJSONToMarkdown(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(DOC_FRAGMENT_NAME)))
}

/**
 * Rewrites the document to match `source` as a minimal diff. Callers must use this instead of
 * replacing state: replicas that still hold the old content would merge it back in.
 */
export function applyMarkdownToYDoc(doc: Y.Doc, source: string, origin?: unknown): void {
  const node = ProseMirrorNode.fromJSON(docSchema(), markdownToDocJSON(source))
  doc.transact(() => {
    updateYFragment(doc, doc.getXmlFragment(DOC_FRAGMENT_NAME), node, { mapping: new Map(), isOMark: new Map() })
  }, origin)
}
