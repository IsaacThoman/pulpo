// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

type Modifier = { type: string; value?: unknown }
type PressableProps = { children?: ReactNode; onPress?: (event: unknown) => void; accessibilityLabel?: string; disabled?: boolean }
const mocks = vi.hoisted(() => ({ platform: 'ios', apiRequest: vi.fn(), push: vi.fn(), navigate: vi.fn(), usageLimits: true }))
const { passthrough, modifier } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: unknown }) => children,
  modifier: (modifiers: unknown, type: string) => (modifiers as Modifier[] | undefined)?.find((item) => item?.type === type)?.value,
}))

vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Alert: { alert: vi.fn() },
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
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray', tertiary: 'gray', text: 'black', green: 'green', blue: '#0000ff', red: 'red', fill: 'gray', fillStrong: 'gray', separator: 'gray', background: 'white' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Card: passthrough,
  PageHeader: ({ title }: { title: string }) => createElement('h1', null, title),
  SectionTitle: ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => createElement('h2', null, children, trailing),
  ListRow: ({ title, detail, onPress }: { title: string; detail?: string; onPress?: () => void }) => createElement('button', { onClick: onPress }, createElement('span', null, title), detail ? createElement('span', null, detail) : null),
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  Segmented: ({ label, options, value, onChange }: { label: string; options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void }) => createElement('div', { role: 'tablist', 'aria-label': label }, options.map((option) => createElement('button', { key: option.value, role: 'tab', 'aria-selected': option.value === value, onClick: () => onChange(option.value) }, option.label))),
}))
vi.mock('../../api/client', () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string) { super(message) } },
  isNetworkError: () => false,
}))
vi.mock('../friends/api', () => ({ friendsKeys: { profile: (namespace: string, username: string) => ['friends', namespace, 'profile', username] }, refreshFriends: vi.fn(), searchFriends: vi.fn() }))
vi.mock('../../store/session', () => ({
  useSessionStore: (selector: (state: unknown) => unknown) => selector({
    instanceUrl: 'https://pulpo.test',
    user: { id: 'me', name: 'Myself', username: 'myself' },
    config: { capabilities: { usageLimits: mocks.usageLimits }, auth: { inviteCodesEnabled: false } },
  }),
}))
import { LeaderboardScreen } from './LeaderboardScreen'

const person = (userId: string, calls: number, tokens: number) => ({ userId, displayName: userId, username: userId.toLowerCase(), avatarUrl: null, profileColor: null, calls, tokens, costMicros: 9_990_000 })
let entries: ReturnType<typeof person>[]
const reads = (prefix: string) => mocks.apiRequest.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith(prefix))
const ranking = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')).filter((label): label is string => Boolean(label && /^\d+\. /.test(label)))

beforeEach(() => {
  mocks.usageLimits = true
  entries = [person('me', 5, 9_000), person('Alice', 12, 400), person('Bob', 0, 0)]
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/usage/leaderboard/activity?')) return {
      summary: { calls: 17, inputTokens: 9_000, outputTokens: 400, costMicros: 19_980_000, firstUsedAt: null },
      daily: [], contribution: [], topModels: [{ modelId: 'm1', name: 'Octo Large', logo: null, calls: 17, inputTokens: 9_000, outputTokens: 400, costMicros: 19_980_000 }],
    }
    if (path.startsWith('/api/usage/leaderboard/records?')) return {
      data: [{ id: 'r1', createdAt: '2026-11-03T12:00:00.000Z', participant: { id: 'Alice', displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null }, model: { id: 'm1', name: 'Octo Large', logo: null }, inputTokens: 100, outputTokens: 23, costMicros: 5_550_000 }],
      nextCursor: null,
    }
    if (path.startsWith('/api/usage/leaderboard?')) return { data: structuredClone(entries) }
    throw new Error(`Unexpected ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mount(params?: { scope?: 'friends' | 'pool' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><LeaderboardScreen {...({ navigation: { goBack: vi.fn(), push: mocks.push, navigate: mocks.navigate }, route: { params } } as unknown as ComponentProps<typeof LeaderboardScreen>)} /></QueryClientProvider>)
}

describe.each(['ios', 'android'])('Leaderboard on %s', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it('ranks you and your friends by calls, then by tokens, and never by money', async () => {
    mount()
    await waitFor(() => expect(ranking()).toEqual(['1. Alice, @alice, 12 calls', '2. me, @me · You, 5 calls', '3. Bob, @bob, 0 calls']))
    expect(reads('/api/usage/leaderboard?')[0]).toMatch(/range=30d&timeZone=.*&scope=friends/)
    expect(screen.getByText('Friends ranking')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }))
    await waitFor(() => expect(ranking()).toEqual(['1. me, @me · You, 9,000 tokens', '2. Alice, @alice, 400 tokens', '3. Bob, @bob, 0 tokens']))
    expect(document.body.textContent).not.toMatch(/\$|USD|9\.99|19\.98|5\.55|balance|spend|credit/i)
  })

  it('opens the profile of anyone ranked or seen in recent usage', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '1. Alice, @alice, 12 calls' }))
    expect(mocks.push).toHaveBeenCalledWith('FriendProfile', { username: 'alice' })
    fireEvent.click(screen.getByRole('button', { name: /^Alice, Octo Large, .*123 tokens$/ }))
    expect(mocks.push).toHaveBeenCalledTimes(2)
  })

  it('reloads for another period and for the Pool', async () => {
    mount()
    await screen.findByText('Friends ranking')
    fireEvent.click(screen.getByRole('tab', { name: '90d' }))
    await waitFor(() => expect(reads('/api/usage/leaderboard?').some((path) => path.includes('range=90d'))).toBe(true))
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Circle' })).getByRole('tab', { name: 'Pool' }))
    await screen.findByText('Pool ranking')
    expect(reads('/api/usage/leaderboard/records?').some((path) => path.includes('scope=pool') && path.includes('range=90d'))).toBe(true)
    expect(screen.getByText('Settled usage across your Pool.')).toBeTruthy()
  })

  it('opens on the Pool when asked to', async () => {
    mount({ scope: 'pool' })
    await screen.findByText('Pool ranking')
    expect(reads('/api/usage/leaderboard?').every((path) => path.includes('scope=pool'))).toBe(true)
  })

  it('offers no Pool ranking where the instance has no Pools', async () => {
    mocks.usageLimits = false
    mount({ scope: 'pool' })
    await screen.findByText('Friends ranking')
    expect(screen.queryByRole('tablist', { name: 'Circle' })).toBeNull()
  })

  it('points to Friends when there is nobody to compare with', async () => {
    entries = [person('me', 5, 9_000)]
    mount()
    await screen.findByText('Add friends to compare usage.')
    expect(ranking()).toEqual([])
    fireEvent.click(screen.getByText('Find Friends'))
    expect(mocks.navigate).toHaveBeenCalledWith('Friends')
  })

  it('offers to retry when the ranking cannot be loaded', async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error('Server unavailable.'))
    mount()
    fireEvent.click(await screen.findByText(platform === 'ios' ? 'Try Again' : 'Usage could not be loaded'))
    await waitFor(() => expect(ranking()).toHaveLength(3))
  })
})
