// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { Outlet } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ bootstrap: mocks.bootstrap, checkingSession: false, instanceReady: true, user: { id: 'me' } }) }))
vi.mock('@/lib/instance-features', () => ({ refreshInstanceFeatures: vi.fn() }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('@/components/auth/RequireAuth', () => ({ RequireAuth: () => <Outlet /> }))
vi.mock('@/components/auth/RequireAdmin', () => ({ RequireAdmin: () => <Outlet /> }))
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: () => <Outlet /> }))
vi.mock('@/pages/auth/AuthLayout', () => ({ AuthLayout: () => <Outlet /> }))
vi.mock('@/components/desktop/DesktopInstancePage', () => ({ DesktopInstancePage: () => null }))
vi.mock('@/components/desktop/DesktopTitleBar', () => ({ DesktopTitleBar: () => null }))
vi.mock('@/pages/FriendsPage', () => ({ FriendsPage: () => <h1>Combined friends page</h1> }))

afterEach(cleanup)
it('replaces the legacy Pool URL with Friends without adding a history entry', async () => {
  window.history.replaceState({}, '', '/friends/pool')
  const length = window.history.length
  render(<App />)
  await screen.findByRole('heading', { name: 'Combined friends page' })
  expect(window.location.pathname).toBe('/friends')
  expect(window.history.length).toBe(length)
})
