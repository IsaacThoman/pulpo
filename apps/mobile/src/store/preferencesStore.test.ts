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
