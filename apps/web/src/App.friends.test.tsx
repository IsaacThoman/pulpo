// @vitest-environment jsdom
import { cleanup, render as renderDom, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, useParams, useSearchParams } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import App from './App'

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), pendingFriendRequests: 0 }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  apiRequest: async (path: string) => ({ count: path === '/api/friends/pending-count' ? mocks.pendingFriendRequests : 0 }),
}))
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

const render = (ui: React.ReactElement) => renderDom(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
const tabs = () => within(screen.getByRole('navigation', { name: 'People sections' }))

beforeEach(() => { mocks.pendingFriendRequests = 0 })
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en-US')
})
it('replaces the legacy Pool URL with Friends without adding a history entry', async () => {
  window.history.replaceState({}, '', '/friends/pool')
  const length = window.history.length
  render(<App />)
  await screen.findByRole('heading', { name: 'Combined friends page' })
  expect(window.location.pathname).toBe('/friends')
  expect(window.history.length).toBe(length)
})

it('shows Profile, Usage and Leaderboard tabs under People, with Usage current', async () => {
  window.history.replaceState({}, '', '/friends')
  render(<App />)
  await screen.findByRole('heading', { name: 'Combined friends page' })
  expect(screen.getByRole('heading', { level: 1, name: 'People' })).toBeTruthy()
  const links = tabs().getAllByRole('link')
  expect(links.map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
    ['Profile', '/octo', null],
    ['Usage', '/friends', 'page'],
    ['Leaderboard', '/friends/leaderboard', null],
  ])
  // Phones give the tabs the whole header, so the heading is only read aloud there.
  expect([...screen.getByRole('heading', { level: 1, name: 'People' }).classList]).toEqual(expect.arrayContaining(['sr-only', 'sm:not-sr-only']))
})

it('labels the People tabs in Spanish, with a Leaderboard tab short enough for a phone header', async () => {
  await i18n.changeLanguage('es-ES')
  window.history.replaceState({}, '', '/friends/leaderboard')
  render(<App />)
  await screen.findByRole('heading', { name: 'Friends leaderboard: friends' })
  expect(screen.getByRole('heading', { level: 1, name: 'Personas' })).toBeTruthy()
  const links = within(screen.getByRole('navigation', { name: 'Secciones de personas' })).getAllByRole('link')
  expect(links.map((link) => [link.textContent, link.getAttribute('aria-current')])).toEqual([
    ['Perfil', null],
    ['Uso', null],
    ['Clasificación', 'page'],
  ])
})

it('badges the Usage tab with pending requests', async () => {
  mocks.pendingFriendRequests = 3
  window.history.replaceState({}, '', '/friends/leaderboard')
  render(<App />)
  const usage = await screen.findByRole('link', { name: 'Usage, 3 pending' })
  expect(usage.getAttribute('href')).toBe('/friends')
  expect(usage.textContent).toBe('Usage3')
})

it('shows profiles at their root username URL', async () => {
  window.history.replaceState({}, '', '/alice')
  render(<App />)
  await screen.findByRole('heading', { name: 'Profile: alice' })
  expect(screen.queryByRole('navigation', { name: 'People sections' })).toBeNull()
})

it('marks the Leaderboard tab current, with your profile as its own tab instead of a usage link', async () => {
  window.history.replaceState({}, '', '/friends/leaderboard')
  render(<App />)
  await screen.findByRole('heading', { name: 'Friends leaderboard: friends' })
  expect(tabs().getByRole('link', { name: 'Leaderboard' }).getAttribute('aria-current')).toBe('page')
  expect(tabs().getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/octo')
  expect(screen.queryByRole('link', { name: 'Personal usage' })).toBeNull()
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
