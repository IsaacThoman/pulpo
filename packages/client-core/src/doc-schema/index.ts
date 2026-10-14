import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { updateYFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import { DOC_FRAGMENT_NAME, docSchema, docToMarkdown, markdownToDoc } from './schema.js'
import { docView, type DocView } from './suggestions.js'

export * from './schema.js'
export * from './suggestions.js'

/** The document as a ProseMirror node, suggestions included. */
export function ydocToNode(doc: Y.Doc): ProseMirrorNode {
  return ProseMirrorNode.fromJSON(docSchema(), yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(DOC_FRAGMENT_NAME)))
}

/**
 * The document's Markdown. `base` (the default, for previews, downloads, and search) leaves out
 * pending suggestions; `proposed` reads as if they were all accepted, which is what agents see.
 */
export function ydocToMarkdown(doc: Y.Doc, view: DocView = 'base'): string {
  return docToMarkdown(docView(ydocToNode(doc), view))
}

/**
 * Rewrites the document to match `node` as a minimal diff. Callers must use this instead of
 * replacing state: replicas that still hold the old content would merge it back in. Throws,
 * writing nothing, when `node` does not fit the schema: editors would drop what they cannot
 * represent.
 */
export function applyNodeToYDoc(doc: Y.Doc, node: ProseMirrorNode, origin?: unknown): void {
  try {
    if (node.childCount) node.check()
  } catch (error) {
    throw new Error(`Refusing to write an invalid document: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  doc.transact(() => {
    updateYFragment(doc, doc.getXmlFragment(DOC_FRAGMENT_NAME), node, { mapping: new Map(), isOMark: new Map() })
  }, origin)
}

/** Rewrites the document to match `source` as a minimal diff (see `applyNodeToYDoc`). */
export function applyMarkdownToYDoc(doc: Y.Doc, source: string, origin?: unknown): void {
  applyNodeToYDoc(doc, markdownToDoc(source), origin)
}
