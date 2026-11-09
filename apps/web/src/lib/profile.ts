import { RESERVED_PROFILE_USERNAMES } from '@pulpo/contracts'
import { matchPath, useLocation } from 'react-router-dom'

export function profileInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

export const PROFILE_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'] as const

export function automaticProfileColor(id: string): string {
  let hash = 0
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return PROFILE_COLORS[Math.abs(hash) % PROFILE_COLORS.length]!
}

/** The signed-in user's own profile, which holds their usage; `/usage` redirects there. */
export function ownProfilePath(username: string | null | undefined): string {
  return username ? `/${username}` : '/usage'
}

const reservedProfileUsernames = new Set<string>(RESERVED_PROFILE_USERNAMES)

/** The username a `/:username` path names, unless its segment is one of Pulpo's own root routes. */
export function profilePathUsername(pathname: string): string | undefined {
  const username = matchPath('/:username', pathname)?.params.username
  return username && !reservedProfileUsernames.has(username.toLowerCase()) ? username : undefined
}

/** Whether a page belongs to People: Friends, the friends leaderboard, or anyone's profile, yours or not. */
export function isPeoplePath(pathname: string): boolean {
  return Boolean(matchPath({ path: '/friends', end: false }, pathname) || profilePathUsername(pathname))
}

/** History state on a link to someone's profile: the People tab it was opened from, with its search. */
export type ProfileLinkState = { peopleOrigin: string }

const PEOPLE_ORIGIN = /^\/friends(?:\/leaderboard)?(?:\?[^#]*)?$/

/** Where someone's profile breadcrumb leads back to. History state is untrusted, so anything but a People tab is Friends. */
export function profileOrigin(state: unknown): string {
  const origin = typeof state === 'object' && state !== null ? (state as { peopleOrigin?: unknown }).peopleOrigin : undefined
  return typeof origin === 'string' && PEOPLE_ORIGIN.test(origin) ? origin : '/friends'
}

/**
 * The state a link to someone's profile carries from the current page: Friends and the leaderboard are
 * its origin, and a profile passes its own origin on, so Friends › Jordan → Sam reads Friends › Sam.
 */
export function useProfileLinkState(): ProfileLinkState | undefined {
  const { pathname, search, state } = useLocation()
  const list = matchPath('/friends/leaderboard', pathname) ? '/friends/leaderboard' : matchPath('/friends', pathname) ? '/friends' : undefined
  if (list) return { peopleOrigin: `${list}${search}` }
  return profilePathUsername(pathname) ? { peopleOrigin: profileOrigin(state) } : undefined
}
