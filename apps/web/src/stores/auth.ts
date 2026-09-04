import { create } from 'zustand'
import { apiRequest, ApiError } from '@/lib/api'
import { clearLocalUserData } from '@/lib/local-first/database'
import { clearRuntimeComposerDrafts } from '@/lib/local-first/composer-drafts'
import { queryClient } from '@/lib/query-client'
import { DEFAULT_MAX_ATTACHMENT_BYTES, type MobileConfig, type NativeAuthResponse, type PasskeyCeremony } from '@pulpo/contracts'
import { authenticateWithPasskey, passkeyErrorMessage } from '@/lib/passkeys'
import { normalizeInstanceUrl } from '@pulpo/client-core'
import { authenticateDesktopPasskey, DesktopPasskeyCancelledError } from '@/lib/desktop-passkeys'
import {
  clearDesktopSession,
  configureDesktopRuntime,
  isDesktopRuntime,
  loadDesktopSession,
  runtimeInstanceUrl,
  runtimeProfileKey,
  storeDesktopSession,
} from '@/lib/runtime'
import { ui } from '@/i18n/ui'

export type AuthRole = 'pending' | 'user' | 'admin'

export interface AuthUser {
  id: string
  name: string
  email: string
  username: string
  avatarUrl: string | null
  profileColor: string | null
  role: AuthRole
  initials: string
  balanceMicros: number
  storageLimitBytes: number
  blocked: boolean
  stateRevision: number
  createdAt: string
}

interface ServerUser extends Omit<AuthUser, 'initials'> {}
interface AuthResponse { user: ServerUser }
interface PublicAuthSettings {
  signupEnabled: boolean
  pendingDetails: boolean
  adminEmail: string
  pendingMessage: string
  apiKeysEnabled: boolean
  maxAttachmentBytes: number
  billingEnabled: boolean
  inviteCodesEnabled: boolean
  dictationEnabled: boolean
}
type AuthResult = { ok: true } | { ok: false; error: string }
export type LoginResult = AuthResult | { ok: false; twoFactorRequired: true }

interface AuthState {
  user: AuthUser | null
  checkingSession: boolean
  setupRequired: boolean | null
  signupEnabled: boolean
  pendingDetails: boolean
  adminEmail: string
  pendingMessage: string
  apiKeysEnabled: boolean
  maxAttachmentBytes: number
  billingEnabled: boolean
  inviteCodesEnabled: boolean
  dictationEnabled: boolean
  instanceUrl: string
  instanceName: string
  instanceReady: boolean
  instanceError: string
  bootstrap: () => Promise<void>
  login: (email: string, password: string, twoFactorCode?: string) => Promise<LoginResult>
  passkeyLogin: (useBrowserAutofill?: boolean) => Promise<AuthResult>
  signup: (name: string, username: string, email: string, password: string) => Promise<AuthResult>
  setup: (name: string, username: string, email: string, password: string) => Promise<AuthResult>
  logout: () => Promise<void>
  switchInstance: (url: string) => Promise<void>
  chooseInstance: () => Promise<void>
  handleDesktopUnauthorized: () => Promise<void>
  replaceUser: (user: ServerUser) => void
  setSignupEnabled: (value: boolean) => void
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('')
}

function normalizeUser(user: ServerUser): AuthUser {
  return {
    ...user,
    avatarUrl: user.avatarUrl ?? null,
    profileColor: user.profileColor ?? null,
    initials: initials(user.name),
  }
}

function readCachedProfile(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(runtimeProfileKey()) ?? 'null') as AuthUser | null
  } catch {
    return null
  }
}

function cacheProfile(user: AuthUser | null): void {
  if (user) localStorage.setItem(runtimeProfileKey(), JSON.stringify(user))
  else localStorage.removeItem(runtimeProfileKey())
}

const cachedProfile = readCachedProfile()

export const useAuth = create<AuthState>()((set, get) => ({
  user: cachedProfile,
  checkingSession: true,
  setupRequired: null,
  signupEnabled: true,
  pendingDetails: true,
  adminEmail: '',
  pendingMessage: 'Your account is pending approval. An admin will review it shortly.',
  apiKeysEnabled: true,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  billingEnabled: false,
  inviteCodesEnabled: false,
  dictationEnabled: false,
  instanceUrl: runtimeInstanceUrl(),
  instanceName: 'Pulpo',
  instanceReady: !isDesktopRuntime(),
  instanceError: '',

  bootstrap: async () => {
    if (!get().checkingSession) return
    if (isDesktopRuntime()) {
      const stored = await loadDesktopSession()
      const instanceUrl = stored?.instanceUrl ?? runtimeInstanceUrl()
      configureDesktopRuntime({
        instanceUrl,
        token: stored?.token ?? null,
        onUnauthorized: () => { void get().handleDesktopUnauthorized() },
      })
      if (!stored) {
        cacheProfile(null)
        set({ user: null })
      }
      const [configResult, authSettings, authResult] = await Promise.all([
        apiRequest<MobileConfig>('/api/mobile/config').then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
        apiRequest<PublicAuthSettings>('/api/auth/settings').catch(() => null),
        stored
          ? apiRequest<AuthResponse>('/api/mobile/me').then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          )
          : Promise.resolve(null),
      ])
      if (!configResult.ok) {
        const error = configResult.error
        set({
          checkingSession: false,
          instanceUrl,
          instanceReady: false,
          instanceError: error instanceof Error ? error.message : 'Could not connect to this Pulpo instance.',
        })
        return
      }
      const config = configResult.value
      const publicSettings = authSettings ?? {
        signupEnabled: config.auth.signupEnabled,
        pendingDetails: config.auth.pendingDetails,
        adminEmail: config.auth.adminEmail,
        pendingMessage: config.auth.pendingMessage,
        apiKeysEnabled: true,
        maxAttachmentBytes: config.limits.maxAttachmentBytes,
        billingEnabled: false,
        inviteCodesEnabled: config.auth.inviteCodesEnabled,
        dictationEnabled: false,
      }
      if (!stored) {
        set({
          user: null,
          checkingSession: false,
          setupRequired: config.setupRequired,
          instanceUrl,
          instanceName: config.instance.name,
          instanceReady: true,
          instanceError: '',
          ...publicSettings,
        })
        return
      }
      if (authResult?.ok) {
        const response = authResult.value
        const user = normalizeUser(response.user)
        cacheProfile(user)
        set({
          user,
          checkingSession: false,
          setupRequired: config.setupRequired,
          instanceUrl,
          instanceName: config.instance.name,
          instanceReady: true,
          instanceError: '',
          ...publicSettings,
        })
      } else {
        const error = authResult?.error
        if (error instanceof ApiError && error.status === 401) {
          await clearDesktopSession()
          configureDesktopRuntime({ instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
          cacheProfile(null)
          set({ user: null, checkingSession: false, setupRequired: config.setupRequired, instanceUrl, instanceName: config.instance.name, instanceReady: true, ...publicSettings })
        } else {
          set({
            user: readCachedProfile(),
            checkingSession: false,
            setupRequired: config.setupRequired,
            instanceUrl,
            instanceName: config.instance.name,
            instanceReady: false,
            instanceError: error instanceof Error ? error.message : 'Could not validate the saved session.',
            ...publicSettings,
          })
        }
      }
      return
    }
    const [setupStatus, authSettings] = await Promise.all([
      apiRequest<{ required: boolean }>('/api/auth/setup-status').catch(() => null),
      apiRequest<PublicAuthSettings>('/api/auth/settings').catch(() => null),
    ])
    const publicSettings = authSettings ?? {
      signupEnabled: get().signupEnabled,
      pendingDetails: get().pendingDetails,
      adminEmail: get().adminEmail,
      pendingMessage: get().pendingMessage,
      apiKeysEnabled: get().apiKeysEnabled,
      maxAttachmentBytes: get().maxAttachmentBytes,
      billingEnabled: get().billingEnabled,
      inviteCodesEnabled: get().inviteCodesEnabled,
      dictationEnabled: get().dictationEnabled,
    }
    try {
      const response = await apiRequest<AuthResponse>('/api/me')
      const user = normalizeUser(response.user)
      cacheProfile(user)
      set({ user, checkingSession: false, setupRequired: setupStatus?.required ?? false, ...publicSettings })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        cacheProfile(null)
        set({ user: null, checkingSession: false, setupRequired: setupStatus?.required ?? false, ...publicSettings })
        return
      }
      // A cached profile may render offline data, while every server mutation
      // remains protected by the HTTP-only session once connectivity returns.
      set({ checkingSession: false, setupRequired: setupStatus?.required ?? get().setupRequired, ...publicSettings })
    }
  },

  login: async (email, password, twoFactorCode) => {
    try {
      if (isDesktopRuntime()) configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
      const response = isDesktopRuntime()
        ? await apiRequest<NativeAuthResponse>('/api/mobile/auth/login', { method: 'POST', body: { email, password, twoFactorCode, deviceLabel: 'Pulpo for Mac' } })
        : await apiRequest<AuthResponse>('/api/auth/login', { method: 'POST', body: { email, password, twoFactorCode } })
      const user = normalizeUser(response.user)
      if (isDesktopRuntime() && 'session' in response) {
        const session = (response as NativeAuthResponse).session
        configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: session.token, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
        await storeDesktopSession({ instanceUrl: get().instanceUrl, ...session })
      }
      cacheProfile(user)
      set({ user, checkingSession: false })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'two_factor_required') {
        return { ok: false, twoFactorRequired: true }
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to sign in.' }
    }
  },

  passkeyLogin: async (useBrowserAutofill = false) => {
    try {
      if (isDesktopRuntime()) {
        configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
        const response = await authenticateDesktopPasskey()
        configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: response.session.token, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
        await storeDesktopSession({ instanceUrl: get().instanceUrl, ...response.session })
        const user = normalizeUser(response.user)
        cacheProfile(user)
        set({ user, checkingSession: false })
        return { ok: true }
      }
      const ceremony = await apiRequest<PasskeyCeremony>('/api/auth/passkey/options', { method: 'POST' })
      const assertion = await authenticateWithPasskey(ceremony, useBrowserAutofill)
      const response = await apiRequest<AuthResponse>('/api/auth/passkey/verify', {
        method: 'POST', body: { ceremonyToken: ceremony.ceremonyToken, response: assertion },
      })
      const user = normalizeUser(response.user)
      cacheProfile(user)
      set({ user, checkingSession: false })
      return { ok: true }
    } catch (error) {
      if (error instanceof DesktopPasskeyCancelledError) return { ok: false, error: 'Passkey sign-in was cancelled.' }
      return { ok: false, error: passkeyErrorMessage(error, 'Unable to sign in with a passkey.') }
    }
  },

  signup: async (name, username, email, password) => {
    try {
      if (isDesktopRuntime()) configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
      const response = isDesktopRuntime()
        ? await apiRequest<NativeAuthResponse>('/api/mobile/auth/signup', { method: 'POST', body: { name, username, email, password, deviceLabel: 'Pulpo for Mac' } })
        : await apiRequest<AuthResponse>('/api/auth/signup', { method: 'POST', body: { name, username, email, password } })
      const user = normalizeUser(response.user)
      if (isDesktopRuntime() && 'session' in response) {
        const session = (response as NativeAuthResponse).session
        configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: session.token, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
        await storeDesktopSession({ instanceUrl: get().instanceUrl, ...session })
      }
      cacheProfile(user)
      set({ user, checkingSession: false })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to create account.' }
    }
  },

  setup: async (name, username, email, password) => {
    try {
      const response = isDesktopRuntime()
        ? await apiRequest<NativeAuthResponse>('/api/mobile/auth/setup', { method: 'POST', body: { name, username, email, password, deviceLabel: 'Pulpo for Mac' } })
        : await apiRequest<AuthResponse>('/api/auth/setup', { method: 'POST', body: { name, username, email, password } })
      const user = normalizeUser(response.user)
      if (isDesktopRuntime() && 'session' in response) {
        const session = (response as NativeAuthResponse).session
        configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: session.token, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
        await storeDesktopSession({ instanceUrl: get().instanceUrl, ...session })
      }
      cacheProfile(user)
      set({ user, checkingSession: false, setupRequired: false })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to finish setup.' }
    }
  },

  logout: async () => {
    const userId = get().user?.id
    set({ user: null, checkingSession: false })
    cacheProfile(null)
    await apiRequest(isDesktopRuntime() ? '/api/mobile/auth/logout' : '/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    if (isDesktopRuntime()) {
      await clearDesktopSession()
      configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
    }
    queryClient.clear()
    if (userId) {
      clearRuntimeComposerDrafts(userId)
      await clearLocalUserData(userId)
    }
  },

  switchInstance: async (value) => {
    if (!isDesktopRuntime()) return
    // Always clear the native credential before changing origins. A session can
    // exist even when its cached profile could not be restored while offline.
    await get().logout()
    const allowLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    const instanceUrl = normalizeInstanceUrl(value, allowLocalhost)
    configureDesktopRuntime({ instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
    set({ checkingSession: true, instanceUrl, instanceReady: false, instanceError: '', user: null })
    try {
      const [config, authSettings] = await Promise.all([
        apiRequest<MobileConfig>('/api/mobile/config'),
        apiRequest<PublicAuthSettings>('/api/auth/settings').catch(() => null),
      ])
      if (config.mobileApiVersion !== 1 || !config.capabilities.bearerSessions || !config.capabilities.realtime) {
        throw new Error(ui("This server does not support the Pulpo desktop app."))
      }
      const settings = authSettings ?? {
        signupEnabled: config.auth.signupEnabled,
        pendingDetails: config.auth.pendingDetails,
        adminEmail: config.auth.adminEmail,
        pendingMessage: config.auth.pendingMessage,
        apiKeysEnabled: true,
        maxAttachmentBytes: config.limits.maxAttachmentBytes,
        billingEnabled: false,
        inviteCodesEnabled: config.auth.inviteCodesEnabled,
        dictationEnabled: false,
      }
      set({ checkingSession: false, setupRequired: config.setupRequired, instanceUrl, instanceName: config.instance.name, instanceReady: true, instanceError: '', ...settings })
      window.location.reload()
    } catch (error) {
      set({ checkingSession: false, instanceReady: false, instanceError: error instanceof Error ? error.message : 'Could not connect to this Pulpo instance.' })
      throw error
    }
  },

  chooseInstance: async () => {
    if (!isDesktopRuntime()) return
    await get().logout()
    set({ instanceReady: false, instanceError: '' })
  },

  handleDesktopUnauthorized: async () => {
    if (!isDesktopRuntime() || !get().user) return
    const userId = get().user!.id
    cacheProfile(null)
    await clearDesktopSession()
    configureDesktopRuntime({ instanceUrl: get().instanceUrl, token: null, onUnauthorized: () => { void get().handleDesktopUnauthorized() } })
    queryClient.clear()
    clearRuntimeComposerDrafts(userId)
    await clearLocalUserData(userId)
    set({ user: null, checkingSession: false })
  },

  replaceUser: (profile) => {
    const user = normalizeUser(profile)
    cacheProfile(user)
    set({ user })
  },

  setSignupEnabled: (signupEnabled) => set({ signupEnabled }),
}))
