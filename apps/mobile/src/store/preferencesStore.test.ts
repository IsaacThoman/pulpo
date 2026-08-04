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

describe('namespaced agent preference', () => {
  beforeEach(() => {
    mocks.values.clear()
    usePreferencesStore.setState({ activeAgentNamespace: null, agentMode: false, agentModeHydrated: false })
  })

  it('survives scope changes without leaking to another account', async () => {
    await usePreferencesStore.getState().activateAgentNamespace('instance-a|user-a')
    await usePreferencesStore.getState().setNamespacedAgentMode('instance-a|user-a', true)
    await usePreferencesStore.getState().activateAgentNamespace('instance-a|user-b')
    expect(usePreferencesStore.getState().agentMode).toBe(false)
    await usePreferencesStore.getState().activateAgentNamespace('instance-a|user-a')
    expect(usePreferencesStore.getState().agentMode).toBe(true)
  })
})
