import { create } from 'zustand'

export interface FilesToast {
  id: number
  message: string
  tone: 'default' | 'error'
  /** Reverts what the toast reports; the toast closes once it ran. */
  undo?: () => Promise<unknown>
}

const TOAST_MS = 5_000
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined

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
    timer = setTimeout(() => get().dismiss(id), toast.undo ? TOAST_MS + 2_000 : TOAST_MS)
  },
  dismiss: (id) => {
    if (id !== undefined && get().toast?.id !== id) return
    if (timer) clearTimeout(timer)
    timer = undefined
    set({ toast: null })
  },
}))
