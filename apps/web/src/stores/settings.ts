import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type TrashRetention = 'instant' | '24h' | '7d' | '30d' | '90d' | 'indefinite'
export type AutomaticChatExpiration = 'disabled' | '24h' | '7d'

/** Per-model map of preset id → selected choice id. */
export type GenerationPrefs = Record<string, string>

interface SettingsState {
  ownerUserId: string | null
  theme: Theme
  language: string
  sendWithEnter: boolean
  streamResponses: boolean
  showReasoning: boolean
  chatWidth: 'full' | 'narrow'
  customInstructions: string
  nickname: string
  memoryEnabled: boolean
  agentModeEnabled: boolean
  leaderboardVisible: boolean
  leaderboardColor: string
  localChatLimit: number
  localAttachmentCacheMb: number
  trashRetention: TrashRetention
  automaticChatExpiration: AutomaticChatExpiration
  defaultModelId: string
  /** Per-model composer preset selections. */
  generation: Record<string, GenerationPrefs>
  setTheme: (t: Theme) => void
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  setGeneration: (modelId: string, prefs: GenerationPrefs) => void
  setPresetChoice: (modelId: string, presetId: string, choiceId: string) => void
}

export const DEFAULT_SETTINGS = {
  theme: 'system' as Theme,
  language: 'en-US',
  sendWithEnter: true,
  streamResponses: true,
  showReasoning: true,
  chatWidth: 'narrow' as const,
  customInstructions: '',
  nickname: '',
  memoryEnabled: false,
  agentModeEnabled: true,
  leaderboardVisible: false,
  leaderboardColor: '#10b981',
  localChatLimit: 50,
  localAttachmentCacheMb: 50,
  trashRetention: '30d' as TrashRetention,
  automaticChatExpiration: 'disabled' as AutomaticChatExpiration,
  defaultModelId: '',
  generation: {},
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ownerUserId: null,
      ...DEFAULT_SETTINGS,
      setTheme: (theme) => set({ theme }),
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      setGeneration: (modelId, prefs) =>
        set((s) => ({
          generation: { ...s.generation, [modelId]: { ...s.generation[modelId], ...prefs } },
        })),
      setPresetChoice: (modelId, presetId, choiceId) =>
        set((s) => ({
          generation: {
            ...s.generation,
            [modelId]: { ...s.generation[modelId], [presetId]: choiceId },
          },
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
