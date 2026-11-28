// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import * as auth from './auth'
import { consumeCallback, setPulpoOrigin } from './auth'

const state = 's'.repeat(43)
const verifier = 'v'.repeat(43)
const code = 'c'.repeat(43)

function setupCallback(returnPath: string, overrides: { callbackState?: string; startedAt?: number } = {}) {
  sessionStorage.setItem('pulpo-search-sign-in', JSON.stringify({
    state, verifier, returnPath, startedAt: overrides.startedAt ?? Date.now(),
  }))
  window.history.replaceState(null, '', `/auth/callback?code=${code}&state=${overrides.callbackState ?? state}`)
}

describe('search sign-in handoff', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  it('consumes the one-time parameters and returns to the original search', () => {
    setupCallback('/search?q=tide+pools&type=images')
    expect(consumeCallback()).toEqual({ code, codeVerifier: verifier })
    expect(window.location.pathname + window.location.search).toBe('/search?q=tide+pools&type=images')
    expect(consumeCallback()).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it.each([
    ['https://example.com/search?q=unsafe', {}],
    ['//example.com/search?q=unsafe', {}],
    ['/search?q=same', { callbackState: 'x'.repeat(43) }],
    ['/search?q=expired', { startedAt: Date.now() - 60 * 60_000 }],
  ] as const)('rejects an invalid handoff for %s and strips the code from history', (returnPath, overrides) => {
    setupCallback(returnPath, overrides)
    expect(consumeCallback()).toHaveProperty('error')
    expect(window.location.pathname + window.location.search).toBe('/')
    expect(sessionStorage.length).toBe(0)
  })
})

describe('Pulpo origin', () => {
  it('follows the origin the API names and ignores unusable values', () => {
    setPulpoOrigin('https://pulpo-dev-pr-12.example.org/ignored/path')
    expect(auth.pulpoOrigin).toBe('https://pulpo-dev-pr-12.example.org')
    setPulpoOrigin(undefined)
    setPulpoOrigin('javascript:alert(1)')
    setPulpoOrigin('not a url')
    expect(auth.pulpoOrigin).toBe('https://pulpo-dev-pr-12.example.org')
  })
})
