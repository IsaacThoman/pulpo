import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReasoningEffort, SpeedOption } from '@/lib/types'

export type Theme = 'light' | 'dark' | 'system'

export interface GenerationPrefs {
  reasoningEffort?: ReasoningEffort
  speed?: SpeedOption
}

interface SettingsState {
  theme: Theme
  language: string
  sendWithEnter: boolean
  streamResponses: boolean
  showReasoning: boolean
  chatWidth: 'full' | 'narrow'
  notifications: boolean
  customInstructions: string
  nickname: string
  /** Per-model composer selections (reasoning effort / speed). */
  generation: Record<string, GenerationPrefs>
  setTheme: (t: Theme) => void
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  setGeneration: (modelId: string, prefs: GenerationPrefs) => void
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
      notifications: true,
      customInstructions: '',
      nickname: '',
      generation: {},
      setTheme: (theme) => set({ theme }),
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      setGeneration: (modelId, prefs) =>
        set((s) => ({
          generation: { ...s.generation, [modelId]: { ...s.generation[modelId], ...prefs } },
        })),
    }),
    { name: 'pulpo-settings' }
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
