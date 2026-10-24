import { create } from 'zustand'
import { getValue, setValue } from '../../data/database'

const KEY = 'sidebar:expanded'

/**
 * Which drawer folders are open: folder ids, and `shortcut:<id>` for shortcuts to folders. Kept
 * per account on this device, as the web keeps them per browser; folders start closed.
 */
export const useSidebarExpansion = create<{
  namespace: string
  expanded: ReadonlySet<string>
  /** Switches to an account's folders, once loaded from the device. */
  load: (namespace: string) => void
  setExpanded: (key: string, expanded: boolean) => void
}>((set, get) => ({
  namespace: '',
  expanded: new Set(),
  load: (namespace) => {
    if (get().namespace === namespace) return
    set({ namespace, expanded: new Set() })
    if (!namespace) return
    void getValue<string[]>(namespace, KEY).then((keys) => {
      if (get().namespace !== namespace || !Array.isArray(keys)) return
      // Folders opened meanwhile stay open (and are kept with the others).
      const opened = get().expanded
      const expanded = new Set([...keys.filter((key) => typeof key === 'string'), ...opened])
      set({ expanded })
      if (opened.size) void setValue(namespace, KEY, [...expanded]).catch(() => undefined)
    }).catch(() => undefined)
  },
  setExpanded: (key, expanded) => {
    const { namespace, expanded: current } = get()
    if (current.has(key) === expanded) return
    const next = new Set(current)
    if (expanded) next.add(key)
    else next.delete(key)
    set({ expanded: next })
    if (namespace) void setValue(namespace, KEY, [...next]).catch(() => undefined)
  },
}))
