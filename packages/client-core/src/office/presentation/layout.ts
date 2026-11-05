import type * as Y from 'yjs'

/**
 * The presentation format's facts the format catalog and clients need without loading the codec
 * (which brings in the XML and ProseMirror machinery): its root map, schema version, extensions,
 * MIME types, and size limit. The Y.Doc layout itself is described in `ydoc.ts`.
 */

export const PRESENTATION_ROOT = 'presentation'
export const PRESENTATION_SCHEMA_VERSION = 1

/** `.pptx` first: new presentations are written as it. */
export const PRESENTATION_EXTENSIONS = ['pptx', 'potx', 'ppsx', 'pptm', 'potm', 'ppsm'] as const

export type PresentationFormat = (typeof PRESENTATION_EXTENSIONS)[number]

/**
 * Largest deck that becomes a live document. Media inside it is stored as assets (each within the
 * per-file asset cap), so most of a big deck's size never reaches the Y.Doc.
 */
export const PRESENTATION_MAX_FILE_BYTES = 100 * 1024 * 1024

const MIME_TYPES: Record<PresentationFormat, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
}

/** The format a file name asks for; unknown extensions write a plain .pptx. */
export function presentationFormat(name: string): PresentationFormat {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return (PRESENTATION_EXTENSIONS as readonly string[]).includes(extension) ? (extension as PresentationFormat) : 'pptx'
}

export function presentationMimeType(extension: string): string {
  return MIME_TYPES[presentationFormat(`.${extension}`)]
}

/** Whether a document holds a deck yet (a cached copy can show before the first sync). */
export function presentationHasContent(doc: Y.Doc): boolean {
  return doc.getMap(PRESENTATION_ROOT).has('slides')
}
