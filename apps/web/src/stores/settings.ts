import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SidebarPins } from '@pulpo/contracts'

export type Theme = 'light' | 'dark' | 'system'
export const SUPPORTED_LANGUAGES = [
  { value: 'en-US', label: 'English' },
  { value: 'es-ES', label: 'Español' },
] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]['value']
export type TrashRetention = 'instant' | '24h' | '7d' | '30d' | '90d' | 'indefinite'
export type AutomaticChatExpiration = 'disabled' | '24h' | '7d'

/** Per-model map of preset id → selected choice id. */
export type GenerationPrefs = Record<string, string>

interface SettingsState {
  ownerUserId: string | null
  theme: Theme
  language: Language
  sendWithEnter: boolean
  doubleShiftSearch: boolean
  streamResponses: boolean
  showReasoning: boolean
  chatWidth: 'full' | 'narrow'
  customInstructions: string
  instructionPresetSelections: Record<string, boolean>
  nickname: string
  memoryEnabled: boolean
  /** Per-model composer Agent mode selections. Missing model ids default on. */
  agentModes: Record<string, boolean>
  leaderboardVisible: boolean
  leaderboardColor: string
  localChatLimit: number
  localAttachmentCacheMb: number
  trashRetention: TrashRetention
  automaticChatExpiration: AutomaticChatExpiration
  newChatAutoExpire: boolean
  defaultModelId: string
  sidebarPins: SidebarPins
  /** Per-model composer preset selections. */
  generation: Record<string, GenerationPrefs>
  setTheme: (t: Theme) => void
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  setGeneration: (modelId: string, prefs: GenerationPrefs) => void
  setPresetChoice: (modelId: string, presetId: string, choiceId: string) => void
  setAgentMode: (modelId: string, enabled: boolean) => void
}

export const DEFAULT_SETTINGS = {
  theme: 'system' as Theme,
  language: 'en-US' as Language,
  sendWithEnter: true,
  doubleShiftSearch: true,
  streamResponses: true,
  showReasoning: true,
  chatWidth: 'narrow' as const,
  customInstructions: '',
  instructionPresetSelections: {},
  nickname: '',
  memoryEnabled: false,
  agentModes: {},
  leaderboardVisible: false,
  leaderboardColor: '#10b981',
  localChatLimit: 50,
  localAttachmentCacheMb: 50,
  trashRetention: '30d' as TrashRetention,
  automaticChatExpiration: '24h' as AutomaticChatExpiration,
  newChatAutoExpire: false,
  defaultModelId: '',
  sidebarPins: { usage: false, billing: false, friends: false, apiKeys: false },
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
      setAgentMode: (modelId, enabled) =>
        set((s) => ({ agentModes: { ...s.agentModes, [modelId]: enabled } })),
    }),
    {
      name: 'pulpo-settings',
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState>
        return {
          ...current,
          ...saved,
          language: normalizeLanguage(saved.language),
        }
      },
    }
  )
)

export function normalizeLanguage(value: unknown): Language {
  return SUPPORTED_LANGUAGES.some((language) => language.value === value)
    ? value as Language
    : DEFAULT_SETTINGS.language
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
}

export function applyLanguage(language: Language) {
  document.documentElement.lang = language
}

// Apply on load + react to system changes
applyTheme(useSettings.getState().theme)
applyLanguage(normalizeLanguage(useSettings.getState().language))
useSettings.subscribe((state, previous) => {
  if (state.theme !== previous.theme) applyTheme(state.theme)
  if (state.language !== previous.language) applyLanguage(normalizeLanguage(state.language))
})
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useSettings.getState().theme === 'system') applyTheme('system')
})
