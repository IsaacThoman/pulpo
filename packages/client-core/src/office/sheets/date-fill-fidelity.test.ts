import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { SheetCodec } from './codec/codec.js'
import { dateToSerial } from './dates.js'
import { WorkbookModel } from './model/workbook.js'
import { cachedValues, fidelityPython, libreOfficeAvailable, libreOfficeConvert } from './testing/fidelity.js'
import { fillSeries } from './view/fill.js'

it.skipIf(process.env.PULPO_SHEETS_FIDELITY !== '1' || !libreOfficeAvailable())('matches real Calc autofill and date formula caches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pulpo-date-fill-'))
  const doc = new Y.Doc()
  try {
    const book = WorkbookModel.initialize(doc)
    const sheet = book.addSheet('Dates')
    const sources = [
      [dateToSerial(2023, 12, 31), dateToSerial(2024, 1, 31)],
      [dateToSerial(2024, 1, 30), dateToSerial(2024, 3, 30)],
      [dateToSerial(2022, 2, 28), dateToSerial(2023, 2, 28)],
    ]
    sources.forEach((values, col) => values.forEach((v, row) => {
      sheet.setCell(row, col, { v })
      sheet.setStyle({ top: row, bottom: row, left: col, right: col }, { numFmt: 'yyyy-mm-dd' })
    }))
    const formulas = [
      ['EDATE(DATE(2024,1,31)+0.75,1)', dateToSerial(2024, 2, 29)],
      ['EDATE(DATE(2024,2,29),12)', dateToSerial(2025, 2, 28)],
      ['EDATE(DATE(2024,3,31),-1)', dateToSerial(2024, 2, 29)],
      ['EOMONTH(DATE(2024,1,31),1)', dateToSerial(2024, 2, 29)],
      ['DATE(2024,2,31)', dateToSerial(2024, 3, 2)],
      ['DATE(2025,2,29)', dateToSerial(2025, 3, 1)],
    ] as const
    formulas.forEach(([f], row) => sheet.setCell(row, 4, { f }))
    const input = join(dir, 'input.xlsx'), oracle = join(dir, 'oracle.xlsx')
    writeFileSync(input, await new SheetCodec().exportFile(doc, { name: 'input.xlsx', assets: new MemoryLiveAssetStore() }))
    execFileSync(fidelityPython(), ['-I', join(process.cwd(), 'scripts/sheets/lo_fill.py'), input, oracle, 'A1:C5'], { timeout: 120_000 })
    // Cached numeric values avoid Python's conversion of date-formatted serials to datetimes.
    const oracleDoc = new Y.Doc()
    await new SheetCodec().importFile(oracleDoc, readFileSync(oracle), { name: 'oracle.xlsx', assets: new MemoryLiveAssetStore() })
    const oracleSheet = new WorkbookModel(oracleDoc).sheets()[0]!
    sources.forEach((values, col) => {
      const actual = fillSeries(values.map((value) => ({ value, formula: false, numFmt: 'yyyy-mm-dd' })), 3)
      actual.forEach((result, i) => {
        expect(result.kind).toBe('value')
        if (result.kind === 'value') expect(oracleSheet.cell(i + 2, col)?.v).toBe(result.value)
      })
    })
    oracleDoc.destroy()
    const converted = libreOfficeConvert(input, 'xlsx', join(dir, 'recalc'))
    expect(converted.ok, converted.error).toBe(true)
    const calculated = cachedValues(converted.outputs![0]!).cells
    formulas.forEach(([, expected], i) => expect(calculated.find((c) => c.cell === `E${i + 1}`)?.cached).toBe(expected))
  } finally { doc.destroy(); rmSync(dir, { recursive: true, force: true }) }
}, 120_000)
