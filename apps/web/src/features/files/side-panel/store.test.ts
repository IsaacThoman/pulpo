import { describe, expect, it } from 'vitest'
import { clampPanelWidth, parseSideParam, sideParamValue } from './store'

describe('side panel state', () => {
  it('round-trips the URL parameter and rejects anything else', () => {
    const id = '0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
    expect(parseSideParam(sideParamValue(id))).toBe(id)
    expect(parseSideParam('file:not-an-id')).toBeNull()
    expect(parseSideParam('chat:0b4f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBeNull()
    expect(parseSideParam(null)).toBeNull()
  })

  it('keeps the panel between its minimum and 70% of the window', () => {
    expect(clampPanelWidth(100, 1600)).toBe(360)
    expect(clampPanelWidth(2000, 1600)).toBe(1120)
    expect(clampPanelWidth(600, 1600)).toBe(600)
    expect(clampPanelWidth(600, 400)).toBe(360)
  })
})
