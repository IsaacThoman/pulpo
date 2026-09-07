import { create } from 'zustand'
import { listenForNativeShortcutLinks } from './native'
import { parseShortcutURL, type ShortcutDestination } from './links'

interface ShortcutInbox {
  pending: ShortcutDestination[]
  receive: (url: string) => void
  acknowledge: (requestId: string) => void
}
const handled = new Set<string>()
/** Keep foreground links through sign-in; never persist account-bound requests. */
export const useShortcutInbox = create<ShortcutInbox>((set) => ({
  pending: [],
  receive: (url) => {
    const destination = parseShortcutURL(url)
    if (!destination || handled.has(destination.requestId)) return
    set((state) => state.pending.some((item) => item.requestId === destination.requestId)
      ? state : { pending: [...state.pending, destination].slice(-16) })
  },
  acknowledge: (requestId) => {
    handled.add(requestId)
    if (handled.size > 100) handled.delete(handled.values().next().value!)
    set((state) => ({ pending: state.pending.filter((item) => item.requestId !== requestId) }))
  },
}))

export function listenForShortcutLinks(linking: {
  addEventListener: (type: 'url', callback: (event: { url: string }) => void) => { remove: () => void }
  getInitialURL: () => Promise<string | null>
}): () => void {
  let active = true
  let receivedWarmLink = false
  const receive = (url: string) => { if (active) useShortcutInbox.getState().receive(url) }
  const listener = linking.addEventListener('url', ({ url }) => { receivedWarmLink = true; receive(url) })
  const stopNative = listenForNativeShortcutLinks((url) => { receivedWarmLink = true; receive(url) })
  void linking.getInitialURL().then((url) => { if (url && !receivedWarmLink) receive(url) }).catch(() => undefined)
  return () => { active = false; listener.remove(); stopNative() }
}
