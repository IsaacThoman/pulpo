// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, FriendSearchResult, FriendsList, PoolSummary } from '@pulpo/contracts'

type Modifier = { type: string; value?: unknown }
type AlertButton = { text: string; style?: string; onPress?: () => void }
const mocks = vi.hoisted(() => ({
  platform: 'ios',
  usageLimits: true,
  apiRequest: vi.fn(),
  alert: vi.fn(),
  showActions: vi.fn(),
  push: vi.fn(),
}))
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
  Pressable: ({ children, onPress, accessibilityLabel }: { children?: ReactNode; onPress?: () => void; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(() => Promise.resolve(true)) }))
vi.mock('@expo/ui/swift-ui', () => ({
  Host: passthrough, Form: passthrough, HStack: passthrough, VStack: passthrough, RNHostView: passthrough,
  Spacer: () => null, Image: () => null, Divider: () => createElement('hr'), ProgressView: () => null,
  Section: ({ title, header, footer, children }: { title?: string; header?: ReactNode; footer?: ReactNode; children: ReactNode }) => createElement('section', { 'aria-label': title }, header, children, footer),
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  Button: ({ label, onPress, children, modifiers }: { label?: string; onPress?: () => void; children?: ReactNode; modifiers?: Modifier[] }) => createElement('button', { onClick: onPress, disabled: Boolean(modifier(modifiers, 'disabled')), 'aria-label': modifier(modifiers, 'accessibilityLabel') as string | undefined }, label ?? children),
  Menu: ({ children, modifiers }: { children: ReactNode; modifiers?: Modifier[] }) => createElement('div', { role: 'menu', 'aria-label': modifier(modifiers, 'accessibilityLabel') as string }, children),
  DisclosureGroup: ({ label, isExpanded, onIsExpandedChange, children }: { label: string; isExpanded: boolean; onIsExpandedChange: (open: boolean) => void; children: ReactNode }) => createElement('div', null, createElement('button', { onClick: () => onIsExpandedChange(!isExpanded) }, label), isExpanded ? children : null),
  TextField: ({ onTextChange, modifiers }: { onTextChange: (value: string) => void; modifiers?: Modifier[] }) => createElement('input', { 'aria-label': modifier(modifiers, 'accessibilityLabel') as string, onChange: (event: { target: { value: string } }) => onTextChange(event.target.value) }),
  useNativeState: (value: string) => ({ get: () => value, set: vi.fn() }),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ shapes: { rectangle: () => ({}) }, ...Object.fromEntries([
  'accessibilityLabel', 'autocorrectionDisabled', 'buttonStyle', 'contentShape', 'controlSize', 'disabled', 'font', 'foregroundStyle', 'frame', 'labelStyle', 'lineLimit', 'padding', 'scrollDismissesKeyboard', 'textFieldStyle', 'textInputAutocapitalization', 'tint',
].map((type) => [type, (value: unknown) => ({ type, value })])) }))
vi.mock('../../platform/MaterialUI', () => ({
  MaterialButton: ({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) => createElement('button', { onClick: onPress, disabled: disabled || loading }, label),
  MaterialIconButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled, 'aria-label': label }),
  MaterialNavigationRow: ({ title, onPress }: { title: string; onPress: () => void }) => createElement('button', { onClick: onPress }, title),
}))
vi.mock('../../platform/materialActions', () => ({ showActions: mocks.showActions }))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../mockup5/src/components/ProfileAvatar', () => ({ ProfileAvatar: () => null }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray', text: 'black', green: 'green', orange: 'orange', blue: 'blue', red: 'red' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Screen: passthrough, Card: passthrough,
  PageHeader: ({ title }: { title: string }) => createElement('h1', null, title),
  SectionTitle: ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => createElement('h2', null, children, trailing),
  EmptyState: ({ title, detail }: { title: string; detail: string }) => createElement('div', null, title, detail),
  Field: ({ label, onChangeText }: { label: string; onChangeText: (value: string) => void }) => createElement('input', { 'aria-label': label, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }),
  // A pressable row's title is its own button, so presses on its trailing actions don't open it, as in React Native.
  ListRow: ({ title, detail, value, onPress, children }: { title: string; detail?: string; value?: string; onPress?: () => void; children?: ReactNode }) => createElement('div', null, onPress ? createElement('button', { onClick: onPress }, title) : createElement('span', null, title), ...[detail, value].filter(Boolean).map((text) => createElement('span', { key: text }, text)), children),
}))
vi.mock('../usage-limits/UsageLimitsSettings', () => ({
  NativeUsageLimit: ({ row }: { row: { label: string; remainingPercentage: number } }) => createElement('div', null, `${row.label}: ${row.remainingPercentage}% left`),
  UsageLimitCard: ({ row }: { row: { label: string; remainingPercentage: number } }) => createElement('div', null, `${row.label}: ${row.remainingPercentage}% left`),
}))
vi.mock('../../api/client', () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error { status = 0 },
  isNetworkError: () => false,
}))
vi.mock('../../store/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({
    instanceUrl: 'https://pulpo.test',
    user: { id: 'me', name: 'Myself', username: 'myself' },
    config: { capabilities: { usageLimits: mocks.usageLimits }, auth: { inviteCodesEnabled: false } },
  }),
}))
import { FriendsScreen } from './FriendsScreen'

const profile = (id: string): FriendProfile => ({ id, displayName: id, username: id.toLowerCase(), avatarUrl: null, profileColor: null })
const connection = (id: string, mutualFriends?: FriendProfile[]): FriendConnection => ({ requestId: `request-${id}`, profile: profile(id), requestedAt: new Date().toISOString(), acceptedAt: null, ...(mutualFriends ? { mutualFriends } : {}) })
const member = (id: string, owner = false) => ({ profile: profile(id), owner, contributionBalanceMicros: 5_000_000, reservedMicros: 100_000, joinedAt: '2026-09-01T00:00:00.000Z' })

let friends: FriendsList
let summary: PoolSummary
let searchResults: FriendSearchResult[]
const writes = () => mocks.apiRequest.mock.calls.filter(([, options]) => options?.method)
const lastAlert = () => mocks.alert.mock.calls.at(-1) as [string, string | undefined, AlertButton[]]
const pressAlert = (label: string) => lastAlert()[2].find((button) => button.text === label)!.onPress!()

beforeEach(() => {
  friends = { friends: ['Alice', 'Bob', 'Cara'].map((id) => connection(id)), incoming: [connection('Dan')], outgoing: [connection('Eve')], blocked: [profile('Finn')] }
  summary = { accountBalanceMicros: 5_000_000, incomingInvitations: [], pool: { id: 'pool', ownerUserId: 'me', pooledBalanceMicros: 10_000_000, members: [member('me', true), member('Alice')], pendingInvitations: [], sharedUsage: null } }
  searchResults = []
  mocks.apiRequest.mockImplementation(async (path: string, options?: { method?: string; body?: { userId?: string } }) => {
    if (options?.method === 'POST' && path === '/api/friends/requests') {
      searchResults = searchResults.map((result) => result.profile.id === options.body?.userId ? { ...result, relationship: 'outgoing', requestId: 'new' } : result)
      return { requestId: 'new', status: 'pending' }
    }
    if (options?.method === 'DELETE' && path.startsWith('/api/friends/requests/')) {
      const requestId = path.split('/').at(-1)
      friends = { ...friends, incoming: friends.incoming.filter((item) => item.requestId !== requestId), outgoing: friends.outgoing.filter((item) => item.requestId !== requestId) }
      searchResults = searchResults.map((result) => result.requestId === requestId ? { ...result, relationship: 'none', requestId: null } : result)
      return {}
    }
    if (options?.method) return {}
    if (path === '/api/friends') return structuredClone(friends)
    if (path === '/api/pools/me') return structuredClone(summary)
    if (path.startsWith('/api/friends/search')) return { results: searchResults }
    throw new Error(`Unexpected ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.usageLimits = true })

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><FriendsScreen {...({ navigation: { goBack: vi.fn(), push: mocks.push }, route: {} } as unknown as ComponentProps<typeof FriendsScreen>)} /></QueryClientProvider>)
}

/** The actions in a person's menu: inline on iOS, a Material menu on Android. */
function menuAction(name: string, label: string) {
  if (mocks.platform === 'ios') {
    fireEvent.click(within(screen.getByRole('menu', { name: `More options for ${name}` })).getByText(label))
    return
  }
  fireEvent.click(screen.getByRole('button', { name: `More options for ${name}` }))
  const [, actions] = mocks.showActions.mock.calls.at(-1) as [string, { label: string; onPress: () => void }[]]
  actions.find((action) => action.label === label)!.onPress()
}

describe.each(['ios', 'android'])('Friends on %s', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it('lists requests, the Pool, and friends outside it, without any amounts', async () => {
    mount()
    await screen.findByText('Dan')
    expect(screen.getByText(/@dan · Requested today/)).toBeTruthy()
    await screen.findByText(/2 of 6 members/)
    expect(screen.getAllByText('Alice')).toHaveLength(1)
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('Cara')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\$|credit|balance|reserved/i)
  })

  it('accepts a friend request and refreshes the lists', async () => {
    mount()
    await screen.findByText('Dan')
    const before = mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/friends').length
    fireEvent.click(screen.getAllByText('Accept')[0]!)
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests/request-Dan/accept', { method: 'POST' }]]))
    await waitFor(() => expect(mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/friends').length).toBeGreaterThan(before))
  })

  it('finds people and sends a friend request', async () => {
    searchResults = [{ profile: profile('Gus'), relationship: 'none', requestId: null, matchedOn: 'username' }]
    mount()
    await screen.findByText('Dan')
    fireEvent.change(screen.getByLabelText('Search friends'), { target: { value: '@Gus' } })
    fireEvent.click(await screen.findByText('Add'))
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests', { method: 'POST', body: { userId: 'Gus' } }]]))
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/friends/search?q=gus', expect.anything())
    await screen.findByText('Request sent')
  })

  it('invites a friend to the Pool only after confirming what is shared', async () => {
    mount()
    await screen.findByText(/2 of 6 members/)
    menuAction('Bob', 'Invite to Pool')
    const [title, message] = lastAlert()
    expect(title).toBe('Invite Bob to your Pool?')
    expect(message).not.toMatch(/\$|credit|balance/i)
    expect(writes()).toEqual([])
    pressAlert('Invite and Share')
    await waitFor(() => expect(writes()).toEqual([['/api/pools/invitations', { method: 'POST', body: { userId: 'Bob', balanceDisclosureAccepted: true } }]]))
  })

  it('confirms before blocking someone', async () => {
    mount()
    await screen.findByText('Cara')
    menuAction('Cara', 'Block')
    expect(lastAlert()[0]).toBe('Block Cara?')
    pressAlert('Block')
    await waitFor(() => expect(writes()).toEqual([['/api/friends/blocks', { method: 'POST', body: { userId: 'Cara' } }]]))
  })

  it('keeps the owner from leaving until ownership is transferred', async () => {
    mount()
    await screen.findByText(/2 of 6 members/)
    expect(screen.getByText('Transfer ownership before leaving this Pool.')).toBeTruthy()
    const leave = screen.getByText('Leave Pool').closest('button, div')!
    expect(leave.tagName === 'DIV' || (leave as HTMLButtonElement).disabled).toBe(true)
  })

  it('joins a Pool after confirming what is shared', async () => {
    summary = { accountBalanceMicros: 0, pool: null, incomingInvitations: [{ id: 'invite', poolId: 'pool', inviter: profile('Alice'), invitee: profile('me'), memberCount: 3, createdAt: '2026-09-01T00:00:00.000Z' }] }
    mount()
    await screen.findByText(/@alice · 3 of 6 members/)
    fireEvent.click(screen.getByText('Join'))
    expect(lastAlert()[0]).toBe('Join this Pool?')
    pressAlert('Join and Share')
    await waitFor(() => expect(writes()).toEqual([['/api/pools/invitations/invite/accept', { method: 'POST', body: { balanceDisclosureAccepted: true } }]]))
  })

  it('separates the owner’s Pool actions from friend actions on a member', async () => {
    mount()
    await screen.findByText(/2 of 6 members/)
    if (mocks.platform === 'ios') {
      const menu = screen.getByRole('menu', { name: 'More options for Alice' })
      expect([...menu.children].map((child) => child.tagName === 'HR' ? '—' : child.textContent)).toEqual(['Make Owner', 'Remove from Pool', '—', 'Remove Friend', 'Block'])
      return
    }
    fireEvent.click(screen.getByRole('button', { name: 'More options for Alice' }))
    const [, actions] = mocks.showActions.mock.calls.at(-1) as [string, { label: string }[]]
    expect(actions.map((action) => action.label)).toEqual(['Make Owner', 'Remove from Pool', 'Remove Friend', 'Block'])
  })

  it('shows the Pool’s shared usage as percentages', async () => {
    const bar = { remainingPercentage: 64, availableBarPercentage: 64, pendingMicros: 0, pendingBarPercentage: 0, resetsAt: null }
    summary.pool!.sharedUsage = { total: bar, fiveHour: null }
    mount()
    await screen.findByText('Shared usage: 64% left')
  })

  it('hides Pools on instances that do not bill usage', async () => {
    mocks.usageLimits = false
    mount()
    await screen.findByText('Bob')
    expect(screen.getAllByText('Alice')).toHaveLength(1)
    expect(mocks.apiRequest).not.toHaveBeenCalledWith('/api/pools/me')
    expect(screen.queryByText(/of 6 members/)).toBeNull()
    expect(screen.queryByText('Invite to Pool')).toBeNull()
  })

  it('updates a search result when its request is declined in the list below', async () => {
    searchResults = [{ profile: profile('Dan'), relationship: 'incoming', requestId: 'request-Dan', matchedOn: 'username' }]
    mount()
    await screen.findByText('Dan')
    fireEvent.change(screen.getByLabelText('Search friends'), { target: { value: '@Dan' } })
    await waitFor(() => expect(screen.getAllByText('Accept')).toHaveLength(2))
    menuAction('Dan', 'Decline Request')
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests/request-Dan', { method: 'DELETE' }]]))
    await screen.findByText('Add')
    expect(screen.queryByText('Accept')).toBeNull()
  })

  it('suggests friends of friends and sends a request from the suggestion', async () => {
    friends.suggestions = [{ profile: profile('Gus'), mutualFriends: [profile('Alice'), profile('Bob')] }]
    friends.incoming = [connection('Dan', [profile('Cara')])]
    mount()
    await screen.findByText('People you may know')
    expect(screen.getByText('@gus · 2 mutuals')).toBeTruthy()
    expect(screen.getByText('@dan · Requested today · 1 mutual')).toBeTruthy()
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests', { method: 'POST', body: { userId: 'Gus' } }]]))
  })

  it('dismisses a suggestion without sending a request', async () => {
    friends.suggestions = [{ profile: profile('Gus'), mutualFriends: [profile('Alice')] }]
    mount()
    const dismiss = await screen.findByRole('button', { name: 'Dismiss Gus' })
    // Dismiss sits just left of Add.
    expect(dismiss.nextElementSibling?.textContent).toBe('Add')
    friends.suggestions = []
    fireEvent.click(dismiss)
    await waitFor(() => expect(writes()).toEqual([['/api/friends/suggestions/dismissals', { method: 'POST', body: { userId: 'Gus' } }]]))
    // The row goes away with the last suggestion, without a note.
    await waitFor(() => expect(screen.queryByText('People you may know')).toBeNull())
    expect(screen.queryByText(/won't be suggested/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss Gus' })).toBeNull()
  })

  it('opens a person’s profile from their row', async () => {
    mount()
    const bob = await screen.findByText('Bob')
    fireEvent.click(bob.closest('button')!)
    expect(mocks.push).toHaveBeenCalledWith('FriendProfile', { username: 'bob' })
  })

  it('opens a Pool member’s profile from their row', async () => {
    mount()
    await screen.findByText(/2 of 6 members/)
    fireEvent.click(screen.getByText('Alice').closest('button')!)
    expect(mocks.push).toHaveBeenCalledWith('FriendProfile', { username: 'alice' })
  })

  it('opens the profile of whoever sent a Pool invitation', async () => {
    summary = { accountBalanceMicros: 0, pool: null, incomingInvitations: [{ id: 'invite', poolId: 'pool', inviter: profile('Zed'), invitee: profile('me'), memberCount: 3, createdAt: '2026-09-01T00:00:00.000Z' }] }
    mount()
    const zed = await screen.findByText('Zed')
    fireEvent.click(zed.closest('button')!)
    expect(mocks.push).toHaveBeenCalledWith('FriendProfile', { username: 'zed' })
  })

  it('cancels a sent request from the collapsed list', async () => {
    mount()
    fireEvent.click(await screen.findByText(/Sent requests/))
    await screen.findByText('Eve')
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(writes()).toEqual([['/api/friends/requests/request-Eve', { method: 'DELETE' }]]))
  })
})
