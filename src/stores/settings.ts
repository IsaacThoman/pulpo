import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface SettingsState {
  theme: Theme
  language: string
  sendWithEnter: boolean
  streamResponses: boolean
  showReasoning: boolean
  chatWidth: 'full' | 'narrow'
  haptics: boolean
  notifications: boolean
  customInstructions: string
  nickname: string
  ttsVoice: string
  autoReadAloud: boolean
  setTheme: (t: Theme) => void
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      language: 'en-US',
      sendWithEnter: true,
      streamResponses: true,
      showReasoning: true,
      chatWidth: 'narrow',
      haptics: false,
      notifications: true,
      customInstructions: '',
      nickname: '',
      ttsVoice: 'alloy',
      autoReadAloud: false,
      setTheme: (theme) => set({ theme }),
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: 'kimi-settings' }
  )
)

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

// Apply on load + react to system changes
applyTheme(useSettings.getState().theme)
useSettings.subscribe((s) => applyTheme(s.theme))
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useSettings.getState().theme === 'system') applyTheme('system')
})
