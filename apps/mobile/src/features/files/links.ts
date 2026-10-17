import { create } from 'zustand'

export type FilesLink =
  | { type: 'folder'; id: string | null }
  /** Any file, as the web's `/files/d/` route: a document, or an uploaded file. */
  | { type: 'file'; id: string }
  | { type: 'trash' }

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

/**
 * A Files link: `pulpo://files[/f/<folder>|/d/<file>|/trash]`, or the same path on the signed-in
 * instance's own web address (as the web app links them). Navigation only; nothing else is read.
 */
export function parseFilesLink(value: string, instanceUrl: string): FilesLink | null {
  try {
    const url = new URL(value)
    let path: string
    if (url.protocol === 'pulpo:') {
      if (url.hostname !== 'files' || url.username || url.password || url.port) return null
      path = url.pathname
    } else if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (url.origin !== new URL(instanceUrl).origin || !url.pathname.startsWith('/files')) return null
      path = url.pathname.slice('/files'.length)
    } else return null
    const parts = path.split('/').filter(Boolean)
    if (!parts.length) return { type: 'folder', id: null }
    if (parts.length === 1 && parts[0] === 'trash') return { type: 'trash' }
    if (parts.length === 2 && uuid.test(parts[1]!)) {
      if (parts[0] === 'f') return { type: 'folder', id: parts[1]!.toLowerCase() }
      if (parts[0] === 'd') return { type: 'file', id: parts[1]!.toLowerCase() }
    }
    return null
  } catch {
    return null
  }
}

/** The latest Files link to open, kept through sign-in and app start until the app handles it. */
export const useFilesLinkInbox = create<{ pending: string | null; receive: (url: string) => void; take: () => string | null }>((set, get) => ({
  pending: null,
  receive: (url) => {
    if (/^pulpo:\/\/files\b|\/files(\/|$)/.test(url)) set({ pending: url })
  },
  take: () => {
    const pending = get().pending
    set({ pending: null })
    return pending
  },
}))

export function listenForFilesLinks(linking: {
  addEventListener: (type: 'url', callback: (event: { url: string }) => void) => { remove: () => void }
  getInitialURL: () => Promise<string | null>
}): () => void {
  let active = true
  const listener = linking.addEventListener('url', ({ url }) => { if (active) useFilesLinkInbox.getState().receive(url) })
  void linking.getInitialURL().then((url) => { if (url && active) useFilesLinkInbox.getState().receive(url) }).catch(() => undefined)
  return () => { active = false; listener.remove() }
}

/**
 * Opens a link tapped in the app's own content (a reply, a document) in the app when it is a Files
 * link on this instance, written in full or as a path (as agents write them). Returns whether it did.
 */
export function openFilesLinkInApp(href: string, instanceUrl: string): boolean {
  let url = href
  if (href.startsWith('/') && !href.startsWith('//')) {
    try {
      url = new URL(href, instanceUrl).href
    } catch {
      return false
    }
  }
  if (!parseFilesLink(url, instanceUrl)) return false
  useFilesLinkInbox.getState().receive(url)
  return true
}
