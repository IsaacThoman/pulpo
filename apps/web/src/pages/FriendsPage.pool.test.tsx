// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, FriendsList, PoolInvitation, PoolMember, PoolSummary } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query-client'
import i18n from '@/i18n'
import { FriendsPage } from './FriendsPage'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request, ApiError: class extends Error {}, isNetworkError: () => false }))
vi.mock('@/stores/auth', () => ({ useAuth: (select: (state: unknown) => unknown) => select({ user: { id: 'me', username: 'me' }, inviteCodesEnabled: false }) }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))

const profile = (id: string): FriendProfile => ({ id, username: id, displayName: id === 'me' ? 'Myself' : id, avatarUrl: null, profileColor: null })
const connection = (id: string): FriendConnection => ({ profile: profile(id), requestId: `friend-${id}`, requestedAt: '2026-09-01T00:00:00.000Z', acceptedAt: '2026-09-01T00:00:00.000Z' })
const member = (id: string): PoolMember => ({ profile: profile(id), owner: id === 'me', contributionBalanceMicros: 5_000_000, reservedMicros: id === 'Alice' ? 100_000 : 0, joinedAt: '2026-09-01T00:00:00.000Z' })
const invitation = (id: string): PoolInvitation => ({ id: `invite-${id}`, poolId: 'pool', inviter: profile('me'), invitee: profile(id), memberCount: 2, createdAt: '2026-09-01T00:00:00.000Z' })
let friends: FriendsList
let summary: PoolSummary
let mutation: (path: string, options: { method: string; body?: unknown }) => unknown

beforeEach(() => {
  friends = { friends: [connection('Alice'), connection('Bob')], incoming: [], outgoing: [], blocked: [] }
  summary = { accountBalanceMicros: 5_000_000, pool: { id: 'pool', ownerUserId: 'me', pooledBalanceMicros: 15_000_000, members: [member('me'), member('Alice'), member('Stranger')], pendingInvitations: [] }, incomingInvitations: [] }
  mutation = () => ({})
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } })
  mocks.request.mockReset().mockImplementation(async (path: string, options?: { method: string; body?: unknown }) => {
    if (options?.method) return mutation(path, options)
    if (path === '/api/friends') return structuredClone(friends)
    if (path === '/api/pools/me') return structuredClone(summary)
    return { count: 0 }
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); await i18n.changeLanguage('en-US') })
async function mount() {
  render(<QueryClientProvider client={queryClient}><FriendsPage /></QueryClientProvider>)
  await screen.findAllByText('Bob')
  await waitFor(() => expect(queryClient.getQueryState(['pool', 'me'])?.fetchStatus).toBe('idle'))
}
function poolRegion() { return screen.getByRole('region', { name: 'Pool' }) }
function friendsRegion() { return screen.getByRole('heading', { name: 'Friends', level: 2 }).closest('section')! }
async function menu(name: string) {
  const trigger = screen.getByRole('button', { name: `More options for ${name}` })
  act(() => trigger.focus())
  fireEvent.keyDown(trigger, { key: 'Enter' })
  return screen.findByRole('menu')
}
async function choose(name: string) { fireEvent.click(await screen.findByRole('menuitem', { name })) }
const writes = () => mocks.request.mock.calls.filter(([, options]) => options?.method)

describe('combined Friends and Pool page', () => {
  it('shows every pool member once, preserves balances, and separates the friends list', async () => {
    friends.incoming = [{ ...connection('Request'), acceptedAt: null }]
    await mount()
    expect(within(poolRegion()).getByText('Alice')).toBeTruthy()
    expect(within(poolRegion()).getByText('Stranger')).toBeTruthy()
    expect(within(poolRegion()).getByText('Myself')).toBeTruthy()
    expect(within(poolRegion()).getByText('$15.00')).toBeTruthy()
    expect(within(poolRegion()).getByText(/reserved/)).toBeTruthy()
    expect(within(friendsRegion()).queryByText('Alice')).toBeNull()
    expect(within(friendsRegion()).getByText('Bob')).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(headings.indexOf('Friend requests')).toBeLessThan(headings.indexOf('Pool'))
    expect(headings.indexOf('Pool')).toBeLessThan(headings.indexOf('Friends'))
  })

  it('keeps pending invitees in Friends, prevents duplicate invites, and cancels reserved seats', async () => {
    summary.pool!.pendingInvitations = [invitation('Bob')]
    await mount()
    expect(within(friendsRegion()).getByText('Invitation sent')).toBeTruthy()
    await menu('Bob')
    expect(screen.queryByRole('menuitem', { name: 'Invite to Pool' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    mutation = () => { summary.pool!.pendingInvitations = []; return {} }
    fireEvent.click(within(poolRegion()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(friendsRegion()).queryByText('Invitation sent')).toBeNull())
    expect(writes()[0]).toEqual(['/api/pools/invitations/invite-Bob', { method: 'DELETE' }])
  })

  it('creates the first pool only after balance disclosure confirmation', async () => {
    summary.pool = null
    await mount()
    expect(screen.queryByRole('region', { name: 'Pool' })).toBeNull()
    await menu('Bob'); await choose('Invite to Pool')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('$5.00')).toBeTruthy()
    expect(writes()).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More options for Bob' })))
    expect(writes()).toHaveLength(0)
    await menu('Bob'); await choose('Invite to Pool')
    mutation = () => { summary.pool = { id: 'pool', ownerUserId: 'me', members: [member('me')], pendingInvitations: [invitation('Bob')], pooledBalanceMicros: 5_000_000 }; return {} }
    fireEvent.click(await screen.findByRole('button', { name: 'Invite and share' }))
    await screen.findByText('Invitation sent')
    expect(within(poolRegion()).getByText('Myself')).toBeTruthy()
    expect(writes()).toEqual([['/api/pools/invitations', { method: 'POST', body: { userId: 'Bob', balanceDisclosureAccepted: true } }]])
  })

  it('counts pending invitations against capacity', async () => {
    summary.pool!.pendingInvitations = ['C', 'D', 'E'].map(invitation)
    await mount(); await menu('Bob')
    expect(screen.getByRole('menuitem', { name: 'Pool full' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pool full' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes()).toHaveLength(0)
  })

  it('hides owner actions for ordinary members but retains friendship controls', async () => {
    summary.pool!.ownerUserId = 'Stranger'
    await mount(); await menu('Alice')
    expect(screen.getByRole('menuitem', { name: 'Remove friend' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Block' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Make owner' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Remove from Pool' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await menu('Bob')
    expect(screen.queryByRole('menuitem', { name: 'Invite to Pool' })).toBeNull()
  })

  it('returns removed pool members to Friends and preserves owner controls for non-friends', async () => {
    await mount(); await menu('Stranger')
    expect(screen.queryByRole('menuitem', { name: 'Remove friend' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Make owner' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    mutation = () => { summary.pool!.members = summary.pool!.members.filter((row) => row.profile.id !== 'Alice'); return {} }
    await menu('Alice'); await choose('Remove from Pool')
    await waitFor(() => expect(within(friendsRegion()).getByText('Alice')).toBeTruthy())
    expect(within(poolRegion()).queryByText('Alice')).toBeNull()
    expect(writes()[0]?.[0]).toBe('/api/pools/members/Alice')
  })

  it('requires transferring ownership before leaving, then enables leaving', async () => {
    await mount()
    expect((screen.getByRole('button', { name: 'Leave Pool' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Transfer ownership before leaving this Pool.')).toBeTruthy()
    mutation = (path) => {
      if (path === '/api/pools/owner') summary.pool!.ownerUserId = 'Alice'
      else summary.pool = null
      return {}
    }
    await menu('Alice'); await choose('Make owner')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Leave Pool' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Leave Pool' }))
    await waitFor(() => expect(within(friendsRegion()).getByText('Alice')).toBeTruthy())
    expect(screen.queryByRole('region', { name: 'Pool' })).toBeNull()
    expect(writes().map(([path]) => path)).toEqual(['/api/pools/owner', '/api/pools/members/me'])
  })

  it.each(['Remove friend', 'Block'])('keeps %s available on a friend in the Pool and refreshes both lists', async (action) => {
    await mount()
    mutation = () => {
      friends.friends = friends.friends.filter((row) => row.profile.id !== 'Alice')
      if (action === 'Block') { summary.pool!.members = summary.pool!.members.filter((row) => row.profile.id !== 'Alice'); friends.blocked = [profile('Alice')] }
      return {}
    }
    await menu('Alice'); await choose(action)
    await waitFor(() => expect(writes()).toHaveLength(1))
    await waitFor(() => expect(queryClient.getQueryData<FriendsList>(['friends', 'me'])?.friends).toHaveLength(1))
    if (action === 'Block') {
      await waitFor(() => expect(within(poolRegion()).queryByText('Alice')).toBeNull())
      expect(writes()[0]).toEqual(['/api/friends/blocks', { method: 'POST', body: { userId: 'Alice' } }])
    } else {
      expect(within(poolRegion()).getByText('Alice')).toBeTruthy()
      expect(writes()[0]).toEqual(['/api/friends/Alice', { method: 'DELETE' }])
    }
  })

  it('joins an incoming invitation only after confirmation', async () => {
    summary.pool = null
    summary.incomingInvitations = [{ ...invitation('me'), inviter: profile('Alice') }]
    await mount()
    expect(screen.queryByRole('region', { name: 'Pool' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(writes()).toHaveLength(0)
    mutation = () => { summary.incomingInvitations = []; summary.pool = { id: 'pool', ownerUserId: 'Alice', members: [member('me'), member('Alice')], pendingInvitations: [], pooledBalanceMicros: 10_000_000 }; return {} }
    fireEvent.click(screen.getByRole('button', { name: 'Join and share' }))
    await waitFor(() => expect(within(poolRegion()).getByText('Alice')).toBeTruthy())
    expect(within(friendsRegion()).queryByText('Alice')).toBeNull()
    expect(writes()[0]).toEqual(['/api/pools/invitations/invite-me/accept', { method: 'POST', body: { balanceDisclosureAccepted: true } }])
  })

  it('disables joining another pool but still allows dismissing the invitation', async () => {
    summary.incomingInvitations = [{ ...invitation('me'), inviter: profile('Other owner') }]
    await mount()
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true)
    mutation = () => { summary.incomingInvitations = []; return {} }
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText('Other owner')).toBeNull())
    expect(writes()[0]?.[0]).toBe('/api/pools/invitations/invite-me/decline')
  })

  it('reports failed actions without moving the friend', async () => {
    await mount(); await menu('Bob'); await choose('Invite to Pool')
    mutation = () => { throw new Error('Invitation could not be sent') }
    fireEvent.click(await screen.findByRole('button', { name: 'Invite and share' }))
    await screen.findByText('Invitation could not be sent')
    expect(within(friendsRegion()).getByText('Bob')).toBeTruthy()
    expect(screen.queryByText('Invitation sent')).toBeNull()
    await menu('Bob')
    expect(screen.getByRole('menuitem', { name: 'Invite to Pool' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  it('keeps Friends usable if Pool loading fails and allows retry', async () => {
    const request = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation((path, options) => path === '/api/pools/me' ? Promise.reject(new Error('Pool unavailable')) : request(path, options))
    await mount(); await screen.findByText('Pool unavailable'); await menu('Bob')
    expect(screen.getByRole('menuitem', { name: 'Remove friend' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Invite to Pool' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    mocks.request.mockImplementation(request)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(poolRegion()).getByText('Alice')).toBeTruthy())
  })

  it('keeps cached pool members manageable after a failed refresh', async () => {
    await mount()
    const request = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation((path, options) => path === '/api/pools/me' ? Promise.reject(new Error('Refresh failed')) : request(path, options))
    await act(() => queryClient.invalidateQueries({ queryKey: ['pool', 'me'] }))
    await screen.findByText('Refresh failed')
    expect(within(poolRegion()).getByText('Alice')).toBeTruthy()
    await menu('Alice')
    expect(screen.getByRole('menuitem', { name: 'Remove friend' })).toBeTruthy()
  })

  it('keeps Pool usable if Friends loading fails', async () => {
    const request = mocks.request.getMockImplementation()!
    mocks.request.mockImplementation((path, options) => path === '/api/friends' ? Promise.reject(new Error('Friends unavailable')) : request(path, options))
    render(<QueryClientProvider client={queryClient}><FriendsPage /></QueryClientProvider>)
    await screen.findByText('Friends unavailable')
    await waitFor(() => expect(within(poolRegion()).getByText('Alice')).toBeTruthy())
    await menu('Alice')
    expect(screen.getByRole('menuitem', { name: 'Make owner' })).toBeTruthy()
  })

  it('distinguishes all friends in the Pool from having no friends and reacts to membership refreshes', async () => {
    await mount()
    summary.pool!.members.push(member('Bob'))
    await act(() => queryClient.invalidateQueries({ queryKey: ['pool', 'me'] }))
    await screen.findByText('All your friends are in your Pool.')
    expect(screen.queryByRole('heading', { name: 'Add friends' })).toBeNull()
    friends.friends = []
    await act(() => queryClient.invalidateQueries({ queryKey: ['friends', 'me'] }))
    await screen.findByRole('heading', { name: 'Add friends' })
    expect(within(poolRegion()).getByText('Bob')).toBeTruthy()
  })

  it('renders the new invitation menu and disclosure in Spanish', async () => {
    await i18n.changeLanguage('es-ES')
    await mount()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Más opciones para Bob' }), { key: 'Enter' })
    await choose('Invitar al fondo')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Al invitar a Bob/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Invitar y compartir' })).toBeTruthy()
  })
})
