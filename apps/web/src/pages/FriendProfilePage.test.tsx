// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FriendProfilePage } from './FriendProfilePage'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))

const friendId = '00000000-0000-4000-8000-000000000001'
const mutualId = '00000000-0000-4000-8000-000000000002'
const detail: FriendProfileDetail = {
  profile: { id: friendId, displayName: 'Alice', username: 'alice', avatarUrl: null, profileColor: null },
  friendsSince: '2026-09-01T12:00:00.000Z',
  mutualFriends: [{ id: mutualId, displayName: 'Bob', username: 'bob', avatarUrl: null, profileColor: null }],
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.request.mockReset().mockResolvedValue(detail)
})
afterEach(() => { cleanup(); client.clear() })

describe('friend profile page', () => {
  it('shows the accepted friend and links mutual friends to their profiles', async () => {
    render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/friends/${friendId}`]}>
        <Routes><Route path="/friends/:userId" element={<FriendProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>)

    await screen.findByRole('heading', { name: 'Alice' })
    expect(mocks.request).toHaveBeenCalledWith(`/api/friends/${friendId}/profile`)
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText(/Friends since/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Bob' }).getAttribute('href')).toBe(`/friends/${mutualId}`)
    expect(screen.getByRole('link', { name: 'Back to friends' }).getAttribute('href')).toBe('/friends')
  })
})
