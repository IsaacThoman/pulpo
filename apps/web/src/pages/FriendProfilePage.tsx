import { useQuery } from '@tanstack/react-query'
import type { FriendProfileDetail } from '@pulpo/contracts'
import { ArrowLeft, UsersRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ProfileIdentity } from '@/components/FriendIdentity'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { ui } from '@/i18n/ui'

export function FriendProfilePage() {
  const { userId = '' } = useParams()
  const profileQuery = useQuery({
    queryKey: ['friend-profile', userId],
    queryFn: () => apiRequest<FriendProfileDetail>(`/api/friends/${userId}/profile`),
    enabled: Boolean(userId),
  })

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
        <p className="mt-3 text-xs text-muted-foreground">{ui('Friends since')} {formatDate(Date.parse(profileQuery.data.friendsSince))}</p>
      </section>

      <section className="overflow-hidden rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">{ui('Mutual friends')}</h2>
          <span className="text-xs text-muted-foreground">{profileQuery.data.mutualFriends.length}</span>
        </div>
        {profileQuery.data.mutualFriends.length > 0
          ? <div className="divide-y">{profileQuery.data.mutualFriends.map((friend) => <div key={friend.id} className="px-4 py-3">
            <ProfileIdentity profile={friend} href={`/friends/${friend.id}`} />
          </div>)}</div>
          : <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            <UsersRound className="mx-auto mb-2 size-5" aria-hidden />
            {ui('No mutual friends yet.')}
          </div>}
      </section>
    </>}
  </div>
}
