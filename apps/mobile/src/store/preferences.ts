import { Appearance } from 'react-native'
import { create } from 'zustand'
import { getValue, setValue } from '../data/database'
import { defaultPreferences as defaults, type Preferences } from './preferenceMapping'

export type { Preferences, TextSizePreference, ThemePreference, TrashRetentionPreference } from './preferenceMapping'
export { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

interface PreferenceState extends Preferences {
  hydrated: boolean
  hydrate: () => Promise<void>
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>
}

export const usePreferencesStore = create<PreferenceState>((set, get) => ({
  ...defaults,
  hydrated: false,
  hydrate: async () => {
    try {
      const stored = await getValue<Partial<Preferences>>('global', 'preferences')
      const preferences = {
        ...defaults,
        ...stored,
        localChatLimit: Math.min(defaults.localChatLimit, stored?.localChatLimit ?? defaults.localChatLimit),
      }
      Appearance.setColorScheme(preferences.theme === 'system' ? 'unspecified' : preferences.theme)
      set({ ...preferences, hydrated: true })
    } catch {
      Appearance.setColorScheme('unspecified')
      set({ ...defaults, hydrated: true })
    }
  },
  setPreference: async (key, value) => {
    const next = { ...get(), [key]: value }
    if (key === 'theme') Appearance.setColorScheme(value === 'system' ? 'unspecified' : value as 'light' | 'dark')
    set((state) => ({ ...state, [key]: value }))
    await setValue('global', 'preferences', Object.fromEntries(
      Object.keys(defaults).map((name) => [name, next[name as keyof Preferences]]),
    ))
  },
}))
