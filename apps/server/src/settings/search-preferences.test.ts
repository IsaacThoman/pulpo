import { defaultSearchAccountPreferences, SEARCH_ACCOUNT_PREFERENCES_KEY } from '@pulpo/contracts/search'
import { describe, expect, it } from 'vitest'
import { savedSearchPreferences, searchPreferencesUpdate } from './search-preferences.js'

const accountId = '00000000-0000-4000-8000-000000000001'
const saved = (value: unknown) => savedSearchPreferences({ [SEARCH_ACCOUNT_PREFERENCES_KEY]: value })

describe('Search account preferences', () => {
  it('stores an engine choice for each search type', () => {
    const categoryProviders = {
      images: { defaultProvider: 'firecrawl', fallbackProvider: 'none' },
      news: { defaultProvider: 'kagi', fallbackProvider: '' },
    } as const
    expect(searchPreferencesUpdate.parse({ accountId, patch: { categoryProviders } }).patch).toEqual({ categoryProviders })
    expect(saved({ ...defaultSearchAccountPreferences, categoryProviders })).toEqual({ ...defaultSearchAccountPreferences, categoryProviders })
    expect(() => searchPreferencesUpdate.parse({
      accountId, patch: { categoryProviders: { web: { defaultProvider: 'kagi', fallbackProvider: '' } } },
    })).toThrow()
    expect(() => searchPreferencesUpdate.parse({
      accountId, patch: { categoryProviders: { images: { defaultProvider: '', fallbackProvider: '' } } },
    })).toThrow()
  })

  it('reads settings saved before engines could differ by search type', () => {
    const { categoryProviders: _categoryProviders, ...older } = { ...defaultSearchAccountPreferences, limit: 20 as const }
    expect(saved(older)).toEqual({ ...defaultSearchAccountPreferences, limit: 20 })
  })

  it('keeps every readable field when another release saved one it does not understand', () => {
    expect(saved({
      ...defaultSearchAccountPreferences,
      defaultProvider: 'firecrawl',
      domains: { 'example.com': 'pin' },
      categoryProviders: { images: { defaultProvider: 'kagi', fallbackProvider: '', ranking: 'new' } },
      futureSetting: true,
    })).toEqual({ ...defaultSearchAccountPreferences, defaultProvider: 'firecrawl', domains: { 'example.com': 'pin' } })
    expect(saved('not settings')).toBeNull()
  })
})
