import { create } from 'zustand'

/** URL search parameter that mirrors the side panel, e.g. `?side=file:<id>`. */
export const SIDE_PANEL_PARAM = 'side'
export const SIDE_PANEL_MIN_WIDTH = 320
/** The main view never gets narrower than this beside the panel. */
export const MAIN_VIEW_MIN_WIDTH = 360
const WIDTH_STORAGE_KEY = 'pulpo.sidePanel.width'
export const DEFAULT_PANEL_WIDTH = 520

/**
 * What the side panel shows: a file, a folder of the Files browser (`null` is My files), or a
 * chat attachment. Chats always live in the main view; the panel holds what they work on.
 */
export type PanelContent =
  | { kind: 'file'; id: string }
  | { kind: 'folder'; id: string | null }
  | { kind: 'attachment'; id: string }

interface SidePanelState {
  content: PanelContent | null
  /** The last thing shown, so the panel can be reopened after closing it. */
  lastContent: PanelContent | null
  open: (content: PanelContent) => void
  close: () => void
  toggle: () => void
  /**
   * Whether the panel fits beside the main view. When it does not, the panel is not shown (it is
   * never laid over the main view) and things opened "to the side" open in the main view instead.
   */
  splitAvailable: boolean
  /** Whether this screen has a side panel at all; admin chat views do not. */
  enabled: boolean
}

export const useSidePanel = create<SidePanelState>()((set, get) => ({
  content: null,
  lastContent: null,
  splitAvailable: true,
  enabled: true,
  open: (content) => set({ content, lastContent: content }),
  close: () => set({ content: null }),
  toggle: () => {
    const { content, lastContent } = get()
    if (content) set({ content: null })
    else if (lastContent) set({ content: lastContent })
  },
}))

export function samePanelContent(left: PanelContent | null, right: PanelContent | null): boolean {
  return serializePanelContent(left) === serializePanelContent(right)
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function serializePanelContent(content: PanelContent | null): string | null {
  if (!content) return null
  if (content.kind === 'file') return `file:${content.id}`
  if (content.kind === 'attachment') return `attachment:${content.id}`
  return `folder:${content.id ?? 'root'}`
}

export function parsePanelContent(value: string | null): PanelContent | null {
  if (!value) return null
  const lower = value.toLowerCase()
  const file = new RegExp(`^file:(${UUID})$`).exec(lower)
  if (file) return { kind: 'file', id: file[1]! }
  const attachment = new RegExp(`^attachment:(${UUID})$`).exec(lower)
  if (attachment) return { kind: 'attachment', id: attachment[1]! }
  const folder = new RegExp(`^folder:(root|${UUID})$`).exec(lower)
  if (folder) return { kind: 'folder', id: folder[1] === 'root' ? null : folder[1]! }
  return null
}

/** Whether a panel and the main view both fit, at their minimum widths, in `available` pixels. */
export function splitFits(available: number): boolean {
  return available >= SIDE_PANEL_MIN_WIDTH + MAIN_VIEW_MIN_WIDTH
}

/** Keeps both views usable: the panel is at least its minimum and leaves the main view its own. */
export function clampPanelWidth(width: number, available: number): number {
  return Math.round(Math.min(Math.max(width, SIDE_PANEL_MIN_WIDTH), Math.max(SIDE_PANEL_MIN_WIDTH, available - MAIN_VIEW_MIN_WIDTH)))
}

export function readPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) return saved
  } catch { /* the preference is optional */ }
  return DEFAULT_PANEL_WIDTH
}

export function writePanelWidth(width: number): void {
  try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width))) } catch { /* the preference is optional */ }
}
