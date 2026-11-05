import * as Y from 'yjs'
import { LiveFormatError, type LiveFormatCodec, type LiveFormatContext } from '../../live-format.js'
import { SHEET_EXTENSIONS, sheetMimeType } from '../layout.js'
import { SHEETS_SCHEMA_VERSION, type SheetFormat } from '../model/schema.js'
import { IMPORT_ORIGIN, markCalcDirty, trackEdits } from '../model/edits.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetCalc } from '../calc.js'
import { applyWorkbook } from './apply.js'
import { readCsv, writeCsv } from './csv.js'
import { readXlsx, type XlsxReadOptions } from './read-xlsx.js'
import { sheetsToText } from './text.js'
import { writeXlsx, type XlsxWriteOptions } from './write-xlsx.js'

export function sheetFormatOf(name: string): SheetFormat {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if ((SHEET_EXTENSIONS as readonly string[]).includes(extension)) return extension as SheetFormat
  throw new LiveFormatError('unsupported', `.${extension} files don't open as spreadsheets`)
}

export interface SheetCodecOptions {
  read?: XlsxReadOptions
  /**
   * Fills in current values for formula cells before writing. By default the formula engine
   * calculates them; `false` writes the values cached when the file was read and asks Excel to
   * recalculate on open.
   */
  calculate?: false | ((doc: Y.Doc) => Pick<XlsxWriteOptions, 'values' | 'spills'> | undefined)
}

/** Spreadsheets: xlsx/xlsm/xltx/xltm and csv/tsv, all as one workbook layout. */
export class SheetCodec implements LiveFormatCodec {
  readonly id = 'sheet' as const
  readonly schemaVersion = SHEETS_SCHEMA_VERSION
  readonly extensions = SHEET_EXTENSIONS

  constructor(private readonly options: SheetCodecOptions = {}) {}

  mimeType(extension: string): string {
    return sheetMimeType(extension)
  }

  async createEmpty(doc: Y.Doc, context: LiveFormatContext): Promise<void> {
    const format = sheetFormatOf(context.name)
    const model = WorkbookModel.initialize(doc, { format })
    const sheet = model.addSheet('Sheet1')
    model.setMeta('activeSheet', sheet.id)
  }

  async importFile(doc: Y.Doc, bytes: Uint8Array, context: LiveFormatContext): Promise<void> {
    const format = sheetFormatOf(context.name)
    if (format === 'csv' || format === 'tsv') doc.transact(() => readCsv(doc, bytes, format), IMPORT_ORIGIN)
    else await readXlsx(doc, bytes, context.assets, this.options.read)
  }

  async exportFile(doc: Y.Doc, context: LiveFormatContext): Promise<Uint8Array> {
    // Renaming out of the live format exports the original workbook under its new name.
    const extension = context.name.slice(context.name.lastIndexOf('.') + 1).toLowerCase()
    const format = (SHEET_EXTENSIONS as readonly string[]).includes(extension) ? extension as SheetFormat : new WorkbookModel(doc).metaValue('format') ?? 'xlsx'
    const calculate = this.options.calculate === undefined ? calculateWithEngine : this.options.calculate
    const calculated = calculate ? calculate(doc) : undefined
    if (format === 'csv' || format === 'tsv') return writeCsv(doc, format, calculated?.values)
    return writeXlsx(doc, context.assets, { format, ...calculated, ...(calculated ? {} : { recalculateOnLoad: true }) })
  }

  async applyFile(doc: Y.Doc, bytes: Uint8Array, context: LiveFormatContext, origin?: unknown): Promise<{ changed: boolean }> {
    // An exported snapshot may include a newer calculation clock in core properties than the
    // preserved source parts. Applying those exact bytes must still be a no-op.
    if (new WorkbookModel(doc).initialized) {
      const current = await this.exportFile(doc, context)
      if (current.length === bytes.length && current.every((value, index) => value === bytes[index])) return { changed: false }
    }
    const incoming = new Y.Doc()
    await this.importFile(incoming, bytes, context)
    const unsubscribe = trackEdits(doc)
    try {
      const result = applyWorkbook(doc, incoming, origin)
      if (result.changed) markCalcDirty(doc)
      return result
    } finally {
      unsubscribe()
      incoming.destroy()
    }
  }

  toText(doc: Y.Doc): string {
    const model = new WorkbookModel(doc)
    if (!model.initialized) return ''
    // Agents read what the sheet shows: formulas calculated, not the values cached in the file.
    const calc = new SheetCalc(model, exportCalculationOptions(model))
    return sheetsToText(doc, (sheet, row, col) => calc.get(sheet, row, col))
  }

  /** Hashes of every preserved part and picture, so unused assets can be collected. */
  referencedAssets(doc: Y.Doc): string[] {
    const model = new WorkbookModel(doc)
    if (!model.initialized) return []
    const hashes = new Set<string>()
    for (const part of model.parts.values()) hashes.add(part.hash)
    for (const sheet of model.sheets()) {
      for (const raw of sheet.drawings.values()) {
        const image = (raw as { image?: { hash: string } }).image
        if (image) hashes.add(image.hash)
      }
    }
    return [...hashes]
  }
}

/** Current values from the formula engine, for writing correct cached values. */
export function calculateWithEngine(doc: Y.Doc): Pick<XlsxWriteOptions, 'values' | 'spills'> {
  const calc = new SheetCalc(new WorkbookModel(doc), exportCalculationOptions(new WorkbookModel(doc)))
  return {
    values: (sheet, row, col) => calc.get(sheet, row, col),
    spills: (sheet, row, col) => calc.spillValues(sheet, row, col),
  }
}

/** Time and randomness belong to the document snapshot, so checksums survive repeated exports. */
function exportCalculationOptions(model: WorkbookModel) {
  const time = model.metaValue('calcTime') ?? Date.UTC(2000, 0, 1)
  let seed = (time ^ Math.floor(time / 0x1_0000_0000)) >>> 0
  return {
    live: false,
    now: () => time,
    timezoneOffset: model.metaValue('calcTimezoneOffset') ?? 0,
    random: () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

/** The codec the format registry uses. */
export const sheetCodec = new SheetCodec()
