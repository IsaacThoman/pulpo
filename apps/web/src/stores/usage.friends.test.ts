import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})

const requests: Array<{ resolve: (body: unknown) => void }> = []
vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
  requests.push({
    resolve: (body) => resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  })
})))

const [{ useUsage }, { useAuth }] = await Promise.all([
  import('./usage'),
  import('./auth'),
])

const currentUserId = '00000000-0000-4000-8000-000000000001'
const friendId = '00000000-0000-4000-8000-000000000002'

beforeEach(() => {
  requests.splice(0)
  useAuth.setState({ user: {
    id: currentUserId,
    name: 'Current User',
    email: 'current@example.com',
    username: 'current_user',
    avatarUrl: null,
    profileColor: null,
    role: 'user',
    initials: 'CU',
    balanceMicros: 0,
    storageLimitBytes: 1_000,
    blocked: false,
    stateRevision: 0,
    createdAt: '2026-08-10T12:00:00.000Z',
  } })
})

afterAll(() => vi.unstubAllGlobals())

describe('friends usage store', () => {
  it('clears previously loaded users before replacing them with the private friend circle', async () => {
    useUsage.setState({
      currentUserId: 'admin-view',
      users: [{
        id: 'unrelated-user', name: 'Unrelated', username: null, avatarUrl: null, profileColor: null,
        email: 'private@example.com', role: 'user', balance: 100, joinedAt: 0, blocked: false,
      }],
    })

    const pending = useUsage.getState().loadLeaderboard('30d')
    expect(useUsage.getState().users).toEqual([])
    expect(useUsage.getState().currentUserId).toBe(currentUserId)

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve({ data: [{
      userId: friendId,
      displayName: 'Accepted Friend',
      username: 'accepted_friend',
      avatarUrl: `/api/users/${friendId}/avatar?v=2`,
      profileColor: '#3b82f6',
      balanceMicros: 2_500_000,
      calls: 4,
      tokens: 500,
      costMicros: 125_000,
    }] })
    await pending

    expect(useUsage.getState().users).toEqual([expect.objectContaining({
      id: friendId,
      name: 'Accepted Friend',
      username: 'accepted_friend',
      profileColor: '#3b82f6',
      balance: 2.5,
      usageCalls: 4,
    })])
  })
})
