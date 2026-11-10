import { describe, expect, it } from 'vitest'
import {
  canCloseTab,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  createTab,
  cycleTab,
  duplicateTab,
  followLocation,
  initialTabs,
  keepOneTab,
  locationNodeId,
  MAX_TABS,
  moveTab,
  openTab,
  reopenClosed,
  ROOT_LOCATION,
  setPinned,
  tabForDigit,
  updateSnapshots,
  type FilesLocation,
  type FilesTabsData,
} from './model'

const folder = (id: string | null): FilesLocation => ({ kind: 'folder', id })
const file = (id: string): FilesLocation => ({ kind: 'file', id })

/** Tabs named by their ids, each showing the folder of the same name; the first is active unless given. */
function tabs(ids: string[], active = ids[0]!, pinned: string[] = []): FilesTabsData {
  return {
    tabs: ids.map((id) => createTab(folder(id), { id, pinned: pinned.includes(id) })),
    activeId: active,
    closed: [],
  }
}

const order = (data: FilesTabsData) => data.tabs.map((tab) => tab.id)

describe('opening tabs', () => {
  it('starts with one tab at the given place', () => {
    const data = initialTabs(file('doc'))
    expect(data.tabs).toHaveLength(1)
    expect(data.tabs[0]!.location).toEqual(file('doc'))
    expect(data.activeId).toBe(data.tabs[0]!.id)
  })

  it('puts a new tab last and shows it', () => {
    const { data, tab } = openTab(tabs(['a', 'b'], 'a'), ROOT_LOCATION, { index: 'end' })
    expect(order(data)).toEqual(['a', 'b', tab.id])
    expect(data.activeId).toBe(tab.id)
  })

  it('lines up background tabs after the tab they were opened from, in order', () => {
    let data = tabs(['a', 'b', 'c'], 'a')
    const first = openTab(data, folder('x'), { activate: false, fromActive: true })
    data = first.data
    const second = openTab(data, folder('y'), { activate: false, fromActive: true })
    data = second.data
    expect(order(data)).toEqual(['a', first.tab.id, second.tab.id, 'b', 'c'])
    expect(data.activeId).toBe('a')
  })

  it('never puts an unpinned tab among the pinned ones', () => {
    const { data, tab } = openTab(tabs(['p', 'a'], 'a', ['p']), ROOT_LOCATION, { index: 0 })
    expect(order(data)).toEqual(['p', tab.id, 'a'])
  })
})

describe('closing tabs', () => {
  it('shows the tab to the right of the closed active tab, else the one to its left', () => {
    expect(closeTab(tabs(['a', 'b', 'c'], 'b'), 'b').activeId).toBe('c')
    expect(closeTab(tabs(['a', 'b', 'c'], 'c'), 'c').activeId).toBe('b')
  })

  it('keeps the active tab when another closes', () => {
    const data = closeTab(tabs(['a', 'b', 'c'], 'a'), 'c')
    expect(order(data)).toEqual(['a', 'b'])
    expect(data.activeId).toBe('a')
  })

  it('keeps one tab in the main view, going back to My files after the last closes', () => {
    const data = keepOneTab(closeTab(tabs(['a']), 'a'))
    expect(data.tabs.map((tab) => tab.location)).toEqual([ROOT_LOCATION])
    expect(data.activeId).toBe(data.tabs[0]!.id)
    // What was closed can still be reopened, where it was.
    expect(data.closed).toHaveLength(1)
    expect(reopenClosed(data).tabs.map((tab) => tab.id)).toEqual(['a', data.tabs[0]!.id])
    // With tabs left, nothing changes.
    const some = tabs(['a', 'b'])
    expect(keepOneTab(some)).toBe(some)
  })

  it('starts again with a tab when Files shows after every tab closed', () => {
    const data = closeTab(tabs(['a']), 'a')
    const back = followLocation(data, ROOT_LOCATION, 'enter')
    expect(back.tabs.map((tab) => tab.location)).toEqual([ROOT_LOCATION])
    expect(back.activeId).toBe(back.tabs[0]!.id)
    expect(reopenClosed(back).tabs.map((tab) => tab.id)).toEqual(['a', back.tabs[0]!.id])
  })

  it('can leave no tab, as the side panel does, and reopen from there', () => {
    const data = closeTab(tabs(['a']), 'a')
    expect(data.tabs).toEqual([])
    expect(data.activeId).toBe('')
    expect(data.closed).toHaveLength(1)
    const reopened = reopenClosed(data)
    expect(order(reopened)).toEqual(['a'])
    expect(reopened.activeId).toBe('a')
    const opened = openTab(data, folder('b'))
    expect(opened.data.tabs).toEqual([opened.tab])
    expect(opened.data.activeId).toBe(opened.tab.id)
  })

  it('closes other tabs but keeps pinned ones, showing the one kept', () => {
    const data = closeOtherTabs(tabs(['p', 'a', 'b', 'c'], 'a', ['p']), 'b')
    expect(order(data)).toEqual(['p', 'b'])
    expect(data.activeId).toBe('b')
    expect(data.closed.at(-1)!.tabs.map(({ tab }) => tab.id)).toEqual(['a', 'c'])
  })

  it('closes the tabs to the right, showing the tab kept when the active one went', () => {
    const data = closeTabsToRight(tabs(['a', 'b', 'c', 'd'], 'd'), 'b')
    expect(order(data)).toEqual(['a', 'b'])
    expect(data.activeId).toBe('b')
  })

  it('reopens closed tabs together, where they were, showing the last', () => {
    let data = closeOtherTabs(tabs(['a', 'b', 'c', 'd'], 'a'), 'c')
    expect(order(data)).toEqual(['c'])
    data = reopenClosed(data)
    expect(order(data)).toEqual(['a', 'b', 'c', 'd'])
    expect(data.activeId).toBe('d')
    expect(data.closed).toHaveLength(0)
  })

  it('reopens a chosen closed group, not only the last', () => {
    let data = closeTab(tabs(['a', 'b', 'c'], 'a'), 'b')
    data = closeTab(data, 'c')
    data = reopenClosed(data, 0)
    expect(order(data)).toEqual(['a', 'b'])
    expect(data.closed.map((entry) => entry.tabs[0]!.tab.id)).toEqual(['c'])
  })

  it('does nothing when there is nothing to reopen', () => {
    const data = tabs(['a'])
    expect(reopenClosed(data)).toBe(data)
  })
})

describe('moving and pinning tabs', () => {
  it('moves a tab, within its group', () => {
    expect(order(moveTab(tabs(['a', 'b', 'c']), 'a', 2))).toEqual(['b', 'c', 'a'])
    expect(order(moveTab(tabs(['p', 'q', 'a', 'b'], 'a', ['p', 'q']), 'b', 0))).toEqual(['p', 'q', 'b', 'a'])
    expect(order(moveTab(tabs(['p', 'q', 'a'], 'a', ['p', 'q']), 'p', 5))).toEqual(['q', 'p', 'a'])
  })

  it('pins a tab after the pinned tabs and unpins it before the rest', () => {
    const pinned = setPinned(tabs(['p', 'a', 'b'], 'a', ['p']), 'b', true)
    expect(order(pinned)).toEqual(['p', 'b', 'a'])
    expect(pinned.tabs[1]!.pinned).toBe(true)
    const unpinned = setPinned(pinned, 'p', false)
    expect(order(unpinned)).toEqual(['b', 'p', 'a'])
  })

  it('duplicates a tab right after it and shows the copy', () => {
    const data = duplicateTab(tabs(['a', 'b'], 'b'), 'a')
    expect(data.tabs).toHaveLength(3)
    expect(data.tabs[1]!.location).toEqual(folder('a'))
    expect(data.activeId).toBe(data.tabs[1]!.id)
  })
})

describe('following the main view', () => {
  it('navigates the active tab', () => {
    const data = followLocation(tabs(['a', 'b'], 'b'), folder('x'), 'push')
    expect(data.tabs.map((tab) => tab.location.id)).toEqual(['a', 'x'])
    expect(data.activeId).toBe('b')
  })

  it('shows the tab a history entry was made for', () => {
    const data = followLocation(tabs(['a', 'b'], 'b'), folder('a'), 'pop', 'a')
    expect(data.activeId).toBe('a')
  })

  it('moves the hinted tab to the location it is going back to', () => {
    const data = followLocation(tabs(['a', 'b'], 'b'), folder('earlier'), 'pop', 'a')
    expect(data.activeId).toBe('a')
    expect(data.tabs[0]!.location).toEqual(folder('earlier'))
  })

  it('shows a tab already at the location when coming back to Files, or going back', () => {
    expect(followLocation(tabs(['a', 'b'], 'b'), folder('a'), 'enter').activeId).toBe('a')
    expect(followLocation(tabs(['a', 'b'], 'b'), folder('a'), 'pop').activeId).toBe('a')
  })

  it('does not jump to another tab on a plain navigation', () => {
    const data = followLocation(tabs(['a', 'b'], 'b'), folder('a'), 'push')
    expect(data.activeId).toBe('b')
    expect(data.tabs[1]!.location).toEqual(folder('a'))
  })

  it('ignores a hint for a tab that was closed', () => {
    const data = followLocation(tabs(['a', 'b'], 'b'), folder('x'), 'pop', 'gone')
    expect(data.tabs.map((tab) => tab.location.id)).toEqual(['a', 'x'])
  })

  it('changes nothing when the active tab is already there', () => {
    const data = tabs(['a', 'b'], 'b')
    expect(followLocation(data, folder('b'), 'push')).toBe(data)
  })
})

describe('switching tabs', () => {
  it('cycles with wrap-around', () => {
    const data = tabs(['a', 'b', 'c'], 'c')
    expect(cycleTab(data, 1)!.id).toBe('a')
    expect(cycleTab(data, -1)!.id).toBe('b')
  })

  it('picks tabs 1–8 by number and the last with 9', () => {
    const data = tabs(['a', 'b', 'c'])
    expect(tabForDigit(data, 2)!.id).toBe('b')
    expect(tabForDigit(data, 9)!.id).toBe('c')
    expect(tabForDigit(data, 5)).toBeUndefined()
  })
})

describe('tab snapshots', () => {
  it('names the stored item a location shows', () => {
    expect(locationNodeId(ROOT_LOCATION)).toBeNull()
    expect(locationNodeId(folder('trash'))).toBeNull()
    expect(locationNodeId(folder('trash:abc'))).toBe('abc')
    expect(locationNodeId(file('doc'))).toBe('doc')
    expect(locationNodeId({ kind: 'attachment', id: 'photo' })).toBe('photo')
  })

  it('records changed looks and leaves unchanged data alone', () => {
    const data = tabs(['a', 'b'])
    const changed = updateSnapshots(data, new Map([['a', { kind: 'folder' as const, name: 'Projects', mimeType: null, color: 'blue' as const }]]))
    expect(changed.tabs[0]!.snapshot).toEqual({ kind: 'folder', name: 'Projects', mimeType: null, color: 'blue' })
    expect(updateSnapshots(changed, new Map([['a', { kind: 'folder' as const, name: 'Projects', mimeType: null, color: 'blue' as const }]]))).toBe(changed)
  })
})

describe('the tab limit', () => {
  const full = (active = 'tab-99') => tabs(Array.from({ length: MAX_TABS }, (_, index) => `tab-${index}`), active, ['tab-0'])

  it('closes the leftmost unpinned tab that is not showing to make room, so it can be reopened', () => {
    const { data, tab } = openTab(full(), ROOT_LOCATION, { index: 'end' })
    expect(data.tabs).toHaveLength(MAX_TABS)
    expect(data.tabs.some((candidate) => candidate.id === 'tab-1')).toBe(false)
    expect(data.closed.at(-1)!.tabs[0]!.tab.id).toBe('tab-1')
    expect(data.activeId).toBe(tab.id)
  })

  it('never drops the tab being viewed, or the tabs it reopens', () => {
    let data = closeTab(full('tab-50'), 'tab-98')
    data = openTab(data, ROOT_LOCATION, { index: 'end' }).data
    const viewing = data.activeId
    data = reopenClosed(data)
    expect(data.tabs).toHaveLength(MAX_TABS)
    expect(data.tabs.some((tab) => tab.id === viewing)).toBe(true)
    expect(data.activeId).toBe('tab-98')
  })

  it('closes a pinned tab when every other tab is pinned, keeping within the limit', () => {
    const ids = Array.from({ length: MAX_TABS }, (_, index) => `tab-${index}`)
    // Every tab pinned, or every tab but the one showing.
    for (const pinned of [ids, ids.slice(0, -1)]) {
      const { data, tab } = openTab(tabs(ids, 'tab-99', pinned), ROOT_LOCATION, { index: 'end' })
      expect(data.tabs).toHaveLength(MAX_TABS)
      expect(data.tabs.some((candidate) => candidate.id === 'tab-0')).toBe(false)
      expect(data.closed.at(-1)!.tabs[0]!.tab.id).toBe('tab-0')
      expect(data.tabs.some((candidate) => candidate.id === 'tab-99')).toBe(true)
      expect(data.activeId).toBe(tab.id)
    }
  })

  it('puts a duplicate right after its source at the limit', () => {
    const data = duplicateTab(full('tab-50'), 'tab-50')
    const index = data.tabs.findIndex((tab) => tab.id === 'tab-50')
    expect(data.tabs[index + 1]!.location).toEqual(folder('tab-50'))
    expect(data.tabs).toHaveLength(MAX_TABS)
  })
})

describe('closing what can be closed', () => {
  it('can close any tab, a lone My files tab too', () => {
    const lone = initialTabs()
    expect(canCloseTab(lone, lone.activeId)).toBe(true)
    expect(canCloseTab(tabs(['a', 'b']), 'missing')).toBe(false)
  })

  it('has nothing to close in a lone My files tab where one tab always stays', () => {
    const lone = initialTabs()
    expect(canCloseTab(lone, lone.activeId, true)).toBe(false)
    // Another lone tab goes back to My files, and a pinned My files tab comes unpinned.
    expect(canCloseTab(tabs(['a']), 'a', true)).toBe(true)
    expect(canCloseTab(setPinned(lone, lone.activeId, true), lone.activeId, true)).toBe(true)
    expect(canCloseTab(tabs(['a', 'b']), 'missing', true)).toBe(false)
  })
})
