import { useQuery } from '@tanstack/react-query'
import type { FriendProfile, FriendProfileView } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { ProfileIdentity } from '@/components/FriendIdentity'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ui, uit } from '@/i18n/ui'

export function MutualFriends({ profiles }: { profiles: FriendProfile[] }) {
  return <div className="mt-2 text-xs text-muted-foreground">
    {profiles.length ? <details>
      <summary className="cursor-pointer hover:text-foreground">{profiles.length === 1 ? uit`${profiles.length} mutual friend` : uit`${profiles.length} mutual friends`}</summary>
      <div className="mt-2 space-y-2">{profiles.map((profile) => <ProfileIdentity key={profile.id} profile={profile} />)}</div>
    </details> : ui('No mutual friends')}
  </div>
}

export function FriendProfileDialog({ userId, target, onClose, busy, onRequest, onAccept }: {
  userId: string
  target: FriendProfile | null
  onClose: () => void
  busy: boolean
  onRequest: (profile: FriendProfile) => void
  onAccept: (profile: FriendProfile, requestId: string) => void
}) {
  const query = useQuery({
    queryKey: ['friends', userId, 'profile', target?.id],
    queryFn: () => apiRequest<FriendProfileView>(`/api/friends/profiles/${target!.id}`),
    enabled: Boolean(target),
    staleTime: 0,
  })
  const data = query.data
  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{ui('Profile')}</DialogTitle>
        <DialogDescription>{ui('See who you know in common.')}</DialogDescription>
      </DialogHeader>
      {query.isPending ? <p className="text-sm text-muted-foreground">{ui('Loading profile…')}</p>
        : query.isError ? <div><p role="alert" className="text-sm text-muted-foreground">{query.error.message}</p><Button variant="outline" className="mt-3" onClick={() => void query.refetch()}>{ui('Try again')}</Button></div>
          : data && <>
            <div className="flex items-center gap-4">
              <ProfileAvatar name={data.profile.displayName} avatarUrl={data.profile.avatarUrl} className="size-16" />
              <div className="min-w-0"><h2 className="break-words text-lg font-medium">{data.profile.displayName}</h2><p className="text-sm text-muted-foreground">@{data.profile.username}</p></div>
            </div>
            {data.relationship === 'none' && <Button disabled={busy} onClick={() => onRequest(data.profile)}>{ui('Add friend')}</Button>}
            {data.relationship === 'incoming' && data.requestId && <Button disabled={busy} onClick={() => onAccept(data.profile, data.requestId!)}>{ui('Accept request')}</Button>}
            {(data.relationship === 'friends' || data.relationship === 'outgoing') && <p className="text-sm text-muted-foreground">{ui(data.relationship === 'friends' ? 'Friends' : 'Request sent')}</p>}
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">{ui('Mutual friends')} · {data.mutualFriends.length}</h3>
              {data.mutualFriends.length ? data.mutualFriends.map((profile) => <ProfileIdentity key={profile.id} profile={profile} />)
                : <p className="text-sm text-muted-foreground">{ui('No mutual friends')}</p>}
            </section>
          </>}
    </DialogContent>
  </Dialog>
}
