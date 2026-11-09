// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FriendProfile, FriendProfileDetail } from '@pulpo/contracts'

type Modifier = { type: string; value?: unknown }
const mocks = vi.hoisted(() => ({ platform: 'ios', apiRequest: vi.fn(), alert: vi.fn(), push: vi.fn() }))
const { passthrough, modifier } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: unknown }) => children,
  modifier: (modifiers: unknown, type: string) => (modifiers as Modifier[] | undefined)?.find((item) => item?.type === type)?.value,
}))

vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Alert: { alert: mocks.alert },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}))
vi.mock('@expo/ui/swift-ui', () => ({
  Host: passthrough, Form: passthrough, HStack: passthrough, VStack: passthrough, RNHostView: passthrough,
  Spacer: () => null, Image: () => null, ProgressView: () => null,
  Section: ({ header, footer, children }: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) => createElement('section', null, header, children, footer),
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  Button: ({ label, onPress, children, modifiers }: { label?: string; onPress?: () => void; children?: ReactNode; modifiers?: Modifier[] }) => createElement('button', { onClick: onPress, disabled: Boolean(modifier(modifiers, 'disabled')) }, label ?? children),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ shapes: { rectangle: () => ({}) }, ...Object.fromEntries([
  'accessibilityLabel', 'buttonStyle', 'contentShape', 'controlSize', 'disabled', 'font', 'foregroundStyle', 'frame', 'lineLimit', 'padding', 'tint',
].map((type) => [type, (value: unknown) => ({ type, value })])) }))
vi.mock('../../platform/MaterialUI', () => ({
  MaterialButton: ({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) => createElement('button', { onClick: onPress, disabled: disabled || loading }, label),
}))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../mockup5/src/components/ProfileAvatar', () => ({ ProfileAvatar: () => null }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray', text: 'black', green: 'green', orange: 'orange', blue: 'blue' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Screen: passthrough, Card: passthrough,
  PageHeader: ({ title }: { title: string }) => createElement('h1', null, title),
  SectionTitle: ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => createElement('h2', null, children, trailing),
  ListRow: ({ title, detail, onPress, children }: { title: string; detail?: string; onPress?: () => void; children?: ReactNode }) => createElement('div', null, onPress ? createElement('button', { onClick: onPress }, title) : createElement('span', null, title), detail ? createElement('span', null, detail) : null, children),
}))
vi.mock('../../api/client', () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string) { super(message) } },
  isNetworkError: () => false,
}))
vi.mock('../../store/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({
    instanceUrl: 'https://pulpo.test',
    user: { id: 'me', name: 'Myself', username: 'myself' },
    config: { capabilities: { usageLimits: false }, auth: { inviteCodesEnabled: false } },
  }),
}))
import { ApiError } from '../../api/client'
import { FriendProfileScreen } from './FriendProfileScreen'

const profile = (id: string): FriendProfile => ({ id, displayName: id, username: id.toLowerCase(), avatarUrl: null, profileColor: null })
let detail: FriendProfileDetail
const writes = () => mocks.apiRequest.mock.calls.filter(([, options]) => options?.method)

beforeEach(() => {
  detail = { profile: profile('Alice'), relationship: 'none', requestId: null, friendsSince: null, mutualFriends: [profile('Bob')] }
  mocks.apiRequest.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === 'POST' && path === '/api/friends/requests') {
      detail = { ...detail, relationship: 'outgoing', requestId: 'request-Alice' }
      return { requestId: 'request-Alice', status: 'pending' }
    }
    if (options?.method) return {}
    if (path === '/api/profiles/alice') return structuredClone(detail)
    throw new Error(`Unexpected ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mount(username = 'Alice') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><FriendProfileScreen {...({ navigation: { goBack: vi.fn(), push: mocks.push }, route: { params: { username } } } as unknown as ComponentProps<typeof FriendProfileScreen>)} /></QueryClientProvider>)
  return client
}

describe.each(['ios', 'android'])('Friend profile on %s', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it('shows someone who is not a friend yet and sends them a request', async () => {
    mount()
    await screen.findByText('@alice')
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/profiles/alice')
    fireEvent.click(screen.getByText('Add Friend'))
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests', { method: 'POST', body: { userId: 'Alice' } }]]))
    await screen.findByText('Cancel Request')
  })

  it('accepts an incoming request', async () => {
    detail = { ...detail, relationship: 'incoming', requestId: 'request-Alice' }
    mount()
    fireEvent.click(await screen.findByText('Accept Request'))
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests/request-Alice/accept', { method: 'POST' }]]))
  })

  it('shows when a friendship began and opens mutual friends', async () => {
    detail = { ...detail, relationship: 'friends', requestId: 'request-Alice', friendsSince: '2026-09-01T12:00:00.000Z' }
    mount()
    await screen.findByText(/^Friends since /)
    expect(screen.getByText('Friends')).toBeTruthy()
    expect(screen.queryByText('Add Friend')).toBeNull()
    fireEvent.click(screen.getByText('Bob').closest('button')!)
    expect(mocks.push).toHaveBeenCalledWith('FriendProfile', { username: 'bob' })
  })

  it('leaves out mutual friends on the viewer’s own profile', async () => {
    detail = { ...detail, relationship: 'self', mutualFriends: [] }
    mount()
    await screen.findByText('This is you')
    expect(screen.queryByText('Mutual friends')).toBeNull()
  })

  it('stops showing a profile once it is no longer available', async () => {
    const client = mount()
    await screen.findByText('@alice')
    mocks.apiRequest.mockRejectedValue(new (ApiError as unknown as new (status: number, message: string) => Error)(404, 'Profile not found'))
    await client.refetchQueries()
    await screen.findByText(/Profile not found/)
    expect(screen.queryByText('@alice')).toBeNull()
  })
})
