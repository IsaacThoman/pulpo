import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ values: new Map<string, unknown>() }))

vi.mock('react-native', () => ({ Appearance: { setColorScheme: vi.fn() } }))
vi.mock('../data/database', () => ({
  getValue: vi.fn(async (namespace: string, key: string) => mocks.values.get(`${namespace}:${key}`) ?? null),
  setValue: vi.fn(async (namespace: string, key: string, value: unknown) => {
    mocks.values.set(`${namespace}:${key}`, value)
  }),
}))

import { usePreferencesStore } from './preferences'
import { defaultPreferences } from './preferenceMapping'

beforeEach(() => {
  mocks.values.clear()
  usePreferencesStore.setState({
    ...defaultPreferences,
    hydrated: true,
    synchronizedOwnerNamespace: null,
    modelPreferencesDirty: false,
    generationPreferenceDirty: false,
    agentModesPreferenceDirty: false,
    pendingServerPreferenceKeys: [],
  })
})

describe('realtime preference reconciliation', () => {
  it('preserves a pending suggestion opt-out, persists remote changes, and resets for another account', async () => {
    await usePreferencesStore.getState().setPreference('showPromptSuggestions', false)
    await usePreferencesStore.getState().applyServerPreferences({ showPromptSuggestions: true })
    expect(usePreferencesStore.getState()).toMatchObject({
      showPromptSuggestions: false,
      pendingServerPreferenceKeys: ['showPromptSuggestions'],
    })
    await usePreferencesStore.getState().applyServerPreferences({ showPromptSuggestions: false })
    expect(usePreferencesStore.getState().pendingServerPreferenceKeys).toEqual([])
    await usePreferencesStore.getState().hydrate()
    expect(usePreferencesStore.getState().showPromptSuggestions).toBe(false)
    await usePreferencesStore.getState().applyServerPreferences({ showPromptSuggestions: true })
    expect(usePreferencesStore.getState().showPromptSuggestions).toBe(true)
    await usePreferencesStore.getState().applyServerPreferences({ showPromptSuggestions: false })
    await usePreferencesStore.getState().resetSynchronizedPreferences('other-account')
    expect(usePreferencesStore.getState().showPromptSuggestions).toBe(true)
  })
  it('persists remote composer opt-out and retires pending checkpoints', async () => {
    const before = usePreferencesStore.getState().composerSyncGeneration
    await usePreferencesStore.getState().applyServerPreferences({ composerSyncEnabled: false })
    expect(usePreferencesStore.getState().composerSyncEnabled).toBe(false)
    expect(usePreferencesStore.getState().composerSyncGeneration).not.toBe(before)
    await usePreferencesStore.getState().hydrate()
    expect(usePreferencesStore.getState().composerSyncEnabled).toBe(false)
    await usePreferencesStore.getState().resetSynchronizedPreferences('other-account')
    expect(usePreferencesStore.getState().composerSyncEnabled).toBe(true)
  })
  it('keeps the latest local menu choice while an older server value is in flight', async () => {
    await usePreferencesStore.getState().setPreference('theme', 'dark')

    await usePreferencesStore.getState().applyServerPreferences({ theme: 'light' })
    expect(usePreferencesStore.getState()).toMatchObject({
      theme: 'dark',
      pendingServerPreferenceKeys: ['theme'],
    })

    await usePreferencesStore.getState().applyServerPreferences({ theme: 'dark' })
    expect(usePreferencesStore.getState()).toMatchObject({
      theme: 'dark',
      pendingServerPreferenceKeys: [],
    })
  })

  it('does not let one model setting acknowledgement expose another pending setting', async () => {
    await usePreferencesStore.getState().setPreference('favoriteModelIds', ['model-a'])
    await usePreferencesStore.getState().setPreference('providerOrder', ['lab-a'])

    await usePreferencesStore.getState().markSynchronizedPreferenceSynced('favoriteModelIds', ['model-a'])
    expect(usePreferencesStore.getState()).toMatchObject({
      modelPreferencesDirty: true,
      pendingServerPreferenceKeys: ['providerOrder'],
    })
  })
})

describe('synchronized model picker preferences', () => {
  it('keeps dirty local favorites and provider order until the server matches them', async () => {
    const localFavorites = ['model-b', 'missing-model']
    const localOrder = ['lab-b', 'lab-a']
    await usePreferencesStore.getState().setPreference('favoriteModelIds', localFavorites)
    await usePreferencesStore.getState().setPreference('providerOrder', localOrder)

    await usePreferencesStore.getState().applyServerPreferences({
      favoriteModelIds: ['model-a'],
      providerOrder: ['lab-a', 'lab-b'],
    })
    expect(usePreferencesStore.getState()).toMatchObject({
      favoriteModelIds: localFavorites,
      providerOrder: localOrder,
      modelPreferencesDirty: true,
    })

    await usePreferencesStore.getState().applyServerPreferences({
      favoriteModelIds: localFavorites,
      providerOrder: localOrder,
    })
    expect(usePreferencesStore.getState().modelPreferencesDirty).toBe(false)
  })

  it('clears favorites and provider order when another account takes ownership', async () => {
    usePreferencesStore.setState({
      synchronizedOwnerNamespace: 'instance|user-a',
      favoriteModelIds: ['model-a'],
      providerOrder: ['lab-a'],
      modelPreferencesDirty: true,
    })

    await usePreferencesStore.getState().resetSynchronizedPreferences('instance|user-b')

    expect(usePreferencesStore.getState()).toMatchObject({
      synchronizedOwnerNamespace: 'instance|user-b',
      favoriteModelIds: [],
      providerOrder: [],
      modelPreferencesDirty: false,
    })
  })
})

describe('synchronized Agent mode preferences', () => {
  const local = { 'model-a': false, 'model-b': true }
  const account = { 'model-a': true, 'model-b': false }

  it('hydrates account choices and defaults missing models on at the call site', async () => {
    await usePreferencesStore.getState().applyServerPreferences({ agentModes: account })

    expect(usePreferencesStore.getState()).toMatchObject({
      agentModes: account,
      agentModesPreferenceDirty: false,
    })
    expect(usePreferencesStore.getState().agentModes['model-missing'] ?? true).toBe(true)
  })

  it('keeps dirty local choices until the matching value is saved', async () => {
    await usePreferencesStore.getState().setPreference('agentModes', local)
    await usePreferencesStore.getState().applyServerPreferences({ agentModes: account })
    expect(usePreferencesStore.getState()).toMatchObject({
      agentModes: local,
      agentModesPreferenceDirty: true,
    })

    await usePreferencesStore.getState().markSynchronizedPreferenceSynced('agentModes', local)
    expect(usePreferencesStore.getState().agentModesPreferenceDirty).toBe(false)
  })

  it('clears choices when another account takes ownership', async () => {
    usePreferencesStore.setState({ agentModes: local, agentModesPreferenceDirty: true })
    await usePreferencesStore.getState().resetSynchronizedPreferences('instance-a|user-b')
    expect(usePreferencesStore.getState()).toMatchObject({
      synchronizedOwnerNamespace: 'instance-a|user-b',
      agentModes: {},
      agentModesPreferenceDirty: false,
    })
  })
})

describe('synchronized generation preference', () => {
  const local = { 'model-a': { reasoning: 'low' } }
  const account = { 'model-a': { reasoning: 'high' } }

  it('replaces legacy local choices with account choices on first sync', async () => {
    usePreferencesStore.setState({ generation: local })

    await usePreferencesStore.getState().applyServerPreferences({ generation: account })

    expect(usePreferencesStore.getState()).toMatchObject({
      generation: account,
      generationPreferenceDirty: false,
    })
  })

  it('clears choices and dirty state when another account takes ownership', async () => {
    usePreferencesStore.setState({
      synchronizedOwnerNamespace: 'instance|user-a',
      generation: local,
      generationPreferenceDirty: true,
    })

    await usePreferencesStore.getState().resetSynchronizedPreferences('instance|user-b')

    expect(usePreferencesStore.getState()).toMatchObject({
      synchronizedOwnerNamespace: 'instance|user-b',
      generation: {},
      generationPreferenceDirty: false,
    })
  })

  it('keeps a dirty local choice when stale account settings arrive', async () => {
    await usePreferencesStore.getState().setPreference('generation', local)

    await usePreferencesStore.getState().applyServerPreferences({ generation: account })

    expect(usePreferencesStore.getState()).toMatchObject({
      generation: local,
      generationPreferenceDirty: true,
    })
  })

  it('clears dirty state when account settings match the local choice', async () => {
    await usePreferencesStore.getState().setPreference('generation', local)

    await usePreferencesStore.getState().applyServerPreferences({ generation: local })

    expect(usePreferencesStore.getState().generationPreferenceDirty).toBe(false)
  })

  it('matches synchronized choices regardless of record key order', async () => {
    const selected = {
      'model-a': { reasoning: 'low', style: 'concise' },
      'model-b': { speed: 'fast' },
    }
    await usePreferencesStore.getState().setPreference('generation', selected)

    await usePreferencesStore.getState().applyServerPreferences({
      generation: {
        'model-b': { speed: 'fast' },
        'model-a': { style: 'concise', reasoning: 'low' },
      },
    })

    expect(usePreferencesStore.getState().generationPreferenceDirty).toBe(false)
  })

  it('clears dirty state after the current local value is saved', async () => {
    await usePreferencesStore.getState().setPreference('generation', local)

    await usePreferencesStore.getState().markSynchronizedPreferenceSynced('generation', local)

    expect(usePreferencesStore.getState().generationPreferenceDirty).toBe(false)
  })
})
