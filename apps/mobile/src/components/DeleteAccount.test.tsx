// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), deleteAccount: vi.fn(), logout: vi.fn(), alert: vi.fn(), cancelQueries: vi.fn(), removeQueries: vi.fn() }))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  KeyboardAvoidingView: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
  Alert: { alert: mocks.alert }, Linking: { openURL: vi.fn() },
  Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, title),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: { value: string; onChangeText: (value: string) => void; accessibilityLabel: string; editable: boolean }) => createElement('input', { 'aria-label': accessibilityLabel, value, disabled: !editable, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }),
  Modal: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
  SafeAreaView: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children: import('react').ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children),
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: import('react').ReactNode }) => createElement('div', null, children) }))
vi.mock('../mockup5/src/theme', () => ({ useAppTheme: () => ({ background: '#fff', text: '#111', secondary: '#333', separator: '#888', red: '#b00' }) }))
vi.mock('../api/client', () => ({ apiRequest: mocks.request, mobileApi: { deleteAccount: mocks.deleteAccount } }))
vi.mock('../data/database', () => ({ cacheNamespace: () => 'instance|user' }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ cancelQueries: mocks.cancelQueries, removeQueries: mocks.removeQueries }) }))
vi.mock('../store/session', () => ({ useSessionStore: Object.assign((select: (state: unknown) => unknown) => select({ user: { id: 'user', email: 'me@example.test' }, instanceUrl: 'https://instance.test' }), { getState: () => ({ logout: mocks.logout }) }) }))
import { DeleteAccountForm } from './DeleteAccount'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks(); mocks.logout.mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function mount(settings: object) {
  mocks.request.mockImplementation(async (path: string) => path === '/api/me/deletion' ? { twoFactorEnabled: false } : settings)
  await act(async () => root.render(<DeleteAccountForm onClose={() => {}} />))
}
async function enterPassword() {
  const input = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'secret')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function requestDeletion() {
  const button = Array.from(container.querySelectorAll('button')).find((value) => value.textContent === 'Permanently delete account')!
  await act(async () => button.click())
}
async function confirmDeletion() {
  const buttons = mocks.alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>
  await act(async () => buttons.find((value) => value.text === 'Delete account')!.onPress!())
}

describe('mobile account deletion', () => {
  it.each([{}, { accountDeletionEnabled: false }])('shows unavailable support without a destructive action: %j', async (settings) => {
    await mount(settings)
    expect(container.textContent).toMatch(/disabled|does not support/)
    expect(container.querySelector('input')).toBeNull()
  })
  it('requires a second confirmation before contacting the server', async () => {
    await mount({ accountDeletionEnabled: true }); await enterPassword(); await requestDeletion()
    expect(mocks.alert).toHaveBeenCalledWith('Permanently delete account?', 'This cannot be undone.', expect.any(Array))
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })
  it('clears only the deleted account queries and credentials after acceptance', async () => {
    await mount({ accountDeletionEnabled: true }); await enterPassword(); await requestDeletion()
    mocks.deleteAccount.mockResolvedValueOnce({ status: 'deletion_requested' })
    await confirmDeletion()
    expect(mocks.deleteAccount).toHaveBeenCalledWith('secret', undefined)
    expect(mocks.logout).toHaveBeenCalledWith(true)
    const filter = mocks.removeQueries.mock.calls[0]![0].predicate
    expect(filter({ queryKey: ['chats', 'instance|user'] })).toBe(true)
    expect(filter({ queryKey: ['chats', 'other|user'] })).toBe(false)
    expect(mocks.alert).toHaveBeenLastCalledWith('Account deletion started', expect.any(String))
  })
  it('preserves credentials and displays errors when deletion is rejected', async () => {
    await mount({ accountDeletionEnabled: true }); await enterPassword(); await requestDeletion()
    mocks.deleteAccount.mockRejectedValueOnce(new Error('Enter your authenticator code'))
    await confirmDeletion()
    expect(container.textContent).toContain('Enter your authenticator code')
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('does not display a second-factor field when two-factor authentication is disabled', async () => {
    await mount({ accountDeletionEnabled: true })
    expect(container.querySelectorAll('input')).toHaveLength(1)
  })
  it('requires an enabled second factor before final confirmation', async () => {
    mocks.request.mockImplementation(async (path: string) => path === '/api/me/deletion' ? { twoFactorEnabled: true } : { accountDeletionEnabled: true })
    await act(async () => root.render(<DeleteAccountForm onClose={() => {}} />))
    await enterPassword(); await requestDeletion()
    expect(mocks.alert).not.toHaveBeenCalled()
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Authenticator or recovery code"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'recovery-code')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await requestDeletion(); await confirmDeletion()
    expect(mocks.deleteAccount).toHaveBeenCalledWith('secret', 'recovery-code')
  })
  it('fails closed and supports retry if requirements cannot be loaded', async () => {
    mocks.request.mockResolvedValueOnce({ accountDeletionEnabled: true }).mockRejectedValueOnce(new Error('offline'))
    await act(async () => root.render(<DeleteAccountForm onClose={() => {}} />))
    expect(container.querySelector('input')).toBeNull()
    mocks.request.mockImplementation(async (path: string) => path === '/api/me/deletion' ? { twoFactorEnabled: false } : { accountDeletionEnabled: true })
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Retry')!.click())
    expect(container.querySelectorAll('input')).toHaveLength(1)
  })

  it('reports acceptance separately from local cleanup failures', async () => {
    await mount({ accountDeletionEnabled: true }); await enterPassword(); await requestDeletion()
    mocks.logout.mockRejectedValueOnce(new Error('Storage failed'))
    await confirmDeletion()
    expect(mocks.alert).toHaveBeenLastCalledWith('Account deletion started', expect.stringContaining('Some data on this device could not be removed'))
  })

})
