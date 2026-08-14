import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, FriendsList } from '@pulpo/contracts'
import { ChevronDown, ChevronRight, Search, UserRoundPlus, UsersRound } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProfileAvatar } from '@/components/ProfileAvatar'

interface SearchResult {
  profile: FriendProfile
  relationship: 'self' | 'none' | 'incoming' | 'outgoing' | 'friends'
  requestId: string | null
}

function ProfileIdentity({ profile }: { profile: FriendProfile }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProfileAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} className="size-10" fallbackClassName="text-xs" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{profile.displayName}</div>
        {profile.username && <div className="truncate text-xs text-muted-foreground">@{profile.username}</div>}
      </div>
    </div>
  )
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {count ? <div className="divide-y">{children}</div> : <div className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</div>}
    </section>
  )
}

function ConnectionRow({ connection, actions }: { connection: FriendConnection; actions: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><ProfileIdentity profile={connection.profile} /><div className="flex flex-wrap items-center gap-2">{actions}</div></div>
}

export function FriendsPage() {
  const userId = useAuth((state) => state.user?.id)
  const [username, setUsername] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchMessage, setSearchMessage] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [blockedOpen, setBlockedOpen] = useState(false)
  const listQuery = useQuery({
    queryKey: ['friends', userId],
    queryFn: () => apiRequest<FriendsList>('/api/friends'),
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['friends-pending-count'] })
  }, [])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['friends', userId] }),
      queryClient.invalidateQueries({ queryKey: ['friends-pending-count'] }),
      queryClient.invalidateQueries({ queryKey: ['friends-usage'] }),
    ])
  }

  const act = async (key: string, operation: () => Promise<unknown>) => {
    setActionId(key)
    setActionError('')
    try {
      await operation()
      setSearchResult(null)
      await refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update friends')
    } finally {
      setActionId(null)
    }
  }

  const search = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = username.trim()
    if (!value) return
    setSearching(true)
    setSearchMessage('')
    setSearchResult(null)
    try {
      setSearchResult(await apiRequest<SearchResult>(`/api/friends/search?username=${encodeURIComponent(value)}`))
    } catch (cause) {
      setSearchMessage(cause instanceof Error ? cause.message : 'No user found')
    } finally {
      setSearching(false)
    }
  }

  const block = (profile: FriendProfile) => {
    if (!confirm(`Block ${profile.displayName}? Any friendship or pending request will be removed.`)) return
    void act(`block:${profile.id}`, () => apiRequest('/api/friends/blocks', { method: 'POST', body: { userId: profile.id } }))
  }

  const data = listQuery.data
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-5"><h1 className="text-sm font-semibold">Friends</h1></header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
          <div>
            <h2 className="text-lg font-medium">Find your friends</h2>
            <p className="mt-1 text-sm text-muted-foreground">Search for an exact username. Your usage is shared only after the request is accepted.</p>
          </div>
          <form className="flex gap-2" onSubmit={search}>
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, '').toLowerCase())} className="pl-7" placeholder="username" maxLength={30} aria-label="Username" />
            </div>
            <Button type="submit" disabled={searching || !username.trim()}><Search />{searching ? 'Searching…' : 'Search'}</Button>
          </form>
          {searchMessage && <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">{searchMessage}</div>}
          {searchResult && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <ProfileIdentity profile={searchResult.profile} />
            {searchResult.relationship === 'none' && <Button size="sm" disabled={actionId !== null} onClick={() => void act(`request:${searchResult.profile.id}`, () => apiRequest('/api/friends/requests', { method: 'POST', body: { userId: searchResult.profile.id } }))}><UserRoundPlus />Add friend</Button>}
            {searchResult.relationship === 'incoming' && <Button size="sm" disabled={actionId !== null} onClick={() => void act(`accept:${searchResult.requestId}`, () => apiRequest(`/api/friends/requests/${searchResult.requestId}/accept`, { method: 'POST' }))}>Accept</Button>}
            {searchResult.relationship === 'outgoing' && <span className="text-sm text-muted-foreground">Request sent</span>}
            {searchResult.relationship === 'friends' && <span className="text-sm text-muted-foreground">Already friends</span>}
            {searchResult.relationship === 'self' && <span className="text-sm text-muted-foreground">This is you</span>}
          </div>}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          {listQuery.isLoading ? <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">Loading friends…</div>
            : listQuery.error ? <div className="rounded-xl border py-12 text-center"><p className="text-sm text-muted-foreground">{listQuery.error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void listQuery.refetch()}>Try again</Button></div>
              : data && <div className="space-y-5">
                <Section title="Incoming requests" count={data.incoming.length} empty="No incoming friend requests">
                  {data.incoming.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} actions={<>
                    <Button size="sm" disabled={actionId !== null} onClick={() => void act(`accept:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}/accept`, { method: 'POST' }))}>Accept</Button>
                    <Button size="sm" variant="outline" disabled={actionId !== null} onClick={() => void act(`decline:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}`, { method: 'DELETE' }))}>Decline</Button>
                    <Button size="sm" variant="ghost" disabled={actionId !== null} onClick={() => block(connection.profile)}>Block</Button>
                  </>} />)}
                </Section>
                <Section title="Friends" count={data.friends.length} empty="Add a friend to build your private leaderboard">
                  {data.friends.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} actions={<>
                    <Button size="sm" variant="outline" disabled={actionId !== null} onClick={() => { if (confirm(`Remove ${connection.profile.displayName} from your friends?`)) void act(`unfriend:${connection.profile.id}`, () => apiRequest(`/api/friends/${connection.profile.id}`, { method: 'DELETE' })) }}>Unfriend</Button>
                    <Button size="sm" variant="ghost" disabled={actionId !== null} onClick={() => block(connection.profile)}>Block</Button>
                  </>} />)}
                </Section>
                <Section title="Outgoing requests" count={data.outgoing.length} empty="No pending outgoing requests">
                  {data.outgoing.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} actions={<Button size="sm" variant="outline" disabled={actionId !== null} onClick={() => void act(`cancel:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}`, { method: 'DELETE' }))}>Cancel</Button>} />)}
                </Section>
                <section className="rounded-xl border">
                  <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium" onClick={() => setBlockedOpen((value) => !value)}>
                    <span className="flex items-center gap-2">{blockedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}Blocked users</span>
                    <span className="text-xs text-muted-foreground">{data.blocked.length}</span>
                  </button>
                  {blockedOpen && <div className="divide-y border-t">{data.blocked.length ? data.blocked.map((profile) => <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><ProfileIdentity profile={profile} /><Button size="sm" variant="outline" disabled={actionId !== null} onClick={() => void act(`unblock:${profile.id}`, () => apiRequest(`/api/friends/blocks/${profile.id}`, { method: 'DELETE' }))}>Unblock</Button></div>) : <div className="px-4 py-8 text-center text-sm text-muted-foreground">No blocked users</div>}</div>}
                </section>
              </div>}
          {!listQuery.isLoading && data && !data.friends.length && !data.incoming.length && !data.outgoing.length && <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><UsersRound className="size-4" />Friend requests stay private to this Pulpo instance.</div>}
        </div>
      </div>
    </div>
  )
}
