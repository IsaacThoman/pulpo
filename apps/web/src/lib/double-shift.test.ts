import { describe, expect, it } from 'vitest'
import { DOUBLE_SHIFT_INTERVAL_MS, handleDoubleShiftKeyDown, type DoubleShiftState } from './double-shift'

const keyEvent = (key: string, repeat = false) => ({ key, repeat })

describe('double Shift shortcut', () => {
  it('matches two distinct Shift presses inside the interval', () => {
    const state: DoubleShiftState = { lastPressAt: null }

    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 100)).toBe(false)
    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 100 + DOUBLE_SHIFT_INTERVAL_MS)).toBe(true)
    expect(state.lastPressAt).toBeNull()
  })

  it('starts a new sequence when the presses are too far apart', () => {
    const state: DoubleShiftState = { lastPressAt: null }

    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 100)).toBe(false)
    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 101 + DOUBLE_SHIFT_INTERVAL_MS)).toBe(false)
    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 150 + DOUBLE_SHIFT_INTERVAL_MS)).toBe(true)
  })

  it('ignores key repeat and cancels when another key is pressed', () => {
    const state: DoubleShiftState = { lastPressAt: null }

    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 100)).toBe(false)
    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift', true), 120)).toBe(false)
    expect(handleDoubleShiftKeyDown(state, keyEvent('A'), 140)).toBe(false)
    expect(handleDoubleShiftKeyDown(state, keyEvent('Shift'), 160)).toBe(false)
  })
})
