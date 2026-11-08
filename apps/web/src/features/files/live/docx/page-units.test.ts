import { describe, expect, it } from 'vitest'
import { MARGIN_PRESETS, marginPresetOf, measurementUnit, paperSizeOf, parseLength, parseMargins, pointsTo } from './page-units'

describe('page units', () => {
  it('measures pages in inches in the United States and centimeters elsewhere', () => {
    expect(measurementUnit('en-US')).toBe('in')
    expect(measurementUnit('en')).toBe('in')
    expect(measurementUnit('en-GB')).toBe('cm')
    expect(measurementUnit('es-ES')).toBe('cm')
    expect(measurementUnit('es')).toBe('cm')
    expect(measurementUnit(undefined)).toBe('in')
  })

  it('reads lengths in the dialog unit or with their own, as Word does', () => {
    expect(parseLength('1', 'in')).toBe(72)
    expect(parseLength('0,5', 'in')).toBe(36)
    expect(parseLength('2.54 cm', 'in')).toBe(72)
    expect(parseLength('1"', 'cm')).toBe(72)
    expect(parseLength('36 pt', 'in')).toBe(36)
    expect(parseLength('25.4 mm', 'in')).toBe(72)
    expect(parseLength('-0.25', 'in')).toBe(-18)
    expect(parseLength('wide', 'in')).toBeNull()
    expect(parseLength('', 'in')).toBeNull()
    expect(pointsTo(72, 'cm')).toBe(2.54)
  })

  it('names paper sizes either way round and margin presets', () => {
    expect(paperSizeOf(612, 792)?.id).toBe('letter')
    expect(paperSizeOf(841.9, 595.3)?.id).toBe('a4')
    expect(paperSizeOf(600, 800)).toBeUndefined()
    expect(marginPresetOf({ top: 36, bottom: 36, left: 36, right: 36 })).toBe('narrow')
    expect(marginPresetOf({ ...MARGIN_PRESETS.wide })).toBe('wide')
    expect(marginPresetOf({ top: 72, bottom: 72, left: 72, right: 70 })).toBeUndefined()
  })

  it('reads margins, naming the first side that is not a length of 0 or more', () => {
    expect(parseMargins({ top: '1', bottom: '1', left: '0.5', right: '2.54 cm' }, 'in')).toEqual({ margins: { top: 72, bottom: 72, left: 36, right: 72 } })
    expect(parseMargins({ top: '1', bottom: '-1', left: 'x', right: '1' }, 'in')).toEqual({ side: 'bottom' })
  })
})
