import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AuthRole = 'pending' | 'user' | 'admin'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: AuthRole
  initials: string
}

interface AuthState {
  user: AuthUser | null
  /** Mock admin toggle mirrored from settings. */
  signupEnabled: boolean
  pendingDetails: boolean
  adminEmail: string
  pendingMessage: string
  login: (email: string, password: string) => { ok: true } | { ok: false; error: string }
  signup: (name: string, email: string, password: string) => { ok: true } | { ok: false; error: string }
  logout: () => void
  /** Demo helper: jump into a known account. */
  loginAs: (user: AuthUser) => void
  setSignupEnabled: (v: boolean) => void
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

const DEMO_USERS: AuthUser[] = [
  {
    id: 'u-isaac',
    name: 'Isaac Thoman',
    email: 'isaac@pulpo.dev',
    role: 'admin',
    initials: 'IT',
  },
  {
    id: 'u-maya',
    name: 'Maya Chen',
    email: 'maya@pulpo.dev',
    role: 'user',
    initials: 'MC',
  },
  {
    id: 'u-pending',
    name: 'Alex Rivera',
    email: 'alex@example.com',
    role: 'pending',
    initials: 'AR',
  },
]

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: DEMO_USERS[0]!,
      signupEnabled: true,
      pendingDetails: true,
      adminEmail: 'isaac@pulpo.dev',
      pendingMessage: 'Your account is pending approval. An admin will review it shortly.',
      login: (email, password) => {
        if (!email.trim() || !password) {
          return { ok: false, error: 'Email and password are required.' }
        }
        const found = DEMO_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
        if (found) {
          set({ user: found })
          return { ok: true }
        }
        // Any other credentials work as a generic user in the mock.
        if (password.length < 6) {
          return { ok: false, error: 'Invalid email or password.' }
        }
        const name = email.split('@')[0] || 'User'
        const pretty = name
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
        set({
          user: {
            id: `u-${Date.now()}`,
            name: pretty,
            email: email.trim(),
            role: 'user',
            initials: initials(pretty),
          },
        })
        return { ok: true }
      },
      signup: (name, email, password) => {
        if (!get().signupEnabled) {
          return { ok: false, error: 'New sign ups are currently disabled.' }
        }
        if (!name.trim() || !email.trim() || !password) {
          return { ok: false, error: 'All fields are required.' }
        }
        if (password.length < 8) {
          return { ok: false, error: 'Password must be at least 8 characters.' }
        }
        if (DEMO_USERS.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
          return { ok: false, error: 'An account with this email already exists.' }
        }
        const user: AuthUser = {
          id: `u-${Date.now()}`,
          name: name.trim(),
          email: email.trim(),
          role: 'pending',
          initials: initials(name.trim()),
        }
        set({ user })
        return { ok: true }
      },
      logout: () => set({ user: null }),
      loginAs: (user) => set({ user }),
      setSignupEnabled: (signupEnabled) => set({ signupEnabled }),
    }),
    { name: 'pulpo-auth' }
  )
)

export const DEMO_ACCOUNTS = DEMO_USERS
