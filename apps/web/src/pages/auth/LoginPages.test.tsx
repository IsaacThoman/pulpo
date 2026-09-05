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

import { AccountDeletionPage } from './AccountDeletionPage'
import { LoginPage } from './LoginPage'
import { LoginOptionsPage } from './LoginOptionsPage'
import i18n from '@/i18n'

afterEach(async () => {
  await i18n.changeLanguage('en-US')
  Reflect.deleteProperty(globalThis, 'window')
})

describe('login pages', () => {
  it('keeps the password-first login design with a small options link', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(markup).toContain('Welcome back')
    expect(markup).toContain('More login options')
    expect(markup).toContain('href="/login/options"')
    expect(markup).toContain('href="/forgot-password"')
    expect(markup.indexOf('More login options')).toBeLessThan(markup.indexOf('Forgot password?'))
    expect(markup.match(/text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline/g)).toHaveLength(2)
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

  it('renders the login surface in Spanish', async () => {
    await i18n.changeLanguage('es-ES')

    const markup = renderToStaticMarkup(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(markup).toContain('Te damos la bienvenida')
    expect(markup).toContain('Inicia sesión en tu cuenta de Pulpo.')
    expect(markup).toContain('Más opciones de inicio de sesión')
    expect(markup).toContain('¿Olvidaste tu contraseña?')
  })
  it('shows deletion confirmation on its own page with a link to sign in and no credential form', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><AccountDeletionPage /></MemoryRouter>)
    expect(markup).toContain('Account deletion in progress')
    expect(markup).toContain('cleanup will continue automatically')
    expect(markup).toContain('href="/login"')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('Some data on this device')
  })

  it('keeps cleanup warnings on the confirmation page and deletion notices off login', () => {
    const initialEntries = [{ pathname: '/account-deletion', state: { accountDeletionRequested: true, accountDeletionCleanupFailed: true } }]
    const confirmation = renderToStaticMarkup(<MemoryRouter initialEntries={initialEntries}><AccountDeletionPage /></MemoryRouter>)
    expect(confirmation).toContain('Some data on this device could not be removed')
    const login = renderToStaticMarkup(<MemoryRouter initialEntries={initialEntries}><LoginPage /></MemoryRouter>)
    expect(login).not.toContain('Account deletion')
    expect(login).not.toContain('Some data on this device')
  })

})
