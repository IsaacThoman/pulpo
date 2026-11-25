// @vitest-environment jsdom

import { defaultSearchAccountPreferences, type SearchAccountPreferences } from '@pulpo/contracts/search'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { loadPreferences, preferencesStorageKey } from './preferences'
import { useSearchPreferences } from './use-search-preferences'

describe('Search account preferences', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('migrates existing settings to one account and keeps browser-only preferences local', async () => {
    window.localStorage.setItem(preferencesStorageKey, JSON.stringify({
      limit: 10, newTab: true, theme: 'dark', rememberRecentQueries: true,
      domains: { 'example.com': 'hide' },
      bangs: [{ trigger: 'docs', name: 'Docs', url: 'https://example.com/?q={query}' }],
    }))
    const read = vi.spyOn(api, 'preferences').mockResolvedValue({ preferences: null })
    const save = vi.spyOn(api, 'updatePreferences').mockImplementation(async (_id, patch, initial) => ({
      preferences: { ...defaultSearchAccountPreferences, ...initial, ...patch },
    }))
    const { result, rerender } = renderHook(({ accountId }) => useSearchPreferences(accountId), {
      initialProps: { accountId: 'first' },
    })
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    expect(save).toHaveBeenCalledWith('first', {}, {
      ...defaultSearchAccountPreferences, limit: 10, newTab: true, domains: { 'example.com': 'hide' },
      bangs: [{ trigger: 'docs', name: 'Docs', url: 'https://example.com/?q={query}' }],
    }, expect.any(AbortSignal))
    expect(result.current.preferences).toMatchObject({ limit: 10, theme: 'dark', rememberRecentQueries: true })
    act(() => result.current.update({ ...result.current.preferences, theme: 'light', rememberRecentQueries: false }))
    expect(save).toHaveBeenCalledTimes(1)
    expect(loadPreferences()).toMatchObject({ theme: 'light', rememberRecentQueries: false })

    rerender({ accountId: 'second' })
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    expect(read).toHaveBeenCalledWith('second', expect.any(AbortSignal))
    expect(result.current.preferences).toMatchObject({ limit: 40, newTab: false, domains: {}, bangs: [], safeSearch: true, theme: 'light' })
  })

  it('keeps offline edits in the account cache and sends them on the next connection', async () => {
    const remote = { ...defaultSearchAccountPreferences, defaultRegion: 'jp' } as const
    vi.spyOn(api, 'preferences').mockResolvedValue({ preferences: remote })
    const save = vi.spyOn(api, 'updatePreferences').mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (_id, patch) => ({ preferences: { ...remote, ...patch } }))
    const first = renderHook(() => useSearchPreferences('first'))
    await waitFor(() => expect(first.result.current.syncStatus).toBe('synced'))
    act(() => first.result.current.update({ ...first.result.current.preferences, limit: 20 }))
    await waitFor(() => expect(first.result.current.syncStatus).toBe('offline'))
    expect(first.result.current.preferences).toMatchObject({ limit: 20, defaultRegion: 'jp' })
    first.unmount()

    const { result } = renderHook(() => useSearchPreferences('first'))
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    expect(save).toHaveBeenLastCalledWith('first', { limit: 20 }, undefined, expect.any(AbortSignal))
    expect(result.current.initialAccountPreferences).toMatchObject({ limit: 20, defaultRegion: 'jp' })
  })

  it('preserves edits made while a preference update is in flight', async () => {
    vi.spyOn(api, 'preferences').mockResolvedValue({ preferences: null })
    let resolveFirst!: (value: { preferences: SearchAccountPreferences }) => void
    const save = vi.spyOn(api, 'updatePreferences').mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockImplementation(async (_id, patch) => ({ preferences: { ...defaultSearchAccountPreferences, limit: 20, ...patch } }))
    const { result } = renderHook(() => useSearchPreferences('first'))
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    act(() => result.current.update({ ...result.current.preferences, limit: 20 }))
    act(() => result.current.update({ ...result.current.preferences, defaultRegion: 'ca' }))
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => resolveFirst({ preferences: { ...defaultSearchAccountPreferences, limit: 20 } }))
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    expect(save).toHaveBeenLastCalledWith('first', { defaultRegion: 'ca' }, undefined, expect.any(AbortSignal))
    expect(result.current.preferences).toMatchObject({ limit: 20, defaultRegion: 'ca' })
  })

  it('syncs an edit when browser storage can be read but cannot be written', async () => {
    vi.spyOn(api, 'preferences').mockResolvedValue({ preferences: defaultSearchAccountPreferences })
    const save = vi.spyOn(api, 'updatePreferences').mockImplementation(async (_id, patch) => ({
      preferences: { ...defaultSearchAccountPreferences, ...patch },
    }))
    const { result } = renderHook(() => useSearchPreferences('first'))
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage quota reached') })
    act(() => result.current.update({ ...result.current.preferences, newTab: true }))
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'))
    expect(save).toHaveBeenCalledWith('first', { newTab: true }, undefined, expect.any(AbortSignal))
    expect(result.current.preferences.newTab).toBe(true)
  })
})
