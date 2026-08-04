import { Appearance } from 'react-native'
import { create } from 'zustand'
import { getValue, setValue } from '../data/database'
import { defaultPreferences as defaults, type Preferences } from './preferenceMapping'

export type { Preferences, TextSizePreference, ThemePreference, TrashRetentionPreference } from './preferenceMapping'
export { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

interface PreferenceState extends Preferences {
  hydrated: boolean
  activeAgentNamespace: string | null
  agentModeHydrated: boolean
  synchronizedOwnerNamespace: string | null
  modelPreferencesDirty: boolean
  hydrate: () => Promise<void>
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>
  applyServerPreferences: (patch: Partial<Preferences>) => Promise<void>
  markModelPreferenceSynced: <K extends 'favoriteModelIds' | 'providerOrder'>(key: K, value: Preferences[K]) => Promise<void>
  resetSynchronizedModelPreferences: (namespace: string) => Promise<void>
  activateAgentNamespace: (namespace: string | null) => Promise<void>
  setNamespacedAgentMode: (namespace: string, value: boolean) => Promise<void>
}

type StoredPreferences = Partial<Preferences> & {
  synchronizedOwnerNamespace?: string | null
  modelPreferencesDirty?: boolean
}

function persistedSnapshot(state: PreferenceState): StoredPreferences {
  const persistedKeys = Object.keys(defaults).filter((name) => name !== 'agentMode')
  return {
    ...Object.fromEntries(persistedKeys.map((name) => [name, state[name as keyof Preferences]])),
    synchronizedOwnerNamespace: state.synchronizedOwnerNamespace,
    modelPreferencesDirty: state.modelPreferencesDirty,
  }
}

export const usePreferencesStore = create<PreferenceState>((set, get) => ({
  ...defaults,
  hydrated: false,
  activeAgentNamespace: null,
  agentModeHydrated: false,
  synchronizedOwnerNamespace: null,
  modelPreferencesDirty: false,
  hydrate: async () => {
    try {
      const stored = await getValue<StoredPreferences>('global', 'preferences')
      const preferences = {
        ...defaults,
        ...stored,
        agentMode: false,
        localChatLimit: Math.min(defaults.localChatLimit, stored?.localChatLimit ?? defaults.localChatLimit),
      }
      Appearance.setColorScheme(preferences.theme === 'system' ? 'unspecified' : preferences.theme)
      set({
        ...preferences,
        synchronizedOwnerNamespace: stored?.synchronizedOwnerNamespace ?? null,
        modelPreferencesDirty: stored?.modelPreferencesDirty ?? false,
        activeAgentNamespace: null,
        agentModeHydrated: false,
        hydrated: true,
      })
    } catch {
      Appearance.setColorScheme('unspecified')
      set({ ...defaults, hydrated: true, activeAgentNamespace: null, agentModeHydrated: false })
    }
  },
  setPreference: async (key, value) => {
    const synchronizedModelPreference = key === 'favoriteModelIds' || key === 'providerOrder'
    const next = { ...get(), [key]: value, modelPreferencesDirty: synchronizedModelPreference || get().modelPreferencesDirty }
    if (key === 'theme') Appearance.setColorScheme(value === 'system' ? 'unspecified' : value as 'light' | 'dark')
    set((state) => ({ ...state, [key]: value, modelPreferencesDirty: synchronizedModelPreference || state.modelPreferencesDirty }))
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  applyServerPreferences: async (patch) => {
    const current = get()
    const favoriteMatches = !patch.favoriteModelIds
      || JSON.stringify(patch.favoriteModelIds) === JSON.stringify(current.favoriteModelIds)
    const providerMatches = !patch.providerOrder
      || JSON.stringify(patch.providerOrder) === JSON.stringify(current.providerOrder)
    const acceptsSynchronized = !current.modelPreferencesDirty || (favoriteMatches && providerMatches)
    const safePatch = { ...patch }
    delete safePatch.agentMode
    if (!acceptsSynchronized) {
      delete safePatch.favoriteModelIds
      delete safePatch.providerOrder
    }
    const next = {
      ...current,
      ...safePatch,
      modelPreferencesDirty: acceptsSynchronized ? false : current.modelPreferencesDirty,
    }
    set(next)
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  markModelPreferenceSynced: async (key, value) => {
    const current = get()
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) return
    const next = { ...current, modelPreferencesDirty: false }
    set({ modelPreferencesDirty: false })
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  resetSynchronizedModelPreferences: async (namespace) => {
    const next = { ...get(), synchronizedOwnerNamespace: namespace, favoriteModelIds: [], providerOrder: [], modelPreferencesDirty: false }
    set({ synchronizedOwnerNamespace: namespace, favoriteModelIds: [], providerOrder: [], modelPreferencesDirty: false })
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  activateAgentNamespace: async (namespace) => {
    if (!namespace) {
      set({ activeAgentNamespace: null, agentMode: false, agentModeHydrated: true })
      return
    }
    set({ activeAgentNamespace: namespace, agentMode: false, agentModeHydrated: false })
    const value = await getValue<boolean>('global', `agent-mode:${namespace}`).catch(() => false)
    if (get().activeAgentNamespace !== namespace) return
    set({ agentMode: value === true, agentModeHydrated: true })
  },
  setNamespacedAgentMode: async (namespace, value) => {
    if (get().activeAgentNamespace !== namespace) {
      await get().activateAgentNamespace(namespace)
    }
    if (get().activeAgentNamespace !== namespace) return
    set({ agentMode: value })
    await setValue('global', `agent-mode:${namespace}`, value)
  },
}))
