import { Fragment } from 'react'
import type { FriendProfile, FriendSearchResult } from '@pulpo/contracts'
import { UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { friendSearchHighlight } from '@/lib/friend-search'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'

function HighlightedText({ value, query }: { value: string; query: string }) {
  return friendSearchHighlight(value, query).map((part, index) => part.match
    ? <mark key={index} className="bg-transparent font-semibold text-foreground">{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

export function ProfileIdentity({ profile, detail, query, matchedOn, href }: {
  profile: FriendProfile
  detail?: string
  query?: string
  matchedOn?: FriendSearchResult['matchedOn']
  href?: string
}) {
  const content = <>
      <ProfileAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} className="size-10" fallbackClassName="text-xs" />
      <div className="min-w-0">
        <div className={cn('truncate text-sm font-medium', href && 'group-hover/profile:underline')}>{query && matchedOn === 'displayName' ? <HighlightedText value={profile.displayName} query={query} /> : profile.displayName}</div>
        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {profile.username && <span className="truncate">@{query && matchedOn === 'username' ? <HighlightedText value={profile.username} query={query} /> : profile.username}</span>}
          {detail && <><span aria-hidden="true">·</span><span className="shrink-0">{detail}</span></>}
        </div>
      </div>
    </>
  const className = 'group/profile flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return href ? <Link to={href} className={className} aria-label={profile.displayName}>{content}</Link> : <div className={className}>{content}</div>
}

export function MutualFriends({ friends, className }: { friends: FriendProfile[]; className?: string }) {
  if (!friends.length) return null
  return <div className={cn('mt-1 flex min-w-0 items-start gap-1 text-xs text-muted-foreground', className)}>
    <UsersRound className="mt-0.5 size-3 shrink-0" aria-hidden />
    <span className="shrink-0">{friends.length === 1 ? ui('Mutual friend:') : ui('Mutual friends:')}</span>
    <span className="min-w-0">
      {friends.map((friend, index) => <Fragment key={friend.id}>
        {index > 0 && ', '}
        <Link className="underline-offset-2 hover:text-foreground hover:underline" to={`/friends/${friend.id}`}>{friend.displayName}</Link>
      </Fragment>)}
    </span>
  </div>
}
