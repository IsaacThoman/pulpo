import { create } from 'zustand'

/** Opens the "Add from Files" picker from the composer's + menu. */
export const useFileReferencePicker = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
