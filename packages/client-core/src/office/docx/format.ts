import { MIME_TYPES } from './names.js'

/**
 * What the format catalog needs to know about Word documents, without loading the codec (the
 * catalog is part of the mobile app's Hermes bundle).
 */

/** Bump when the Y.Doc layout or the schema changes in a way older clients would misread. */
export const DOCX_SCHEMA_VERSION = 1

export const DOCX_EXTENSIONS = ['docx', 'dotx', 'docm', 'dotm'] as const

/** The Y.XmlFragment holding the body. */
export const DOCX_BODY_FRAGMENT = 'body'

/** Largest Word file that opens for editing (pictures beyond the per-asset cap fail anyway). */
export const DOCX_MAX_FILE_BYTES = 50 * 1024 * 1024

export function docxMimeType(extension: string): string {
  return MIME_TYPES[extension.toLowerCase() as keyof typeof MIME_TYPES] ?? MIME_TYPES.docx
}

/** Deepest table nesting a document may have (tables in cells in tables…). */
export const DOCX_MAX_TABLE_DEPTH = 30
