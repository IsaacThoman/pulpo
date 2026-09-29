import { create } from 'zustand'

export interface FileToast {
  id: string
  message: string
  tone?: 'default' | 'error'
  /** Reverses the action; the toast offers an Undo button while it is visible. */
  undo?: () => Promise<unknown>
}

interface FileToastState {
  toasts: FileToast[]
  show: (toast: Omit<FileToast, 'id'>) => string
  dismiss: (id: string) => void
}

const MAX_TOASTS = 3

export const useFileToasts = create<FileToastState>()((set) => ({
  toasts: [],
  show: (toast) => {
    const id = crypto.randomUUID()
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-MAX_TOASTS) }))
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
