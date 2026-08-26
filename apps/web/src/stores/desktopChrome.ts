import { create } from 'zustand'

interface DesktopChromeState {
  temporaryChat: boolean
  sidebarTitleBarVisible: boolean
  setTemporaryChat: (temporaryChat: boolean) => void
  setSidebarTitleBarVisible: (sidebarTitleBarVisible: boolean) => void
}

export const useDesktopChrome = create<DesktopChromeState>()((set) => ({
  temporaryChat: false,
  sidebarTitleBarVisible: false,
  setTemporaryChat: (temporaryChat) => set({ temporaryChat }),
  setSidebarTitleBarVisible: (sidebarTitleBarVisible) => set({ sidebarTitleBarVisible }),
}))
