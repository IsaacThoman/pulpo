import { create } from 'zustand'

/** URL search parameter that mirrors the side panel, e.g. `?side=file:<id>`. */
export const SIDE_PANEL_PARAM = 'side'
export const SIDE_PANEL_MIN_WIDTH = 360
const WIDTH_STORAGE_KEY = 'pulpo.sidePanel.width'
const DEFAULT_WIDTH = 520

/**
 * What the side panel shows. A chat without an id is a new chat; its folders are the Files
 * folders (or `root` for all files) the agent may use once the first message creates it.
 */
export type PanelContent =
  | { kind: 'file'; id: string }
  | { kind: 'chat'; id: string }
  | { kind: 'chat'; id: null; folderIds: string[] }

interface SidePanelState {
  content: PanelContent | null
  /** The last thing shown, so the panel can be reopened after closing it. */
  lastContent: PanelContent | null
  /** Temporarily fill the content area; the main view stays mounted underneath. */
  maximized: boolean
  open: (content: PanelContent) => void
  close: () => void
  toggle: () => void
  setMaximized: (maximized: boolean) => void
}

export const useSidePanel = create<SidePanelState>()((set, get) => ({
  content: null,
  lastContent: null,
  maximized: false,
  open: (content) => set({ content, lastContent: content }),
  close: () => set({ content: null, maximized: false }),
  toggle: () => {
    const { content, lastContent } = get()
    if (content) set({ content: null, maximized: false })
    else if (lastContent) set({ content: lastContent })
  },
  setMaximized: (maximized) => set({ maximized: maximized && get().content !== null }),
}))

export function samePanelContent(left: PanelContent | null, right: PanelContent | null): boolean {
  return serializePanelContent(left) === serializePanelContent(right)
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function serializePanelContent(content: PanelContent | null): string | null {
  if (!content) return null
  if (content.kind === 'file') return `file:${content.id}`
  if (content.id !== null) return `chat:${content.id}`
  return content.folderIds.length ? `chat:new:${content.folderIds.join(',')}` : 'chat:new'
}

export function parsePanelContent(value: string | null): PanelContent | null {
  if (!value) return null
  const lower = value.toLowerCase()
  const file = new RegExp(`^file:(${UUID})$`).exec(lower)
  if (file) return { kind: 'file', id: file[1]! }
  const chat = new RegExp(`^chat:(${UUID})$`).exec(lower)
  if (chat) return { kind: 'chat', id: chat[1]! }
  const scope = `(?:root|${UUID})`
  const fresh = new RegExp(`^chat:new(?::(${scope}(?:,${scope})*))?$`).exec(lower)
  if (fresh) {
    const ids = fresh[1] ? [...new Set(fresh[1].split(','))] : []
    return { kind: 'chat', id: null, folderIds: ids.includes('root') ? ['root'] : ids }
  }
  return null
}

/** Keeps the main view usable: the panel takes at most 70% of the window. */
export function clampPanelWidth(width: number, viewport: number): number {
  return Math.round(Math.min(Math.max(width, SIDE_PANEL_MIN_WIDTH), Math.max(SIDE_PANEL_MIN_WIDTH, viewport * 0.7)))
}

export function readPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) return saved
  } catch { /* the preference is optional */ }
  return DEFAULT_WIDTH
}

export function writePanelWidth(width: number): void {
  try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width))) } catch { /* the preference is optional */ }
}
