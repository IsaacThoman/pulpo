import type * as Y from 'yjs'

/**
 * What the format catalog needs to know about spreadsheets without loading the codec (which
 * pulls in the XML parser and the formula engine): extensions, MIME types, the schema version,
 * and whether a document holds anything yet.
 */

/** Bumped when the Y.Doc layout changes incompatibly (see model/schema.ts). */
export const SHEETS_SCHEMA_VERSION = 1

/** The first is used for new files. */
export const SHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xltx', 'xltm', 'csv', 'tsv'] as const

/** Largest file that opens for editing (xlsx is compressed; the cell limit applies too). */
export const SHEET_MAX_FILE_BYTES = 100 * 1024 * 1024

const MIME_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
}

export function sheetMimeType(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] ?? MIME_TYPES.xlsx!
}

/** The workbook's root map in the Y.Doc. */
export const WORKBOOK_MAP = 'workbook'

export function sheetHasContent(doc: Y.Doc): boolean {
  return doc.getMap(WORKBOOK_MAP).has('meta')
}
