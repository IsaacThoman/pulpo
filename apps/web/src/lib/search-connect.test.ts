import { describe, expect, it } from 'vitest'
import { readSearchConnectInput, searchConnectLoginState } from './search-connect'

const challenge = 'c'.repeat(43)
const state = 's'.repeat(43)
const query = `code_challenge=${challenge}&state=${state}`

describe('Pulpo Search login return', () => {
  it('keeps the verified handoff shape through login', () => {
    expect(readSearchConnectInput(`?${query}`)).toEqual({ codeChallenge: challenge, state })
    expect(searchConnectLoginState({ from: `/connect/search?${query}&redirect_uri=https://other.test` }))
      .toEqual({ from: `/connect/search?${query}` })
  })

  it('ignores external, unrelated, or malformed destinations', () => {
    expect(searchConnectLoginState({ from: `//example.test/connect/search?${query}` })).toBeUndefined()
    expect(searchConnectLoginState({ from: `/login?${query}` })).toBeUndefined()
    expect(searchConnectLoginState({ from: '/connect/search?code_challenge=short' })).toBeUndefined()
    expect(searchConnectLoginState(null)).toBeUndefined()
  })
})
