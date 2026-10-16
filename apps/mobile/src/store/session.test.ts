import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  syncShortcuts: vi.fn(),
  clearShortcuts: vi.fn(),
  token: 'session-token' as string | null,
  secure: new Map<string, string>(),
  alert: vi.fn(),
  logout: vi.fn(),
  meWithToken: vi.fn(),
  logoutWithToken: vi.fn(),
  config: vi.fn(),
  me: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  passkeyOptions: vi.fn(),
  verifyPasskey: vi.fn(),
  exchangeBrowserPasskey: vi.fn(),
  canUseNativePasskeys: vi.fn(() => false),
  nativeAuthenticate: vi.fn(),
  runSafariPasskeyAuthentication: vi.fn(),
  configureApi: vi.fn(),
  clearNamespace: vi.fn(async () => []),
  deleteToken: vi.fn(async (_key: string) => undefined),
}))

vi.mock('../shortcuts/native', () => ({ syncShortcutsSession: mocks.syncShortcuts, clearShortcutsSession: mocks.clearShortcuts }))

vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, Appearance: { setColorScheme: vi.fn() }, Platform: { OS: 'ios' } }))
vi.mock('expo-device', () => ({ deviceName: 'Test iPhone', modelName: 'iPhone' }))
vi.mock('expo-file-system', () => ({ File: class { exists = false; delete() {} } }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: vi.fn(async (key: string) => key === 'pulpo.native.session' ? mocks.token : mocks.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    if (key === 'pulpo.native.session') mocks.token = value
    else mocks.secure.set(key, value)
  }),
  deleteItemAsync: mocks.deleteToken,
}))
vi.mock('../data/database', () => ({
  cacheNamespace: (instanceUrl: string, userId: string) => `${new URL(instanceUrl).origin}|${userId}`,
  clearNamespace: mocks.clearNamespace,
  getValue: vi.fn(async (namespace: string, key: string) => mocks.values.get(`${namespace}:${key}`) ?? null),
  setValue: vi.fn(async (namespace: string, key: string, value: unknown) => {
    mocks.values.set(`${namespace}:${key}`, value)
  }),
}))
vi.mock('../auth/passkeys', () => ({
  canUseNativePasskeys: mocks.canUseNativePasskeys,
  NativePasskeyError: class NativePasskeyError extends Error {},
  PasskeyCancelledError: class PasskeyCancelledError extends Error {},
  nativeAuthenticate: mocks.nativeAuthenticate,
  runSafariPasskeyAuthentication: mocks.runSafariPasskeyAuthentication,
}))
vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message)
    }
  }
  return {
    ApiError,
    apiOrigin: () => 'https://pulpo.test',
    configureApi: mocks.configureApi,
    isNetworkError: (error: unknown) => error instanceof TypeError,
    mobileApi: {
      config: mocks.config,
      me: mocks.me,
      login: mocks.login,
      passkeyOptions: mocks.passkeyOptions,
      verifyPasskey: mocks.verifyPasskey,
      exchangeBrowserPasskey: mocks.exchangeBrowserPasskey,
      signup: mocks.signup,
      logout: mocks.logout,
      meWithToken: mocks.meWithToken,
      logoutWithToken: mocks.logoutWithToken,
    },
  }
})

import { ApiError } from '../api/client'
import { useSessionStore } from './session'

const instanceUrl = 'https://pulpo.test'

function user(id: string, name = id): User {
  return {
    id,
    email: `${id}@pulpo.test`,
    name,
    username: `pulpo_${id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    avatarUrl: null,
    profileColor: null,
    role: 'user',
    balanceMicros: 0,
    storageLimitBytes: 1,
    blocked: false,
    stateRevision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.values.clear()
  mocks.token = 'session-token'
  mocks.config.mockReset().mockResolvedValue(null)
  mocks.me.mockReset()
  mocks.login.mockReset()
  mocks.signup.mockReset()
  mocks.passkeyOptions.mockReset()
  mocks.verifyPasskey.mockReset()
  mocks.exchangeBrowserPasskey.mockReset()
  mocks.canUseNativePasskeys.mockReset().mockReturnValue(false)
  mocks.nativeAuthenticate.mockReset()
  mocks.runSafariPasskeyAuthentication.mockReset()
  mocks.configureApi.mockReset()
  mocks.deleteToken.mockReset().mockImplementation(async (key: string) => {
    if (key === 'pulpo.native.session') mocks.token = null
    else mocks.secure.delete(key)
  })
  mocks.secure.clear()
  mocks.alert.mockReset()
  mocks.logout.mockReset().mockResolvedValue(undefined)
  mocks.meWithToken.mockReset()
  mocks.logoutWithToken.mockReset().mockResolvedValue(undefined)
  mocks.clearNamespace.mockReset().mockResolvedValue([])
  useSessionStore.setState({
    status: 'hydrating', instanceUrl, token: null, user: null, accounts: [], config: null, error: null,
  })
  mocks.values.set('global:instanceUrl', instanceUrl)
  mocks.syncShortcuts.mockClear()
  mocks.clearShortcuts.mockClear()
})

describe('local-first session hydration', () => {
  it('opens the cached account before server validation finishes', async () => {
    const cachedUser = user('11111111-1111-4111-8111-111111111111', 'Cached Isaac')
    const namespace = `${instanceUrl}|${cachedUser.id}`
    mocks.values.set('global:activeSessionNamespace', namespace)
    mocks.values.set(`${namespace}:user`, cachedUser)
    const pendingMe = deferred<{ user: User }>()
    mocks.me.mockReturnValue(pendingMe.promise)

    await useSessionStore.getState().hydrate()

    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user: cachedUser })
    expect(mocks.me).toHaveBeenCalledOnce()
  })

  it('migrates a single legacy cached account and never guesses between multiple accounts', async () => {
    const first = user('11111111-1111-4111-8111-111111111111')
    const firstNamespace = `${instanceUrl}|${first.id}`
    mocks.values.set('global:knownNamespaces', [firstNamespace])
    mocks.values.set(`${firstNamespace}:user`, first)
    mocks.me.mockReturnValue(deferred<{ user: User }>().promise)

    await useSessionStore.getState().hydrate()
    expect(useSessionStore.getState().user).toEqual(first)
    expect(mocks.values.get('global:activeSessionNamespace')).toBe(firstNamespace)

    const second = user('22222222-2222-4222-8222-222222222222')
    const secondNamespace = `${instanceUrl}|${second.id}`
    mocks.values.delete('global:activeSessionNamespace')
    mocks.values.set('global:knownNamespaces', [firstNamespace, secondNamespace])
    mocks.values.set(`${secondNamespace}:user`, second)
    useSessionStore.setState({ status: 'hydrating', token: null, user: null })

    void useSessionStore.getState().hydrate()
    await vi.waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2))
    expect(useSessionStore.getState()).toMatchObject({ status: 'hydrating', user: null })
  })

  it('keeps cached identity available when background validation is offline', async () => {
    const cachedUser = user('11111111-1111-4111-8111-111111111111')
    const namespace = `${instanceUrl}|${cachedUser.id}`
    mocks.values.set('global:activeSessionNamespace', namespace)
    mocks.values.set(`${namespace}:user`, cachedUser)
    mocks.me.mockRejectedValue(new TypeError('Network request failed'))

    await useSessionStore.getState().hydrate()
    await vi.waitFor(() => expect(useSessionStore.getState().error).toBe('Offline'))
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user: cachedUser })
  })

  it('uses the server to identify an uncached session and persists its namespace', async () => {
    const serverUser = user('33333333-3333-4333-8333-333333333333', 'Server Isaac')
    mocks.me.mockResolvedValue({ user: serverUser })

    await useSessionStore.getState().hydrate()

    const namespace = `${instanceUrl}|${serverUser.id}`
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user: serverUser })
    expect(mocks.values.get('global:activeSessionNamespace')).toBe(namespace)
    expect(mocks.values.get(`${namespace}:user`)).toEqual(serverUser)
  })

  it('clears the active account pointer when the session expires', async () => {
    mocks.values.set('global:activeSessionNamespace', `${instanceUrl}|user`)
    useSessionStore.setState({ status: 'authenticated', token: 'session-token', user: user('11111111-1111-4111-8111-111111111111') })

    await useSessionStore.getState().handleUnauthorized()

    expect(mocks.values.get('global:activeSessionNamespace')).toBeNull()
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', token: null, user: null })
    expect(mocks.clearShortcuts).toHaveBeenCalled()
    expect(mocks.syncShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ token: null, user: null, status: 'anonymous' }))
  })
})

describe('two-factor login', () => {
  it('returns a challenge result without creating a session', async () => {
    mocks.token = null
    mocks.login.mockRejectedValue(new ApiError(401, 'two_factor_required', 'Enter your code'))

    await expect(useSessionStore.getState().login('member@example.com', 'password')).resolves.toBe('two-factor-required')
    expect(useSessionStore.getState()).toMatchObject({ status: 'hydrating', token: null, user: null })
  })

  it('forwards the factor and persists the resulting native session', async () => {
    mocks.token = null
    const signedIn = user('44444444-4444-4444-8444-444444444444', 'Two Factor User')
    mocks.login.mockResolvedValue({ user: signedIn, session: { token: 'new-session-token', expiresAt: '2026-09-01T00:00:00.000Z' } })

    await expect(useSessionStore.getState().login('member@example.com', 'password', '123456')).resolves.toBe('authenticated')
    expect(mocks.login).toHaveBeenCalledWith('member@example.com', 'password', 'Test iPhone', '123456', { platform: 'ios' })
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: 'new-session-token', user: signedIn })
  })
})

describe('passkey login', () => {
  const ceremony = { ceremonyToken: 'c'.repeat(43), options: { challenge: 'challenge' } }
  const assertion = { id: 'credential' }

  it('uses native ceremonies for a compiled domain and persists the bearer session', async () => {
    const signedIn = user('55555555-5555-4555-8555-555555555555', 'Native Passkey User')
    mocks.canUseNativePasskeys.mockReturnValue(true)
    mocks.passkeyOptions.mockResolvedValue(ceremony)
    mocks.nativeAuthenticate.mockResolvedValue(assertion)
    mocks.verifyPasskey.mockResolvedValue({ user: signedIn, session: { token: 'native-passkey-token', expiresAt: '2026-09-01T00:00:00.000Z' } })

    await useSessionStore.getState().loginWithPasskey()

    expect(mocks.verifyPasskey).toHaveBeenCalledWith(ceremony.ceremonyToken, assertion, 'Test iPhone', { platform: 'ios' })
    expect(mocks.runSafariPasskeyAuthentication).not.toHaveBeenCalled()
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: 'native-passkey-token', user: signedIn })
  })

  it('uses Safari PKCE for custom domains and exchanges the one-time code', async () => {
    const signedIn = user('66666666-6666-4666-8666-666666666666', 'Safari Passkey User')
    mocks.runSafariPasskeyAuthentication.mockResolvedValue({ code: 'authorization-code', codeVerifier: 'code-verifier' })
    mocks.exchangeBrowserPasskey.mockResolvedValue({ user: signedIn, session: { token: 'safari-passkey-token', expiresAt: '2026-09-01T00:00:00.000Z' } })

    await useSessionStore.getState().loginWithPasskey()

    expect(mocks.exchangeBrowserPasskey).toHaveBeenCalledWith('authorization-code', 'code-verifier', 'Test iPhone', { platform: 'ios' })
    expect(mocks.passkeyOptions).not.toHaveBeenCalled()
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: 'safari-passkey-token', user: signedIn })
  })
})


describe('local sign-out after account deletion', () => {
  it('revokes in-memory credentials and continues cache cleanup when secure storage fails', async () => {
    const signedIn = user('deleted-user')
    useSessionStore.setState({ status: 'authenticated', token: 'revoked-token', user: signedIn })
    mocks.deleteToken.mockRejectedValueOnce(new Error('Secure storage unavailable'))
    await expect(useSessionStore.getState().logout(true)).rejects.toThrow('Secure storage unavailable')
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', token: null, user: null })
    expect(mocks.clearShortcuts).toHaveBeenCalled()
    expect(mocks.syncShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ token: null, user: null, status: 'anonymous' }))
    expect(mocks.configureApi).toHaveBeenCalledWith(expect.objectContaining({ token: null }))
    expect(mocks.clearNamespace).toHaveBeenCalledWith(`${instanceUrl}|deleted-user`)
    expect(mocks.values.get('global:activeSessionNamespace')).toBeNull()
  })
})

describe('session transition failures', () => {
  it('restores API credentials when server discovery fails', async () => {
    useSessionStore.setState({ status: 'authenticated', token: 'existing-token', user: user('existing') })
    mocks.config.mockRejectedValueOnce(new TypeError('Network request failed'))
    await expect(useSessionStore.getState().switchInstance('https://unreachable.test')).rejects.toThrow()
    expect(mocks.configureApi).toHaveBeenLastCalledWith(expect.objectContaining({ instanceUrl, token: 'existing-token', onUnauthorized: expect.any(Function) }))
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', instanceUrl, token: 'existing-token' })
    expect(mocks.clearShortcuts).not.toHaveBeenCalled()
  })

  it('ignores approval refresh after signing out', async () => {
    useSessionStore.setState({ status: 'pending', token: 'pending-token', user: { ...user('pending'), role: 'pending' } })
    const pending = deferred<{ user: User }>()
    mocks.me.mockReturnValue(pending.promise)
    const refresh = useSessionStore.getState().refreshSession()
    await useSessionStore.getState().logout(true)
    pending.resolve({ user: user('pending') })
    await refresh
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', user: null, token: null })
  })

  it('clears expired credentials from memory even if secure storage fails', async () => {
    useSessionStore.setState({ status: 'authenticated', token: 'expired', user: user('expired') })
    mocks.deleteToken.mockRejectedValueOnce(new Error('Secure storage unavailable'))
    await useSessionStore.getState().handleUnauthorized().catch(() => undefined)
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', user: null, token: null })
    expect(mocks.clearShortcuts).toHaveBeenCalled()
    expect(mocks.syncShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'anonymous', token: null }))
  })
})


describe('signup and approval', () => {
  it.each(['pending', 'user'] as const)('persists a %s signup and normalizes submitted identity', async (role) => {
    const signedUp = { ...user('signup'), role }
    mocks.signup.mockResolvedValue({ user: signedUp, session: { token: 'signup-token' } })
    await useSessionStore.getState().signup(' New User ', ' NEW_USER ', ' member@pulpo.test ', 'password')
    expect(mocks.signup).toHaveBeenCalledWith('New User', 'new_user', 'member@pulpo.test', 'password', 'Test iPhone', { platform: 'ios' })
    expect(useSessionStore.getState()).toMatchObject({ status: role === 'pending' ? 'pending' : 'authenticated', token: 'signup-token', user: signedUp })
    expect(mocks.token).toBe('signup-token')
  })

  it('refreshes approval without replacing the native session token', async () => {
    const pending = { ...user('signup'), role: 'pending' as const }
    useSessionStore.setState({ status: 'pending', user: pending, token: 'signup-token' })
    mocks.me.mockResolvedValue({ user: { ...pending, role: 'user' } })
    await useSessionStore.getState().refreshSession()
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: 'signup-token', user: { role: 'user' } })
  })
})

describe('multiple signed-in accounts', () => {
  const personal = user('11111111-1111-4111-8111-111111111111', 'Personal Isaac')
  const work = user('22222222-2222-4222-8222-222222222222', 'Work Isaac')
  const tokenKey = (account: User) => `pulpo.native.session.${account.id}`
  const namespace = (account: User) => `${instanceUrl}|${account.id}`

  // Signs in every account; the first is active and the rest are parked.
  function signedIn(...accounts: User[]) {
    for (const account of accounts) mocks.values.set(`${namespace(account)}:user`, account)
    mocks.values.set('global:signedInAccounts', { instanceUrl, userIds: accounts.map((account) => account.id) })
    mocks.values.set('global:activeSessionNamespace', namespace(accounts[0]!))
    for (const account of accounts.slice(1)) mocks.secure.set(tokenKey(account), `token-${account.id}`)
    mocks.token = `token-${accounts[0]!.id}`
    useSessionStore.setState({ status: 'authenticated', token: mocks.token, user: accounts[0]!, accounts })
    mocks.meWithToken.mockImplementation(async (token: string) => {
      const account = accounts.find((candidate) => token === `token-${candidate.id}`)
      if (!account) throw new ApiError(401, 'unauthorized', 'Unauthorized')
      return { user: account }
    })
  }

  it('parks the active session without revoking it or clearing its cache when adding an account', async () => {
    signedIn(personal)

    await useSessionStore.getState().addAccount()

    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', token: null, user: null, accounts: [personal] })
    expect(mocks.secure.get(tokenKey(personal))).toBe(`token-${personal.id}`)
    expect(mocks.token).toBeNull()
    expect(mocks.values.get('global:activeSessionNamespace')).toBeNull()
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.clearNamespace).not.toHaveBeenCalled()
    expect(mocks.configureApi).toHaveBeenLastCalledWith(expect.objectContaining({ token: null }))

    mocks.login.mockResolvedValue({ user: work, session: { token: 'token-work' } })
    await useSessionStore.getState().login('work@pulpo.test', 'password')
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: 'token-work', user: work, accounts: [personal, work] })
    expect(mocks.values.get('global:signedInAccounts')).toEqual({ instanceUrl, userIds: [personal.id, work.id] })
  })

  it('refuses to add more than the maximum number of accounts', async () => {
    const accounts = [1, 2, 3, 4, 5].map((index) => user(`${index}${index}${index}${index}${index}${index}${index}${index}-0000-4000-8000-000000000000`))
    signedIn(...accounts)
    await expect(useSessionStore.getState().addAccount()).rejects.toThrow('up to 5 accounts')
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user: accounts[0] })
  })

  it('replaces an already signed-in account instead of duplicating it', async () => {
    signedIn(personal)
    await useSessionStore.getState().addAccount()
    mocks.login.mockResolvedValue({ user: personal, session: { token: 'token-personal-again' } })

    await useSessionStore.getState().login('personal@pulpo.test', 'password')

    expect(mocks.logoutWithToken).toHaveBeenCalledWith(`token-${personal.id}`)
    expect(mocks.secure.has(tokenKey(personal))).toBe(false)
    expect(mocks.values.get('global:signedInAccounts')).toEqual({ instanceUrl, userIds: [personal.id] })
    expect(useSessionStore.getState()).toMatchObject({ token: 'token-personal-again', user: personal, accounts: [personal] })
  })

  it('switches accounts through a signed-out teardown and keeps both sessions', async () => {
    signedIn(personal, work)
    const transitions: Array<{ status: string; token: string | null }> = []
    const unsubscribe = useSessionStore.subscribe(({ status, token }) => transitions.push({ status, token }))

    await useSessionStore.getState().switchAccount(work.id)
    unsubscribe()

    expect(transitions[0]).toEqual({ status: 'hydrating', token: null })
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: `token-${work.id}`, user: work })
    expect(mocks.token).toBe(`token-${work.id}`)
    expect(mocks.secure.get(tokenKey(personal))).toBe(`token-${personal.id}`)
    expect(mocks.secure.has(tokenKey(work))).toBe(false)
    expect(mocks.values.get('global:activeSessionNamespace')).toBe(namespace(work))
    expect(mocks.meWithToken).toHaveBeenCalledWith(`token-${work.id}`)
    expect(mocks.configureApi).toHaveBeenLastCalledWith(expect.objectContaining({ token: `token-${work.id}` }))
    expect(mocks.clearShortcuts).toHaveBeenCalled()
    expect(mocks.syncShortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ token: `token-${work.id}`, user: work }))
    expect(mocks.clearNamespace).not.toHaveBeenCalled()
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('drops a revoked account when switching to it and returns to the previous account', async () => {
    signedIn(personal, work)
    mocks.secure.set(tokenKey(work), 'revoked-token')

    await expect(useSessionStore.getState().switchAccount(work.id)).rejects.toThrow('Work Isaac was signed out')

    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: `token-${personal.id}`, user: personal, accounts: [personal] })
    expect(mocks.values.get('global:signedInAccounts')).toEqual({ instanceUrl, userIds: [personal.id] })
    expect(mocks.secure.size).toBe(0)
  })

  it('signs out only the active account and falls back to another signed-in account', async () => {
    signedIn(personal, work)

    await useSessionStore.getState().logout()

    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.clearNamespace).toHaveBeenCalledExactlyOnceWith(namespace(personal))
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: `token-${work.id}`, user: work, accounts: [work] })
    expect(mocks.values.get('global:signedInAccounts')).toEqual({ instanceUrl, userIds: [work.id] })
  })

  it('signs out an inactive account with its own token', async () => {
    signedIn(personal, work)

    await useSessionStore.getState().signOutAccount(work.id)

    expect(mocks.logoutWithToken).toHaveBeenCalledWith(`token-${work.id}`)
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.clearNamespace).toHaveBeenCalledExactlyOnceWith(namespace(work))
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user: personal, token: `token-${personal.id}` })
    expect(mocks.secure.has(tokenKey(work))).toBe(false)
  })

  it('signs out of every account', async () => {
    signedIn(personal, work)

    await useSessionStore.getState().logoutAll()

    expect(mocks.logoutWithToken).toHaveBeenCalledWith(`token-${work.id}`)
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.clearNamespace).toHaveBeenCalledWith(namespace(personal))
    expect(mocks.clearNamespace).toHaveBeenCalledWith(namespace(work))
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', token: null, user: null, accounts: [] })
    expect(mocks.values.get('global:signedInAccounts')).toBeNull()
    expect(mocks.token).toBeNull()
    expect(mocks.secure.size).toBe(0)
  })

  it('falls back to another validated account when the active session expires', async () => {
    signedIn(personal, work)

    await useSessionStore.getState().handleUnauthorized()

    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: `token-${work.id}`, user: work, error: null })
    expect(mocks.meWithToken).toHaveBeenCalledWith(`token-${work.id}`)
    expect(mocks.alert).toHaveBeenCalledWith('Session expired', expect.stringContaining('Personal Isaac'))
    expect(mocks.values.get('global:signedInAccounts')).toEqual({ instanceUrl, userIds: [work.id] })
    expect(mocks.clearNamespace).not.toHaveBeenCalled()
  })

  it('shows sign-in when every fallback account was revoked', async () => {
    signedIn(personal, work)
    mocks.meWithToken.mockRejectedValue(new ApiError(401, 'unauthorized', 'Unauthorized'))

    await useSessionStore.getState().handleUnauthorized()

    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', token: null, user: null, accounts: [], error: 'Your session expired. Sign in again.' })
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('ignores unauthorized responses while no account is active', async () => {
    signedIn(personal, work)
    await useSessionStore.getState().addAccount()
    await useSessionStore.getState().handleUnauthorized()
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', accounts: [personal, work], error: null })
  })

  it('signs out every account when switching instances', async () => {
    signedIn(personal, work)
    mocks.config.mockResolvedValue({ instance: { name: 'Other' } })

    await useSessionStore.getState().switchInstance('https://other.test')

    expect(mocks.logoutWithToken).toHaveBeenCalledWith(`token-${work.id}`)
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.clearNamespace).toHaveBeenCalledWith(namespace(personal))
    expect(mocks.clearNamespace).toHaveBeenCalledWith(namespace(work))
    expect(useSessionStore.getState()).toMatchObject({ instanceUrl: 'https://other.test', status: 'anonymous', accounts: [] })
    expect(mocks.values.get('global:signedInAccounts')).toBeNull()
    expect(mocks.secure.size).toBe(0)
  })

  it('offers parked accounts on the sign-in screen after a restart', async () => {
    signedIn(personal)
    await useSessionStore.getState().addAccount()
    useSessionStore.setState({ status: 'hydrating', accounts: [] })

    await useSessionStore.getState().hydrate()

    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', token: null, accounts: [personal] })
  })
})
