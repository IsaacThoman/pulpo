// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ openURL: vi.fn(), redeem: vi.fn(), refresh: vi.fn(), discover: vi.fn(), setUser: vi.fn(), logout: vi.fn(), state: {} as Record<string, unknown> }))
vi.mock('react-native', () => {
  const Container = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    Platform: { OS: 'ios', select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default },
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    Linking: { openURL: mocks.openURL },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    ActivityIndicator: () => createElement('span', null, 'Loading'),
    Image: () => null,
    KeyboardAvoidingView: Container, ScrollView: Container, View: Container,
    Text: ({ children, onPress, accessibilityRole }: { children?: ReactNode; onPress?: () => void; accessibilityRole?: string }) => createElement('span', { onClick: onPress, role: accessibilityRole }, children),
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
    TextInput: ({ value, onChangeText, accessibilityLabel, editable = true }: { value: string; onChangeText: (value: string) => void; accessibilityLabel: string; editable?: boolean }) => createElement('input', { 'aria-label': accessibilityLabel, value, disabled: !editable, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }),
  }
})
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
vi.mock('../../assets/pulpo-smiley.png', () => ({ default: 1 }))
vi.mock('../../../platform/MaterialUI', () => ({ MaterialButton: () => null, MaterialField: () => null }))
vi.mock('../../../platform/useSubpageBack', () => ({ useSubpageBack: () => {} }))
vi.mock('../../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../../components/DeleteAccount', () => ({ DeleteAccountAction: () => createElement('button', null, 'Delete account') }))
vi.mock('../theme', () => ({ useAppTheme: () => ({ isDark: false }) }))
vi.mock('../domain', () => ({ normalizeInstanceUrl: (value: string) => value }))
vi.mock('../../../api/client', () => ({ mobileApi: { redeemInviteCode: mocks.redeem } }))
vi.mock('../../../auth/passkeys', () => ({ NativePasskeyError: class extends Error {}, PasskeyCancelledError: class extends Error {} }))
vi.mock('../../../store/session', () => ({
  useSessionStore: Object.assign((select: (state: unknown) => unknown) => select(mocks.state), { getState: () => mocks.state }),
}))
import { AuthExperience } from './AuthExperience'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const auth = { accountDeletionEnabled: true, signupEnabled: true, pendingDetails: true, adminEmail: 'admin@example.test', pendingMessage: 'You are on the waitlist.', inviteCodesEnabled: true }
let root: Root
let container: HTMLDivElement

function setSession(config: { auth: Partial<typeof auth> } | null) {
  mocks.state = {
    status: 'pending', token: 'token', instanceUrl: 'https://pulpo.test', accounts: [], config,
    user: { id: 'user', name: 'New Member', email: 'new@example.test', role: 'pending' },
    refreshSession: mocks.refresh, discover: mocks.discover, setUser: mocks.setUser, logout: mocks.logout,
  }
}
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((value) => value.textContent === label || value.getAttribute('aria-label') === label)!
async function typeInviteCode(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Invite code"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const approvedUser = { id: 'user', name: 'New Member', email: 'new@example.test', role: 'user' }
const inviteInput = () => container.querySelector<HTMLInputElement>('input[aria-label="Invite code"]')!

beforeEach(() => {
  vi.resetAllMocks()
  mocks.discover.mockResolvedValue({})
  mocks.openURL.mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('mobile pending approval', () => {
  it('shows the administrator message and contact address like the web page', async () => {
    setSession({ auth })
    await act(async () => root.render(<AuthExperience />))
    expect(container.textContent).toContain('Account pending approval')
    expect(container.textContent).toContain('You are on the waitlist.')
    expect(container.textContent).not.toContain('Your Pulpo account is ready')
    expect(container.textContent).toContain('Contact your admin at admin@example.test')
    expect(container.textContent).toContain('Signed in as new@example.test')
    await act(async () => (Array.from(container.querySelectorAll('span')).find((value) => value.textContent === 'admin@example.test')!).click())
    expect(mocks.openURL).toHaveBeenCalledWith('mailto:admin@example.test')
    expect(button('Sign out')).toBeTruthy()
    expect(button('Refresh status')).toBeTruthy()
  })

  it('falls back to the default message and hides optional sections when the instance turns them off', async () => {
    setSession({ auth: { ...auth, pendingDetails: false, inviteCodesEnabled: false } })
    await act(async () => root.render(<AuthExperience />))
    expect(container.textContent).not.toContain('Need help?')
    expect(container.querySelector('input')).toBeNull()

    await act(async () => root.unmount()); root = createRoot(container)
    setSession(null)
    await act(async () => root.render(<AuthExperience />))
    expect(container.textContent).toContain('Your account is pending approval. An admin will review it shortly.')
  })

  it('normalizes the invite code and applies the approved user returned by redeeming it', async () => {
    setSession({ auth })
    mocks.redeem.mockResolvedValue({ user: approvedUser })
    mocks.setUser.mockResolvedValue(undefined)
    await act(async () => root.render(<AuthExperience />))
    await typeInviteCode('ab-1')
    expect(inviteInput().value).toBe('AB1')
    expect(button('Redeem invite code').disabled).toBe(true)
    await typeInviteCode('ab1-cd2-ef3')
    expect(inviteInput().value).toBe('AB1CD2')
    await act(async () => button('Redeem invite code').click())
    expect(mocks.redeem).toHaveBeenCalledWith('AB1CD2')
    expect(mocks.setUser).toHaveBeenCalledWith(approvedUser)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('replaces a rejected code when a full code is pasted after it', async () => {
    setSession({ auth })
    mocks.redeem.mockRejectedValue(new Error('This invite code is invalid or already used'))
    await act(async () => root.render(<AuthExperience />))
    await typeInviteCode('ZZZZZZ')
    await act(async () => button('Redeem invite code').click())
    expect(container.textContent).toContain('This invite code is invalid or already used')
    await typeInviteCode('ZZZZZZ abc-123\n')
    expect(inviteInput().value).toBe('ABC123')
    expect(container.textContent).not.toContain('This invite code is invalid')
  })

  it('does not report a used code as rejected when saving the approved account fails', async () => {
    setSession({ auth })
    mocks.redeem.mockResolvedValue({ user: approvedUser })
    mocks.setUser.mockRejectedValue(new Error('Storage unavailable'))
    await act(async () => root.render(<AuthExperience />))
    await typeInviteCode('AB1CD2')
    await act(async () => button('Redeem invite code').click())
    expect(container.textContent).toContain('Invite accepted. Tap Refresh status to continue.')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('locks the other actions while one is running', async () => {
    setSession({ auth })
    let finishRedeem!: (value: unknown) => void
    mocks.redeem.mockReturnValue(new Promise((resolve) => { finishRedeem = resolve }))
    mocks.setUser.mockResolvedValue(undefined)
    await act(async () => root.render(<AuthExperience />))
    await typeInviteCode('AB1CD2')
    await act(async () => { button('Redeem invite code').click(); button('Redeem invite code').click() })
    expect(mocks.redeem).toHaveBeenCalledOnce()
    expect(button('Sign out').disabled).toBe(true)
    expect(button('Refresh status').disabled).toBe(true)
    await act(async () => finishRedeem({ user: approvedUser }))
    expect(button('Sign out').disabled).toBe(false)
  })

  it('refreshes approval and instance settings, clearing a rejected code', async () => {
    setSession({ auth })
    mocks.redeem.mockRejectedValue(new Error('This invite code is invalid or already used'))
    mocks.refresh.mockResolvedValue(undefined)
    await act(async () => root.render(<AuthExperience />))
    await typeInviteCode('ZZZZZZ')
    await act(async () => button('Redeem invite code').click())
    expect(container.textContent).toContain('This invite code is invalid or already used')
    await act(async () => button('Refresh status').click())
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.discover).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Still waiting for administrator approval.')
    expect(container.textContent).not.toContain('This invite code is invalid')
  })

  it('signs out once on a double tap', async () => {
    setSession({ auth })
    mocks.logout.mockReturnValue(new Promise(() => {}))
    await act(async () => root.render(<AuthExperience />))
    await act(async () => { button('Sign out').click(); button('Sign out').click() })
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(button('Refresh status').disabled).toBe(true)
  })

  it.each([
    ['ignores a seventh typed character', 'AB1CD2', 'AB1CD2X', 'AB1CD2'],
    ['replaces the code with one pasted in the middle', 'ZZZZZZ', 'ZZZABC123ZZZ', 'ABC123'],
    ['keeps one copy of a doubled autofill', '', '123456123456', '123456'],
    ['replaces a similar code with one pasted at the start', 'AB1CD3', 'AB1CD2AB1CD3', 'AB1CD2'],
    ['replaces a similar code with one pasted at the end', 'ABC123', 'ABC123ABC999', 'ABC999'],
  ])('%s', async (_name, previous, raw, expected) => {
    setSession({ auth })
    await act(async () => root.render(<AuthExperience />))
    if (previous) await typeInviteCode(previous)
    await typeInviteCode(raw)
    expect(inviteInput().value).toBe(expected)
  })

  it('shows a sign out failure instead of leaving it unhandled', async () => {
    setSession({ auth })
    mocks.logout.mockRejectedValue(new Error('Could not reach the server.'))
    await act(async () => root.render(<AuthExperience />))
    await act(async () => button('Sign out').click())
    expect(container.textContent).toContain('Could not reach the server.')
  })

  it('does not apply a redeemed user to a session that changed meanwhile', async () => {
    setSession({ auth })
    mocks.redeem.mockImplementation(async () => { mocks.state = { ...mocks.state, token: 'other' }; return { user: approvedUser } })
    await act(async () => root.render(<AuthExperience />))
    await typeInviteCode('AB1CD2')
    await act(async () => button('Redeem invite code').click())
    expect(mocks.setUser).not.toHaveBeenCalled()
  })

  it('explains when the administrator has turned account deletion off', async () => {
    setSession({ auth: { ...auth, accountDeletionEnabled: false } })
    await act(async () => root.render(<AuthExperience />))
    expect(container.textContent).toContain('Account deletion is disabled by the instance administrator.')
    expect(Array.from(container.querySelectorAll('button')).some((value) => value.textContent === 'Delete account')).toBe(false)
  })
})
