import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { FormulaEngine } from './formula/engine.js'
import { FINANCIAL_FUNCTIONS } from './formula/functions/financial.js'
import { functionRegistry } from './formula/functions/index.js'
import { sheetsFixture, fidelityAvailable, fidelityPython, libreOfficeAvailable, SHEETS_SCRIPTS_DIR } from './testing/fidelity.js'

const enabled = process.env.PULPO_OFFICE_FIDELITY === '1'
it.skipIf(!enabled)('matches the complete LibreOffice financial oracle grid', () => {
  const dir = sheetsFixture('financial-oracle')
  const cases = readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as [string, number | string][])
  expect([...new Set(cases.map(([formula]) => formula.split('(')[0]))].sort()).toEqual(FINANCIAL_FUNCTIONS.map(f => f.name).sort())
  const engine = new FormulaEngine({ functions: functionRegistry() })
  const mismatches: string[] = []
  for (const [formula, expected] of cases) {
    const result = engine.evaluateFormula(formula)
    const actual = typeof result === 'object' && result !== null ? result.toString() : result
    if (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected))) continue
    if (actual !== expected) mismatches.push(`${formula}: ${actual} != ${expected}`)
  }
  if (mismatches.length) writeFileSync(join(tmpdir(), 'pulpo-financial-mismatches.txt'), mismatches.join('\n'))
  expect(mismatches.length, mismatches.slice(0, 40).join('\n')).toBe(0)
})

// Exceptions keep both Excel's documented result and the raw Calc cache. They cover
// NUM/VALUE/N/A errors, optional arguments, NASD/actual-year/coupon day counts,
// fractional IPMT/DDB periods, text in arrays, and unimplemented Calc ODDF* calls.
// financial_reference.py derives them independently from MS-OI29500 and Support
// formulas; financial-oracle/README.md links the sources and explains each reason.
it.skipIf(!enabled)('reproduces the committed caches through headless LibreOffice', () => {
  expect(fidelityAvailable(), 'Run scripts/sheets/setup-fidelity-env.sh').toBe(true)
  expect(libreOfficeAvailable(), 'Install LibreOffice for the financial oracle').toBe(true)
  const result = spawnSync(fidelityPython(), ['-I', join(SHEETS_SCRIPTS_DIR, 'financial_oracle.py'), '--check'], { encoding: 'utf8', timeout: 180_000 })
  expect(result.status, result.stderr || result.stdout).toBe(0)
}, 190_000)
