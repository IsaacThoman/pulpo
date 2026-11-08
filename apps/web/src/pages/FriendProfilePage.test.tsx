// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query-client'
import { FriendProfilePage } from './FriendProfilePage'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))

const friendId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000003'
let detail: FriendProfileDetail

function mount(path = '/alice') {
  render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/:username" element={<FriendProfilePage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => {
  detail = {
    profile: { id: friendId, displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null },
    relationship: 'friends',
    requestId,
    friendsSince: '2026-09-01T12:00:00.000Z',
    mutualFriends: [{ id: '00000000-0000-4000-8000-000000000002', displayName: 'Bob', username: 'bob', avatarUrl: null, profileColor: null }],
  }
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } })
  mocks.request.mockReset().mockImplementation(async (_path: string, options?: { method?: string }) => {
    if (!options?.method) return structuredClone(detail)
    return {}
  })
})
afterEach(() => { cleanup(); queryClient.clear() })

describe('profile page', () => {
  it('loads an accepted friend by username and links mutual friends by username', async () => {
    mount()

    await screen.findByRole('heading', { name: 'Alice' })
    expect(mocks.request).toHaveBeenCalledWith('/api/profiles/alice')
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText(/Friends since/)).toBeTruthy()
    expect(screen.getByText('Friends')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Bob' }).getAttribute('href')).toBe('/bob')
    expect(screen.getByRole('link', { name: 'Back to friends' }).getAttribute('href')).toBe('/friends')
  })

  it('lets the viewer request a non-friend from their profile', async () => {
    detail = { ...detail, relationship: 'none', requestId: null, friendsSince: null, mutualFriends: [] }
    mocks.request.mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (!options?.method) return structuredClone(detail)
      detail = { ...detail, relationship: 'outgoing', requestId }
      return { requestId, status: 'pending' }
    })
    mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Add friend' }))

    await screen.findByRole('button', { name: 'Cancel request' })
    expect(mocks.request).toHaveBeenCalledWith('/api/friends/requests', { method: 'POST', body: { userId: friendId } })
    await waitFor(() => expect(queryClient.getQueryState(['friend-profile', 'alice'])?.fetchStatus).toBe('idle'))
  })
})
