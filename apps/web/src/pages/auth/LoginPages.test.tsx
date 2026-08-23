import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null,
    login: vi.fn(),
    passkeyLogin: vi.fn(),
    signupEnabled: true,
    setupRequired: false,
    instanceUrl: 'https://pulpo.baby',
    chooseInstance: vi.fn(),
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

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('login pages', () => {
  it('keeps the password-first login design with a small options link', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(markup).toContain('Welcome back')
    expect(markup).toContain('More login options')
    expect(markup).toContain('href="/login/options"')
    expect(markup).toContain('autoComplete="username webauthn"')
    expect(markup).not.toContain('Sign in with a passkey')
    expect(markup).not.toContain('Change server, currently')
  })

  it('shows the selected instance below the desktop login card', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        pulpoDesktop: { platform: 'desktop' },
        location: { origin: 'https://desktop.pulpo.invalid' },
      },
    })

    const markup = renderToStaticMarkup(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(markup).toContain('https://pulpo.baby')
    expect(markup).toContain('Change server, currently https://pulpo.baby')
    expect(markup).toContain('Change</span>')
  })

  it('puts passkey sign-in and back navigation on the options page', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LoginOptionsPage /></MemoryRouter>)

    expect(markup).toContain('Sign in with a passkey')
    expect(markup).toContain('href="/login"')
    expect(markup).toContain('Back')
  })
})
