// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), logout: vi.fn(), navigate: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/stores/auth', () => ({ useAuth: Object.assign((select: (state: unknown) => unknown) => select({ user: { email: 'me@example.test' }, logout: mocks.logout }), { getState: () => ({ instanceUrl: 'https://instance.test' }) }) }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text }))
import { DeleteAccountSettings } from './DeleteAccountSettings'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.logout.mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function mount(settings: object) {
  mocks.request.mockResolvedValueOnce(settings)
  await act(async () => root.render(<DeleteAccountSettings />))
}
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === text)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}
async function password(value: string) {
  const input = document.querySelector<HTMLInputElement>('#delete-account-password')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('web account deletion', () => {
  it.each([{}, { accountDeletionEnabled: false, adminEmail: 'admin@example.test' }])('does not offer deletion when unavailable: %j', async (settings) => {
    await mount(settings)
    expect(document.querySelector('button')).toBeNull()
    expect(document.body.textContent).toMatch(/disabled|does not support/)
  })
  it('identifies the account and instance, and clears secrets when the form is canceled', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(document.body.textContent).toContain('me@example.test · https://instance.test')
    expect(document.body.textContent).toContain('no automatic refunds')
    await password('secret'); await click('Close'); await click('Delete account')
    expect(document.querySelector<HTMLInputElement>('#delete-account-password')!.value).toBe('')
  })
  it('does not send a request when final confirmation is canceled', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    await click('Close')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('clears local state only after acceptance and shows confirmation on sign-in', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    mocks.request.mockResolvedValueOnce({ status: 'deletion_requested' })
    await click('Permanently delete account')
    expect(mocks.request).toHaveBeenLastCalledWith('/api/me', { method: 'DELETE', body: { currentPassword: 'secret', verificationCode: undefined } })
    expect(window.confirm).not.toHaveBeenCalled()
    expect(mocks.logout).toHaveBeenCalledWith(true)
    expect(mocks.navigate).toHaveBeenCalledWith('/login', { replace: true, state: { accountDeletionRequested: true } })
  })
  it('keeps the session and form after an API failure', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    mocks.request.mockRejectedValueOnce(new Error('Transfer Pool ownership first'))
    await click('Permanently delete account')
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Transfer Pool ownership')
    expect(mocks.logout).not.toHaveBeenCalled()
  })
})
