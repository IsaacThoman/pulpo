// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined), request: vi.fn() }))
vi.mock('@/lib/instance-features', () => ({ refreshInstanceFeatures: mocks.refresh }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
const { useAuth } = await import('@/stores/auth')
const { queryClient } = await import('@/lib/query-client')
const { SettingsModal } = await import('./SettingsModal')
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

type User = NonNullable<ReturnType<typeof useAuth.getState>['user']>
// Cached profiles from before the setting existed have no usageVisibility.
const user = {
  id: 'user-1', email: 'ada@example.com', name: 'Ada Tester', username: 'ada', avatarUrl: null,
  profileColor: '#ef4444', role: 'user', initials: 'AT', createdAt: '2026-09-01T00:00:00Z',
} as unknown as User

const visibilitySelect = () => screen.getByRole('combobox', { name: 'Usage visibility' })
async function chooseVisibility(label: string) {
  fireEvent.keyDown(visibilitySelect(), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  useAuth.setState({ codexEnabled: false, billingEnabled: false, user })
  mocks.request.mockImplementation(async (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === '/api/me' && init?.method === 'PATCH') return { user: { ...user, ...init.body } }
    return {}
  })
})
afterEach(() => { cleanup(); client.clear() })

function open() {
  return render(<QueryClientProvider client={client}><MemoryRouter><SettingsModal open onClose={() => {}} initialSection="profile" /></MemoryRouter></QueryClientProvider>)
}

describe('usage visibility setting', () => {
  it('defaults to friends, explains the levels, and saves a choice right away', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    open()
    expect(visibilitySelect().textContent).toBe('Friends')
    expect(document.getElementById(visibilitySelect().getAttribute('aria-describedby')!)?.textContent)
      .toBe('Who can see your usage stats and requests on your profile. Pool members can always see your usage.')

    fireEvent.keyDown(visibilitySelect(), { key: 'ArrowDown' })
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Private (Pool only)', 'Friends', 'Public'])
    fireEvent.click(screen.getByRole('option', { name: 'Public' }))

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/api/me', { method: 'PATCH', body: { usageVisibility: 'public' } }))
    await waitFor(() => expect(useAuth.getState().user?.usageVisibility).toBe('public'))
    expect(visibilitySelect().textContent).toBe('Public')
    for (const key of ['friends-usage', 'pool-usage', 'friend-profile']) {
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] }))
    }
    invalidate.mockRestore()
  })

  it('rolls back and announces a failed save', async () => {
    mocks.request.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/me' && init?.method === 'PATCH') throw new Error('Could not reach Pulpo')
      return {}
    })
    open()

    await chooseVisibility('Private (Pool only)')

    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach Pulpo')
    expect(visibilitySelect().textContent).toBe('Friends')
    expect(visibilitySelect().getAttribute('aria-invalid')).toBe('true')
    expect(useAuth.getState().user?.usageVisibility).toBeUndefined()
  })

  it('keeps an unsaved display name when the visibility saves', async () => {
    open()
    const name = screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Ada Draft' } })

    await chooseVisibility('Private (Pool only)')

    await waitFor(() => expect(useAuth.getState().user?.usageVisibility).toBe('pool'))
    expect(name.value).toBe('Ada Draft')
    expect((screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
