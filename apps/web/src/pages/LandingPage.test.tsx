import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { authState } = vi.hoisted(() => ({
  authState: {
    instanceName: 'Pulpo',
    signupEnabled: false,
    setupRequired: false,
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuth: Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    { getState: () => authState },
  ),
}))

import { LandingPage } from './LandingPage'
import i18n from '@/i18n'

afterEach(async () => {
  await i18n.changeLanguage('en-US')
  authState.signupEnabled = false
  authState.setupRequired = false
})

describe('landing page', () => {
  it('shows the instance name and a log in button', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).toContain('Pulpo')
    expect(markup).toContain('href="/login"')
    expect(markup).toContain('Log in')
    expect(markup).not.toContain('href="/signup"')
    expect(markup).toContain('href="/privacy"')
    expect(markup).toContain('href="/support"')
  })

  it('offers sign up only when signup is enabled', () => {
    authState.signupEnabled = true

    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).toContain('href="/signup"')
    expect(markup).toContain('Sign up')
  })

  it('redirects to setup on a fresh instance', () => {
    authState.setupRequired = true

    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route index element={<LandingPage />} />
          <Route path="setup" element={<p>setup page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(markup).not.toContain('href="/login"')
  })

  it('renders in Spanish', async () => {
    await i18n.changeLanguage('es-ES')

    const markup = renderToStaticMarkup(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(markup).toContain('Iniciar sesión')
    expect(markup).toContain('Una plataforma de IA autoalojada y configurable.')
  })
})
