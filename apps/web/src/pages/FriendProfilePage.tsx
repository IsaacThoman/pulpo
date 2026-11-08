import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { ArrowLeft, Check, UserRoundPlus, UsersRound, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ProfileIdentity } from '@/components/FriendIdentity'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { queryClient } from '@/lib/query-client'
import { ui } from '@/i18n/ui'

export function FriendProfilePage() {
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const normalizedUsername = username.trim().toLowerCase()
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState('')
  const profileQuery = useQuery({
    queryKey: ['friend-profile', normalizedUsername],
    queryFn: () => apiRequest<FriendProfileDetail>(`/api/profiles/${encodeURIComponent(normalizedUsername)}`),
    enabled: Boolean(normalizedUsername),
  })

  useEffect(() => {
    const canonicalUsername = profileQuery.data?.profile.username
    if (canonicalUsername && canonicalUsername !== username) navigate(`/${canonicalUsername}`, { replace: true })
  }, [navigate, profileQuery.data?.profile.username, username])

  const updateRelationship = async () => {
    const detail = profileQuery.data
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
    if (detail.relationship === 'self') return <span className="text-sm text-muted-foreground">{ui('This is you')}</span>
    if (detail.relationship === 'friends') return <span className="inline-flex items-center gap-1.5 text-sm text-emerald-500"><Check className="size-4" aria-hidden />{ui('Friends')}</span>
    if (detail.relationship === 'incoming') return <Button size="sm" disabled={actionPending} onClick={() => void updateRelationship()}><Check />{actionPending ? ui('Accepting…') : ui('Accept request')}</Button>
    if (detail.relationship === 'outgoing') return <Button size="sm" variant="outline" disabled={actionPending} onClick={() => void updateRelationship()}><X />{actionPending ? ui('Canceling…') : ui('Cancel request')}</Button>
    return <Button size="sm" disabled={actionPending} onClick={() => void updateRelationship()}><UserRoundPlus />{actionPending ? ui('Sending…') : ui('Add friend')}</Button>
  }

  return <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
    <Button asChild size="sm" variant="ghost" className="-ml-2 text-muted-foreground">
      <Link to="/friends"><ArrowLeft />{ui('Back to friends')}</Link>
    </Button>

    {profileQuery.isLoading && <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">{ui('Loading profile…')}</div>}
    {profileQuery.error && <div className="rounded-xl border py-12 text-center">
      <p className="text-sm text-muted-foreground">{profileQuery.error.message}</p>
      <Button className="mt-3" size="sm" variant="outline" onClick={() => void profileQuery.refetch()}>{ui('Try again')}</Button>
    </div>}

    {profileQuery.data && <>
      <section className="rounded-xl border px-6 py-8 text-center">
        <ProfileAvatar
          name={profileQuery.data.profile.displayName}
          avatarUrl={profileQuery.data.profile.avatarUrl}
          className="mx-auto size-24"
          fallbackClassName="text-2xl"
        />
        <h2 className="mt-4 text-xl font-semibold">{profileQuery.data.profile.displayName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">@{profileQuery.data.profile.username}</p>
        {profileQuery.data.relationship === 'friends' && profileQuery.data.friendsSince &&
          <p className="mt-3 text-xs text-muted-foreground">{ui('Friends since')} {formatDate(Date.parse(profileQuery.data.friendsSince))}</p>}
        <div className="mt-4 flex justify-center">{relationshipAction(profileQuery.data)}</div>
        {actionError && <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p>}
      </section>

      {profileQuery.data.relationship !== 'self' && <section className="overflow-hidden rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">{ui('Mutual friends')}</h2>
          <span className="text-xs text-muted-foreground">{profileQuery.data.mutualFriends.length}</span>
        </div>
        {profileQuery.data.mutualFriends.length > 0
          ? <div className="divide-y">{profileQuery.data.mutualFriends.map((friend) => <div key={friend.id} className="px-4 py-3">
            <ProfileIdentity profile={friend} href={`/${friend.username}`} />
          </div>)}</div>
          : <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            <UsersRound className="mx-auto mb-2 size-5" aria-hidden />
            {ui('No mutual friends yet.')}
          </div>}
      </section>}
    </>}
  </div>
}
