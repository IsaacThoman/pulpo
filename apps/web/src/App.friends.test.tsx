// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { Outlet, useParams, useSearchParams } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ bootstrap: mocks.bootstrap, checkingSession: false, instanceReady: true, user: { id: 'me', username: 'octo' } }) }))
vi.mock('@/lib/instance-features', () => ({ refreshInstanceFeatures: vi.fn() }))
vi.mock('@/lib/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('@/components/auth/RequireAuth', () => ({ RequireAuth: () => <Outlet /> }))
vi.mock('@/components/auth/RequireAdmin', () => ({ RequireAdmin: () => <Outlet /> }))
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: () => <Outlet /> }))
vi.mock('@/pages/auth/AuthLayout', () => ({ AuthLayout: () => <Outlet /> }))
vi.mock('@/components/desktop/DesktopInstancePage', () => ({ DesktopInstancePage: () => null }))
vi.mock('@/components/desktop/DesktopTitleBar', () => ({ DesktopTitleBar: () => null }))
vi.mock('@/pages/FriendsPage', () => ({ FriendsPage: () => <h1>Combined friends page</h1> }))
vi.mock('@/pages/ProfilePage', () => ({ ProfilePage: () => {
  const { username } = useParams()
  return <h1>{`Profile: ${username}`}</h1>
} }))
vi.mock('@/pages/usage/LeaderboardPage', () => ({
  LeaderboardPage: () => null,
  FriendsLeaderboardPage: () => {
    const [params] = useSearchParams()
    return <h1>{`Friends leaderboard: ${params.get('scope') ?? 'friends'}`}</h1>
  },
}))

afterEach(cleanup)
it('replaces the legacy Pool URL with Friends without adding a history entry', async () => {
  window.history.replaceState({}, '', '/friends/pool')
  const length = window.history.length
  render(<App />)
  await screen.findByRole('heading', { name: 'Combined friends page' })
  expect(window.location.pathname).toBe('/friends')
  expect(window.history.length).toBe(length)
})

it('shows People and Leaderboard tabs on the Friends hub', async () => {
  window.history.replaceState({}, '', '/friends')
  render(<App />)
  await screen.findByRole('heading', { name: 'Combined friends page' })
  expect(screen.getByRole('link', { name: 'People' }).getAttribute('href')).toBe('/friends')
  expect(screen.getByRole('link', { name: 'Leaderboard' }).getAttribute('href')).toBe('/friends/leaderboard')
  expect(screen.queryByRole('link', { name: 'Personal usage' })).toBeNull()
})

it('shows profiles at their root username URL', async () => {
  window.history.replaceState({}, '', '/alice')
  render(<App />)
  await screen.findByRole('heading', { name: 'Profile: alice' })
  expect(screen.queryByRole('link', { name: 'People' })).toBeNull()
})

it('links the leaderboard back to personal usage on your profile', async () => {
  window.history.replaceState({}, '', '/friends/leaderboard')
  render(<App />)
  await screen.findByRole('heading', { name: 'Friends leaderboard: friends' })
  expect(screen.getByRole('link', { name: 'Personal usage' }).getAttribute('href')).toBe('/octo')
})

it('replaces the personal usage URL with your profile', async () => {
  window.history.replaceState({}, '', '/usage')
  const length = window.history.length
  render(<App />)
  await screen.findByRole('heading', { name: 'Profile: octo' })
  expect(window.location.pathname).toBe('/octo')
  expect(window.history.length).toBe(length)
})

it.each([
  ['/usage/friends', 'friends', ''],
  ['/usage/leaderboard', 'friends', ''],
  ['/usage/pool', 'pool', '?scope=pool'],
])('moves the legacy %s leaderboard into the Friends hub', async (legacy, scope, search) => {
  window.history.replaceState({}, '', legacy)
  const length = window.history.length
  render(<App />)
  await screen.findByRole('heading', { name: `Friends leaderboard: ${scope}` })
  expect(window.location.pathname).toBe('/friends/leaderboard')
  expect(window.location.search).toBe(search)
  expect(window.history.length).toBe(length)
})
