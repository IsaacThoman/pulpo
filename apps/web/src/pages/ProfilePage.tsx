import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { ArrowLeft, ArrowRight, Check, Globe, Lock, UserRoundPlus, UsersRound, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ProfileIdentity } from '@/components/FriendIdentity'
import { ProfileHeaderRow, ProfileHeading } from '@/components/ProfileHeader'
import { PersonalUsage } from '@/components/usage/PersonalUsage'
import { ProfileUsage, UsagePrivateNotice } from '@/components/usage/ProfileUsage'
import { useSettingsDialog } from '@/components/settings/settings-dialog'
import { Button } from '@/components/ui/button'
import { ApiError, apiRequest } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { queryClient } from '@/lib/query-client'
import { profileUsageQueryKey } from '@/lib/usage-query'
import { resolvedUsageVisibility, usageVisibilitySummary } from '@/lib/usage-visibility'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

const VISIBILITY_ICONS = { pool: Lock, friends: UsersRound, public: Globe }

/** The signed-in user's identity, with who can see their usage and a shortcut to change it. */
function OwnProfileHeading() {
  const user = useAuth((state) => state.user)
  const { openSettings } = useSettingsDialog()
  if (!user) return null
  const visibility = resolvedUsageVisibility(user.usageVisibility)
  const VisibilityIcon = VISIBILITY_ICONS[visibility]
  return (
    <ProfileHeading name={user.name} avatarUrl={user.avatarUrl} username={user.username}>
      <p className="mt-0.5 text-xs text-muted-foreground wrap-anywhere">
        {user.email} {ui("· Joined")} {formatDate(Date.parse(user.createdAt))}
      </p>
      <button
        type="button"
        aria-haspopup="dialog"
        className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => openSettings('profile')}
      >
        <VisibilityIcon className="size-3" aria-hidden />
        {usageVisibilitySummary(visibility)}
      </button>
    </ProfileHeading>
  )
}

/** Profiles live at `/:username`. Your own shows your full usage; others show theirs when they share it. */
export function ProfilePage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const ownUsername = useAuth((state) => state.user?.username)
  const viewerId = useAuth((state) => state.user?.id)
  const normalizedUsername = username.trim().toLowerCase()
  const viewingOwnUsername = Boolean(ownUsername) && normalizedUsername === ownUsername?.toLowerCase()
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
  const usageHidden = profileGone || (detail ? !detail.usageVisible : false)

  useEffect(() => {
    const canonicalUsername = viewingOwnUsername ? ownUsername : detail?.profile.username
    if (canonicalUsername && canonicalUsername !== username) navigate(`/${canonicalUsername}`, { replace: true })
  }, [navigate, detail?.profile.username, ownUsername, username, viewingOwnUsername])

  // Renaming yourself while on your profile follows you to the new handle.
  const previousOwnUsername = useRef(ownUsername)
  useEffect(() => {
    const previous = previousOwnUsername.current
    previousOwnUsername.current = ownUsername
    if (previous && ownUsername && previous !== ownUsername && normalizedUsername === previous) navigate(`/${ownUsername}`, { replace: true })
  }, [navigate, normalizedUsername, ownUsername])

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
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-5">
      {self
        ? <h1 className="shrink-0 text-sm font-semibold">{ui("Profile")}</h1>
        : <Button asChild size="sm" variant="ghost" className="-ml-2 text-muted-foreground">
          <Link to="/friends"><ArrowLeft />{ui('Back to friends')}</Link>
        </Button>}
      {(self || detail?.usageVisible) && <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
        <Link to="/friends/leaderboard">{ui("Compare with friends")}<ArrowRight /></Link>
      </Button>}
    </header>
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
              identity={<ProfileHeading name={detail.profile.displayName} avatarUrl={detail.profile.avatarUrl} username={detail.profile.username}>
                {detail.relationship === 'friends' && detail.friendsSince &&
                  <p className="mt-0.5 text-xs text-muted-foreground">{ui('Friends since')} {formatDate(Date.parse(detail.friendsSince))}</p>}
              </ProfileHeading>}
              aside={<div className="flex flex-col items-start gap-2 sm:items-end">
                {relationshipAction(detail)}
                {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
              </div>}
            />

            {detail.usageVisible
              ? <ProfileUsage username={normalizedUsername} name={detail.profile.displayName} />
              : <UsagePrivateNotice name={detail.profile.displayName} />}

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
