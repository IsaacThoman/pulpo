// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorUser } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  request: vi.fn(), load: vi.fn(), users: [] as MonitorUser[], billingEnabled: false, adminId: 'admin', instance: '',
  billingUsers: [] as { userId: string; plan: 'baby' | 'eight' | 'fat'; weeklyLimitMicros: number; fiveHourLimitMicros: number }[],
}))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/stores/usage', () => ({ useUsage: (select: (state: unknown) => unknown) => select({ users: mocks.users, loadAdmin: mocks.load }) }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ user: { id: mocks.adminId }, billingEnabled: mocks.billingEnabled }) }))
vi.mock('@/lib/runtime', () => ({ runtimeAccountKey: (userId: string) => `${mocks.instance}${userId}` }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { data: mocks.billingUsers.map((row) => ({
  ...row, subscriptionPlan: row.plan, weeklySpentMicros: 0, fiveHourSpentMicros: 0, storageLimitBytes: 0,
})) } }) }))
vi.mock('@/components/settings/DeviceSettings', () => ({ DeviceSessionListView: () => null }))
vi.mock('@/components/ProfileAvatar', () => ({ ProfileAvatar: () => null }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text, activeLocale: () => 'en-US' }))
import { AdminUsersPage } from './AdminUsersPage'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value) },
  })
  mocks.adminId = 'admin'
  mocks.instance = ''
  mocks.billingEnabled = false
  mocks.billingUsers = []
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
  vi.unstubAllGlobals()
})
const deleteButton = () => container.querySelector<HTMLButtonElement>('button[title="Delete"]')!
const mount = async () => { await act(async () => root.render(<AdminUsersPage />)) }

describe('admin user sorting', () => {
  beforeEach(() => {
    const user = mocks.users[0]
    mocks.users = [
      { ...user, id: 'a', name: 'Zed', username: 'zed', email: 'alpha@example.test', role: 'user', balance: 100, storageBytes: 2, joinedAt: 300, lastActiveAt: 100, inviteCodeQuota: 10 },
      { ...user, id: 'b', name: 'alice', username: 'alice', email: 'zeta@example.test', role: 'admin', balance: 2, storageBytes: 100, joinedAt: 100, lastActiveAt: 300, inviteCodeQuota: 2 },
      { ...user, id: 'c', name: 'Bob', username: 'bob', email: 'beta@example.test', role: 'pending', balance: 10, storageBytes: 10, joinedAt: 200, lastActiveAt: 200, inviteCodeQuota: 100 },
    ]
  })

  const emails = () => Array.from(container.querySelectorAll('tbody tr'), (row) => row.children[3].textContent)
  const header = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('thead button')).find((button) => button.textContent === label)!
  const sortBy = async (label: string) => { await act(async () => header(label).click()) }
  const enableBilling = () => {
    mocks.billingEnabled = true
    mocks.billingUsers = [
      { userId: 'a', plan: 'fat', weeklyLimitMicros: 2, fiveHourLimitMicros: 100 },
      { userId: 'b', plan: 'baby', weeklyLimitMicros: 100, fiveHourLimitMicros: 10 },
      { userId: 'c', plan: 'eight', weeklyLimitMicros: 10, fiveHourLimitMicros: 2 },
    ]
  }

  it.each([
    ['Role', ['zeta', 'beta', 'alpha']],
    ['Display name', ['zeta', 'beta', 'alpha']],
    ['Last active', ['alpha', 'beta', 'zeta']],
    ['Email', ['alpha', 'beta', 'zeta']],
    ['Plan', ['zeta', 'beta', 'alpha']],
    ['Weekly limit', ['alpha', 'beta', 'zeta']],
    ['5-hour limit', ['beta', 'zeta', 'alpha']],
    ['Invites', ['zeta', 'alpha', 'beta']],
    ['Balance', ['zeta', 'beta', 'alpha']],
    ['File storage', ['alpha', 'beta', 'zeta']],
    ['Created', ['zeta', 'beta', 'alpha']],
  ])('sorts %s in both directions without changing store order', async (label, order) => {
    enableBilling()
    await mount()
    const expected = order.map((name) => `${name}@example.test`)
    await sortBy(label)
    expect(emails()).toEqual(expected)
    expect(header(label).closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    await sortBy(label)
    expect(emails()).toEqual([...expected].reverse())
    expect(header(label).closest('th')?.getAttribute('aria-sort')).toBe('descending')
    expect(mocks.users.map((user) => user.id)).toEqual(['a', 'b', 'c'])
  })

  it('preserves sorting while searching and updates the active column', async () => {
    await mount()
    expect(container.querySelectorAll('thead button')).toHaveLength(7)
    await sortBy('Balance')
    await act(async () => fireEvent.change(container.querySelector('input')!, { target: { value: 'eta' } }))
    expect(emails()).toEqual(['zeta@example.test', 'beta@example.test'])
    await sortBy('Email')
    expect(emails()).toEqual(['beta@example.test', 'zeta@example.test'])
    expect(header('Balance').closest('th')?.hasAttribute('aria-sort')).toBe(false)
    await act(async () => fireEvent.change(container.querySelector('input')!, { target: { value: '' } }))
    expect(emails()).toEqual(['alpha@example.test', 'beta@example.test', 'zeta@example.test'])
  })

  it('keeps users who have never been active last in both directions', async () => {
    mocks.users[0].lastActiveAt = null
    await mount()
    await sortBy('Last active')
    expect(emails()).toEqual(['beta@example.test', 'zeta@example.test', 'alpha@example.test'])
    await sortBy('Last active')
    expect(emails()).toEqual(['zeta@example.test', 'beta@example.test', 'alpha@example.test'])
  })

  it('keeps missing billing data last and reorders when it arrives', async () => {
    enableBilling()
    const delayed = mocks.billingUsers.pop()!
    await mount()
    await sortBy('Plan')
    expect(emails()).toEqual(['zeta@example.test', 'alpha@example.test', 'beta@example.test'])
    await sortBy('Plan')
    expect(emails()).toEqual(['alpha@example.test', 'zeta@example.test', 'beta@example.test'])
    mocks.billingUsers.push(delayed)
    await mount()
    expect(emails()).toEqual(['alpha@example.test', 'beta@example.test', 'zeta@example.test'])
  })

  it('preserves row order for equal values and handles an empty table', async () => {
    mocks.users.forEach((user) => { user.balance = 0 })
    await mount()
    await sortBy('Balance')
    await sortBy('Balance')
    expect(emails()).toEqual(['alpha@example.test', 'zeta@example.test', 'beta@example.test'])
    mocks.users = []
    await mount()
    expect(emails()).toEqual([])
  })

  it('restores the search and sort direction on a fresh mount, including a cleared search', async () => {
    await mount()
    await sortBy('Balance')
    await sortBy('Balance')
    await act(async () => fireEvent.change(container.querySelector('input')!, { target: { value: 'eta' } }))
    await act(async () => root.unmount())
    root = createRoot(container)
    await mount()
    expect(container.querySelector('input')?.value).toBe('eta')
    expect(header('Balance').closest('th')?.getAttribute('aria-sort')).toBe('descending')
    expect(emails()).toEqual(['beta@example.test', 'zeta@example.test'])

    await act(async () => fireEvent.change(container.querySelector('input')!, { target: { value: '' } }))
    await act(async () => root.unmount())
    root = createRoot(container)
    await mount()
    expect(container.querySelector('input')?.value).toBe('')
    expect(emails()).toEqual(['alpha@example.test', 'beta@example.test', 'zeta@example.test'])
  })

  it('keeps saved views separate when the admin or instance changes', async () => {
    await mount()
    await sortBy('Balance')
    await act(async () => fireEvent.change(container.querySelector('input')!, { target: { value: 'eta' } }))
    mocks.adminId = 'another-admin'
    await mount()
    expect(container.querySelector('input')?.value).toBe('')
    expect(container.querySelector('th[aria-sort]')).toBeNull()
    await sortBy('Email')

    mocks.adminId = 'admin'
    mocks.instance = 'https://another-instance.test|'
    await mount()
    expect(container.querySelector('input')?.value).toBe('')
    expect(container.querySelector('th[aria-sort]')).toBeNull()

    mocks.instance = ''
    await mount()
    expect(container.querySelector('input')?.value).toBe('eta')
    expect(header('Balance').closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(emails()).toEqual(['zeta@example.test', 'beta@example.test'])
  })

  it.each([
    'invalid json',
    'null',
    JSON.stringify({ query: 123, sort: { key: 'unknown', direction: 'ascending' } }),
    JSON.stringify({ query: '', sort: { key: 'balance', direction: 'invalid' } }),
  ])('uses defaults for invalid saved view %s', async (saved) => {
    localStorage.setItem('pulpo-admin-users-view:admin', saved)
    await mount()
    expect(container.querySelector('input')?.value).toBe('')
    expect(container.querySelector('th[aria-sort]')).toBeNull()
    expect(emails()).toEqual(['alpha@example.test', 'zeta@example.test', 'beta@example.test'])
    await sortBy('Balance')
    expect(emails()).toEqual(['zeta@example.test', 'beta@example.test', 'alpha@example.test'])
  })

  it('keeps sorting and searching usable when storage is unavailable', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    await mount()
    await sortBy('Balance')
    await act(async () => fireEvent.change(container.querySelector('input')!, { target: { value: 'eta' } }))
    expect(emails()).toEqual(['zeta@example.test', 'beta@example.test'])
  })
})

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
