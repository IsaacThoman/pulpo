// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { authState, runtime } = vi.hoisted(() => ({
  authState: {
    user: null as { id: string; role: string } | null,
    checkingSession: false,
    bootstrap: vi.fn(async () => {}),
    instanceName: 'Pulpo',
    signupEnabled: false,
    setupRequired: false,
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

import { RequireAuth } from './RequireAuth'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="login" element={<p>login page</p>} />
        <Route element={<RequireAuth />}>
          <Route index element={<p>chat page</p>} />
          <Route path="c/:chatId" element={<p>chat page</p>} />
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
