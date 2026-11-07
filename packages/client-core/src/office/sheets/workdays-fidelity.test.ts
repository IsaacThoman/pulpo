import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { SheetCodec } from './codec/codec.js'
import { FormulaEngine } from './formula/engine.js'
import { functionRegistry } from './formula/functions/index.js'
import { WorkbookModel } from './model/workbook.js'
import { cachedValues, fidelityAvailable, libreOfficeAvailable, libreOfficeConvert } from './testing/fidelity.js'

const enabled = process.env.PULPO_OFFICE_FIDELITY === '1' || process.env.PULPO_SHEETS_FIDELITY === '1'

it.skipIf(!enabled || !fidelityAvailable() || !libreOfficeAvailable())('matches LibreOffice business-day caches for all weekend masks, holidays and both directions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pulpo-workdays-'))
  try {
    for (const date1904 of [false, true]) {
      const doc = new Y.Doc()
      try {
        const book = WorkbookModel.initialize(doc, { date1904 })
        const sheet = book.addSheet('Business days')
        const engine = new FormulaEngine({ functions: functionRegistry(), date1904 })
        engine.setSheets(['Business days'])
        const formulas: string[] = []
        const holidays = '{45000;45001;45001;45002.75;45007;45008;45009;45040;44999;44990}'
        for (let bits = 0; bits < 127; bits++) {
          const mask = `"${bits.toString(2).padStart(7, '0')}"`
          for (const days of [-30, -1, 0, 1, 30, 300000]) {
            formulas.push(`WORKDAY.INTL(45000,${days},${mask},${holidays})`)
          }
          formulas.push(`NETWORKDAYS.INTL(44980,45060,${mask},${holidays})`)
          formulas.push(`NETWORKDAYS.INTL(45060,44980,${mask},${holidays})`)
        }
        for (const weekend of [1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17]) {
          formulas.push(`WORKDAY.INTL(2900000,-300000,${weekend},${holidays})`)
          formulas.push(`NETWORKDAYS.INTL(45000,2957000,${weekend},${holidays})`)
        }
        formulas.push(`WORKDAY(45000,30,${holidays})`, `WORKDAY(45000,-30,${holidays})`, `WORKDAY(45000,0,${holidays})`)
        formulas.push(`NETWORKDAYS(45000,45060,${holidays})`, `NETWORKDAYS(45060,45000,${holidays})`)
        formulas.forEach((formula, row) => sheet.setCell(row, 0, { f: formula }))
        const input = join(dir, `business-${date1904}.xlsx`)
        writeFileSync(input, await new SheetCodec().exportFile(doc, { name: 'business.xlsx', assets: new MemoryLiveAssetStore() }))
        const converted = libreOfficeConvert(input, 'xlsx', join(dir, `recalc-${date1904}`))
        expect(converted.ok, converted.error).toBe(true)
        const cells = new Map(cachedValues(converted.outputs![0]!).cells.map((cell) => [cell.cell, cell.cached]))
        formulas.forEach((formula, row) => {
          const actual = engine.evaluateFormula(formula)
          const expected = cells.get(`A${row + 1}`)
          expect(typeof actual === 'object' && actual !== null ? actual.toString() : actual, `${date1904}/${formula}`).toEqual(expected)
        })
      } finally { doc.destroy() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 180_000)
