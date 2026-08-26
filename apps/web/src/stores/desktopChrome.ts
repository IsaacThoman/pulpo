import { create } from 'zustand'

interface DesktopChromeState {
  temporaryChat: boolean
  sidebarCapVisible: boolean
  setTemporaryChat: (temporaryChat: boolean) => void
  setSidebarCapVisible: (sidebarCapVisible: boolean) => void
}

export const useDesktopChrome = create<DesktopChromeState>()((set) => ({
  temporaryChat: false,
  sidebarCapVisible: false,
  setTemporaryChat: (temporaryChat) => set({ temporaryChat }),
  setSidebarCapVisible: (sidebarCapVisible) => set({ sidebarCapVisible }),
}))
