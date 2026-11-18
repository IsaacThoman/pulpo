// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FriendProfile, FriendProfileDetail } from '@pulpo/contracts'

type Modifier = { type: string; value?: unknown }
type PressableProps = { children?: ReactNode; onPress?: (event: unknown) => void; accessibilityLabel?: string; disabled?: boolean }
const mocks = vi.hoisted(() => ({ platform: 'ios', apiRequest: vi.fn(), alert: vi.fn(), push: vi.fn(), navigate: vi.fn(), usageLimits: false }))
const { passthrough, modifier } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: unknown }) => children,
  modifier: (modifiers: unknown, type: string) => (modifiers as Modifier[] | undefined)?.find((item) => item?.type === type)?.value,
}))

vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Alert: { alert: mocks.alert },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) => createElement('div', { 'aria-label': accessibilityLabel }, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: PressableProps) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
  ScrollView: passthrough,
  RefreshControl: () => null,
  ActivityIndicator: () => null,
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: passthrough }))
vi.mock('@expo/ui/swift-ui', () => {
  const Container = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    Host: Container, Form: Container, HStack: Container, VStack: Container, RNHostView: passthrough,
    Spacer: () => null, Image: () => null, ProgressView: () => null, RoundedRectangle: () => null,
    Section: ({ title, header, footer, children }: { title?: string; header?: ReactNode; footer?: ReactNode; children?: ReactNode }) => createElement('section', null, title ? createElement('h2', null, title) : header, children, footer),
    Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
    Label: ({ title }: { title: string }) => createElement('span', null, title),
    LabeledContent: ({ label, children }: { label: string; children?: ReactNode }) => createElement('div', null, createElement('span', null, label), children),
    Button: ({ label, onPress, children, modifiers }: { label?: string; onPress?: () => void; children?: ReactNode; modifiers?: Modifier[] }) => createElement('button', { onClick: onPress, disabled: Boolean(modifier(modifiers, 'disabled')), 'aria-label': modifier(modifiers, 'accessibilityLabel') as string | undefined }, label ?? children),
    // A segmented picker reads as tabs, its options from the tagged texts inside it.
    Picker: ({ label, selection, onSelectionChange, children }: { label: string; selection: string; onSelectionChange: (value: string) => void; children: Array<{ props: { children: string; modifiers: Modifier[] } }> }) => createElement('div', { role: 'tablist', 'aria-label': label }, children.map((option) => {
      const value = modifier(option.props.modifiers, 'tag') as string
      return createElement('button', { key: value, role: 'tab', 'aria-selected': value === selection, onClick: () => onSelectionChange(value) }, option.props.children)
    })),
  }
})
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ shapes: { rectangle: () => ({}) }, ...Object.fromEntries([
  'accessibilityElement', 'accessibilityHidden', 'accessibilityHint', 'accessibilityLabel', 'buttonStyle', 'contentShape', 'controlSize', 'disabled', 'font', 'foregroundStyle',
  'frame', 'lineLimit', 'minimumScaleFactor', 'monospacedDigit', 'opacity', 'padding', 'pickerStyle', 'refreshable', 'tag', 'tint',
].map((type) => [type, (value: unknown = true) => ({ type, value })])) }))
vi.mock('../../platform/MaterialUI', () => ({ MaterialButton: ({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) => createElement('button', { onClick: onPress, disabled: loading }, label) }))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../mockup5/src/components/ProfileAvatar', () => ({ ProfileAvatar: () => null }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray', tertiary: 'gray', text: 'black', green: 'green', orange: 'orange', blue: '#0000ff', red: 'red', fill: 'gray', fillStrong: 'gray', separator: 'gray', background: 'white' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Card: passthrough,
  PageHeader: ({ title }: { title: string }) => createElement('h1', null, title),
  SectionTitle: ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => createElement('h2', null, children, trailing),
  ListRow: ({ title, detail, onPress, children }: { title: string; detail?: string; onPress?: () => void; children?: ReactNode }) => createElement('div', null, onPress ? createElement('button', { onClick: onPress }, title) : createElement('span', null, title), detail ? createElement('span', null, detail) : null, children),
  PrimaryButton: ({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) => createElement('button', { onClick: onPress, disabled: loading }, label),
  Segmented: ({ label, options, value, onChange }: { label: string; options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void }) => createElement('div', { role: 'tablist', 'aria-label': label }, options.map((option) => createElement('button', { key: option.value, role: 'tab', 'aria-selected': option.value === value, onClick: () => onChange(option.value) }, option.label))),
}))
vi.mock('../../api/client', () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string) { super(message) } },
  isNetworkError: () => false,
}))
vi.mock('../../store/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({
    instanceUrl: 'https://pulpo.test',
    user: { id: 'me', name: 'Myself', username: 'myself', email: 'me@pulpo.test', avatarUrl: null, profileColor: null, usageVisibility: 'public', createdAt: '2026-07-04T12:00:00.000Z' },
    config: { capabilities: { usageLimits: mocks.usageLimits }, auth: { inviteCodesEnabled: false } },
  }),
}))
import { ApiError } from '../../api/client'
import { FriendProfileScreen } from './FriendProfileScreen'

const apiError = (status: number, message: string) => new (ApiError as unknown as new (status: number, message: string) => Error)(status, message)
const profile = (id: string): FriendProfile => ({ id, displayName: id, username: id.toLowerCase(), avatarUrl: null, profileColor: null })
const activity = {
  // The server also reports what the usage cost; the app must never show it.
  summary: { calls: 42, inputTokens: 9_000, outputTokens: 3_345, costMicros: 7_770_000, inferenceReferenceCostMicros: 0, firstUsedAt: '2026-10-01T12:00:00.000Z' },
  daily: [],
  contribution: [],
  topModels: [{ modelId: 'm1', name: 'Octo Large', logo: null, calls: 40, inputTokens: 9_000, outputTokens: 3_000, costMicros: 7_000_000 }, { modelId: 'other', name: 'Secret', logo: null, calls: 2, inputTokens: 0, outputTokens: 345, costMicros: 770_000 }],
  modelNames: {},
  balanceMicros: 88_880_000,
}
const record = (id: string) => ({ id, createdAt: '2026-11-03T12:00:00.000Z', model: { id: 'm1', name: 'Octo Large', logo: null }, inputTokens: 100, outputTokens: 23, costMicros: 5_550_000, balanceAfterMicros: 66_660_000 })
let detail: FriendProfileDetail
let usageError: Error | null
const writes = () => mocks.apiRequest.mock.calls.filter(([, options]) => options?.method)
const reads = (prefix: string) => mocks.apiRequest.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith(prefix))

beforeEach(() => {
  mocks.usageLimits = false
  usageError = null
  detail = { profile: profile('Alice'), relationship: 'none', requestId: null, friendsSince: null, mutualFriends: [profile('Bob')], usageVisible: true, usageVisibility: 'friends', joinedAt: '2026-08-15T12:00:00.000Z' }
  mocks.apiRequest.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === 'POST' && path === '/api/friends/requests') {
      detail = { ...detail, relationship: 'outgoing', requestId: 'request-Alice' }
      return { requestId: 'request-Alice', status: 'pending' }
    }
    if (options?.method) return {}
    if (path === '/api/profiles/alice') return structuredClone(detail)
    if (path.includes('/usage/') && usageError) throw usageError
    if (path.startsWith('/api/profiles/alice/usage/activity?') || path.startsWith('/api/usage/activity?')) return structuredClone(activity)
    if (path.startsWith('/api/profiles/alice/usage/records?') || path.startsWith('/api/usage/records?')) {
      return path.includes('cursor=next') ? { data: [record('r9'), record('r10')], nextCursor: null } : { data: Array.from({ length: 9 }, (_, index) => record(`r${index}`)), nextCursor: 'next' }
    }
    throw new Error(`Unexpected ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mount(username = 'Alice') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><FriendProfileScreen {...({ navigation: { goBack: vi.fn(), push: mocks.push, navigate: mocks.navigate }, route: { params: { username } } } as unknown as ComponentProps<typeof FriendProfileScreen>)} /></QueryClientProvider>)
  return client
}

describe.each(['ios', 'android'])('Profile on %s', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it('shows someone who is not a friend yet and sends them a request', async () => {
    mount()
    await screen.findByText('@alice')
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/profiles/alice')
    expect(screen.getByText(/^Joined /)).toBeTruthy()
    expect(screen.getByText('Usage visible to their friends')).toBeTruthy()
    // Only friends can be compared on the leaderboard.
    expect(screen.queryByText('Compare with Friends')).toBeNull()
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

  it('shows when a friendship began, opens mutual friends, and compares on the leaderboard', async () => {
    detail = { ...detail, relationship: 'friends', requestId: 'request-Alice', friendsSince: '2026-09-01T12:00:00.000Z' }
    mount()
    await screen.findByText(/^Friends since /)
    expect(screen.getByText('Friends')).toBeTruthy()
    expect(screen.queryByText('Add Friend')).toBeNull()
    fireEvent.click(screen.getByText('Bob').closest('button')!)
    expect(mocks.push).toHaveBeenCalledWith('FriendProfile', { username: 'bob' })
    fireEvent.click(await screen.findByText('Compare with Friends'))
    expect(mocks.navigate).toHaveBeenCalledWith('Leaderboard')
  })

  it('shows the usage someone shares, in calls and tokens and never in money', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByText('Octo Large').length).toBeGreaterThan(0))
    expect(reads('/api/profiles/alice/usage/activity?')[0]).toMatch(/range=30d&timeZone=/)
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    expect(screen.getByText('12.3K')).toBeTruthy()
    // Models hidden from other people arrive as one entry.
    expect(screen.getByText('Other')).toBeTruthy()
    expect(screen.queryByText('Secret')).toBeNull()
    expect(screen.getAllByText('123 tokens')).toHaveLength(8)
    expect(document.body.textContent).not.toMatch(/\$|USD|7\.77|5\.55|88\.88|66\.66|balance|spend|credit/i)
  })

  it('reloads usage for another period and ranks models by tokens when asked', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByText('Octo Large').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: '7d' }))
    await waitFor(() => expect(reads('/api/profiles/alice/usage/activity?').some((path) => path.includes('range=7d'))).toBe(true))
    expect(reads('/api/profiles/alice/usage/records?').some((path) => path.includes('range=7d') && path.includes('limit=20'))).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }))
    await waitFor(() => expect(screen.getByText('12K')).toBeTruthy())
  })

  it('shows more recent calls, loading older ones when it runs out', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByText('123 tokens')).toHaveLength(8))
    fireEvent.click(screen.getByText('Show More'))
    await waitFor(() => expect(screen.getAllByText('123 tokens')).toHaveLength(11))
    expect(reads('/api/profiles/alice/usage/records?').some((path) => path.includes('cursor=next'))).toBe(true)
    expect(screen.queryByText('Show More')).toBeNull()
  })

  it('says so, and asks for nothing, when someone has not shared their usage', async () => {
    detail = { ...detail, usageVisible: false, usageVisibility: 'pool' }
    mount()
    await screen.findByText('Alice hasn’t shared their usage with you.')
    expect(screen.getByText('Usage visible to their Pool')).toBeTruthy()
    expect(reads('/api/profiles/alice/usage/')).toEqual([])
    expect(screen.queryByRole('tab', { name: '7d' })).toBeNull()
  })

  it('hides usage that stops being shared while the profile is open, and forgets it', async () => {
    const client = mount()
    await waitFor(() => expect(screen.getAllByText('Octo Large').length).toBeGreaterThan(0))
    usageError = apiError(403, 'This profile\'s usage is private')
    detail = { ...detail, usageVisible: false }
    fireEvent.click(screen.getByRole('tab', { name: '7d' }))
    await screen.findByText('Alice hasn’t shared their usage with you.')
    expect(screen.queryByText('Octo Large')).toBeNull()
    // Nothing of their usage stays cached, for this period or the one shown before.
    await waitFor(() => expect(reads('/api/profiles/alice').filter((path) => path === '/api/profiles/alice').length).toBeGreaterThan(1))
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['friends', 'https://pulpo.test|me', 'profile-usage'] }).filter((query) => query.state.data !== undefined)).toEqual([]))
    expect(reads('/api/profiles/alice/usage/activity?').filter((path) => path.includes('range=7d'))).toHaveLength(1)
    // The profile was asked again, to learn that usage is no longer shared.
    expect(reads('/api/profiles/alice').filter((path) => path === '/api/profiles/alice').length).toBeGreaterThan(1)
  })

  it('shows your own profile from your account, with all of your usage', async () => {
    mocks.usageLimits = true
    mount('Myself')
    await screen.findByText('@myself')
    expect(screen.getByText('me@pulpo.test')).toBeTruthy()
    expect(screen.getByText(/^Joined /)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('Octo Large').length).toBeGreaterThan(0))
    expect(reads('/api/profiles/')).toEqual([])
    expect(reads('/api/usage/activity?')).toHaveLength(1)
    expect(screen.queryByText('Mutual friends')).toBeNull()
    expect(screen.queryByText('Add Friend')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\$|USD|88\.88|66\.66|balance|credit/i)

    fireEvent.click(screen.getByText('Edit Profile'))
    expect(mocks.navigate).toHaveBeenCalledWith('EditProfile')
    fireEvent.click(screen.getByRole('button', { name: 'Usage visible to everyone' }))
    expect(mocks.navigate).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Plan and Usage Limits'))
    expect(mocks.navigate).toHaveBeenCalledWith('SettingsDetail', { section: 'usage' })
    fireEvent.click(screen.getByText('Compare with Friends'))
    expect(mocks.navigate).toHaveBeenCalledWith('Leaderboard')
  })

  it('leaves plan limits off your profile where the instance has none', async () => {
    mount('myself')
    await screen.findByText('@myself')
    expect(screen.queryByText('Plan and Usage Limits')).toBeNull()
  })

  it('stops showing a profile once it is no longer available', async () => {
    const client = mount()
    await screen.findByText('@alice')
    mocks.apiRequest.mockRejectedValue(apiError(404, 'Profile not found'))
    await client.refetchQueries()
    await screen.findByText(/Profile not found/)
    expect(screen.queryByText('@alice')).toBeNull()
  })
})
