import { describe, expect, it } from 'vitest'
import { readSearchConnectInput } from './search-connect'
import { authReturnLoginState, searchHandoffReturn } from './auth-return'
import { SEARCH_HANDOFF_PATH } from '@pulpo/contracts/search'

const challenge = 'c'.repeat(43)
const state = 's'.repeat(43)
const query = `code_challenge=${challenge}&state=${state}`

describe('Pulpo Search login return', () => {
  it('keeps the verified handoff shape through login', () => {
    expect(readSearchConnectInput(`?${query}`)).toEqual({ codeChallenge: challenge, state })
    expect(authReturnLoginState({ from: `/connect/search?${query}&redirect_uri=https://other.test` }))
      .toEqual({ from: `/connect/search?${query}` })
  })

  it('ignores external, unrelated, or malformed destinations', () => {
    expect(authReturnLoginState({ from: `//example.test/connect/search?${query}` })).toBeUndefined()
    expect(authReturnLoginState({ from: `/login?${query}` })).toBeUndefined()
    expect(authReturnLoginState({ from: '/connect/search?code_challenge=short' })).toBeUndefined()
    expect(authReturnLoginState(null)).toBeUndefined()
  })

  it('carries the search draft in the fragment through sign-in and filters untrusted return data', () => {
    const hash = '#q=Tide+pools&source=https%3A%2F%2Fwww.nps.gov%2F&source=http%3A%2F%2Flocalhost'
    const from = `${SEARCH_HANDOFF_PATH}#q=Tide+pools&source=https%3A%2F%2Fwww.nps.gov%2F`
    expect(searchHandoffReturn(SEARCH_HANDOFF_PATH, hash)).toBe(from)
    expect(authReturnLoginState({ from: SEARCH_HANDOFF_PATH + hash })).toEqual({ from })
    expect(authReturnLoginState({ from: '//elsewhere.test' + from })).toBeUndefined()
    expect(authReturnLoginState({ from: SEARCH_HANDOFF_PATH + '#q=missing+sources' })).toBeUndefined()
  })
})
