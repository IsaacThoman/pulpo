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
  vi.resetAllMocks()
  mocks.logout.mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function mount(settings: object) {
  mocks.request.mockImplementation(async (path: string) => path === '/api/me/deletion' ? { twoFactorEnabled: false } : settings)
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
    expect(document.body.textContent).toContain('me@example.test')
    expect(document.body.textContent).toContain('https://instance.test')
    expect(document.querySelector('#delete-account-code')).toBeNull()
    expect(document.body.textContent).toContain('no automatic refunds')
    await password('secret'); await click('Close'); await click('Delete account')
    expect(document.querySelector<HTMLInputElement>('#delete-account-password')!.value).toBe('')
  })
  it('does not send a request when final confirmation is canceled', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    await click('Close')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.request.mock.calls.every((call) => call[1]?.method !== 'DELETE')).toBe(true)
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('clears local state only after acceptance and shows the dedicated confirmation page', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    mocks.request.mockResolvedValueOnce({ status: 'deletion_requested' })
    await click('Permanently delete account')
    expect(mocks.request).toHaveBeenLastCalledWith('/api/me', { method: 'DELETE', body: { currentPassword: 'secret', verificationCode: undefined } })
    expect(window.confirm).not.toHaveBeenCalled()
    expect(mocks.logout).toHaveBeenCalledWith(true)
    expect(mocks.navigate).toHaveBeenCalledWith('/account-deletion', { replace: true })
  })
  it('keeps the session and form after an API failure', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    mocks.request.mockRejectedValueOnce(new Error('Transfer Pool ownership first'))
    await click('Permanently delete account')
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Transfer Pool ownership')
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('requires a code only when two-factor authentication is enabled', async () => {
    await mount({ accountDeletionEnabled: true })
    mocks.request.mockImplementation(async (path: string) => path === '/api/me/deletion' ? { twoFactorEnabled: true } : { accountDeletionEnabled: true })
    await click('Delete account'); await password('secret')
    const input = document.querySelector<HTMLInputElement>('#delete-account-code')!
    expect(input.required).toBe(true)
    await click('Permanently delete account')
    expect(mocks.logout).not.toHaveBeenCalled()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'recovery-code')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Permanently delete account')
    expect(mocks.request).toHaveBeenCalledWith('/api/me', { method: 'DELETE', body: { currentPassword: 'secret', verificationCode: 'recovery-code' } })
  })
  it('fails closed when requirements are unavailable, and allows retry', async () => {
    await mount({ accountDeletionEnabled: true })
    mocks.request.mockRejectedValueOnce(new Error('offline'))
    await click('Delete account')
    expect(document.querySelector('input')).toBeNull()
    await click('Permanently delete account')
    expect(mocks.logout).not.toHaveBeenCalled()
    await click('Retry')
    expect(document.querySelector('#delete-account-password')).not.toBeNull()
  })
  it('refreshes stale two-factor requirements after a rejected submission', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/api/me') throw new Error('Enter your authenticator or recovery code.')
      return path === '/api/me/deletion' ? { twoFactorEnabled: true } : { accountDeletionEnabled: true }
    })
    await click('Permanently delete account')
    expect(document.querySelector('#delete-account-code')).not.toBeNull()
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('rechecks administrator availability when the dialog opens', async () => {
    await mount({ accountDeletionEnabled: true })
    mocks.request.mockImplementation(async (path: string) => path === '/api/me/deletion' ? { twoFactorEnabled: false } : { accountDeletionEnabled: false })
    await click('Delete account')
    expect(document.querySelector('input')).toBeNull()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('disabled by the instance administrator')
  })

  it('shows acceptance and a local-cleanup warning on the confirmation page if storage fails', async () => {
    await mount({ accountDeletionEnabled: true }); await click('Delete account'); await password('secret')
    mocks.logout.mockRejectedValueOnce(new Error('Storage failed'))
    await click('Permanently delete account')
    expect(mocks.navigate).toHaveBeenCalledWith('/account-deletion', { replace: true, state: { accountDeletionCleanupFailed: true } })
  })

})
