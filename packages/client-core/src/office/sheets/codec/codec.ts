import * as Y from 'yjs'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../../live-format.js'
import { SHEETS_SCHEMA_VERSION, type SheetFormat } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { applyWorkbook } from './apply.js'
import { readCsv, writeCsv } from './csv.js'
import { readXlsx, type XlsxReadOptions } from './read-xlsx.js'
import { sheetsToText } from './text.js'
import { writeXlsx, type XlsxWriteOptions } from './write-xlsx.js'

const MIME_TYPES: Record<SheetFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
}

export function sheetFormatOf(name: string): SheetFormat {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (extension in MIME_TYPES) return extension as SheetFormat
  throw new LiveFormatError('unsupported', `.${extension} files don't open as spreadsheets`)
}

export interface SheetCodecOptions {
  read?: XlsxReadOptions
  /**
   * Fills in current values for formula cells before writing (the calculation engine). Without it
   * files are written with the values cached when they were read and ask Excel to recalculate.
   */
  calculate?: (doc: Y.Doc) => Pick<XlsxWriteOptions, 'values' | 'spills'> | undefined
}

/** Spreadsheets: xlsx/xlsm/xltx/xltm and csv/tsv, all as one workbook layout. */
export class SheetCodec implements LiveFormatCodec {
  readonly id = 'sheet' as const
  readonly schemaVersion = SHEETS_SCHEMA_VERSION
  readonly extensions = ['xlsx', 'xlsm', 'xltx', 'xltm', 'csv', 'tsv'] as const

  constructor(private readonly options: SheetCodecOptions = {}) {}

  mimeType(extension: string): string {
    return MIME_TYPES[extension.toLowerCase() as SheetFormat] ?? MIME_TYPES.xlsx
  }

  async createEmpty(doc: Y.Doc, context: LiveFormatContext): Promise<void> {
    const format = sheetFormatOf(context.name)
    const model = WorkbookModel.initialize(doc, { format })
    const sheet = model.addSheet('Sheet1')
    model.setMeta('activeSheet', sheet.id)
  }

  async importFile(doc: Y.Doc, bytes: Uint8Array, context: LiveFormatContext): Promise<void> {
    const format = sheetFormatOf(context.name)
    if (format === 'csv' || format === 'tsv') readCsv(doc, bytes, format)
    else await readXlsx(doc, bytes, context.assets, this.options.read)
  }

  async exportFile(doc: Y.Doc, context: LiveFormatContext): Promise<Uint8Array> {
    const format = sheetFormatOf(context.name)
    const calculated = this.options.calculate?.(doc)
    if (format === 'csv' || format === 'tsv') return writeCsv(doc, format, calculated?.values)
    return writeXlsx(doc, context.assets, { format, ...calculated, ...(calculated ? {} : { recalculateOnLoad: true }) })
  }

  async applyFile(doc: Y.Doc, bytes: Uint8Array, context: LiveFormatContext, origin?: unknown): Promise<{ changed: boolean }> {
    const incoming = new Y.Doc()
    await this.importFile(incoming, bytes, context)
    return applyWorkbook(doc, incoming, origin)
  }

  toText(doc: Y.Doc): string {
    return sheetsToText(doc)
  }
}
