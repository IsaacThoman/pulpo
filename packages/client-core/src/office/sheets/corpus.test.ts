import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { LiveFormatError } from '../live-format.js'
import { cellName } from './address.js'
import { SheetCalc } from './calc.js'
import { SheetCodec } from './codec/codec.js'
import { insertAxis } from './model/structure.js'
import { WorkbookModel } from './model/workbook.js'
import {
  compareXlsx,
  editWithOpenpyxl,
  fidelityAvailable,
  formatDifferences,
  inspectXlsx,
  libreOfficeAvailable,
  libreOfficeConvert,
  sheetsFixture,
  SHEETS_FIXTURES_DIR,
  xmlPartsDiff,
} from './testing/fidelity.js'
import { SHEET_EXTENSIONS } from './layout.js'
import { isErrorValue, storedValue, type CellValue } from './values.js'
import * as commands from './view/commands.js'

interface ManifestEntry {
  path: string
  group: string
  expect: 'open' | 'refuse:strict' | 'refuse:encrypted' | 'refuse:corrupt' | 'open-or-refuse'
  notes?: string
}

const manifest = JSON.parse(readFileSync(join(SHEETS_FIXTURES_DIR, 'manifest.json'), 'utf8')) as { files: ManifestEntry[] }
const codec = new SheetCodec()

async function load(path: string): Promise<{ doc: Y.Doc; assets: MemoryLiveAssetStore; name: string }> {
  const name = path.split('/').pop()!
  const assets = new MemoryLiveAssetStore()
  const doc = new Y.Doc()
  await codec.importFile(doc, readFileSync(sheetsFixture(path)), { name, assets })
  return { doc, assets, name }
}

const REFUSALS: Record<string, string> = { 'refuse:strict': 'unsupported', 'refuse:encrypted': 'encrypted', 'refuse:corrupt': 'corrupt' }

/** Volatile functions recalculate to new values each time they're read. */
const VOLATILE = /\b(RAND|RANDBETWEEN|RANDARRAY|NOW|TODAY)\s*\(/i

describe('fixture corpus', () => {
  for (const entry of manifest.files.filter((file) => SHEET_EXTENSIONS.some((extension) => file.path.toLowerCase().endsWith(`.${extension}`)))) {
    it(`${entry.path} (${entry.expect})`, async () => {
      const name = entry.path.split('/').pop()!
      const bytes = readFileSync(sheetsFixture(entry.path))
      let result: { doc: Y.Doc; assets: MemoryLiveAssetStore } | undefined
      try {
        result = await load(entry.path)
      } catch (error) {
        expect(error, `${entry.path} should not throw ${String(error)}`).toBeInstanceOf(LiveFormatError)
        if (entry.expect.startsWith('refuse:')) expect((error as LiveFormatError).code).toBe(REFUSALS[entry.expect])
        else expect(entry.expect).toBe('open-or-refuse')
        return
      }
      expect(entry.expect.startsWith('refuse:'), `${entry.path} opened but should be refused`).toBe(false)
      const output = await codec.exportFile(result.doc, { name, assets: result.assets })
      if (/\.(csv|tsv)$/i.test(name)) {
        // Exactly the bytes that were read.
        expect(Buffer.from(output).equals(bytes)).toBe(true)
        return
      }
      // The export opens again with the same contents, and applying it to the document loses
      // nothing. (Strict "applying your own export changes nothing" is checked in codec.test.ts on
      // fixtures we write; files from elsewhere can drift in how preserved XML is serialized.)
      const before = codec.toText(result.doc)
      const volatile = VOLATILE.test(before)
      const again = new Y.Doc()
      await codec.importFile(again, output, { name, assets: result.assets })
      if (!volatile) expect(codec.toText(again)).toBe(before)
      await codec.applyFile(result.doc, output, { name, assets: result.assets })
      if (!volatile) expect(codec.toText(result.doc)).toBe(before)
    }, 60_000)
  }
})

/** Equal the way Excel would show them: numbers to 15 significant digits, text exactly. */
function sameValue(a: CellValue, b: CellValue): boolean {
  if (isErrorValue(a) || isErrorValue(b)) return isErrorValue(a) && isErrorValue(b) && a.e === b.e
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  // Blank and empty text read the same in a cache.
  return (a ?? '') === (b ?? '')
}

describe('formula oracle', () => {
  // Files saved by Excel carry the value of every formula; recalculating them from scratch must
  // agree. LibreOffice-saved files are a second oracle for the generated formulas.
  const oracleFiles = manifest.files.filter((entry) => entry.expect === 'open' && /\.(xlsx|xlsm)$/i.test(entry.path) && (entry.path.startsWith('poi/') || entry.path.startsWith('libreoffice/')))
  it('recalculates cached formula values', async () => {
    const report: string[] = []
    let total = 0
    let agreed = 0
    const misses: string[] = []
    for (const entry of oracleFiles) {
      const { doc } = await load(entry.path)
      const model = new WorkbookModel(doc)
      const calc = new SheetCalc(model, { live: false, ignoreCache: true, now: () => Date.UTC(2026, 10, 4) })
      let fileTotal = 0
      let fileAgreed = 0
      for (const sheet of model.sheets()) {
        sheet.forEachCell((row, col, data) => {
          // Only formulas with a cache to compare; volatile and data-table ones can't agree.
          if (data.f === undefined || data.v === undefined || data.keep?.fText || /RAND|NOW|TODAY|INDIRECT|OFFSET|CELL|INFO/i.test(data.f)) return
          if (calc.isUnsupported(sheet, row, col)) return
          fileTotal++
          const expected = storedValue(data)
          const actual = calc.get(sheet, row, col)
          if (sameValue(actual, expected)) fileAgreed++
          else if (misses.length < 60) misses.push(`${entry.path} ${sheet.name}!${cellName(row, col)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
        })
      }
      calc.destroy()
      total += fileTotal
      agreed += fileAgreed
      if (fileTotal) report.push(`${entry.path}: ${fileAgreed}/${fileTotal}`)
    }
    const rate = agreed / Math.max(1, total)
    console.info(`Formula oracle: ${agreed}/${total} cached values reproduced (${(rate * 100).toFixed(2)}%)\n${report.join('\n')}\nFirst disagreements:\n${misses.join('\n')}`)
    expect(total).toBeGreaterThan(1000)
    // 98.5% when last measured; the rest are POI's edge cases (external references, error precedence).
    expect(rate).toBeGreaterThan(0.98)
  }, 300_000)
})

const fidelity = fidelityAvailable() && process.env.PULPO_SHEETS_FIDELITY === '1'

/** Where we read a file the way Excel does and openpyxl doesn't, so the two can't agree. */
const EXPECTED_DIFFERENCES: Record<string, string[]> = {
  // `_x0041_` in a string is an escape for "A" (ECMA-376 §22.4.2.4), which openpyxl doesn't decode.
  'generated/gen-values.xlsx': ['sheets/Values/cells/B24', 'sheets/Values/cells/C23'],
  // openpyxl wrote table column names that don't match the header cells; Excel repairs that by
  // taking the header text, and so do we.
  'generated/gen-tables.xlsx': ['sheets/Tables/tables/Sales/columns/*/name'],
}

describe.skipIf(!fidelity)('fidelity against openpyxl and LibreOffice', () => {
  const xlsxFiles = manifest.files.filter((entry) => entry.expect === 'open' && /\.(xlsx|xlsm|xltx)$/i.test(entry.path))
  const scratch = mkdtempSync(join(tmpdir(), 'pulpo-sheets-fidelity-'))

  it('round-trips every fixture without changing what openpyxl reads or untouched parts', async () => {
    const failures: string[] = []
    for (const entry of xlsxFiles) {
      const { doc, assets, name } = await load(entry.path)
      const output = join(scratch, name)
      const exported = await codec.exportFile(doc, { name, assets })
      writeFileSync(output, exported)
      // openpyxl skips parts it doesn't read (printer settings, media), so it can't vouch for the
      // package itself: our own reader, which checks every entry, must open the export too.
      try {
        await codec.importFile(new Y.Doc(), exported, { name, assets })
      } catch (error) {
        failures.push(`${entry.path}: our export doesn't open again: ${String(error)}`)
        continue
      }
      const original = sheetsFixture(entry.path)
      try {
        // Calculated values may legitimately differ from caches openpyxl never computed.
        const compared = compareXlsx(original, output, { ignore: ['calc', 'package', ...(EXPECTED_DIFFERENCES[entry.path] ?? [])] })
        if (!compared.equal) failures.push(`${entry.path}:\n${formatDifferences(compared, 8)}`)
        const parts = xmlPartsDiff(original, output)
        const lost = parts.removed.filter((path) => !/calcChain|sharedStrings/.test(path))
        if (lost.length) failures.push(`${entry.path}: parts removed ${lost.join(', ')}`)
      } catch (error) {
        // Files openpyxl itself can't read are covered by the import/export test above.
        if (!/openpyxl|ToolError/i.test(String(error))) failures.push(`${entry.path}: ${String(error)}`)
      }
    }
    expect(failures, failures.join('\n\n')).toEqual([])
  }, 900_000)

  it('writes edits openpyxl reads back', async () => {
    const { doc, assets } = await load('generated/gen-styles.xlsx')
    const model = new WorkbookModel(doc)
    const sheet = model.sheets()[0]!
    commands.setCellInput(sheet, 40, 0, 'edited')
    commands.setCellInput(sheet, 40, 1, '=1+1')
    commands.applyStyle(sheet, [{ top: 40, left: 0, bottom: 40, right: 0 }], { bold: true, fill: { rgb: 'FFFFFF00' } })
    insertAxis(sheet, 'row', 0, 1)
    const output = join(scratch, 'edited.xlsx')
    writeFileSync(output, await codec.exportFile(doc, { name: 'edited.xlsx', assets }))
    const dump = inspectXlsx(output, { values: true }) as unknown as { sheets: Record<string, { cells: Record<string, { v: unknown; font?: { bold?: boolean } }> }> }
    const cells = dump.sheets[sheet.name]!.cells
    expect(cells.A42?.v).toBe('edited')
    expect(cells.A42?.font?.bold).toBe(true)
    expect(cells.B42?.v).toBe(2)
  }, 120_000)

  it('merges an agent edit made with openpyxl with a concurrent user edit', async () => {
    const { doc, assets, name } = await load('generated/gen-multisheet.xlsx')
    const exported = join(scratch, 'agent-in.xlsx')
    writeFileSync(exported, await codec.exportFile(doc, { name, assets }))
    const edited = join(scratch, 'agent-out.xlsx')
    editWithOpenpyxl(exported, edited, [{ op: 'insert_rows', sheet: 'Summary', idx: 1, amount: 1 }, { op: 'set', sheet: 'Summary', cell: 'A1', value: 'agent' }])
    // A user edits a cell further down at the same time.
    const user = new Y.Doc()
    Y.applyUpdate(user, Y.encodeStateAsUpdate(doc))
    const userSheet = new WorkbookModel(user).sheetByName('Summary')!
    commands.setCellInput(userSheet, 5, 6, 'user')
    await codec.applyFile(doc, readFileSync(edited), { name, assets }, 'agent')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(user, Y.encodeStateVector(doc)))
    const sheet = new WorkbookModel(doc).sheetByName('Summary')!
    expect(sheet.cell(0, 0)?.v).toBe('agent')
    // openpyxl's insert_rows doesn't adjust anything, but the row moved: the user's cell follows it.
    expect(sheet.cell(6, 6)?.v).toBe('user')
  }, 120_000)

  it.skipIf(!libreOfficeAvailable())('exports files LibreOffice converts to PDF', async () => {
    const failures: string[] = []
    for (const path of ['generated/gen-styles.xlsx', 'generated/gen-charts.xlsx', 'generated/gen-conditional-formatting.xlsx', 'poi/ExcelTables.xlsx', 'poi/WithThreeCharts.xlsx', 'poi/SimpleMacro.xlsm']) {
      const { doc, assets, name } = await load(path)
      const output = join(scratch, `lo-${name}`)
      writeFileSync(output, await codec.exportFile(doc, { name, assets }))
      const result = libreOfficeConvert(output, 'pdf', scratch)
      if (!result.ok) failures.push(`${path}: ${JSON.stringify(result).slice(0, 300)}`)
    }
    expect(failures).toEqual([])
  }, 600_000)
})
