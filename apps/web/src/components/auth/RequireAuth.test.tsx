// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const { authState, runtime } = vi.hoisted(() => ({
  authState: {
    user: null as { id: string; role: string } | null,
    checkingSession: false,
    bootstrap: vi.fn(async () => {}),
    instanceName: 'Pulpo',
    signupEnabled: false,
    setupRequired: false,
    login: vi.fn(),
    signedInAccounts: [],
    refreshSignedInAccounts: vi.fn(async () => {}),
  },
  runtime: { desktop: false },
}))

vi.mock('@/stores/auth', () => ({
  useAuth: Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    { getState: () => authState },
  ),
}))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => runtime.desktop }))

import { authReturnLoginState } from '@/lib/auth-return'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RequireAuth } from './RequireAuth'

const chatPath = '/c/00000000-0000-7000-8000-0000000000c1'

function OpenedChat() {
  return <p>{useLocation().pathname}</p>
}

function renderAt(path: string, login: ReactNode = <p>login page</p>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="login" element={login} />
        <Route element={<RequireAuth />}>
          <Route index element={<p>chat page</p>} />
          <Route path="c/:chatId" element={<OpenedChat />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  authState.user = null
  runtime.desktop = false
})

describe('RequireAuth', () => {
  it('shows the landing page at the root when signed out', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
    expect(screen.queryByText('chat page')).toBeNull()
  })

  it('redirects other signed-out routes to login', () => {
    renderAt('/c/abc')
    expect(screen.getByText('login page')).toBeTruthy()
  })

  it('returns to the requested chat after signing in', async () => {
    authState.login.mockImplementationOnce(async () => {
      authState.user = { id: 'owner', role: 'user' }
      return { ok: true }
    })
    renderAt(chatPath, <LoginPage />)

    expect(screen.queryByText(chatPath)).toBeNull()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(chatPath)).toBeTruthy()
  })

  it.each([`//example.test${chatPath}`, `https://example.test${chatPath}`, `${chatPath}/other`, `${chatPath}?next=/`, '/c/invalid'])('rejects invalid chat login return %s', (from) => {
    expect(authReturnLoginState({ from })).toBeUndefined()
  })

  it('keeps sending desktop users straight to login', () => {
    runtime.desktop = true
    renderAt('/')
    expect(screen.getByText('login page')).toBeTruthy()
  })

  it('shows the landing page at the root while the session is still being checked', () => {
    authState.checkingSession = true
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
    authState.checkingSession = false
  })

  it('keeps the spinner on other routes while the session is being checked', () => {
    authState.checkingSession = true
    renderAt('/c/abc')
    expect(screen.queryByText('login page')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
    authState.checkingSession = false
  })

  it('renders the app for signed-in users', () => {
    authState.user = { id: 'u1', role: 'user' }
    renderAt('/')
    expect(screen.getByText('chat page')).toBeTruthy()
  })
})
