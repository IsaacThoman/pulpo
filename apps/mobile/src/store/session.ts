import { clearMobileComposerSync } from '../features/chat/composerSync'
import { Appearance } from 'react-native'
import * as Device from 'expo-device'
import { File } from 'expo-file-system'
import { clearComposerDraftCacheNamespace } from '../features/chat/composerDraftCache'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { normalizeInstanceUrl } from '@pulpo/client-core'
import type { MobileConfig, User } from '@pulpo/contracts'
import { ApiError, apiOrigin, configureApi, isNetworkError, mobileApi } from '../api/client'
import {
  canUseNativePasskeys,
  NativePasskeyError,
  nativeAuthenticate,
  PasskeyCancelledError,
  runSafariPasskeyAuthentication,
} from '../auth/passkeys'
import { cacheNamespace, clearNamespace, getValue, setValue } from '../data/database'

const SESSION_TOKEN_KEY = 'pulpo.native.session'
const GLOBAL_NAMESPACE = 'global'
const ACTIVE_SESSION_NAMESPACE_KEY = 'activeSessionNamespace'
const DEFAULT_INSTANCE = process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? 'https://pulpo.baby'

type SessionStatus = 'hydrating' | 'anonymous' | 'authenticated' | 'pending'

interface SessionState {
  status: SessionStatus
  instanceUrl: string
  token: string | null
  user: User | null
  config: MobileConfig | null
  error: string | null
  hydrate: () => Promise<void>
  discover: (url?: string) => Promise<MobileConfig>
  login: (email: string, password: string, twoFactorCode?: string) => Promise<'authenticated' | 'two-factor-required'>
  loginWithPasskey: (forceBrowser?: boolean) => Promise<void>
  signup: (name: string, username: string, email: string, password: string) => Promise<void>
  logout: (localOnly?: boolean) => Promise<void>
  refreshSession: () => Promise<void>
  switchInstance: (url: string) => Promise<MobileConfig>
  setUser: (user: User) => Promise<void>
  handleUnauthorized: () => Promise<void>
}

function allowLocalhost(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__
}

async function deviceLabel(): Promise<string> {
  return Device.deviceName ?? Device.modelName ?? 'Pulpo for iPhone'
}

async function rememberActiveNamespace(namespace: string): Promise<void> {
  const known = new Set(await getValue<string[]>(GLOBAL_NAMESPACE, 'knownNamespaces') ?? [])
  known.add(namespace)
  await Promise.all([
    setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, namespace),
    setValue(GLOBAL_NAMESPACE, 'knownNamespaces', [...known]),
  ])
}

async function persistAccount(instanceUrl: string, user: User): Promise<void> {
  const namespace = cacheNamespace(instanceUrl, user.id)
  await Promise.all([
    setValue(GLOBAL_NAMESPACE, 'instanceUrl', instanceUrl),
    setValue(namespace, 'user', user),
    rememberActiveNamespace(namespace),
  ])
}

async function persistSession(instanceUrl: string, user: User, token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  await persistAccount(instanceUrl, user)
}

async function cachedAccount(instanceUrl: string): Promise<{ namespace: string; user: User } | null> {
  const expectedOrigin = new URL(instanceUrl).origin
  const preferredNamespace = await getValue<string>(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY)
  if (preferredNamespace?.startsWith(`${expectedOrigin}|`)) {
    const user = await getValue<User>(preferredNamespace, 'user')
    if (user && cacheNamespace(instanceUrl, user.id) === preferredNamespace) {
      return { namespace: preferredNamespace, user }
    }
  }

  const namespaces = await getValue<string[]>(GLOBAL_NAMESPACE, 'knownNamespaces') ?? []
  const candidates = (await Promise.all(namespaces
    .filter((namespace) => namespace.startsWith(`${expectedOrigin}|`))
    .map(async (namespace) => ({ namespace, user: await getValue<User>(namespace, 'user') }))))
    .filter((candidate): candidate is { namespace: string; user: User } => Boolean(
      candidate.user && cacheNamespace(instanceUrl, candidate.user.id) === candidate.namespace,
    ))
  return candidates.length === 1 ? candidates[0]! : null
}

function removeCachedFiles(uris: string[]): void {
  for (const uri of uris) {
    try {
      const file = new File(uri)
      if (file.exists) file.delete()
    } catch {
      // A cache file can already have been evicted by iOS.
    }
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'hydrating',
  instanceUrl: DEFAULT_INSTANCE,
  token: null,
  user: null,
  config: null,
  error: null,

  hydrate: async () => {
    try {
      const [storedInstance, token] = await Promise.all([
        getValue<string>(GLOBAL_NAMESPACE, 'instanceUrl'),
        SecureStore.getItemAsync(SESSION_TOKEN_KEY),
      ])
      const instanceUrl = normalizeInstanceUrl(storedInstance ?? DEFAULT_INSTANCE, allowLocalhost())
      configureApi({ instanceUrl, token, onUnauthorized: () => { void get().handleUnauthorized() } })
      set({ instanceUrl, token, status: token ? 'hydrating' : 'anonymous' })
      if (!token) {
        void mobileApi.config()
          .then((config) => {
            if (get().instanceUrl === instanceUrl && !get().token) set({ config, error: null })
          })
          .catch((error) => {
            if (get().instanceUrl === instanceUrl && !get().token) {
              set({ error: error instanceof Error ? error.message : 'Could not connect' })
            }
          })
        return
      }

      const cached = await cachedAccount(instanceUrl)
      if (cached) {
        set({
          user: cached.user,
          status: cached.user.role === 'pending' ? 'pending' : 'authenticated',
          error: null,
        })
        void rememberActiveNamespace(cached.namespace)
      }

      const refreshFromServer = async () => {
        const [configResult, userResult] = await Promise.allSettled([mobileApi.config(), mobileApi.me()])
        if (get().token !== token || get().instanceUrl !== instanceUrl) return
        if (configResult.status === 'fulfilled') set({ config: configResult.value })
        if (userResult.status === 'fulfilled') {
          const user = userResult.value.user
          await persistAccount(instanceUrl, user)
          if (get().token !== token || get().instanceUrl !== instanceUrl) return
          set({ user, status: user.role === 'pending' ? 'pending' : 'authenticated', error: null })
          return
        }
        const error = userResult.reason
        if (error instanceof ApiError && error.status === 401) return
        if (cached) {
          set({ error: isNetworkError(error) ? 'Offline' : error instanceof Error ? error.message : 'Could not refresh session' })
          return
        }
        set({ status: 'anonymous', error: error instanceof Error ? error.message : 'Could not connect' })
      }

      if (cached) void refreshFromServer()
      else await refreshFromServer()
    } catch {
      const instanceUrl = normalizeInstanceUrl(DEFAULT_INSTANCE, allowLocalhost())
      configureApi({ instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
      set({ instanceUrl, token: null, user: null, config: null, status: 'anonymous', error: 'Could not securely load session data.' })
    }
  },

  discover: async (url) => {
    const instanceUrl = normalizeInstanceUrl(url ?? get().instanceUrl, allowLocalhost())
    configureApi({ instanceUrl, token: get().token, onUnauthorized: () => { void get().handleUnauthorized() } })
    const config = await mobileApi.config()
    set({ instanceUrl, config, error: null })
    return config
  },

  login: async (email, password, twoFactorCode) => {
    configureApi({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    let result
    try {
      result = await mobileApi.login(email.trim(), password, await deviceLabel(), twoFactorCode)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'two_factor_required') return 'two-factor-required'
      throw error
    }
    await persistSession(get().instanceUrl, result.user, result.session.token)
    configureApi({ instanceUrl: get().instanceUrl, token: result.session.token, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: result.session.token, user: result.user, status: result.user.role === 'pending' ? 'pending' : 'authenticated', error: null })
    return 'authenticated'
  },

  loginWithPasskey: async (forceBrowser = false) => {
    const instanceUrl = get().instanceUrl
    configureApi({ instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    let result
    if (!forceBrowser && canUseNativePasskeys(instanceUrl)) {
      const ceremony = await mobileApi.passkeyOptions()
      let response
      try {
        response = await nativeAuthenticate(ceremony)
      } catch (error) {
        if (error instanceof PasskeyCancelledError) throw error
        throw new NativePasskeyError(error)
      }
      result = await mobileApi.verifyPasskey(ceremony.ceremonyToken, response, await deviceLabel())
    } else {
      const { code, codeVerifier } = await runSafariPasskeyAuthentication(instanceUrl)
      result = await mobileApi.exchangeBrowserPasskey(code, codeVerifier, await deviceLabel())
    }
    await persistSession(instanceUrl, result.user, result.session.token)
    configureApi({ instanceUrl, token: result.session.token, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: result.session.token, user: result.user, status: result.user.role === 'pending' ? 'pending' : 'authenticated', error: null })
  },

  signup: async (name, username, email, password) => {
    configureApi({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    const result = await mobileApi.signup(name.trim(), username.trim().toLowerCase(), email.trim(), password, await deviceLabel())
    await persistSession(get().instanceUrl, result.user, result.session.token)
    configureApi({ instanceUrl: get().instanceUrl, token: result.session.token, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: result.session.token, user: result.user, status: result.user.role === 'pending' ? 'pending' : 'authenticated', error: null })
  },

  logout: async (localOnly = false) => {
    const { user, instanceUrl, token } = get()
    if (token && !localOnly) await mobileApi.logout().catch(() => undefined)
    // Revoked sessions must disappear from memory even if local storage fails.
    configureApi({ instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: null, user: null, status: 'anonymous', error: null })
    const cleanup = await Promise.allSettled([
      SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
      setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
      (async () => {
        if (!user) return
        const namespace = cacheNamespace(instanceUrl, user.id)
        clearComposerDraftCacheNamespace(namespace)
        clearMobileComposerSync(namespace)
        removeCachedFiles(await clearNamespace(namespace))
      })(),
    ])
    const failure = cleanup.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason

  },

  refreshSession: async () => {
    const { user } = await mobileApi.me()
    await get().setUser(user)
    set({ status: user.role === 'pending' ? 'pending' : 'authenticated', error: null })
  },

  switchInstance: async (value) => {
    const previous = get()
    const instanceUrl = normalizeInstanceUrl(value, allowLocalhost())
    configureApi({ instanceUrl, token: null })
    const config = await mobileApi.config()
    if (previous.token) {
      configureApi({ instanceUrl: previous.instanceUrl, token: previous.token })
      await mobileApi.logout().catch(() => undefined)
    }
    await Promise.all([
      SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
      setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
    ])
    if (previous.user) {
      const namespace = cacheNamespace(previous.instanceUrl, previous.user.id)
      clearComposerDraftCacheNamespace(namespace)
      clearMobileComposerSync(namespace)
      removeCachedFiles(await clearNamespace(namespace))
    }
    await setValue(GLOBAL_NAMESPACE, 'instanceUrl', instanceUrl)
    configureApi({ instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ instanceUrl, config, token: null, user: null, status: 'anonymous', error: null })
    return config
  },

  setUser: async (user) => {
    await persistAccount(get().instanceUrl, user)
    set({ user, status: user.role === 'pending' ? 'pending' : 'authenticated' })
  },

  handleUnauthorized: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
      setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
    ])
    configureApi({ instanceUrl: apiOrigin(), token: null })
    set({ token: null, user: null, status: 'anonymous', error: 'Your session expired. Sign in again.' })
    Appearance.setColorScheme('unspecified')
  },
}))
