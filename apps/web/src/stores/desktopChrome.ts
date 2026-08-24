import { create } from 'zustand'

interface DesktopChromeState {
  temporaryChat: boolean
  setTemporaryChat: (temporaryChat: boolean) => void
}

export const useDesktopChrome = create<DesktopChromeState>()((set) => ({
  temporaryChat: false,
  setTemporaryChat: (temporaryChat) => set({ temporaryChat }),
}))
