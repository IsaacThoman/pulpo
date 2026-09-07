// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceSession } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({ request: vi.fn(), logout: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/stores/auth', () => ({ useAuth: Object.assign((select: (state: unknown) => unknown) => select({ user: { id: 'owner' } }), { getState: () => ({ logout: mocks.logout }) }) }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string, values?: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => values?.[key] ?? key), activeLocale: () => 'en-US' }))
import { DeviceSessionListView, DeviceSettings } from './DeviceSettings'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const current: DeviceSession = { id: 'current', deviceLabel: 'Chrome on Mac', appType: 'web', platform: 'macos', browser: 'Chrome', signInIp: '198.51.100.1', latestIp: '198.51.100.2', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), expiresAt: new Date().toISOString(), isCurrent: true }
const other = { ...current, id: 'other', deviceLabel: 'My iPhone', platform: 'ios' as const, appType: 'mobile' as const, browser: null, isCurrent: false }
let root: Root, container: HTMLDivElement, queryClient: QueryClient
beforeEach(() => {
  vi.resetAllMocks()
  mocks.request.mockImplementation(async (_path: string, options?: { method?: string }) => options?.method ? undefined : { sessions: [current, other] })
  mocks.logout.mockResolvedValue(undefined)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); queryClient.clear(); container.remove(); focusManager.setFocused(undefined) })
async function mount(userId?: string) {
  await act(async () => { root.render(<QueryClientProvider client={queryClient}><DeviceSessionListView userId={userId} /></QueryClientProvider>) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
async function click(label: string) {
  const buttons = Array.from(document.querySelectorAll('button'))
  const button = buttons.find((node) => node.getAttribute('aria-label') === label || node.textContent === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
describe('device management', () => {
  it('displays device/IP details directly in the settings section', async () => {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><DeviceSettings /></QueryClientProvider>))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(mocks.request).toHaveBeenCalledWith('/api/me/sessions')
    expect(document.querySelector('h2')?.textContent).toBe('Devices')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain('This device')
    expect(document.body.textContent).toContain('Latest IP: 198.51.100.2')
    expect(document.body.textContent).toContain('Sign-in IP: 198.51.100.1')
    expect(document.querySelector('details')?.open).toBe(false)
  })
  it('requires confirmation and allows cancellation without revoking', async () => {
    await mount(); await click('Sign out My iPhone')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    await click('Cancel')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('revokes one device and refreshes the list', async () => {
    await mount(); await click('Sign out My iPhone')
    const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent === 'Sign out')!
    await act(async () => (button as HTMLButtonElement).click())
    expect(mocks.request).toHaveBeenCalledWith('/api/me/sessions/other', { method: 'DELETE' })
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('warns before signing out the current device and clears credentials', async () => {
    await mount(); await click('Sign out Chrome on Mac')
    expect(document.body.textContent).toContain('You will return to sign-in.')
    const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent === 'Sign out')!
    await act(async () => (button as HTMLButtonElement).click())
    expect(mocks.logout).toHaveBeenCalledWith(true)
  })
  it('keeps sessions signed in and shows mutation errors', async () => {
    await mount(); await click('Sign out all other devices')
    mocks.request.mockRejectedValueOnce(new Error('Try again later'))
    const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent === 'Sign out')!
    await act(async () => (button as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('Try again later')
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('uses admin endpoints for the selected user and supports bulk revocation', async () => {
    await mount('target-user')
    expect(mocks.request).toHaveBeenCalledWith('/api/admin/users/target-user/sessions')
    await click('Sign out all devices')
    const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent === 'Sign out')!
    await act(async () => (button as HTMLButtonElement).click())
    expect(mocks.request).toHaveBeenCalledWith('/api/admin/users/target-user/sessions/revoke-all', { method: 'POST' })
    expect(mocks.logout).not.toHaveBeenCalled()
  })
  it('refreshes on focus and supports retry and empty results', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Offline'))
    await mount()
    expect(document.body.textContent).toContain('Offline')
    mocks.request.mockResolvedValue({ sessions: [] })
    await click('Retry')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(document.body.textContent).toContain('No signed-in devices.')
    const calls = mocks.request.mock.calls.length
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(mocks.request.mock.calls.length).toBeGreaterThan(calls)
  })
})
