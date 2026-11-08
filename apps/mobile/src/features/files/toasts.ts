import { create } from 'zustand'

export interface FilesToast {
  id: number
  message: string
  tone: 'default' | 'error'
  /** Reverts what the toast reports; the toast closes once it ran. */
  undo?: () => Promise<unknown>
}

const TOAST_MS = 5_000
const UNDO_TOAST_MS = TOAST_MS + 2_000
/** Reaching Undo with a screen reader takes several swipes after the announcement. */
const SCREEN_READER_UNDO_TOAST_MS = 60_000
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined
let screenReaderEnabled = false

/** Kept current by FilesToastHost, so Undo stays reachable while VoiceOver or TalkBack runs. */
export function setFilesToastScreenReaderEnabled(enabled: boolean) {
  screenReaderEnabled = enabled
}

export function filesToastDuration({ undo, screenReader }: { undo: boolean; screenReader: boolean }): number {
  if (!undo) return TOAST_MS
  return screenReader ? SCREEN_READER_UNDO_TOAST_MS : UNDO_TOAST_MS
}

/** What a screen reader says when the toast appears. */
export function filesToastAnnouncement(toast: Pick<FilesToast, 'message' | 'undo'>): string {
  return toast.undo ? `${toast.message}, Undo available` : toast.message
}

/** One toast at a time for Files actions, shown by whichever Files screen is on screen. */
export const useFilesToasts = create<{
  toast: FilesToast | null
  show: (toast: Omit<FilesToast, 'id' | 'tone'> & { tone?: FilesToast['tone'] }) => void
  dismiss: (id?: number) => void
}>((set, get) => ({
  toast: null,
  show: (toast) => {
    if (timer) clearTimeout(timer)
    const id = nextId++
    set({ toast: { tone: 'default', ...toast, id } })
    timer = setTimeout(() => get().dismiss(id), filesToastDuration({ undo: Boolean(toast.undo), screenReader: screenReaderEnabled }))
  },
  dismiss: (id) => {
    if (id !== undefined && get().toast?.id !== id) return
    if (timer) clearTimeout(timer)
    timer = undefined
    set({ toast: null })
  },
}))
