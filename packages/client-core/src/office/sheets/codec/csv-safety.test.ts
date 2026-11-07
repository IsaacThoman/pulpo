import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import type { CellData, CsvDialect } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { contentFromInput, fillInput, placeCell, snapshotCell, sortRange } from '../view/commands.js'
import { toTsv } from '../view/clipboard.js'
import { SheetCodec } from './codec.js'
import { decodeText, encodeText, parseCsv, readCsv, writeCsv } from './csv.js'

const codec = new SheetCodec({ calculate: false })
const context = { name: 'data.csv', assets: new MemoryLiveAssetStore() }
const utf8 = (text: string) => new TextEncoder().encode(text)
const dialect = (delimiter = ','): CsvDialect => ({ delimiter, quote: '"', lineEnding: '\n', encoding: 'utf-8', bom: false, trailingNewline: true, quoting: 'minimal' })
const grid = (doc: Y.Doc, format: 'csv' | 'tsv' = 'csv', separator = ',') => parseCsv(decodeText(writeCsv(doc, format)).text, separator).rows.map((row) => row.fields)
function workbook(csv = dialect()) {
  const doc = new Y.Doc()
  const model = WorkbookModel.initialize(doc, { format: 'csv', csv })
  const sheet = model.addSheet('Sheet1')
  return { doc, model, sheet }
}

describe('CSV writer safety', () => {
  it.each([',', ';', '\t', '|'])('rejects malformed and stale raw fields for delimiter %j', (delimiter) => {
    const { doc, sheet } = workbook(dialect(delimiter))
    const cases: CellData[] = [
      { v: 1, raw: '1\n' }, { v: 1, raw: '\r1' }, { v: 1, raw: '1\r\n' },
      { v: 'actual', raw: `wrong${delimiter}neighbor` }, { v: 'actual', raw: 'wrong"quote' },
      { v: 'actual', raw: '"unclosed' }, { v: 'actual', raw: '"closed"junk' },
      { v: 'actual', raw: '"backslash\\"escape"' }, { v: 'actual', raw: '"a""' },
      { v: 'actual', raw: '"stale"' }, { v: 'actual', raw: '' },
      { v: 'a"b\r\nc', raw: '"a""b\r\nc"' }, { v: 7, raw: '"007"' },
    ]
    cases.forEach((data, row) => { sheet.setCell(row, 0, data); sheet.setCell(row, 1, { v: 'neighbor' }) })
    expect(grid(doc, delimiter === '\t' ? 'tsv' : 'csv', delimiter)).toEqual(cases.map((data) => [data.v === 7 ? '007' : String(data.v), 'neighbor']))
    doc.destroy()
  })

  it.each(['\n1', '1\n', '\r1', '1\r', '1\r\n', ' 1', '1 ', '\t1', '\uFEFF1'])('preserves typed whitespace in %j as a value', (text) => {
    const { doc, sheet } = workbook()
    expect(contentFromInput(sheet, text, { valuesOnly: true }).data).toEqual({ v: text })
    fillInput(sheet, [{ top: 0, bottom: 1, left: 0, right: 0 }], { row: 0, col: 0 }, text, { valuesOnly: true })
    sheet.setCell(0, 1, { v: 'neighbor' })
    expect(grid(doc)).toEqual([[text, 'neighbor'], [text, '']])
    doc.destroy()
  })

  it('keeps exact, safe numeric spellings from typed input', () => {
    const { doc, sheet } = workbook()
    for (const text of ['007', '-0', '1.50', '1e3']) {
      expect(contentFromInput(sheet, text, { valuesOnly: true }).data).toEqual({ v: Number(text), raw: text })
    }
    doc.destroy()
  })

  it('validates raw again when exporting CSV as TSV and TSV as CSV', () => {
    const doc = new Y.Doc()
    readCsv(doc, utf8('"tab\there",neighbor\n'), 'csv')
    // Even an unquoted raw string valid for comma cannot be reused for tabs.
    new WorkbookModel(doc).sheets()[0]!.setCell(0, 0, { v: 'tab\there', raw: 'tab\there' })
    expect(grid(doc, 'tsv', '\t')).toEqual([['tab\there', 'neighbor']])
    const tab = new Y.Doc()
    readCsv(tab, utf8('left,right\tneighbor\n'), 'tsv')
    new WorkbookModel(tab).sheets()[0]!.setCell(0, 0, { v: 'left,right', raw: 'left,right' })
    expect(grid(tab)).toEqual([['left,right', 'neighbor']])
    doc.destroy(); tab.destroy()
  })

  it('guards snapshot paste, copied fill, sort, and restored file state', async () => {
    const { doc, sheet } = workbook()
    sheet.setCell(0, 0, { v: 'z', raw: 'z\n' })
    sheet.setCell(0, 1, { v: 'neighbor' })
    placeCell(sheet, snapshotCell(sheet, 0, 0), { row: 0, col: 0 }, { row: 1, col: 0 })
    sheet.setCell(1, 1, { v: 'copied' })
    sortRange(sheet, { top: 0, bottom: 1, left: 0, right: 1 }, [{ col: 1 }], (row, col) => sheet.cell(row, col)?.v ?? null)
    expect(grid(doc)).toEqual([['z', 'copied'], ['z', 'neighbor']])
    const imported = new Y.Doc()
    await codec.importFile(imported, utf8('a,b\n'), context)
    await codec.applyFile(imported, writeCsv(doc, 'csv'), context, 'restore')
    expect(grid(imported)).toEqual(grid(doc))
    doc.destroy(); imported.destroy()
  })

  it('sanitizes tolerated invalid import syntax and agent applyFile', async () => {
    for (const apply of [false, true]) {
      const doc = new Y.Doc()
      await codec.importFile(doc, utf8(apply ? 'before,neighbor\n' : '"1"junk,neighbor\n'), context)
      if (apply) await codec.applyFile(doc, utf8('"1"junk,neighbor\n'), context)
      expect(new WorkbookModel(doc).sheets()[0]!.cell(0, 0)).toEqual({ v: '1junk' })
      expect(grid(doc)).toEqual([['1junk', 'neighbor']])
      doc.destroy()
    }
  })

  it('does not let preserved row endings or an invalid dialect inject fields', () => {
    const { doc, model, sheet } = workbook()
    sheet.setCell(0, 0, { v: 'left' })
    sheet.setCell(1, 0, { v: 'right' })
    sheet.rowMeta.set(`${sheet.rows.idAt(0)}|keep`, { ending: ',injected\n' })
    expect(grid(doc)).toEqual([['left'], ['right']])
    for (const csv of [{ ...dialect(), lineEnding: ',bad' }, { ...dialect(), delimiter: '"' }, { ...dialect(), quote: '' }]) {
      model.meta.set('csv', csv)
      expect(() => writeCsv(doc, 'csv')).toThrow('Invalid CSV dialect')
    }
    doc.destroy()
  })

  it('validates the configured quote and doubled-quote escape style', () => {
    const { doc, sheet } = workbook({ ...dialect('|'), quote: "'" })
    sheet.setCell(0, 0, { v: "it's|fine", raw: "'it''s|fine'" })
    sheet.setCell(0, 1, { v: 'safe', raw: "'bad'junk" })
    const text = decodeText(writeCsv(doc, 'csv')).text
    expect(text).toBe("'it''s|fine'|safe\n")
    expect(parseCsv(text, '|', "'").rows[0]!.fields).toEqual(["it's|fine", 'safe'])
    doc.destroy()
  })

  it('quotes clipboard TSV from values even if a snapshot contains malformed raw', () => {
    const values = ['tab\there', 'quote"', 'line\r\nbreak']
    expect(parseCsv(toTsv([values.map((text) => ({ text }))]), '\t').rows[0]!.fields).toEqual(values)
  })

  it.each([1, 3])('retains %i single-column empty records without a trailing newline', (height) => {
    const { doc, sheet } = workbook({ ...dialect(), trailingNewline: false })
    for (let row = 0; row < height; row++) {
      sheet.ensure(row, 0)
      sheet.cells.set(sheet.keyAt(row, 0), { raw: '' })
    }
    expect(grid(doc)).toEqual(Array.from({ length: height }, () => ['']))
    doc.destroy()
  })
})

// Fixed seed and bounded grids keep failures reproducible without another dependency.
function random(seed: number) {
  return (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor(seed / 0x1_0000_0000 * max)
  }
}
const samples = ['', ',', ';', '\t', '|', '"', '""', '\r', '\n', '\r\n', ' leading', 'trailing ', ' 1 ', '007', '-0', '1.50', '1e3', '1\n', '\uFEFF', '日本語', '🦑', 'é', 'e\u0301', '0', '1', '123']

describe('seeded CSV grid round trips', () => {
  it.each([',', ';', '\t', '|'])('exports and imports random grids with delimiter %j (seed 0x947)', async (delimiter) => {
    const next = random(0x947)
    for (let trial = 0; trial < 100; trial++) {
      const csv = { ...dialect(delimiter), lineEnding: (['\r', '\n', '\r\n'] as const)[next(3)]!, bom: !!next(2), trailingNewline: !!next(2), quoting: next(2) ? 'always' as const : 'minimal' as const }
      const { doc, sheet } = workbook(csv)
      const width = 1 + next(6), height = 1 + next(8)
      const expected = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
        // An unambiguous header lets import sniff non-comma dialects. Single-column grids
        // use always quoting so other delimiter characters in their values stay opaque.
        const text = row === 0 && width > 1 ? `column_${col}` : Array.from({ length: 1 + next(4) }, () => samples[next(samples.length)]!).join('')
        // Include corrupt and stale preservation data, independently of the actual value.
        const raw = [undefined, text, `"${text.replace(/"/g, '""')}"`, 'stale', '1\n,broken'][next(5)]
        // Preserve explicit empty cells too, as the importer does for trailing empty fields.
        sheet.ensure(row, col)
        sheet.cells.set(sheet.keyAt(row, col), { v: text, ...(raw !== undefined ? { raw } : {}) })
        return text
      }))
      if (width === 1) sheet.workbook.setMeta('csv', { ...csv, quoting: 'always' })
      const format = delimiter === '\t' ? 'tsv' : 'csv'
      const bytes = writeCsv(doc, format)
      expect(parseCsv(decodeText(bytes).text, delimiter).rows.map((row) => row.fields), `trial ${trial}`).toEqual(expected)
      const imported = new Y.Doc()
      const fileContext = { ...context, name: `data.${format}` }
      await codec.importFile(imported, bytes, fileContext)
      const output = await codec.exportFile(imported, fileContext)
      expect(output, `untouched trial ${trial}`).toEqual(bytes)
      expect(parseCsv(decodeText(output).text, delimiter).rows.map((row) => row.fields)).toEqual(expected)
      doc.destroy(); imported.destroy()
    }
  })

  it.each([',', ';', '\t', '|'])('keeps independently generated imported files byte-identical with delimiter %j (seed 0x449942)', async (delimiter) => {
    const next = random(0x449942)
    for (let trial = 0; trial < 60; trial++) {
      const width = 2 + next(5), height = 2 + next(8)
      const rows = Array.from({ length: height }, (_, row) => Array.from({ length: row === 0 ? width : 1 + next(width) }, (_, col) => {
        const value = row === 0 ? `header_${col}` : samples[next(samples.length)]! + samples[next(samples.length)]!
        // Independent reference encoder: include needless quotes and original numeric spellings.
        return next(2) || value.includes(delimiter) || /["\r\n]/.test(value) || value.startsWith('\uFEFF')
          ? `"${value.replace(/"/g, '""')}"` : value
      }).join(delimiter) + (['\r', '\n', '\r\n'] as const)[next(3)]!).join('')
      const encoding = (['utf-8', 'utf-16le', 'utf-16be'] as const)[next(3)]!
      const bytes = encodeText(rows, { encoding, bom: true })
      const doc = new Y.Doc()
      const fileContext = { ...context, name: delimiter === '\t' ? 'data.tsv' : 'data.csv' }
      await codec.importFile(doc, bytes, fileContext)
      expect(await codec.exportFile(doc, fileContext), `trial ${trial}`).toEqual(bytes)
      doc.destroy()
    }
  })

  it.each(['utf-8', 'utf-16le', 'utf-16be'] as const)('keeps a BOM followed by literal BOM content byte-identical in %s', async (encoding) => {
    for (const text of ['\uFEFFvalue,neighbor\n', 'header,\uFEFFvalue\n', '"\uFEFFvalue",neighbor\n']) {
      const bytes = encodeText(text, { encoding, bom: true })
      const doc = new Y.Doc()
      await codec.importFile(doc, bytes, context)
      expect(await codec.exportFile(doc, context)).toEqual(bytes)
      doc.destroy()
    }
  })
})
