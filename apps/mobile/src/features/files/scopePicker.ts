import { create } from 'zustand'

/** Opens the "Add from Files" picker from the composer's + menu. */
export const useFileScopePicker = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
