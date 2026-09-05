import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  token: 'session-token' as string | null,
  config: vi.fn(),
  me: vi.fn(),
  login: vi.fn(),
  passkeyOptions: vi.fn(),
  verifyPasskey: vi.fn(),
  exchangeBrowserPasskey: vi.fn(),
  canUseNativePasskeys: vi.fn(() => false),
  nativeAuthenticate: vi.fn(),
  runSafariPasskeyAuthentication: vi.fn(),
  configureApi: vi.fn(),
  clearNamespace: vi.fn(async () => []),
  deleteToken: vi.fn(async () => undefined),
}))

vi.mock('react-native', () => ({ Appearance: { setColorScheme: vi.fn() } }))
vi.mock('expo-device', () => ({ deviceName: 'Test iPhone', modelName: 'iPhone' }))
vi.mock('expo-file-system', () => ({ File: class { exists = false; delete() {} } }))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: vi.fn(async () => mocks.token),
  setItemAsync: vi.fn(async (_key: string, value: string) => { mocks.token = value }),
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
      signup: vi.fn(),
      logout: vi.fn(async () => undefined),
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
  mocks.passkeyOptions.mockReset()
  mocks.verifyPasskey.mockReset()
  mocks.exchangeBrowserPasskey.mockReset()
  mocks.canUseNativePasskeys.mockReset().mockReturnValue(false)
  mocks.nativeAuthenticate.mockReset()
  mocks.runSafariPasskeyAuthentication.mockReset()
  mocks.configureApi.mockReset()
  mocks.deleteToken.mockReset().mockResolvedValue(undefined)
  mocks.clearNamespace.mockReset().mockResolvedValue([])
  useSessionStore.setState({
    status: 'hydrating', instanceUrl, token: null, user: null, config: null, error: null,
  })
  mocks.values.set('global:instanceUrl', instanceUrl)
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
    expect(mocks.login).toHaveBeenCalledWith('member@example.com', 'password', 'Test iPhone', '123456')
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

    expect(mocks.verifyPasskey).toHaveBeenCalledWith(ceremony.ceremonyToken, assertion, 'Test iPhone')
    expect(mocks.runSafariPasskeyAuthentication).not.toHaveBeenCalled()
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', token: 'native-passkey-token', user: signedIn })
  })

  it('uses Safari PKCE for custom domains and exchanges the one-time code', async () => {
    const signedIn = user('66666666-6666-4666-8666-666666666666', 'Safari Passkey User')
    mocks.runSafariPasskeyAuthentication.mockResolvedValue({ code: 'authorization-code', codeVerifier: 'code-verifier' })
    mocks.exchangeBrowserPasskey.mockResolvedValue({ user: signedIn, session: { token: 'safari-passkey-token', expiresAt: '2026-09-01T00:00:00.000Z' } })

    await useSessionStore.getState().loginWithPasskey()

    expect(mocks.exchangeBrowserPasskey).toHaveBeenCalledWith('authorization-code', 'code-verifier', 'Test iPhone')
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
    expect(mocks.configureApi).toHaveBeenCalledWith(expect.objectContaining({ token: null }))
    expect(mocks.clearNamespace).toHaveBeenCalledWith(`${instanceUrl}|deleted-user`)
    expect(mocks.values.get('global:activeSessionNamespace')).toBeNull()
  })
})
