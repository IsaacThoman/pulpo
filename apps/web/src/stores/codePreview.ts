import { create } from 'zustand'
import type { CodePreviewKind } from '@/lib/code-preview'

export interface CodePreview {
  title: string
  kind: CodePreviewKind
  code: string
}

interface CodePreviewState {
  preview: CodePreview | null
  /** Mounted preview panels; code blocks only offer previews when one can show them. */
  hosts: number
  open: (preview: CodePreview) => void
  close: () => void
  attachHost: () => () => void
}

export const useCodePreview = create<CodePreviewState>()((set) => ({
  preview: null,
  hosts: 0,
  open: (preview) => set({ preview }),
  close: () => set({ preview: null }),
  attachHost: () => {
    set((state) => ({ hosts: state.hosts + 1 }))
    // A preview belongs to the page that opened it.
    return () => set((state) => ({ hosts: state.hosts - 1, preview: null }))
  },
}))
