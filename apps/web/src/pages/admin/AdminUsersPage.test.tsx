// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorUser } from '@/lib/types'

const mocks = vi.hoisted(() => ({ request: vi.fn(), load: vi.fn(), users: [] as MonitorUser[] }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/stores/usage', () => ({ useUsage: (select: (state: unknown) => unknown) => select({ users: mocks.users, loadAdmin: mocks.load }) }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ user: { id: 'admin' }, billingEnabled: false }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }))
vi.mock('@/components/settings/DeviceSettings', () => ({ DeviceSessionListView: () => null }))
vi.mock('@/components/ProfileAvatar', () => ({ ProfileAvatar: () => null }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text, activeLocale: () => 'en-US' }))
import { AdminUsersPage } from './AdminUsersPage'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  mocks.users = [{ id: 'target', name: 'Test', username: 'test', email: 'test@example.test', role: 'user', balance: 0, joinedAt: 0, blocked: false, avatarUrl: null, profileColor: null }]
  mocks.load.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
const deleteButton = () => container.querySelector<HTMLButtonElement>('button[title="Delete"]')!
const mount = async () => { await act(async () => root.render(<AdminUsersPage />)) }

describe('admin account deletion', () => {
  it('shows API errors with the affected account and allows retry', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Transfer Pool ownership first.'))
    await mount()
    await act(async () => deleteButton().click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('test@example.test: Transfer Pool ownership first.')
    expect(deleteButton().disabled).toBe(false)
    expect(mocks.load).toHaveBeenCalledTimes(1)
    mocks.request.mockResolvedValueOnce({ status: 'deletion_requested' })
    await act(async () => deleteButton().click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })

  it('prevents duplicate submissions and shows progress after acceptance', async () => {
    let accept!: (value: unknown) => void
    mocks.request.mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    await mount()
    await act(async () => deleteButton().click())
    expect(deleteButton().disabled).toBe(true)
    await act(async () => deleteButton().click())
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('/api/admin/users/target', { method: 'DELETE' })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('at least 16 minutes'))
    mocks.load.mockImplementationOnce(async () => {
      mocks.users = [{ ...mocks.users[0], blocked: true, deletionRequestedAt: new Date().toISOString() }]
    })
    await act(async () => accept({ status: 'deletion_requested' }))
    expect(container.textContent).toContain('Account deletion in progress')
    expect(deleteButton().disabled).toBe(true)
  })

  it('does not delete when confirmation is canceled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    await mount()
    await act(async () => deleteButton().click())
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('disables deletion for the current administrator', async () => {
    mocks.users[0].id = 'admin'
    await mount()
    expect(deleteButton().disabled).toBe(true)
  })
})
