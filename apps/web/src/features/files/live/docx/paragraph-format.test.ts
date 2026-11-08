import type { ParagraphFormat } from '@pulpo/client-core/office/docx/view'
import { describe, expect, it } from 'vitest'
import { paragraphChange, paragraphFields } from './paragraph-format'

const format = (change: Partial<ParagraphFormat> = {}): ParagraphFormat => ({
  alignment: 'left',
  indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
  spacing: { before: 0, after: 8, beforeAuto: false, afterAuto: false, line: { multiple: 1.15 } },
  keepNext: false,
  keepLines: false,
  pageBreakBefore: false,
  widowControl: true,
  border: 'none',
  ...change,
})

describe('Paragraph dialog fields', () => {
  it('shows a hanging indent and exact spacing as Word does', () => {
    const fields = paragraphFields(format({ indent: { left: 36, right: 0, firstLine: 0, hanging: 18 }, spacing: { before: 6, after: 0, beforeAuto: false, afterAuto: false, line: { exact: 18 } } }), 'in', 'en-US')
    expect(fields).toMatchObject({ left: '0.5', special: 'hanging', by: '0.25', before: '6', after: '0', rule: 'exact', at: '18' })
    expect(paragraphFields(format({ spacing: { before: 0, after: 0, beforeAuto: false, afterAuto: false, line: { multiple: 2 } } }), 'cm', 'es-ES')).toMatchObject({ rule: 'double', at: '2' })
  })

  it('writes only what changed, so paragraphs with other formats keep the rest', () => {
    const initial = paragraphFields(format(), 'in', 'en-US')
    expect(paragraphChange(initial, initial, 'in')).toEqual({ change: {} })
    expect(paragraphChange(initial, { ...initial, special: 'hanging', by: '0.5', left: '0.5' }, 'in')).toEqual({ change: { indent: { left: 36, hanging: 36 } } })
    expect(paragraphChange(initial, { ...initial, rule: 'atLeast', at: '14' }, 'in')).toEqual({ change: { spacing: { line: { atLeast: 14 } } } })
    expect(paragraphChange(initial, { ...initial, rule: 'oneHalf' }, 'in')).toEqual({ change: { spacing: { line: { multiple: 1.5 } } } })
    expect(paragraphChange(initial, { ...initial, keepNext: true, widowControl: false, alignment: 'both' }, 'in')).toEqual({ change: { alignment: 'both', keepNext: true, widowControl: false } })
  })

  it('removes a first-line or hanging indent with None', () => {
    const initial = paragraphFields(format({ indent: { left: 36, right: 0, firstLine: 18, hanging: 0 } }), 'in')
    expect(paragraphChange(initial, { ...initial, special: 'none' }, 'in')).toEqual({ change: { indent: { firstLine: 0 } } })
  })

  it('refuses what is not a length, a spacing, or a line height', () => {
    const initial = paragraphFields(format(), 'in')
    expect(paragraphChange(initial, { ...initial, left: 'wide' }, 'in')).toMatchObject({ error: { field: 'left' } })
    expect(paragraphChange(initial, { ...initial, special: 'firstLine', by: '-1' }, 'in')).toMatchObject({ error: { field: 'by' } })
    expect(paragraphChange(initial, { ...initial, before: '-2' }, 'in')).toMatchObject({ error: { field: 'before' } })
    expect(paragraphChange(initial, { ...initial, rule: 'exact', at: '0.1' }, 'in')).toMatchObject({ error: { field: 'at' } })
    expect(paragraphChange(initial, { ...initial, rule: 'multiple', at: '200' }, 'in')).toMatchObject({ error: { field: 'at' } })
  })
})
