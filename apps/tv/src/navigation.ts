import { create } from 'zustand'

export type Route =
  | { name: 'home' }
  | { name: 'chat'; chatId: string }
  | { name: 'library' }
  | { name: 'settings' }

export type Overlay =
  | { name: 'models'; selectedId: string | null; onSelect: (modelId: string) => void }
  | { name: 'actions'; title?: string; actions: SheetAction[] }

export interface SheetAction {
  key: string
  label: string
  icon: import('expo-symbols').SFSymbol
  destructive?: boolean
  run: () => void
}

interface NavigationState {
  stack: Route[]
  overlay: Overlay | null
  push: (route: Route) => void
  /** Replace the top route, e.g. a new chat that has just been created. */
  replace: (route: Route) => void
  pop: () => boolean
  reset: () => void
  present: (overlay: Overlay) => void
  dismiss: () => void
}

export const useNavigation = create<NavigationState>((set, get) => ({
  stack: [{ name: 'home' }],
  overlay: null,
  push: (route) => set((state) => ({ stack: [...state.stack, route] })),
  replace: (route) => set((state) => ({ stack: [...state.stack.slice(0, -1), route] })),
  pop: () => {
    const { overlay, stack } = get()
    if (overlay) { set({ overlay: null }); return true }
    if (stack.length <= 1) return false
    set({ stack: stack.slice(0, -1) })
    return true
  },
  reset: () => set({ stack: [{ name: 'home' }], overlay: null }),
  present: (overlay) => set({ overlay }),
  dismiss: () => set({ overlay: null }),
}))

/** The Menu button should leave the app only from the root screen. */
export function canGoBack(state: Pick<NavigationState, 'stack' | 'overlay'>): boolean {
  return state.overlay !== null || state.stack.length > 1
}
