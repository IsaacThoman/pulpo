import type { FriendProfile, FriendSearchResult } from '@pulpo/contracts'
import { useContext } from 'react'
import { FriendProfileContext } from '@/lib/friend-profile-context'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { uit } from '@/i18n/ui'
import { friendSearchHighlight } from '@/lib/friend-search'

function HighlightedText({ value, query }: { value: string; query: string }) {
  return friendSearchHighlight(value, query).map((part, index) => part.match
    ? <mark key={index} className="bg-transparent font-semibold text-foreground">{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

export function ProfileIdentity({ profile, detail, query, matchedOn, interactive = true }: {
  profile: FriendProfile
  interactive?: boolean
  detail?: string
  query?: string
  matchedOn?: FriendSearchResult['matchedOn']
}) {
  const openProfile = useContext(FriendProfileContext)
  const identity = (
    <div className="flex min-w-0 items-center gap-3">
      <ProfileAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} className="size-10" fallbackClassName="text-xs" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{query && matchedOn === 'displayName' ? <HighlightedText value={profile.displayName} query={query} /> : profile.displayName}</div>
        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {profile.username && <span className="truncate">@{query && matchedOn === 'username' ? <HighlightedText value={profile.username} query={query} /> : profile.username}</span>}
          {detail && <><span aria-hidden="true">·</span><span className="shrink-0">{detail}</span></>}
        </div>
      </div>
    </div>
  )
  return openProfile && interactive
    ? <button type="button" className="block w-full min-w-0 rounded-md text-left hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openProfile(profile)} aria-label={uit`View ${profile.displayName}'s profile`}>{identity}</button>
    : identity
}
