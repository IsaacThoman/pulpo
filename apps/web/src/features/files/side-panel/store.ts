import { create } from 'zustand'

/** URL search parameter that mirrors the side panel, e.g. `?side=file:<id>`. */
export const SIDE_PANEL_PARAM = 'side'
export const SIDE_PANEL_MIN_WIDTH = 360
const WIDTH_STORAGE_KEY = 'pulpo.sidePanel.width'
const DEFAULT_WIDTH = 520

/** The file shown beside the main view. It stays open while the main view navigates. */
export const useSidePanel = create<{
  fileId: string | null
  open: (fileId: string) => void
  close: () => void
}>()((set) => ({
  fileId: null,
  open: (fileId) => set({ fileId }),
  close: () => set({ fileId: null }),
}))

export function sideParamValue(fileId: string): string {
  return `file:${fileId}`
}

export function parseSideParam(value: string | null): string | null {
  const match = /^file:([0-9a-f-]{36})$/i.exec(value ?? '')
  return match ? match[1]!.toLowerCase() : null
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
