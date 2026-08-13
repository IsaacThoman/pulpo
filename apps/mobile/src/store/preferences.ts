import { Appearance } from 'react-native'
import { create } from 'zustand'
import { getValue, setValue } from '../data/database'
import { defaultPreferences as defaults, type Preferences } from './preferenceMapping'

export type { AutomaticChatExpirationPreference, Preferences, TextSizePreference, ThemePreference, TrashRetentionPreference } from './preferenceMapping'
export { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

interface PreferenceState extends Preferences {
  hydrated: boolean
  synchronizedOwnerNamespace: string | null
  modelPreferencesDirty: boolean
  generationPreferenceDirty: boolean
  agentModesPreferenceDirty: boolean
  hydrate: () => Promise<void>
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>
  applyServerPreferences: (patch: Partial<Preferences>) => Promise<void>
  markSynchronizedPreferenceSynced: <K extends 'favoriteModelIds' | 'providerOrder' | 'generation' | 'agentModes'>(key: K, value: Preferences[K]) => Promise<void>
  resetSynchronizedPreferences: (namespace: string) => Promise<void>
}

type StoredPreferences = Partial<Preferences> & {
  synchronizedOwnerNamespace?: string | null
  modelPreferencesDirty?: boolean
  generationPreferenceDirty?: boolean
  agentModesPreferenceDirty?: boolean
}

function persistedSnapshot(state: PreferenceState): StoredPreferences {
  const persistedKeys = Object.keys(defaults)
  return {
    ...Object.fromEntries(persistedKeys.map((name) => [name, state[name as keyof Preferences]])),
    synchronizedOwnerNamespace: state.synchronizedOwnerNamespace,
    modelPreferencesDirty: state.modelPreferencesDirty,
    generationPreferenceDirty: state.generationPreferenceDirty,
    agentModesPreferenceDirty: state.agentModesPreferenceDirty,
  }
}

function sameGenerationPreferences(left: Preferences['generation'], right: Preferences['generation']): boolean {
  const modelIds = Object.keys(left)
  if (modelIds.length !== Object.keys(right).length) return false
  return modelIds.every((modelId) => {
    const leftSelections = left[modelId]
    const rightSelections = right[modelId]
    if (!leftSelections || !rightSelections) return false
    const presetIds = Object.keys(leftSelections)
    return presetIds.length === Object.keys(rightSelections).length
      && presetIds.every((presetId) => leftSelections[presetId] === rightSelections[presetId])
  })
}

function sameAgentModes(left: Preferences['agentModes'], right: Preferences['agentModes']): boolean {
  const modelIds = Object.keys(left)
  return modelIds.length === Object.keys(right).length
    && modelIds.every((modelId) => left[modelId] === right[modelId])
}

export const usePreferencesStore = create<PreferenceState>((set, get) => ({
  ...defaults,
  hydrated: false,
  synchronizedOwnerNamespace: null,
  modelPreferencesDirty: false,
  generationPreferenceDirty: false,
  agentModesPreferenceDirty: false,
  hydrate: async () => {
    try {
      const stored = await getValue<StoredPreferences>('global', 'preferences')
      const preferences = {
        ...defaults,
        ...stored,
        localChatLimit: Math.min(defaults.localChatLimit, stored?.localChatLimit ?? defaults.localChatLimit),
      }
      Appearance.setColorScheme(preferences.theme === 'system' ? 'unspecified' : preferences.theme)
      set({
        ...preferences,
        synchronizedOwnerNamespace: stored?.synchronizedOwnerNamespace ?? null,
        modelPreferencesDirty: stored?.modelPreferencesDirty ?? false,
        generationPreferenceDirty: stored?.generationPreferenceDirty ?? false,
        agentModesPreferenceDirty: stored?.agentModesPreferenceDirty ?? false,
        hydrated: true,
      })
    } catch {
      Appearance.setColorScheme('unspecified')
      set({ ...defaults, hydrated: true })
    }
  },
  setPreference: async (key, value) => {
    const synchronizedModelPreference = key === 'favoriteModelIds' || key === 'providerOrder'
    const synchronizedGenerationPreference = key === 'generation'
    const synchronizedAgentModesPreference = key === 'agentModes'
    const next = {
      ...get(),
      [key]: value,
      modelPreferencesDirty: synchronizedModelPreference || get().modelPreferencesDirty,
      generationPreferenceDirty: synchronizedGenerationPreference || get().generationPreferenceDirty,
      agentModesPreferenceDirty: synchronizedAgentModesPreference || get().agentModesPreferenceDirty,
    }
    if (key === 'theme') Appearance.setColorScheme(value === 'system' ? 'unspecified' : value as 'light' | 'dark')
    set((state) => ({
      ...state,
      [key]: value,
      modelPreferencesDirty: synchronizedModelPreference || state.modelPreferencesDirty,
      generationPreferenceDirty: synchronizedGenerationPreference || state.generationPreferenceDirty,
      agentModesPreferenceDirty: synchronizedAgentModesPreference || state.agentModesPreferenceDirty,
    }))
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  applyServerPreferences: async (patch) => {
    const current = get()
    const favoriteMatches = !patch.favoriteModelIds
      || JSON.stringify(patch.favoriteModelIds) === JSON.stringify(current.favoriteModelIds)
    const providerMatches = !patch.providerOrder
      || JSON.stringify(patch.providerOrder) === JSON.stringify(current.providerOrder)
    const acceptsSynchronized = !current.modelPreferencesDirty || (favoriteMatches && providerMatches)
    const generationMatches = patch.generation === undefined
      || sameGenerationPreferences(patch.generation, current.generation)
    const acceptsGeneration = !current.generationPreferenceDirty || generationMatches
    const agentModesMatch = patch.agentModes === undefined || sameAgentModes(patch.agentModes, current.agentModes)
    const acceptsAgentModes = !current.agentModesPreferenceDirty || agentModesMatch
    const safePatch = { ...patch }
    if (!acceptsSynchronized) {
      delete safePatch.favoriteModelIds
      delete safePatch.providerOrder
    }
    if (!acceptsGeneration) delete safePatch.generation
    if (!acceptsAgentModes) delete safePatch.agentModes
    const next = {
      ...current,
      ...safePatch,
      modelPreferencesDirty: acceptsSynchronized ? false : current.modelPreferencesDirty,
      generationPreferenceDirty: acceptsGeneration ? false : current.generationPreferenceDirty,
      agentModesPreferenceDirty: acceptsAgentModes ? false : current.agentModesPreferenceDirty,
    }
    set(next)
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  markSynchronizedPreferenceSynced: async (key, value) => {
    const current = get()
    const matches = key === 'generation'
      ? sameGenerationPreferences(current.generation, value as Preferences['generation'])
      : key === 'agentModes'
        ? sameAgentModes(current.agentModes, value as Preferences['agentModes'])
        : JSON.stringify(current[key]) === JSON.stringify(value)
    if (!matches) return
    const synced = key === 'generation'
      ? { generationPreferenceDirty: false }
      : key === 'agentModes'
        ? { agentModesPreferenceDirty: false }
        : { modelPreferencesDirty: false }
    const next = { ...current, ...synced }
    set(synced)
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
  resetSynchronizedPreferences: async (namespace) => {
    const reset = {
      synchronizedOwnerNamespace: namespace,
      favoriteModelIds: [],
      providerOrder: [],
      generation: {},
      agentModes: {},
      modelPreferencesDirty: false,
      generationPreferenceDirty: false,
      agentModesPreferenceDirty: false,
    }
    const next = { ...get(), ...reset }
    set(reset)
    await setValue('global', 'preferences', persistedSnapshot(next))
  },
}))
