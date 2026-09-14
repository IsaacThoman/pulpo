import type { FriendProfile, FriendSearchResult } from '@pulpo/contracts'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { friendSearchHighlight } from '@/lib/friend-search'

function HighlightedText({ value, query }: { value: string; query: string }) {
  return friendSearchHighlight(value, query).map((part, index) => part.match
    ? <mark key={index} className="bg-transparent font-semibold text-foreground">{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

export function ProfileIdentity({ profile, detail, query, matchedOn }: {
  profile: FriendProfile
  detail?: string
  query?: string
  matchedOn?: FriendSearchResult['matchedOn']
}) {
  return (
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
}
