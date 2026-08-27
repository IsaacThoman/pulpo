import { Appearance } from 'react-native'
import { create } from 'zustand'
import { LatestValueQueue } from '@pulpo/client-core'
import { getValue, setValue } from '../data/database'
import { defaultPreferences as defaults, serverPreferenceKey, type Preferences } from './preferenceMapping'

export type { AutomaticChatExpirationPreference, Preferences, TextSizePreference, ThemePreference, TrashRetentionPreference } from './preferenceMapping'
export { preferencePatchForServer, preferencesFromServer } from './preferenceMapping'

interface PreferenceState extends Preferences {
  hydrated: boolean
  synchronizedOwnerNamespace: string | null
  modelPreferencesDirty: boolean
  generationPreferenceDirty: boolean
  agentModesPreferenceDirty: boolean
  pendingServerPreferenceKeys: Array<keyof Preferences>
  hydrate: () => Promise<void>
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>
  applyServerPreferences: (patch: Partial<Preferences>) => Promise<void>
  markSynchronizedPreferenceSynced: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>
  resetSynchronizedPreferences: (namespace: string) => Promise<void>
}

type StoredPreferences = Partial<Preferences> & {
  synchronizedOwnerNamespace?: string | null
  modelPreferencesDirty?: boolean
  generationPreferenceDirty?: boolean
  agentModesPreferenceDirty?: boolean
  pendingServerPreferenceKeys?: Array<keyof Preferences>
}

const preferencePersistence = new LatestValueQueue<'global', StoredPreferences, void>()

function persistPreferences(snapshot: StoredPreferences): Promise<void> {
  return preferencePersistence.enqueue('global', snapshot, (latest) => setValue('global', 'preferences', latest))
}

function persistedSnapshot(state: PreferenceState): StoredPreferences {
  const persistedKeys = Object.keys(defaults)
  return {
    ...Object.fromEntries(persistedKeys.map((name) => [name, state[name as keyof Preferences]])),
    synchronizedOwnerNamespace: state.synchronizedOwnerNamespace,
    modelPreferencesDirty: state.modelPreferencesDirty,
    generationPreferenceDirty: state.generationPreferenceDirty,
    agentModesPreferenceDirty: state.agentModesPreferenceDirty,
    pendingServerPreferenceKeys: state.pendingServerPreferenceKeys,
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

function samePreference<K extends keyof Preferences>(key: K, left: Preferences[K], right: Preferences[K]): boolean {
  if (key === 'generation') {
    return sameGenerationPreferences(left as Preferences['generation'], right as Preferences['generation'])
  }
  if (key === 'agentModes') {
    return sameAgentModes(left as Preferences['agentModes'], right as Preferences['agentModes'])
  }
  return JSON.stringify(left) === JSON.stringify(right)
}

export const usePreferencesStore = create<PreferenceState>((set, get) => ({
  ...defaults,
  hydrated: false,
  synchronizedOwnerNamespace: null,
  modelPreferencesDirty: false,
  generationPreferenceDirty: false,
  agentModesPreferenceDirty: false,
  pendingServerPreferenceKeys: [],
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
        pendingServerPreferenceKeys: stored?.pendingServerPreferenceKeys ?? [],
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
    const synchronizedWithServer = serverPreferenceKey(key) !== null
    const pendingServerPreferenceKeys = synchronizedWithServer
      ? [...new Set([...get().pendingServerPreferenceKeys, key])]
      : get().pendingServerPreferenceKeys
    const next = {
      ...get(),
      [key]: value,
      modelPreferencesDirty: synchronizedModelPreference || get().modelPreferencesDirty,
      generationPreferenceDirty: synchronizedGenerationPreference || get().generationPreferenceDirty,
      agentModesPreferenceDirty: synchronizedAgentModesPreference || get().agentModesPreferenceDirty,
      pendingServerPreferenceKeys,
    }
    if (key === 'theme') Appearance.setColorScheme(value === 'system' ? 'unspecified' : value as 'light' | 'dark')
    set((state) => ({
      ...state,
      [key]: value,
      modelPreferencesDirty: synchronizedModelPreference || state.modelPreferencesDirty,
      generationPreferenceDirty: synchronizedGenerationPreference || state.generationPreferenceDirty,
      agentModesPreferenceDirty: synchronizedAgentModesPreference || state.agentModesPreferenceDirty,
      pendingServerPreferenceKeys: synchronizedWithServer
        ? [...new Set([...state.pendingServerPreferenceKeys, key])]
        : state.pendingServerPreferenceKeys,
    }))
    await persistPreferences(persistedSnapshot(next))
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
    const pendingServerPreferenceKeys = current.pendingServerPreferenceKeys.filter((key) => {
      const remote = patch[key]
      if (remote === undefined) return true
      if (samePreference(key, current[key], remote as Preferences[typeof key])) return false
      delete safePatch[key]
      return true
    })
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
      pendingServerPreferenceKeys,
    }
    set(next)
    await persistPreferences(persistedSnapshot(next))
  },
  markSynchronizedPreferenceSynced: async (key, value) => {
    const current = get()
    const matches = samePreference(key, current[key], value)
    if (!matches) return
    const pendingServerPreferenceKeys = current.pendingServerPreferenceKeys.filter((candidate) => candidate !== key)
    const synced = {
      pendingServerPreferenceKeys,
      ...(key === 'generation' ? { generationPreferenceDirty: false } : {}),
      ...(key === 'agentModes' ? { agentModesPreferenceDirty: false } : {}),
      ...(key === 'favoriteModelIds' || key === 'providerOrder'
        ? { modelPreferencesDirty: pendingServerPreferenceKeys.some((candidate) => candidate === 'favoriteModelIds' || candidate === 'providerOrder') }
        : {}),
    }
    const next = { ...current, ...synced }
    set(synced)
    await persistPreferences(persistedSnapshot(next))
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
      pendingServerPreferenceKeys: [],
    }
    const next = { ...get(), ...reset }
    set(reset)
    await persistPreferences(persistedSnapshot(next))
  },
}))
