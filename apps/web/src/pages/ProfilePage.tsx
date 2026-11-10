import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendProfileDetail, UsageVisibility } from '@pulpo/contracts'
import { Check, Globe, Lock, UserRoundPlus, UsersRound, X } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ProfileIdentity } from '@/components/FriendIdentity'
import { ProfileHeaderRow, ProfileHeading } from '@/components/ProfileHeader'
import { PersonalUsage } from '@/components/usage/PersonalUsage'
import { ProfileUsage } from '@/components/usage/ProfileUsage'
import { useSettingsDialog } from '@/components/settings/settings-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ApiError, apiRequest } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { queryClient } from '@/lib/query-client'
import { profileUsageQueryKey } from '@/lib/usage-query'
import { profileUsageVisibilitySummary, resolvedUsageVisibility, usageVisibilitySummary } from '@/lib/usage-visibility'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'
import { PeopleHeader, PersonHeader } from './PeopleLayout'

const VISIBILITY_ICONS = { pool: Lock, friends: UsersRound, public: Globe }
const VISIBILITY_ICON_CLASS = 'inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Who can see a profile's usage, as an icon beside the handle that names the level on hover. */
function UsageVisibilityIcon({ visibility, label, onClick }: { visibility: UsageVisibility; label: string; onClick?: () => void }) {
  const Icon = VISIBILITY_ICONS[visibility]
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {onClick
            ? <button
                type="button"
                aria-haspopup="dialog"
                aria-label={label}
                className={`${VISIBILITY_ICON_CLASS} cursor-pointer transition-colors hover:bg-accent hover:text-foreground`}
                onClick={onClick}
              >
                <Icon className="size-3" aria-hidden />
              </button>
            : <span role="img" tabIndex={0} aria-label={label} className={`${VISIBILITY_ICON_CLASS} cursor-default`}>
                <Icon className="size-3" aria-hidden />
              </span>}
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** The signed-in user's identity; the visibility icon opens Profile settings to change it. */
function OwnProfileHeading() {
  const user = useAuth((state) => state.user)
  const { openSettings } = useSettingsDialog()
  if (!user) return null
  const visibility = resolvedUsageVisibility(user.usageVisibility)
  return (
    <ProfileHeading
      name={user.name}
      avatarUrl={user.avatarUrl}
      username={user.username}
      handleAccessory={<UsageVisibilityIcon visibility={visibility} label={usageVisibilitySummary(visibility)} onClick={() => openSettings('profile')} />}
    >
      <p className="mt-0.5 text-xs text-muted-foreground wrap-anywhere">
        {user.email} {ui("· Joined")} {formatDate(Date.parse(user.createdAt))}
      </p>
    </ProfileHeading>
  )
}

/** Profiles live at `/:username`. Your own shows your full usage; others show theirs when they share it. */
export function ProfilePage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { state: locationState } = useLocation()
  const ownUsername = useAuth((state) => state.user?.username)
  const viewerId = useAuth((state) => state.user?.id)
  const normalizedUsername = username.trim().toLowerCase()
  // Renaming yourself on your profile keeps the old handle yours until the canonical redirect
  // below has moved the URL off it, so the page never flashes as someone else's profile.
  const [lastOwnUsername, setLastOwnUsername] = useState(ownUsername)
  const [renamedFrom, setRenamedFrom] = useState<string>()
  if (lastOwnUsername !== ownUsername) {
    setLastOwnUsername(ownUsername)
    if (lastOwnUsername && normalizedUsername === lastOwnUsername.toLowerCase()) setRenamedFrom(normalizedUsername)
  }
  if (renamedFrom && normalizedUsername !== renamedFrom) setRenamedFrom(undefined)
  const viewingOwnUsername = Boolean(ownUsername)
    && (normalizedUsername === ownUsername?.toLowerCase() || normalizedUsername === renamedFrom)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState('')
  const profileQuery = useQuery({
    queryKey: ['friend-profile', normalizedUsername],
    queryFn: () => apiRequest<FriendProfileDetail>(`/api/profiles/${encodeURIComponent(normalizedUsername)}`),
    enabled: Boolean(normalizedUsername) && !viewingOwnUsername,
  })

  // A 404 refetch means the profile was deleted or blocked us; never keep showing the cached copy.
  const profileGone = profileQuery.error instanceof ApiError && profileQuery.error.status === 404
  const detail = viewingOwnUsername || profileGone ? undefined : profileQuery.data
  const self = viewingOwnUsername || detail?.relationship === 'self'
  // A profile cached before usage visibility existed has no flag. Show neither the usage
  // nor the not-shared notice until the fresh profile says which applies.
  const usageVisible = detail?.usageVisible
  const usageHidden = profileGone || usageVisible === false

  // The canonical URL keeps the history state that says which People tab the profile was opened from.
  useEffect(() => {
    const canonicalUsername = viewingOwnUsername ? ownUsername : detail?.profile.username
    if (canonicalUsername && canonicalUsername !== username) navigate(`/${canonicalUsername}`, { replace: true, state: locationState })
  }, [navigate, detail?.profile.username, locationState, ownUsername, username, viewingOwnUsername])

  // Usage someone stopped sharing must not linger in the cache for a later visit.
  useEffect(() => {
    if (usageHidden) queryClient.removeQueries({ queryKey: profileUsageQueryKey(viewerId, normalizedUsername) })
  }, [normalizedUsername, usageHidden, viewerId])

  const updateRelationship = async () => {
    if (!detail || actionPending) return
    setActionPending(true)
    setActionError('')
    try {
      if (detail.relationship === 'none') {
        await apiRequest('/api/friends/requests', { method: 'POST', body: { userId: detail.profile.id } })
      } else if (detail.relationship === 'incoming' && detail.requestId) {
        await apiRequest(`/api/friends/requests/${detail.requestId}/accept`, { method: 'POST' })
      } else if (detail.relationship === 'outgoing' && detail.requestId) {
        await apiRequest(`/api/friends/requests/${detail.requestId}`, { method: 'DELETE' })
      } else {
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['friend-profile', normalizedUsername] }),
        queryClient.invalidateQueries({ queryKey: ['friends'] }),
        queryClient.invalidateQueries({ queryKey: ['friends-pending-count'] }),
        queryClient.invalidateQueries({ queryKey: ['friends-usage'] }),
      ])
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : ui('Could not update friends'))
    } finally {
      setActionPending(false)
    }
  }

  const relationshipAction = (detail: FriendProfileDetail) => {
    if (detail.relationship === 'self') return null
    if (detail.relationship === 'friends') return <span className="inline-flex items-center gap-1.5 text-sm text-emerald-500"><Check className="size-4" aria-hidden />{ui('Friends')}</span>
    if (detail.relationship === 'incoming') return <Button size="sm" disabled={actionPending} onClick={() => void updateRelationship()}><Check />{actionPending ? ui('Accepting…') : ui('Accept request')}</Button>
    if (detail.relationship === 'outgoing') return <Button size="sm" variant="outline" disabled={actionPending} onClick={() => void updateRelationship()}><X />{actionPending ? ui('Canceling…') : ui('Cancel request')}</Button>
    return <Button size="sm" disabled={actionPending} onClick={() => void updateRelationship()}><UserRoundPlus />{actionPending ? ui('Sending…') : ui('Add friend')}</Button>
  }

  return <div className="flex h-full flex-col">
    {/* Your profile is People's Profile tab; anyone else's drills down from the tab you opened it from.
        The friends leaderboard lists only friends, so it can't compare a non-friend whose usage is public or shared through a Pool. */}
    {self ? <PeopleHeader /> : <PersonHeader
      name={detail?.profile.displayName ?? `@${normalizedUsername}`}
      compare={usageVisible === true && detail?.relationship === 'friends'}
    />}
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-6">
        {self ? <PersonalUsage identity={<OwnProfileHeading />} /> : <div className="space-y-6">
          {profileQuery.isLoading && <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">{ui('Loading profile…')}</div>}
          {profileQuery.error && <div className="rounded-xl border py-12 text-center">
            <p className="text-sm text-muted-foreground">{profileQuery.error.message}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void profileQuery.refetch()}>{ui('Try again')}</Button>
          </div>}

          {detail && <>
            <ProfileHeaderRow
              identity={<ProfileHeading
                name={detail.profile.displayName}
                avatarUrl={detail.profile.avatarUrl}
                username={detail.profile.username}
                // Profiles cached before these fields existed lack them until the refetch lands.
                handleAccessory={detail.usageVisibility && <UsageVisibilityIcon visibility={detail.usageVisibility} label={profileUsageVisibilitySummary(detail.usageVisibility)} />}
              >
                {detail.joinedAt && <p className="mt-0.5 text-xs text-muted-foreground">{ui('Joined')} {formatDate(Date.parse(detail.joinedAt))}</p>}
              </ProfileHeading>}
              aside={<div className="flex flex-col items-start gap-2 sm:items-end">
                {relationshipAction(detail)}
                {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
              </div>}
            />

            {usageVisible === true && <ProfileUsage username={normalizedUsername} />}

            <section className="overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-medium">{ui('Mutual friends')}</h2>
                <span className="text-xs text-muted-foreground">{detail.mutualFriends.length}</span>
              </div>
              {detail.mutualFriends.length > 0
                ? <div className="divide-y">{detail.mutualFriends.map((friend) => <div key={friend.id} className="px-4 py-3">
                  <ProfileIdentity profile={friend} href={`/${friend.username}`} />
                </div>)}</div>
                : <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <UsersRound className="mx-auto mb-2 size-5" aria-hidden />
                  {ui('No mutual friends yet.')}
                </div>}
            </section>
          </>}
        </div>}
      </div>
    </div>
  </div>
}
