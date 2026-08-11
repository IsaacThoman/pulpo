import { describe, expect, it } from 'vitest'
import { pkceChallenge } from './passkeys.js'

describe('mobile passkey PKCE', () => {
  it('matches the RFC 7636 S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('does not accept a verifier as its own challenge', () => {
    const verifier = 'A'.repeat(43)
    expect(pkceChallenge(verifier)).not.toBe(verifier)
    expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
