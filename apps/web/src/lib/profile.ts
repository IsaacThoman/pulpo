import { matchPath } from 'react-router-dom'

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

/** Whether a page is one of People's tabs: your own profile, Friends, or the friends leaderboard. */
export function isPeoplePath(pathname: string, username: string | null | undefined): boolean {
  if (matchPath({ path: '/friends', end: false }, pathname)) return true
  const profile = matchPath('/:username', pathname)?.params.username
  return Boolean(username && profile?.toLowerCase() === username.toLowerCase())
}
