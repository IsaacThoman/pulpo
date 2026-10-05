/**
 * File-manager selection: plain click selects one item, toggle (Cmd/Ctrl) adds or removes one,
 * range (Shift) selects from the anchor. `focus` is the keyboard cursor.
 */
export interface FileSelection {
  ids: ReadonlySet<string>
  anchor: string | null
  focus: string | null
}

export const EMPTY_SELECTION: FileSelection = { ids: new Set(), anchor: null, focus: null }

export function selectOnly(id: string): FileSelection {
  return { ids: new Set([id]), anchor: id, focus: id }
}

function range(order: readonly string[], from: string, to: string): string[] {
  const start = order.indexOf(from)
  const end = order.indexOf(to)
  if (start < 0 || end < 0) return [to]
  return order.slice(Math.min(start, end), Math.max(start, end) + 1)
}

export function clickSelect(
  state: FileSelection,
  order: readonly string[],
  id: string,
  modifiers: { toggle: boolean; range: boolean },
): FileSelection {
  if (modifiers.range && state.anchor && order.includes(state.anchor)) {
    const spanned = range(order, state.anchor, id)
    const ids = modifiers.toggle ? new Set([...state.ids, ...spanned]) : new Set(spanned)
    return { ids, anchor: state.anchor, focus: id }
  }
  if (modifiers.toggle) {
    const ids = new Set(state.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids, anchor: id, focus: id }
  }
  return selectOnly(id)
}

/** Keyboard movement to `id`; with `extend` (Shift) the selection spans from the anchor. */
export function stepSelect(state: FileSelection, order: readonly string[], id: string, extend: boolean): FileSelection {
  if (!extend) return selectOnly(id)
  const anchor = state.anchor && order.includes(state.anchor) ? state.anchor : id
  return { ids: new Set(range(order, anchor, id)), anchor, focus: id }
}

export function selectAll(order: readonly string[]): FileSelection {
  return order.length ? { ids: new Set(order), anchor: order[0]!, focus: order.at(-1)! } : EMPTY_SELECTION
}

/** Drops ids that are no longer listed, e.g. after another device moved them away. */
export function pruneSelection(state: FileSelection, order: readonly string[]): FileSelection {
  const listed = new Set(order)
  if ([...state.ids].every((id) => listed.has(id)) && (!state.focus || listed.has(state.focus))) return state
  return {
    ids: new Set([...state.ids].filter((id) => listed.has(id))),
    anchor: state.anchor && listed.has(state.anchor) ? state.anchor : null,
    focus: state.focus && listed.has(state.focus) ? state.focus : null,
  }
}

export type NavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/** Where the keyboard cursor lands; `columns` is 1 in list view and the row width in grid view. */
export function navigateIndex(current: number, count: number, key: NavigationKey, columns: number): number {
  if (!count) return -1
  if (current < 0) return key === 'End' || key === 'ArrowUp' || key === 'ArrowLeft' ? count - 1 : 0
  const step = { ArrowUp: -columns, ArrowDown: columns, ArrowLeft: columns > 1 ? -1 : 0, ArrowRight: columns > 1 ? 1 : 0, Home: -count, End: count }[key]
  return Math.min(count - 1, Math.max(0, current + step))
}

/**
 * Type-to-select: the first name after the cursor that starts with the typed prefix, wrapping
 * around. Repeating one letter cycles through the names that start with it.
 */
export function typeaheadIndex(names: readonly string[], query: string, current: number): number {
  const needle = query.toLocaleLowerCase()
  const cycling = needle.length > 1 && [...needle].every((character) => character === needle[0])
  const prefix = cycling ? needle[0]! : needle
  const start = cycling || needle.length === 1 ? current + 1 : Math.max(current, 0)
  for (let offset = 0; offset < names.length; offset += 1) {
    const index = (start + offset) % names.length
    if (names[index]!.toLocaleLowerCase().startsWith(prefix)) return index
  }
  return -1
}
