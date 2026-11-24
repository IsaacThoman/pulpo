import { create } from 'zustand'

/** The chat whose workspace screen is open, if any. The chat screen shows the viewer for it. */
export const useWorkspaceScreenViewer = create<{
  chatId: string | null
  open: (chatId: string) => void
  close: () => void
}>()((set) => ({
  chatId: null,
  open: (chatId) => set({ chatId }),
  close: () => set({ chatId: null }),
}))
