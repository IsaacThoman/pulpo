// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/local-first/database', () => ({ clearLocalUserData: vi.fn() }))
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
vi.mock('@/lib/local-first/composer-drafts', () => ({ clearRuntimeComposerDrafts: vi.fn() }))
vi.mock('./chat', () => ({ useChat: { setState: vi.fn() } }))

Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true })
const { useAuth } = await import('./auth')

type Pending = { path: string; resolve: (body: unknown, status?: number) => void; reject: (error: unknown) => void }
let requests: Pending[]
const user = { id: 'audit-user', name: 'Audit', username: 'audit', email: 'audit@example.com', role: 'user', stateRevision: 1 }

beforeEach(() => {
  requests = []
  localStorage.clear()
  useAuth.setState({ user: null, checkingSession: true, setupRequired: null })
  vi.stubGlobal('fetch', vi.fn((input: string) => new Promise<Response>((resolve, reject) => {
    requests.push({ path: String(input), reject, resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    })) })
  })))
})

function respond() {
  for (const request of requests) request.resolve(request.path.endsWith('/api/me') ? { user } : request.path.endsWith('setup-status') ? { required: false } : { signupEnabled: true })
}

it('starts independent bootstrap requests together and shares an in-flight bootstrap', async () => {
  const first = useAuth.getState().bootstrap()
  const second = useAuth.getState().bootstrap()
  expect(first).toBe(second)
  expect(requests.map((request) => request.path)).toEqual(['/api/auth/setup-status', '/api/auth/settings', '/api/me'])
  respond()
  await first
  expect(useAuth.getState().user?.id).toBe(user.id)
  expect(useAuth.getState().checkingSession).toBe(false)
  await useAuth.getState().bootstrap()
  expect(requests).toHaveLength(3)
})

it('keeps the cached profile offline and clears the in-flight guard for a later retry', async () => {
  useAuth.setState({ user: { ...user, role: 'user', initials: 'A' } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
  const first = useAuth.getState().bootstrap()
  requests.forEach((request) => request.reject(new TypeError('offline')))
  await first
  expect(useAuth.getState().user?.id).toBe(user.id)
  useAuth.setState({ checkingSession: true })
  requests = []
  const next = useAuth.getState().bootstrap()
  expect(next).not.toBe(first)
  respond()
  await next
})

it('does not restore a stale bootstrap session after logout', async () => {
  const pending = useAuth.getState().bootstrap()
  await useAuth.getState().logout(true)
  respond()
  await pending
  expect(useAuth.getState().user).toBeNull()
  expect(localStorage.getItem('pulpo-profile')).toBeNull()
})
