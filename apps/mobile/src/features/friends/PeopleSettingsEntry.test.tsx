// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ platform: 'ios', apiRequest: vi.fn(), usageLimits: true }))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))

vi.mock('react-native', () => ({ Platform: { get OS() { return mocks.platform } }, Alert: { alert: vi.fn() } }))
vi.mock('@expo/ui/swift-ui', () => ({
  HStack: passthrough, VStack: passthrough, Spacer: () => null, Image: () => null,
  Section: ({ title, children }: { title?: string; children: ReactNode }) => createElement('section', { 'aria-label': title }, children),
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  Button: ({ onPress, children }: { onPress?: () => void; children?: ReactNode }) => createElement('button', { onClick: onPress }, children),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ shapes: { rectangle: () => ({}), capsule: () => ({}) }, ...Object.fromEntries([
  'background', 'buttonStyle', 'contentShape', 'font', 'foregroundStyle', 'frame', 'lineLimit', 'padding',
].map((type) => [type, (value: unknown) => ({ type, value })])) }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ red: 'red' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Card: passthrough,
  SectionTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  ListRow: ({ title, detail, value, onPress }: { title: string; detail?: string; value?: string; onPress?: () => void }) => createElement('button', { onClick: onPress }, ...[title, detail, value].filter(Boolean).map((text) => createElement('span', { key: text }, text))),
}))
vi.mock('../../api/client', () => ({ apiRequest: mocks.apiRequest, ApiError: class ApiError extends Error {}, isNetworkError: () => false }))
vi.mock('../../store/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({
    instanceUrl: 'https://pulpo.test',
    user: { id: 'me', name: 'Myself', username: 'myself' },
    config: { capabilities: { usageLimits: mocks.usageLimits }, auth: { inviteCodesEnabled: false } },
  }),
}))
import { PeopleSettingsEntry } from './PeopleSettingsEntry'

const open = { profile: vi.fn(), friends: vi.fn(), leaderboard: vi.fn() }
let counts: { friends: number; pool: number }

beforeEach(() => {
  mocks.usageLimits = true
  counts = { friends: 0, pool: 0 }
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path === '/api/friends/pending-count') return { count: counts.friends }
    if (path === '/api/pools/pending-count') return { count: counts.pool }
    throw new Error(`Unexpected ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PeopleSettingsEntry onOpenProfile={open.profile} onOpenFriends={open.friends} onOpenLeaderboard={open.leaderboard} />
  </QueryClientProvider>)
}

describe.each(['ios', 'android'])('People in Settings on %s', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it('leads to your profile, Friends, and the leaderboard', async () => {
    mount()
    fireEvent.click(screen.getByText('Profile').closest('button')!)
    expect(open.profile).toHaveBeenCalledWith('myself')
    expect(screen.getByText('@myself')).toBeTruthy()
    fireEvent.click(screen.getByText('Friends').closest('button')!)
    expect(open.friends).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('Leaderboard').closest('button')!)
    expect(open.leaderboard).toHaveBeenCalledOnce()
    await screen.findByText('Friends, requests, and your Pool')
  })

  it('badges Friends with the requests and Pool invitations waiting', async () => {
    counts = { friends: 2, pool: 1 }
    mount()
    await screen.findByText('3 requests waiting')
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('leaves the Pool out where the instance has none', async () => {
    mocks.usageLimits = false
    counts = { friends: 0, pool: 5 }
    mount()
    await screen.findByText('Friends and requests')
    expect(mocks.apiRequest).not.toHaveBeenCalledWith('/api/pools/pending-count')
  })
})
