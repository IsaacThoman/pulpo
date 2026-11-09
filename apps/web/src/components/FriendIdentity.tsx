import type { ReactNode } from 'react'
import type { FriendProfile, FriendSearchResult } from '@pulpo/contracts'
import { Link } from 'react-router-dom'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { friendSearchHighlight } from '@/lib/friend-search'
import { useProfileLinkState } from '@/lib/profile'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'

function HighlightedText({ value, query }: { value: string; query: string }) {
  return friendSearchHighlight(value, query).map((part, index) => part.match
    ? <mark key={index} className="bg-transparent font-semibold text-foreground">{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

function ProfileHoverCard({ profile, children }: { profile: FriendProfile; children: ReactNode }) {
  const linkState = useProfileLinkState()
  return <TooltipProvider delayDuration={1_000}>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        hideArrow
        className="w-64 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
      >
        <Link
          to={`/${profile.username}`}
          state={linkState}
          className="group/hover-profile flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={profile.displayName}
        >
          <ProfileAvatar
            name={profile.displayName}
            avatarUrl={profile.avatarUrl}
            shape="circle"
            className="size-12"
            fallbackClassName="text-sm"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium group-hover/hover-profile:underline">{profile.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">@{profile.username}</p>
          </div>
        </Link>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
}

export function ProfileIdentity({ profile, detail, query, matchedOn, href }: {
  profile: FriendProfile
  detail?: string
  query?: string
  matchedOn?: FriendSearchResult['matchedOn']
  href?: string
}) {
  const linkState = useProfileLinkState()
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
  const identity = href
    ? <Link to={href} state={linkState} className={className} aria-label={profile.displayName}>{content}</Link>
    : <div className={className}>{content}</div>
  return <ProfileHoverCard profile={profile}>{identity}</ProfileHoverCard>
}

/** Rows also hold identity and actions, so only a few avatars render; the count covers the rest. */
const MUTUAL_AVATAR_LIMIT = 3

export function MutualFriends({ friends, className }: { friends: FriendProfile[]; className?: string }) {
  const linkState = useProfileLinkState()
  if (!friends.length) return null
  const label = `${friends.length === 1 ? ui('Mutual friend:') : ui('Mutual friends:')} ${friends.map((friend) => friend.displayName).join(', ')}`
  return <div className={cn('flex shrink-0 items-center gap-2', className)} role="group" aria-label={label}>
    <div className="flex -space-x-2">
      {friends.slice(0, MUTUAL_AVATAR_LIMIT).map((friend) => <ProfileHoverCard key={friend.id} profile={friend}>
        <Link
          to={`/${friend.username}`}
          state={linkState}
          className="relative rounded-full focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={friend.displayName}
        >
          <ProfileAvatar
            name={friend.displayName}
            avatarUrl={friend.avatarUrl}
            shape="circle"
            className="size-6 ring-2 ring-background"
            fallbackClassName="text-[9px]"
          />
        </Link>
      </ProfileHoverCard>)}
    </div>
    <span className="text-xs text-muted-foreground" aria-hidden>
      {friends.length === 1 ? ui('1 mutual') : uit`${friends.length} mutuals`}
    </span>
  </div>
}
