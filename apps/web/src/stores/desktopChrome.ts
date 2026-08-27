import { create } from 'zustand'

interface DesktopChromeState {
  desktopSidebarVisible: boolean
  temporaryChat: boolean
  setDesktopSidebarVisible: (desktopSidebarVisible: boolean) => void
  setTemporaryChat: (temporaryChat: boolean) => void
}

export const useDesktopChrome = create<DesktopChromeState>()((set) => ({
  desktopSidebarVisible: false,
  temporaryChat: false,
  setDesktopSidebarVisible: (desktopSidebarVisible) => set({ desktopSidebarVisible }),
  setTemporaryChat: (temporaryChat) => set({ temporaryChat }),
}))
