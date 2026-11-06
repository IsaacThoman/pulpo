import { EDITOR_BUNDLE } from './editorBundle.generated'
import { NOTEBOOK_EDITOR_BUNDLE } from './notebookEditorBundle.generated'
import { PRESENTATION_EDITOR_BUNDLE } from './presentationEditorBundle.generated'
import { TEXT_EDITOR_BUNDLE } from './textEditorBundle.generated'

/**
 * The editor page this app ships for each live format (built by scripts/build-doc-editor.mjs).
 * A format without one opens read only, as a document from a newer server would.
 */
export const EDITOR_BUNDLES = {
  markdown: EDITOR_BUNDLE,
  text: TEXT_EDITOR_BUNDLE,
  notebook: NOTEBOOK_EDITOR_BUNDLE,
  presentation: PRESENTATION_EDITOR_BUNDLE,
} as const

export type MobileEditorFormat = keyof typeof EDITOR_BUNDLES
export type EditorBundle = (typeof EDITOR_BUNDLES)[MobileEditorFormat]

/** The bundle for a document's format (Markdown for documents from before formats), or null. */
export function editorBundleFor(format: string | null | undefined): EditorBundle | null {
  const key = (format ?? 'markdown') as MobileEditorFormat
  return Object.hasOwn(EDITOR_BUNDLES, key) ? EDITOR_BUNDLES[key] : null
}

/** What this app announces when joining a document: the schema of each editor it ships. */
export const MOBILE_SCHEMA_VERSIONS: Record<string, number> = Object.fromEntries(
  Object.entries(EDITOR_BUNDLES).map(([format, bundle]) => [format, bundle.schemaVersion]),
)
