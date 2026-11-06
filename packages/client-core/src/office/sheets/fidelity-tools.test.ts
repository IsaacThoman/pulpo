// Smoke tests for the Python/LibreOffice fidelity tooling. Opt-in, because it needs
// the venv from scripts/sheets/setup-fidelity-env.sh (and LibreOffice for the LO cases):
//   PULPO_SHEETS_FIDELITY=1 npx vitest run packages/client-core/src/office/sheets/fidelity-tools.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cachedValues,
  compareXlsx,
  editWithOpenpyxl,
  fidelityAvailable,
  formatDifferences,
  inspectXlsx,
  libreOfficeAvailable,
  libreOfficeConvert,
  sheetsFixture,
  xmlPartsDiff,
} from './testing/fidelity.js'

const enabled = process.env.PULPO_SHEETS_FIDELITY === '1'
const work = enabled ? mkdtempSync(join(tmpdir(), 'pulpo-sheets-fidelity-')) : ''

describe.skipIf(!enabled)('sheets fidelity tools', { timeout: 120_000 }, () => {
  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true })
  })

  it('has the python environment', () => {
    expect(fidelityAvailable(), 'run packages/client-core/scripts/sheets/setup-fidelity-env.sh').toBe(true)
  })

  it('inspects conditional formatting including x14 extensions', () => {
    const dump = inspectXlsx(sheetsFixture('poi/NewStyleConditionalFormattings.xlsx'))
    expect(dump.error).toBeUndefined()
    const sheet = dump.sheets?.CF
    const types = new Set(sheet?.conditionalFormatting?.map((rule) => rule.type))
    expect(types).toEqual(new Set(['cellIs', 'expression', 'colorScale', 'dataBar', 'iconSet']))
    expect(sheet?.x14).toHaveProperty('conditionalFormatting')
    expect(dump.warnings).toContain('Conditional Formatting extension is not supported and will be removed')
  })

  it('reports refusals as structured errors', () => {
    expect(inspectXlsx(sheetsFixture('poi/sample.strict.xlsx')).error?.type).toBe('StrictOoxml')
    expect(inspectXlsx(sheetsFixture('poi/protected_passtika.xlsx')).error?.container).toBe('cfb')
  })

  it('compares a workbook with an openpyxl-edited copy', () => {
    const source = sheetsFixture('poi/SimpleWithComments.xlsx')
    const same = compareXlsx(source, source)
    expect(same.equal, formatDifferences(same)).toBe(true)

    const edited = join(work, 'edited.xlsx')
    const edit = editWithOpenpyxl(source, edited, [
      { op: 'set', sheet: 'Sheet1', cell: 'A1', value: 99 },
      { op: 'add_sheet', name: 'Agent' },
    ])
    expect(edit.ok).toBe(true)
    const diff = compareXlsx(source, edited, { ignore: ['package', 'warnings'] })
    expect(diff.equal).toBe(false)
    expect(diff.differences).toContainEqual({ path: 'sheets/Sheet1/cells/A1/v', kind: 'changed', a: 1, b: 99 })
    expect(diff.differences.some((d) => d.path === 'sheets/Agent' && d.kind === 'added')).toBe(true)

    const parts = xmlPartsDiff(source, source)
    expect(parts.same).toBe(true)
    const changedParts = xmlPartsDiff(source, edited)
    expect(changedParts.same).toBe(false)
    expect(Object.keys(changedParts.different)).toContain('xl/worksheets/sheet1.xml')
  })

  it('reads LibreOffice-calculated cached values', () => {
    const generated = cachedValues(sheetsFixture('generated/gen-formulas.xlsx'))
    expect(generated.summary.withCachedValue).toBe(0)
    const oracle = cachedValues(sheetsFixture('libreoffice/gen-formulas.lo.xlsx'), { sheets: ['Formulas'] })
    expect(oracle.summary.withoutCachedValue).toBe(0)
    expect(oracle.cells.find((c) => c.formula === '=POWER(2,10)')?.cached).toBe(1024)
  })

  it.skipIf(!libreOfficeAvailable())('converts with LibreOffice', () => {
    const result = libreOfficeConvert(sheetsFixture('poi/SimpleWithComments.xlsx'), 'csv', join(work, 'csv'))
    expect(result.ok, result.error).toBe(true)
    expect(result.outputs?.length).toBe(3)
    expect(result.outputs?.every((file) => existsSync(file))).toBe(true)
  })
})
