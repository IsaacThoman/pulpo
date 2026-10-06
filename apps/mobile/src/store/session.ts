import { clearShortcutsSession, syncShortcutsSession } from '../shortcuts/native'
import { clearMobileShelf } from '../features/chat/shelf-registry'
import { clearMobileComposerSync } from '../features/chat/composerSync'
import { Alert, Appearance, Platform } from 'react-native'
import * as Device from 'expo-device'
import { File } from 'expo-file-system'
import { clearComposerDraftCacheNamespace } from '../features/chat/composerDraftCache'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { normalizeInstanceUrl } from '@pulpo/client-core'
import { MAX_SIGNED_IN_ACCOUNTS, type MobileConfig, type User } from '@pulpo/contracts'
import { ApiError, configureApi, isNetworkError, mobileApi } from '../api/client'
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
const SIGNED_IN_ACCOUNTS_KEY = 'signedInAccounts'
const TOKEN_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
const DEFAULT_INSTANCE = process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? 'https://pulpo.baby'

type SessionStatus = 'hydrating' | 'anonymous' | 'authenticated' | 'pending'

interface SessionState {
  status: SessionStatus
  instanceUrl: string
  token: string | null
  user: User | null
  /** Every signed-in account on this instance (active and inactive), from each namespace's cached profile. */
  accounts: User[]
  config: MobileConfig | null
  error: string | null
  hydrate: () => Promise<void>
  discover: (url?: string) => Promise<MobileConfig>
  login: (email: string, password: string, twoFactorCode?: string) => Promise<'authenticated' | 'two-factor-required'>
  loginWithPasskey: (forceBrowser?: boolean) => Promise<void>
  signup: (name: string, username: string, email: string, password: string) => Promise<void>
  logout: (localOnly?: boolean) => Promise<void>
  /** Keeps the active account signed in and opens sign-in for another one. */
  addAccount: () => Promise<void>
  switchAccount: (userId: string) => Promise<void>
  signOutAccount: (userId: string) => Promise<void>
  logoutAll: () => Promise<void>
  refreshSession: () => Promise<void>
  switchInstance: (url: string) => Promise<MobileConfig>
  setUser: (user: User) => Promise<void>
  handleUnauthorized: () => Promise<void>
}

function allowLocalhost(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__
}

async function deviceLabel(): Promise<string> {
  return Device.deviceName ?? Device.modelName ?? 'Pulpo Mobile'
}

// Inactive accounts keep their bearer tokens in their own Keychain items.
function accountTokenKey(userId: string): string {
  return `${SESSION_TOKEN_KEY}.${userId.replace(/[^\w.-]/g, '_')}`
}

async function signedInUserIds(instanceUrl: string): Promise<string[]> {
  const index = await getValue<{ instanceUrl: string; userIds: string[] }>(GLOBAL_NAMESPACE, SIGNED_IN_ACCOUNTS_KEY)
  return index?.instanceUrl === instanceUrl ? index.userIds : []
}

async function writeSignedInUserIds(instanceUrl: string, userIds: string[]): Promise<void> {
  await setValue(GLOBAL_NAMESPACE, SIGNED_IN_ACCOUNTS_KEY, userIds.length ? { instanceUrl, userIds } : null)
}

async function rememberSignedInAccount(instanceUrl: string, userId: string): Promise<void> {
  const userIds = await signedInUserIds(instanceUrl)
  if (!userIds.includes(userId)) await writeSignedInUserIds(instanceUrl, [...userIds, userId])
}

async function forgetSignedInAccount(instanceUrl: string, userId: string): Promise<void> {
  await writeSignedInUserIds(instanceUrl, (await signedInUserIds(instanceUrl)).filter((id) => id !== userId))
}

async function loadAccounts(instanceUrl: string): Promise<User[]> {
  const users = await Promise.all((await signedInUserIds(instanceUrl))
    .map((userId) => getValue<User>(cacheNamespace(instanceUrl, userId), 'user')))
  return users.filter((user): user is User => user !== null)
}

async function clearAccountData(instanceUrl: string, userId: string): Promise<void> {
  const namespace = cacheNamespace(instanceUrl, userId)
  clearComposerDraftCacheNamespace(namespace)
  clearMobileShelf(namespace)
  clearMobileComposerSync(namespace)
  removeCachedFiles(await clearNamespace(namespace))
}

function sessionStatus(user: User): 'authenticated' | 'pending' {
  return user.role === 'pending' ? 'pending' : 'authenticated'
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
    rememberSignedInAccount(instanceUrl, user.id),
  ])
}

async function persistSession(instanceUrl: string, user: User, token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, TOKEN_OPTIONS)
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

export const useSessionStore = create<SessionState>((set, get) => {
  const onUnauthorized = () => { void get().handleUnauthorized() }

  const completeSignIn = async (instanceUrl: string, user: User, token: string) => {
    const userIds = await signedInUserIds(instanceUrl)
    if (userIds.includes(user.id)) {
      // Signing in to an account that is already signed in replaces its older session.
      const stale = await SecureStore.getItemAsync(accountTokenKey(user.id))
      if (stale && stale !== token) await mobileApi.logoutWithToken(stale).catch(() => undefined)
      await SecureStore.deleteItemAsync(accountTokenKey(user.id))
    } else if (userIds.length >= MAX_SIGNED_IN_ACCOUNTS) {
      await mobileApi.logoutWithToken(token).catch(() => undefined)
      throw new Error(`You can be signed in to up to ${MAX_SIGNED_IN_ACCOUNTS} accounts. Sign out of one first.`)
    }
    await persistSession(instanceUrl, user, token)
    configureApi({ instanceUrl, token, onUnauthorized })
    set({ token, user, status: sessionStatus(user), error: null, accounts: await loadAccounts(instanceUrl) })
  }

  // Makes a signed-in inactive account active. The current account, if any,
  // stays signed in. Throws (with the active slot empty) if the account's
  // session was revoked; callers choose the fallback account.
  const activate = async (userId: string) => {
    const { instanceUrl, token: previousToken, user: previousUser } = get()
    const token = await SecureStore.getItemAsync(accountTokenKey(userId))
    const namespace = cacheNamespace(instanceUrl, userId)
    const cached = await getValue<User>(namespace, 'user')
    if (!token) {
      await forgetSignedInAccount(instanceUrl, userId)
      set({ accounts: await loadAccounts(instanceUrl) })
      throw new Error(`${cached?.name ?? 'That account'} is no longer signed in. Sign in to it again.`)
    }
    if (previousToken && previousUser) await SecureStore.setItemAsync(accountTokenKey(previousUser.id), previousToken, TOKEN_OPTIONS)
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, TOKEN_OPTIONS)
    await SecureStore.deleteItemAsync(accountTokenKey(userId))
    // Unmount the previous account's screens, socket, and queries (as a sign-out
    // would) before any request can carry the next account's token.
    clearShortcutsSession()
    configureApi({ instanceUrl, token: null, onUnauthorized })
    set({ token: null, user: null, status: 'hydrating', error: null })
    await new Promise((resolve) => setTimeout(resolve, 0))
    configureApi({ instanceUrl, token, onUnauthorized })
    set({ token, user: cached, status: cached ? sessionStatus(cached) : 'hydrating' })
    await rememberActiveNamespace(namespace)

    let user: User
    try {
      ({ user } = await mobileApi.meWithToken(token))
    } catch (error) {
      if (get().token !== token) return
      if (error instanceof ApiError && error.status === 401) {
        configureApi({ instanceUrl, token: null, onUnauthorized })
        set({ token: null, user: null, status: 'hydrating' })
        await Promise.allSettled([
          SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
          setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
          forgetSignedInAccount(instanceUrl, userId),
        ])
        throw new Error(`${cached?.name ?? 'That account'} was signed out. Sign in to it again.`, { cause: error })
      }
      const message = isNetworkError(error) ? 'Offline' : error instanceof Error ? error.message : 'Could not refresh session'
      set(cached ? { error: message } : { status: 'anonymous', error: message })
      return
    }
    if (get().token !== token) return
    await persistAccount(instanceUrl, user)
    if (get().token !== token) return
    set({ user, status: sessionStatus(user), error: null, accounts: await loadAccounts(instanceUrl) })
  }

  // After the active account is gone, open another signed-in account
  // (preferring `preferred`) or fall back to the sign-in screen.
  const activateRemaining = async (preferred?: string) => {
    const { instanceUrl } = get()
    const userIds = await signedInUserIds(instanceUrl).catch((): string[] => [])
    for (const userId of preferred && userIds.includes(preferred) ? [preferred, ...userIds.filter((id) => id !== preferred)] : userIds) {
      try {
        await activate(userId)
        return true
      } catch {
        // A revoked account was dropped; try the next one.
      }
    }
    configureApi({ instanceUrl, token: null, onUnauthorized })
    set({ token: null, user: null, status: 'anonymous', accounts: await loadAccounts(instanceUrl).catch(() => []) })
    return false
  }

  return {
    status: 'hydrating',
    instanceUrl: DEFAULT_INSTANCE,
    token: null,
    user: null,
    accounts: [],
    config: null,
    error: null,

    hydrate: async () => {
      try {
        const [storedInstance, token] = await Promise.all([
          getValue<string>(GLOBAL_NAMESPACE, 'instanceUrl'),
          SecureStore.getItemAsync(SESSION_TOKEN_KEY),
        ])
        const instanceUrl = normalizeInstanceUrl(storedInstance ?? DEFAULT_INSTANCE, allowLocalhost())
        configureApi({ instanceUrl, token, onUnauthorized })
        set({ instanceUrl, token, status: token ? 'hydrating' : 'anonymous', accounts: await loadAccounts(instanceUrl).catch(() => []) })
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
            status: sessionStatus(cached.user),
            error: null,
          })
          void rememberActiveNamespace(cached.namespace)
          void rememberSignedInAccount(instanceUrl, cached.user.id)
        }

        const refreshFromServer = async () => {
          const [configResult, userResult] = await Promise.allSettled([mobileApi.config(), mobileApi.me()])
          if (get().token !== token || get().instanceUrl !== instanceUrl) return
          if (configResult.status === 'fulfilled') set({ config: configResult.value })
          if (userResult.status === 'fulfilled') {
            const user = userResult.value.user
            await persistAccount(instanceUrl, user)
            if (get().token !== token || get().instanceUrl !== instanceUrl) return
            set({ user, status: sessionStatus(user), error: null, accounts: await loadAccounts(instanceUrl) })
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
        configureApi({ instanceUrl, token: null, onUnauthorized })
        set({ instanceUrl, token: null, user: null, accounts: [], config: null, status: 'anonymous', error: 'Could not securely load session data.' })
      }
    },

    discover: async (url) => {
      const instanceUrl = normalizeInstanceUrl(url ?? get().instanceUrl, allowLocalhost())
      configureApi({ instanceUrl, token: get().token, onUnauthorized })
      const config = await mobileApi.config()
      set({ instanceUrl, config, error: null })
      return config
    },

    login: async (email, password, twoFactorCode) => {
      configureApi({ instanceUrl: get().instanceUrl, token: null, onUnauthorized })
      let result
      try {
        result = await mobileApi.login(email.trim(), password, await deviceLabel(), twoFactorCode, deviceMetadata())
      } catch (error) {
        if (error instanceof ApiError && error.code === 'two_factor_required') return 'two-factor-required'
        throw error
      }
      await completeSignIn(get().instanceUrl, result.user, result.session.token)
      return 'authenticated'
    },

    loginWithPasskey: async (forceBrowser = false) => {
      const instanceUrl = get().instanceUrl
      configureApi({ instanceUrl, token: null, onUnauthorized })
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
        result = await mobileApi.verifyPasskey(ceremony.ceremonyToken, response, await deviceLabel(), deviceMetadata())
      } else {
        const { code, codeVerifier } = await runSafariPasskeyAuthentication(instanceUrl)
        result = await mobileApi.exchangeBrowserPasskey(code, codeVerifier, await deviceLabel(), deviceMetadata())
      }
      await completeSignIn(instanceUrl, result.user, result.session.token)
    },

    signup: async (name, username, email, password) => {
      configureApi({ instanceUrl: get().instanceUrl, token: null, onUnauthorized })
      const result = await mobileApi.signup(name.trim(), username.trim().toLowerCase(), email.trim(), password, await deviceLabel(), deviceMetadata())
      await completeSignIn(get().instanceUrl, result.user, result.session.token)
    },

    logout: async (localOnly = false) => {
      const { user, instanceUrl, token } = get()
      clearShortcutsSession()
      if (token && !localOnly) await mobileApi.logout().catch(() => undefined)
      const otherAccounts = (await signedInUserIds(instanceUrl).catch(() => [])).filter((id) => id !== user?.id)
      // Revoked sessions must disappear from memory even if local storage fails.
      configureApi({ instanceUrl, token: null, onUnauthorized })
      set({ token: null, user: null, status: otherAccounts.length ? 'hydrating' : 'anonymous', error: null })
      const cleanup = await Promise.allSettled([
        SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
        setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
        (async () => {
          if (!user) return
          await forgetSignedInAccount(instanceUrl, user.id)
          await clearAccountData(instanceUrl, user.id)
        })(),
      ])
      set({ accounts: await loadAccounts(instanceUrl).catch(() => []) })
      if (otherAccounts.length) await activateRemaining()
      const failure = cleanup.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    },

    addAccount: async () => {
      const { instanceUrl, token, user } = get()
      if (!token || !user) return
      if ((await signedInUserIds(instanceUrl)).length >= MAX_SIGNED_IN_ACCOUNTS) {
        throw new Error(`You can be signed in to up to ${MAX_SIGNED_IN_ACCOUNTS} accounts.`)
      }
      // Park the session without revoking it or clearing its cached data.
      await SecureStore.setItemAsync(accountTokenKey(user.id), token, TOKEN_OPTIONS)
      await rememberSignedInAccount(instanceUrl, user.id)
      clearShortcutsSession()
      configureApi({ instanceUrl, token: null, onUnauthorized })
      set({ token: null, user: null, status: 'anonymous', error: null, accounts: await loadAccounts(instanceUrl) })
      await Promise.all([
        SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
        setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
      ])
    },

    switchAccount: async (userId) => {
      const previous = get().user
      if (previous?.id === userId) return
      try {
        await activate(userId)
      } catch (error) {
        if (!get().token) await activateRemaining(previous?.id)
        throw error
      }
    },

    signOutAccount: async (userId) => {
      if (get().user?.id === userId) return get().logout()
      const { instanceUrl } = get()
      const token = await SecureStore.getItemAsync(accountTokenKey(userId))
      if (token) await mobileApi.logoutWithToken(token).catch(() => undefined)
      await SecureStore.deleteItemAsync(accountTokenKey(userId))
      await forgetSignedInAccount(instanceUrl, userId)
      await clearAccountData(instanceUrl, userId)
      set({ accounts: await loadAccounts(instanceUrl) })
    },

    logoutAll: async () => {
      const { instanceUrl, user } = get()
      for (const userId of await signedInUserIds(instanceUrl)) {
        if (userId !== user?.id) await get().signOutAccount(userId)
      }
      await get().logout()
    },

    refreshSession: async () => {
      const { token, instanceUrl } = get()
      const { user } = await mobileApi.me()
      if (get().token !== token || get().instanceUrl !== instanceUrl) return
      await persistAccount(instanceUrl, user)
      if (get().token !== token || get().instanceUrl !== instanceUrl) return
      set({ user, status: sessionStatus(user), error: null })
    },

    switchInstance: async (value) => {
      const previous = get()
      const instanceUrl = normalizeInstanceUrl(value, allowLocalhost())
      configureApi({ instanceUrl, token: null })
      let config: MobileConfig
      try {
        config = await mobileApi.config()
      } catch (error) {
        configureApi({ instanceUrl: previous.instanceUrl, token: previous.token, onUnauthorized })
        throw error
      }
      clearShortcutsSession()
      // Every signed-in account belongs to the previous instance.
      configureApi({ instanceUrl: previous.instanceUrl, token: previous.token })
      for (const userId of await signedInUserIds(previous.instanceUrl).catch(() => [])) {
        if (userId !== previous.user?.id) await get().signOutAccount(userId).catch(() => undefined)
      }
      if (previous.token) await mobileApi.logout().catch(() => undefined)
      await Promise.all([
        SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
        setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
        setValue(GLOBAL_NAMESPACE, SIGNED_IN_ACCOUNTS_KEY, null),
      ])
      if (previous.user) await clearAccountData(previous.instanceUrl, previous.user.id)
      await setValue(GLOBAL_NAMESPACE, 'instanceUrl', instanceUrl)
      configureApi({ instanceUrl, token: null, onUnauthorized })
      set({ instanceUrl, config, token: null, user: null, accounts: [], status: 'anonymous', error: null })
      return config
    },

    setUser: async (user) => {
      await persistAccount(get().instanceUrl, user)
      set({ user, status: sessionStatus(user) })
    },

    handleUnauthorized: async () => {
      const { instanceUrl, token, user, accounts } = get()
      // Only the active bearer session can expire; anonymous 401s are not session loss.
      if (!token) return
      const error = 'Your session expired. Sign in again.'
      clearShortcutsSession()
      // Stop authenticated work immediately, even if platform storage is unavailable.
      configureApi({ instanceUrl, token: null })
      set({ token: null, user: null, status: accounts.some((account) => account.id !== user?.id) ? 'hydrating' : 'anonymous', error })
      Appearance.setColorScheme('unspecified')
      await Promise.allSettled([
        SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
        setValue(GLOBAL_NAMESPACE, ACTIVE_SESSION_NAMESPACE_KEY, null),
        user ? forgetSignedInAccount(instanceUrl, user.id) : undefined,
      ])
      if (!(await signedInUserIds(instanceUrl).catch(() => [])).length) {
        set({ status: 'anonymous', accounts: await loadAccounts(instanceUrl).catch(() => []) })
        return
      }
      if (await activateRemaining()) {
        Alert.alert('Session expired', `${user?.name ?? 'An account'} was signed out. Sign in to it again to keep using it.`)
      } else set({ error })
    },
  }
})

function deviceMetadata() {
  return { platform: Platform.OS === 'ios' ? 'ios' as const : Platform.OS === 'android' ? 'android' as const : 'unknown' as const }
}

// Synchronous native bridge: account transitions cannot race a queued React effect.
useSessionStore.subscribe((state, previous) => {
  if (state.status !== previous.status || state.token !== previous.token
    || state.instanceUrl !== previous.instanceUrl || state.user?.id !== previous.user?.id
    || state.user?.blocked !== previous.user?.blocked) syncShortcutsSession(state)
})
