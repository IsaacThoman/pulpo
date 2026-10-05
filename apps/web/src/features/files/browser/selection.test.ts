import { describe, expect, it } from 'vitest'
import { clickSelect, EMPTY_SELECTION, navigateIndex, pruneSelection, selectAll, selectOnly, stepSelect, typeaheadIndex } from './selection'

const order = ['a', 'b', 'c', 'd', 'e']
const ids = (state: { ids: ReadonlySet<string> }) => [...state.ids].sort()

describe('file selection', () => {
  it('selects one item on a plain click and toggles with Cmd/Ctrl', () => {
    let state = clickSelect(EMPTY_SELECTION, order, 'b', { toggle: false, range: false })
    expect(ids(state)).toEqual(['b'])
    state = clickSelect(state, order, 'd', { toggle: true, range: false })
    expect(ids(state)).toEqual(['b', 'd'])
    state = clickSelect(state, order, 'b', { toggle: true, range: false })
    expect(ids(state)).toEqual(['d'])
  })

  it('selects a range from the anchor with Shift, adding to it with Cmd+Shift', () => {
    let state = selectOnly('b')
    state = clickSelect(state, order, 'd', { toggle: false, range: true })
    expect(ids(state)).toEqual(['b', 'c', 'd'])
    expect(state.anchor).toBe('b')
    state = clickSelect(state, order, 'a', { toggle: false, range: true })
    expect(ids(state)).toEqual(['a', 'b'])
    state = clickSelect(selectOnly('e'), order, 'e', { toggle: true, range: false })
    expect(ids(clickSelect({ ...selectOnly('a'), ids: new Set(['a', 'e']) }, order, 'c', { toggle: true, range: true }))).toEqual(['a', 'b', 'c', 'e'])
  })

  it('extends with Shift+arrows from the anchor and selects everything with Cmd+A', () => {
    const state = stepSelect(selectOnly('c'), order, 'e', true)
    expect(ids(state)).toEqual(['c', 'd', 'e'])
    expect(ids(stepSelect(state, order, 'b', true))).toEqual(['b', 'c'])
    expect(ids(selectAll(order))).toEqual(order)
  })

  it('drops items that disappear from the folder', () => {
    const state = pruneSelection({ ids: new Set(['a', 'z']), anchor: 'z', focus: 'a' }, order)
    expect(ids(state)).toEqual(['a'])
    expect(state.anchor).toBeNull()
  })

  it('moves the cursor by rows in grid view and clamps at the edges', () => {
    expect(navigateIndex(1, 10, 'ArrowDown', 4)).toBe(5)
    expect(navigateIndex(1, 10, 'ArrowUp', 4)).toBe(0)
    expect(navigateIndex(9, 10, 'ArrowRight', 4)).toBe(9)
    expect(navigateIndex(3, 10, 'ArrowLeft', 1)).toBe(3)
    expect(navigateIndex(-1, 10, 'ArrowDown', 1)).toBe(0)
    expect(navigateIndex(4, 10, 'End', 1)).toBe(9)
  })

  it('jumps to names by typed prefix and cycles on repeated letters', () => {
    const names = ['Apple', 'banana', 'Blueberry', 'cherry']
    expect(typeaheadIndex(names, 'bl', -1)).toBe(2)
    expect(typeaheadIndex(names, 'b', -1)).toBe(1)
    expect(typeaheadIndex(names, 'bb', 1)).toBe(2)
    expect(typeaheadIndex(names, 'bbb', 2)).toBe(1)
    expect(typeaheadIndex(names, 'z', 0)).toBe(-1)
  })
})
