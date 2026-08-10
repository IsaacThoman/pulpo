import { create } from 'zustand'
import { apiRequest, ApiError } from '@/lib/api'
import { clearLocalUserData } from '@/lib/local-first/database'
import { queryClient } from '@/lib/query-client'
import { DEFAULT_MAX_ATTACHMENT_BYTES } from '@pulpo/contracts'

export type AuthRole = 'pending' | 'user' | 'admin'

export interface AuthUser {
  id: string
  name: string
  email: string
  username: string | null
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
  bootstrap: () => Promise<void>
  login: (email: string, password: string, twoFactorCode?: string) => Promise<LoginResult>
  signup: (name: string, email: string, password: string) => Promise<AuthResult>
  setup: (name: string, email: string, password: string) => Promise<AuthResult>
  logout: () => Promise<void>
  replaceUser: (user: ServerUser) => void
  setSignupEnabled: (value: boolean) => void
}

const PROFILE_KEY = 'pulpo-profile'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('')
}

function normalizeUser(user: ServerUser): AuthUser {
  return {
    ...user,
    username: user.username ?? null,
    avatarUrl: user.avatarUrl ?? null,
    profileColor: user.profileColor ?? null,
    initials: initials(user.name),
  }
}

function readCachedProfile(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as AuthUser | null
  } catch {
    return null
  }
}

function cacheProfile(user: AuthUser | null): void {
  if (user) localStorage.setItem(PROFILE_KEY, JSON.stringify(user))
  else localStorage.removeItem(PROFILE_KEY)
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

  bootstrap: async () => {
    if (!get().checkingSession) return
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
      const response = await apiRequest<AuthResponse>('/api/auth/login', {
        method: 'POST', body: { email, password, twoFactorCode },
      })
      const user = normalizeUser(response.user)
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

  signup: async (name, email, password) => {
    try {
      const response = await apiRequest<AuthResponse>('/api/auth/signup', {
        method: 'POST', body: { name, email, password },
      })
      const user = normalizeUser(response.user)
      cacheProfile(user)
      set({ user, checkingSession: false })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to create account.' }
    }
  },

  setup: async (name, email, password) => {
    try {
      const response = await apiRequest<AuthResponse>('/api/auth/setup', {
        method: 'POST', body: { name, email, password },
      })
      const user = normalizeUser(response.user)
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
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    queryClient.clear()
    if (userId) await clearLocalUserData(userId)
  },

  replaceUser: (profile) => {
    const user = normalizeUser(profile)
    cacheProfile(user)
    set({ user })
  },

  setSignupEnabled: (signupEnabled) => set({ signupEnabled }),
}))
