import { MAX_SIGNED_IN_ACCOUNTS, type SignedInAccount, type SignedInAccountList, type User } from '@pulpo/contracts'
import { ApiError, apiRequest, type ApiErrorBody } from './api'
import {
  clearDesktopSession,
  isDesktopRuntime,
  loadDesktopSession,
  loadDesktopSignedInAccounts,
  runtimeApiUrl,
  runtimeClientHeaders,
  runtimeInstanceUrl,
  storeDesktopSession,
  storeDesktopSignedInAccounts,
} from './runtime'
import { ui, uit } from '@/i18n/ui'

// Browsers keep every signed-in account's session in HTTP-only cookies the
// server manages. The desktop app keeps the other accounts' bearer tokens in
// the OS keychain and only caches their display details here.

type AccountProfile = Omit<SignedInAccount, 'active'>
type ActiveUser = Pick<User, 'id' | 'name' | 'username' | 'email' | 'avatarUrl' | 'profileColor'>

function profileCacheKey(): string {
  return `pulpo-signed-in-accounts:${new URL(runtimeInstanceUrl()).origin}`
}

function readProfiles(): Record<string, AccountProfile> {
  try {
    return JSON.parse(localStorage.getItem(profileCacheKey()) ?? '{}') as Record<string, AccountProfile>
  } catch {
    return {}
  }
}

function writeProfiles(profiles: Record<string, AccountProfile>): void {
  try {
    if (Object.keys(profiles).length) localStorage.setItem(profileCacheKey(), JSON.stringify(profiles))
    else localStorage.removeItem(profileCacheKey())
  } catch { /* the cache only labels offline accounts */ }
}

function accountProfile(user: ActiveUser): AccountProfile {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    profileColor: user.profileColor,
  }
}

/** Authenticates as another signed-in desktop account without touching the active session. */
async function desktopAccountRequest<T>(path: string, token: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const response = await fetch(runtimeApiUrl(path), {
    method,
    credentials: 'omit',
    headers: { ...runtimeClientHeaders(path), authorization: `Bearer ${token}` },
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => undefined) as ApiErrorBody | undefined
  if (!response.ok) {
    throw new ApiError(response.status, body?.error?.code ?? 'request_failed', body?.error?.message ?? `Request failed (${response.status})`, body)
  }
  return body as T
}

function revokeDesktopToken(token: string): void {
  void desktopAccountRequest('/api/mobile/auth/logout', token, 'POST').catch(() => undefined)
}

export async function listSignedInAccounts(activeUser: ActiveUser | null): Promise<SignedInAccount[]> {
  if (!isDesktopRuntime()) return (await apiRequest<SignedInAccountList>('/api/auth/accounts')).accounts
  const stored = await loadDesktopSignedInAccounts()
  const profiles = readProfiles()
  const kept: typeof stored = []
  const others: SignedInAccount[] = []
  for (const entry of stored) {
    // Signing in again to a signed-in account leaves its older session behind.
    if (entry.userId === activeUser?.id || kept.some((account) => account.userId === entry.userId)) {
      revokeDesktopToken(entry.token)
      continue
    }
    try {
      const { user } = await desktopAccountRequest<{ user: User }>('/api/mobile/me', entry.token)
      profiles[user.id] = accountProfile(user)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) continue
    }
    kept.push(entry)
    const profile = profiles[entry.userId]
    if (profile) others.push({ ...profile, active: false })
  }
  for (const id of Object.keys(profiles)) {
    if (!kept.some((account) => account.userId === id) && id !== activeUser?.id) delete profiles[id]
  }
  if (activeUser) profiles[activeUser.id] = accountProfile(activeUser)
  writeProfiles(profiles)
  if (kept.length !== stored.length) await storeDesktopSignedInAccounts(kept)
  return [...(activeUser ? [{ ...accountProfile(activeUser), active: true }] : []), ...others]
}

/** Keeps the active account signed in and clears the active session for a new sign-in. */
export async function prepareToAddAccount(activeUser: ActiveUser): Promise<void> {
  if (!isDesktopRuntime()) {
    await apiRequest('/api/auth/accounts/add', { method: 'POST' })
    return
  }
  const [session, stored] = await Promise.all([loadDesktopSession(), loadDesktopSignedInAccounts()])
  if (!session) throw new Error(ui('Sign in again before adding another account.'))
  const others = stored.filter((account) => account.userId !== activeUser.id)
  if (others.length + 1 >= MAX_SIGNED_IN_ACCOUNTS) {
    throw new ApiError(409, 'account_limit', uit`You can stay signed in to up to ${MAX_SIGNED_IN_ACCOUNTS} accounts.`)
  }
  writeProfiles({ ...readProfiles(), [activeUser.id]: accountProfile(activeUser) })
  await storeDesktopSignedInAccounts([{ userId: activeUser.id, token: session.token, expiresAt: session.expiresAt }, ...others])
  await clearDesktopSession()
}

/** Makes a signed-in account active; returns its profile. */
export async function activateSignedInAccount(userId: string, activeUser: ActiveUser | null): Promise<User> {
  if (!isDesktopRuntime()) {
    return (await apiRequest<{ user: User }>('/api/auth/accounts/switch', { method: 'POST', body: { userId } })).user
  }
  const [session, stored] = await Promise.all([loadDesktopSession(), loadDesktopSignedInAccounts()])
  const target = stored.find((account) => account.userId === userId)
  if (!target) throw new ApiError(404, 'account_not_signed_in', ui('That account is no longer signed in.'))
  let user: User
  try {
    user = (await desktopAccountRequest<{ user: User }>('/api/mobile/me', target.token)).user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await storeDesktopSignedInAccounts(stored.filter((account) => account !== target))
      throw new ApiError(401, 'account_signed_out', ui('That account was signed out. Sign in to it again.'))
    }
    throw error
  }
  const others = stored.filter((account) => account !== target)
  if (session && activeUser) others.unshift({ userId: activeUser.id, token: session.token, expiresAt: session.expiresAt })
  await storeDesktopSignedInAccounts(others)
  await storeDesktopSession({ instanceUrl: runtimeInstanceUrl(), token: target.token, expiresAt: target.expiresAt })
  return user
}

/** Signs out a signed-in account that is not the active one. */
export async function signOutSignedInAccount(userId: string): Promise<void> {
  if (!isDesktopRuntime()) {
    await apiRequest('/api/auth/accounts/sign-out', { method: 'POST', body: { userId } })
    return
  }
  const stored = await loadDesktopSignedInAccounts()
  for (const account of stored) if (account.userId === userId) revokeDesktopToken(account.token)
  await storeDesktopSignedInAccounts(stored.filter((account) => account.userId !== userId))
  const profiles = readProfiles()
  delete profiles[userId]
  writeProfiles(profiles)
}

/** Signs out every account that is not the active one; returns their user IDs. */
export async function signOutOtherAccounts(): Promise<string[]> {
  if (!isDesktopRuntime()) {
    const { accounts } = await apiRequest<SignedInAccountList>('/api/auth/accounts')
    const others = accounts.filter((account) => !account.active).map((account) => account.id)
    await apiRequest('/api/auth/accounts/sign-out-all', { method: 'POST' })
    return others
  }
  const stored = await loadDesktopSignedInAccounts()
  for (const account of stored) revokeDesktopToken(account.token)
  await storeDesktopSignedInAccounts([])
  writeProfiles({})
  return stored.map((account) => account.userId)
}
