// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), revoke: vi.fn(), others: vi.fn(), logout: vi.fn(), alert: vi.fn(), onState: null as null | ((state: string) => void) }))
vi.mock('react-native', () => ({
  ActivityIndicator: () => createElement('span', null, 'Loading'),
  AppState: { addEventListener: (_event: string, callback: (state: string) => void) => { mocks.onState = callback; return { remove() {} } } },
  Alert: { alert: mocks.alert },
  Button: ({ title, onPress, disabled, accessibilityLabel }: { title: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, title),
  Text: ({ children }: { children: import('react').ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
}))
vi.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) }))
vi.mock('../mockup5/src/components/PrototypeUI', () => ({
  Screen: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
  Card: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
  PageHeader: () => createElement('h1', null, 'Devices'),
}))
vi.mock('../mockup5/src/theme', () => ({ useAppTheme: () => ({ text: '#111', secondary: '#555', red: '#b00', blue: '#00b' }) }))
vi.mock('../api/client', () => ({ mobileApi: { sessions: mocks.sessions, revokeSession: mocks.revoke, revokeOtherSessions: mocks.others } }))
vi.mock('../store/session', () => ({ useSessionStore: { getState: () => ({ logout: mocks.logout }) } }))
import { DevicesScreen } from './Devices'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, container: HTMLDivElement
const current = { id: 'current', deviceLabel: 'My phone', appType: 'mobile', platform: 'ios', browser: null, latestIp: '198.51.100.1', signInIp: '192.0.2.1', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), isCurrent: true }
const other = { ...current, id: 'other', deviceLabel: 'My computer', appType: 'desktop', platform: 'windows', isCurrent: false }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessions.mockResolvedValue({ sessions: [current, other] })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function mount() { await act(async () => root.render(<DevicesScreen navigation={{ goBack() {} }} />)) }
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === label || node.textContent === label)!
  await act(async () => button.click())
}
async function confirm() {
  const buttons = mocks.alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>
  await act(async () => buttons.find((button) => button.text === 'Sign out')!.onPress!())
}
describe('mobile devices', () => {
  it('shows devices, expands original IP details, and refreshes on foreground', async () => {
    await mount()
    expect(container.textContent).toContain('This device')
    expect(container.textContent).toContain('Windows')
    expect(container.textContent).not.toContain('Sign-in IP')
    await click('Details')
    expect(container.textContent).toContain('Sign-in IP: 192.0.2.1')
    await act(async () => mocks.onState!('active'))
    expect(mocks.sessions).toHaveBeenCalledTimes(2)
  })
  it('does not revoke until confirmation and signs out individual devices', async () => {
    await mount(); await click('Sign out My computer')
    expect(mocks.revoke).not.toHaveBeenCalled()
    await confirm()
    expect(mocks.revoke).toHaveBeenCalledWith('other')
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('warns for the current device and removes local credentials', async () => {
    await mount(); await click('Sign out My phone')
    expect(mocks.alert.mock.calls[0]![1]).toContain('You will return to sign-in')
    await confirm()
    expect(mocks.logout).toHaveBeenCalledWith(true)
  })
  it('supports all-other sign-out and shows failures without clearing credentials', async () => {
    await mount(); await click('Sign out all other devices'); await confirm()
    expect(mocks.others).toHaveBeenCalledOnce()
    mocks.revoke.mockRejectedValueOnce(new Error('Try again'))
    await click('Sign out My computer'); await confirm()
    expect(container.textContent).toContain('Try again')
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('supports loading errors, retry, and empty lists', async () => {
    mocks.sessions.mockRejectedValueOnce(new Error('Offline'))
    await mount(); expect(container.textContent).toContain('Offline')
    mocks.sessions.mockResolvedValueOnce({ sessions: [] })
    await click('Retry'); expect(container.textContent).toContain('No signed-in devices.')
  })
})
