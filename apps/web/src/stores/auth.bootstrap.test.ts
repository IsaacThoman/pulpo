// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/local-first/database', () => ({ clearLocalUserData: vi.fn() }))
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
vi.mock('@/lib/local-first/composer-drafts', () => ({ clearRuntimeComposerDrafts: vi.fn() }))
vi.mock('./chat', () => ({ useChat: { setState: vi.fn() } }))
vi.mock('@/lib/passkeys', () => ({
  authenticateWithPasskey: vi.fn(async () => ({})),
  passkeyErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

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

it.each(['login', 'signup', 'setup', 'passkey'] as const)('keeps a successful %s when the signed-out bootstrap finishes later', async (action) => {
  const pending = useAuth.getState().bootstrap()
  const startupRequests = [...requests]
  const auth = useAuth.getState()
  const signingIn = action === 'login'
    ? auth.login(user.email, 'test-password')
    : action === 'passkey'
      ? auth.passkeyLogin()
      : auth[action](user.name, user.username, user.email, 'test-password')
  if (action === 'passkey') {
    requests.at(-1)!.resolve({ ceremonyToken: 'test-ceremony', options: {} })
    await vi.waitFor(() => expect(requests.at(-1)!.path).toBe('/api/auth/passkey/verify'))
  }
  requests.at(-1)!.resolve({ user })
  expect(await signingIn).toEqual({ ok: true })
  expect(useAuth.getState().user?.id).toBe(user.id)

  for (const request of startupRequests) {
    if (request.path === '/api/me') request.resolve({ error: { code: 'unauthorized' } }, 401)
    else request.resolve(request.path.endsWith('setup-status') ? { required: false } : { signupEnabled: true })
  }
  await pending
  expect(useAuth.getState().user?.id).toBe(user.id)
  expect(JSON.parse(localStorage.getItem('pulpo-profile')!).id).toBe(user.id)
  expect(useAuth.getState().checkingSession).toBe(false)
})

it('does not replace a new login with the previous account from a delayed bootstrap', async () => {
  const pending = useAuth.getState().bootstrap()
  const startupRequests = [...requests]
  const signingIn = useAuth.getState().login(user.email, 'test-password')
  requests.at(-1)!.resolve({ user })
  expect(await signingIn).toEqual({ ok: true })
  const previousUser = { ...user, id: 'previous-account', email: 'previous@example.test' }
  for (const request of startupRequests) {
    request.resolve(request.path === '/api/me' ? { user: previousUser } : request.path.endsWith('setup-status') ? { required: false } : {})
  }
  await pending
  expect(useAuth.getState().user?.id).toBe(user.id)
  expect(JSON.parse(localStorage.getItem('pulpo-profile')!).id).toBe(user.id)
})

it('still accepts the startup session when a later login fails', async () => {
  const pending = useAuth.getState().bootstrap()
  const signingIn = useAuth.getState().login(user.email, 'wrong-password')
  requests.at(-1)!.resolve({ error: { code: 'unauthorized', message: 'Invalid credentials' } }, 401)
  expect(await signingIn).toEqual({ ok: false, error: 'Invalid credentials' })
  respond()
  await pending
  expect(useAuth.getState().user?.id).toBe(user.id)
})


it('defaults Codex off when an older server omits the feature flag', async () => {
  useAuth.setState({ codexEnabled: true })
  const pending = useAuth.getState().bootstrap()
  respond()
  await pending
  expect(useAuth.getState().codexEnabled).toBe(false)
})

it('refreshes the Codex policy and fails closed when settings cannot be read', async () => {
  const refresh = useAuth.getState().refreshSettings()
  requests[0]!.resolve({ codexEnabled: true })
  await refresh
  expect(useAuth.getState().codexEnabled).toBe(true)
  const unavailable = useAuth.getState().refreshSettings()
  requests[1]!.reject(new TypeError('Offline'))
  await unavailable
  expect(useAuth.getState().codexEnabled).toBe(false)
})
