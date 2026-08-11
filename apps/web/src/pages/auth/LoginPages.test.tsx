import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null,
    login: vi.fn(),
    passkeyLogin: vi.fn(),
    signupEnabled: true,
    setupRequired: false,
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuth: Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    { getState: () => authState },
  ),
}))
vi.mock('@/lib/passkeys', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  browserSupportsWebAuthnAutofill: vi.fn(async () => false),
  cancelPasskeyCeremony: vi.fn(),
}))

import { LoginPage } from './LoginPage'
import { LoginOptionsPage } from './LoginOptionsPage'

describe('login pages', () => {
  it('keeps the password-first login design with a small options link', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(markup).toContain('Welcome back')
    expect(markup).toContain('More login options')
    expect(markup).toContain('href="/login/options"')
    expect(markup).toContain('autoComplete="username webauthn"')
    expect(markup).not.toContain('Sign in with a passkey')
  })

  it('puts passkey sign-in and back navigation on the options page', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LoginOptionsPage /></MemoryRouter>)

    expect(markup).toContain('Sign in with a passkey')
    expect(markup).toContain('href="/login"')
    expect(markup).toContain('Back')
  })
})
