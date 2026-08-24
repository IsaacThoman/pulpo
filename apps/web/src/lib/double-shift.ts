export const DOUBLE_SHIFT_INTERVAL_MS = 500

export type DoubleShiftState = {
  lastPressAt: number | null
}

type ShiftKeyEvent = Pick<KeyboardEvent, 'key' | 'repeat'>

export function handleDoubleShiftKeyDown(
  state: DoubleShiftState,
  event: ShiftKeyEvent,
  now: number,
): boolean {
  if (event.repeat) return false

  if (event.key !== 'Shift') {
    state.lastPressAt = null
    return false
  }

  const elapsed = state.lastPressAt === null ? null : now - state.lastPressAt
  if (elapsed !== null && elapsed >= 0 && elapsed <= DOUBLE_SHIFT_INTERVAL_MS) {
    state.lastPressAt = null
    return true
  }

  state.lastPressAt = now
  return false
}
