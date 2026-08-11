import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn() }))
vi.mock('@/lib/passkeys', () => ({
  isPasskeyCancellation: vi.fn(() => false),
  passkeyErrorMessage: vi.fn((_error, fallback: string) => fallback),
  registerPasskey: vi.fn(),
}))

import { PasskeySettings } from './PasskeySettings'

describe('PasskeySettings', () => {
  it('presents passkeys as a complete sign-in method', () => {
    const markup = renderToStaticMarkup(<PasskeySettings />)
    expect(markup).toContain('Passkeys')
    expect(markup).toContain('Sign in securely without a password.')
    expect(markup).toContain('Manage')
  })
})
