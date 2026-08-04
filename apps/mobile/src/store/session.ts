import { Appearance } from 'react-native'
import * as Device from 'expo-device'
import { File } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { normalizeInstanceUrl } from '@pulpo/client-core'
import type { MobileConfig, User } from '@pulpo/contracts'
import { apiOrigin, configureApi, mobileApi } from '../api/client'
import { cacheNamespace, clearNamespace, getValue, setValue } from '../data/database'

const SESSION_TOKEN_KEY = 'pulpo.native.session'
const GLOBAL_NAMESPACE = 'global'
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
  login: (email: string, password: string) => Promise<void>
  signup: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
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

async function persistSession(instanceUrl: string, user: User, token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  await Promise.all([
    setValue(GLOBAL_NAMESPACE, 'instanceUrl', instanceUrl),
    setValue(cacheNamespace(instanceUrl, user.id), 'user', user),
  ])
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
      const storedInstance = await getValue<string>(GLOBAL_NAMESPACE, 'instanceUrl')
      const instanceUrl = normalizeInstanceUrl(storedInstance ?? DEFAULT_INSTANCE, allowLocalhost())
      const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY)
      configureApi({ instanceUrl, token, onUnauthorized: () => { void get().handleUnauthorized() } })
      set({ instanceUrl, token, status: token ? 'hydrating' : 'anonymous' })
      let config: MobileConfig | null = null
      try {
      config = await mobileApi.config()
      if (!token) return set({ config, status: 'anonymous', error: null })
      const { user } = await mobileApi.me()
      await setValue(cacheNamespace(instanceUrl, user.id), 'user', user)
      set({ config, user, status: user.role === 'pending' ? 'pending' : 'authenticated', error: null })
      } catch (error) {
        if (token) {
          const namespaces = await getValue<string[]>(GLOBAL_NAMESPACE, 'knownNamespaces') ?? []
          const cachedUsers = await Promise.all(namespaces
            .filter((namespace) => namespace.startsWith(`${new URL(instanceUrl).origin}|`))
            .map((namespace) => getValue<User>(namespace, 'user')))
          const user = cachedUsers.find(Boolean) ?? null
          if (user) return set({ config, user, status: user.role === 'pending' ? 'pending' : 'authenticated', error: 'Offline' })
        }
        set({ config, status: 'anonymous', error: error instanceof Error ? error.message : 'Could not connect' })
      }
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

  login: async (email, password) => {
    configureApi({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    const result = await mobileApi.login(email.trim(), password, await deviceLabel())
    await persistSession(get().instanceUrl, result.user, result.session.token)
    const namespace = cacheNamespace(get().instanceUrl, result.user.id)
    const known = new Set(await getValue<string[]>(GLOBAL_NAMESPACE, 'knownNamespaces') ?? [])
    known.add(namespace)
    await setValue(GLOBAL_NAMESPACE, 'knownNamespaces', [...known])
    configureApi({ instanceUrl: get().instanceUrl, token: result.session.token, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: result.session.token, user: result.user, status: result.user.role === 'pending' ? 'pending' : 'authenticated', error: null })
  },

  signup: async (name, email, password) => {
    configureApi({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    const result = await mobileApi.signup(name.trim(), email.trim(), password, await deviceLabel())
    await persistSession(get().instanceUrl, result.user, result.session.token)
    const namespace = cacheNamespace(get().instanceUrl, result.user.id)
    const known = new Set(await getValue<string[]>(GLOBAL_NAMESPACE, 'knownNamespaces') ?? [])
    known.add(namespace)
    await setValue(GLOBAL_NAMESPACE, 'knownNamespaces', [...known])
    configureApi({ instanceUrl: get().instanceUrl, token: result.session.token, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: result.session.token, user: result.user, status: result.user.role === 'pending' ? 'pending' : 'authenticated', error: null })
  },

  logout: async () => {
    const { user, instanceUrl, token } = get()
    if (token) await mobileApi.logout().catch(() => undefined)
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)
    if (user) removeCachedFiles(await clearNamespace(cacheNamespace(instanceUrl, user.id)))
    configureApi({ instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ token: null, user: null, status: 'anonymous', error: null })
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
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)
    if (previous.user) removeCachedFiles(await clearNamespace(cacheNamespace(previous.instanceUrl, previous.user.id)))
    await setValue(GLOBAL_NAMESPACE, 'instanceUrl', instanceUrl)
    configureApi({ instanceUrl, token: null, onUnauthorized: () => { void get().handleUnauthorized() } })
    set({ instanceUrl, config, token: null, user: null, status: 'anonymous', error: null })
    return config
  },

  setUser: async (user) => {
    const namespace = cacheNamespace(get().instanceUrl, user.id)
    await setValue(namespace, 'user', user)
    set({ user, status: user.role === 'pending' ? 'pending' : 'authenticated' })
  },

  handleUnauthorized: async () => {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)
    configureApi({ instanceUrl: apiOrigin(), token: null })
    set({ token: null, user: null, status: 'anonymous', error: 'Your session expired. Sign in again.' })
    Appearance.setColorScheme('unspecified')
  },
}))
