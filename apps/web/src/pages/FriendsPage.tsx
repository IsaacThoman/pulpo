import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, FriendsList } from '@pulpo/contracts'
import { BarChart3, ChevronDown, ChevronRight, MoreHorizontal, Search, UserRoundPlus, UsersRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/lib/api'
import { friendRequestAge } from '@/lib/friends'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ProfileAvatar } from '@/components/ProfileAvatar'

interface SearchResult {
  profile: FriendProfile
  relationship: 'self' | 'none' | 'incoming' | 'outgoing' | 'friends'
  requestId: string | null
}

function ProfileIdentity({ profile, detail }: { profile: FriendProfile; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProfileAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} className="size-10" fallbackClassName="text-xs" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{profile.displayName}</div>
        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {profile.username && <span className="truncate">@{profile.username}</span>}
          {detail && <><span aria-hidden="true">·</span><span className="shrink-0">{detail}</span></>}
        </div>
      </div>
    </div>
  )
}

function Section({ title, count, empty, children }: { title: string; count: number; empty?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {count ? <div className="divide-y">{children}</div> : empty ? <div className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</div> : null}
    </section>
  )
}

function CollapsibleSection({ title, count, open, onToggle, children }: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border">
      <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent/50" onClick={onToggle} aria-expanded={open}>
        <span className="flex items-center gap-2">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{title}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </button>
      {open && <div className="divide-y border-t">{children}</div>}
    </section>
  )
}

function ConnectionRow({ connection, detail, actions }: { connection: FriendConnection; detail?: string; actions: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-4 py-3"><ProfileIdentity profile={connection.profile} detail={detail} /><div className="flex shrink-0 items-center gap-2">{actions}</div></div>
}

export function FriendsPage() {
  const userId = useAuth((state) => state.user?.id)
  const navigate = useNavigate()
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchMessage, setSearchMessage] = useState('')
  const [actionIds, setActionIds] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [outgoingOpen, setOutgoingOpen] = useState(false)
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

  const act = async (key: string, operation: () => Promise<unknown>, message: string, onSuccess?: () => void) => {
    setActionIds((current) => new Set(current).add(key))
    setActionError('')
    setActionMessage('')
    try {
      await operation()
      onSuccess?.()
      setActionMessage(message)
      await refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update friends')
    } finally {
      setActionIds((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const search = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = username.trim().replace(/^@/, '').toLowerCase()
    if (!value) return
    setUsername(value)
    setSearching(true)
    setSearchMessage('')
    setSearchResult(null)
    setActionMessage('')
    try {
      setSearchResult(await apiRequest<SearchResult>(`/api/friends/search?username=${encodeURIComponent(value)}`))
    } catch {
      setSearchMessage(`No account found for @${value}. Check the username and try again.`)
    } finally {
      setSearching(false)
    }
  }

  const block = (profile: FriendProfile) => {
    if (!confirm(`Block ${profile.displayName}? Any friendship or pending request will be removed.`)) return
    void act(`block:${profile.id}`, () => apiRequest('/api/friends/blocks', { method: 'POST', body: { userId: profile.id } }), `${profile.displayName} was blocked.`, () => {
      if (searchResult?.profile.id === profile.id) setSearchResult(null)
    })
  }

  const data = listQuery.data
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-5"><h1 className="text-sm font-semibold">Friends</h1></header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
          <div>
            <h2 className="text-lg font-medium">Find your friends</h2>
            <p className="mt-1 text-sm text-muted-foreground">Search by exact username. Usage is shared after they accept.</p>
          </div>
          <form className="flex gap-2" onSubmit={search}>
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input ref={usernameInputRef} value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, '').replace(/\s/g, '').toLowerCase())} className="pl-7" placeholder="username" maxLength={30} aria-label="Username" />
            </div>
            <Button type="submit" disabled={searching || !username.trim()}><Search />{searching ? 'Searching…' : 'Search'}</Button>
          </form>
          {searchMessage && <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">{searchMessage}</div>}
          {searchResult && <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <ProfileIdentity profile={searchResult.profile} />
            {searchResult.relationship === 'none' && <Button size="sm" disabled={actionIds.has(`request:${searchResult.profile.id}`)} onClick={() => void act(
              `request:${searchResult.profile.id}`,
              () => apiRequest('/api/friends/requests', { method: 'POST', body: { userId: searchResult.profile.id } }),
              `Friend request sent to ${searchResult.profile.displayName}.`,
              () => setSearchResult((result) => result ? { ...result, relationship: 'outgoing' } : result),
            )}><UserRoundPlus />{actionIds.has(`request:${searchResult.profile.id}`) ? 'Sending…' : 'Add friend'}</Button>}
            {searchResult.relationship === 'incoming' && <Button size="sm" disabled={actionIds.has(`accept:${searchResult.requestId}`)} onClick={() => void act(`accept:${searchResult.requestId}`, () => apiRequest(`/api/friends/requests/${searchResult.requestId}/accept`, { method: 'POST' }), `${searchResult.profile.displayName} is now your friend.`, () => setSearchResult((result) => result ? { ...result, relationship: 'friends' } : result))}>{actionIds.has(`accept:${searchResult.requestId}`) ? 'Accepting…' : 'Accept'}</Button>}
            {searchResult.relationship === 'outgoing' && <span className="text-sm text-muted-foreground">Request sent</span>}
            {searchResult.relationship === 'friends' && <Button size="sm" variant="outline" onClick={() => navigate('/usage/friends')}><BarChart3 />View usage</Button>}
            {searchResult.relationship === 'self' && <span className="text-sm text-muted-foreground">This is you</span>}
          </div>}
          {(actionError || actionMessage) && <p role="status" className={actionError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{actionError || actionMessage}</p>}

          {listQuery.isLoading ? <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">Loading friends…</div>
            : listQuery.error ? <div className="rounded-xl border py-12 text-center"><p className="text-sm text-muted-foreground">{listQuery.error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void listQuery.refetch()}>Try again</Button></div>
              : data && <div className="space-y-5">
                {data.incoming.length > 0 && <Section title="Friend requests" count={data.incoming.length}>
                  {data.incoming.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} detail={`Requested ${friendRequestAge(connection.requestedAt)}`} actions={<>
                    <Button size="sm" disabled={actionIds.has(`accept:${connection.requestId}`)} onClick={() => void act(`accept:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}/accept`, { method: 'POST' }), `${connection.profile.displayName} is now your friend.`)}>{actionIds.has(`accept:${connection.requestId}`) ? 'Accepting…' : 'Accept'}</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`More options for ${connection.profile.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void act(`decline:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}`, { method: 'DELETE' }), `Request from ${connection.profile.displayName} declined.`)}>Decline request</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => block(connection.profile)}>Block</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>} />)}
                </Section>}

                {data.friends.length > 0 ? <Section title="Friends" count={data.friends.length}>
                  {data.friends.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} actions={<>
                    <Button size="sm" variant="ghost" onClick={() => navigate('/usage/friends')}><BarChart3 />View usage</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`More options for ${connection.profile.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { if (confirm(`Remove ${connection.profile.displayName} from your friends?`)) void act(`unfriend:${connection.profile.id}`, () => apiRequest(`/api/friends/${connection.profile.id}`, { method: 'DELETE' }), `${connection.profile.displayName} was removed from your friends.`) }}>Remove friend</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => block(connection.profile)}>Block</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>} />)}
                </Section> : <div className="rounded-xl border px-6 py-10 text-center">
                  <UsersRound className="mx-auto size-6 text-muted-foreground" />
                  <h2 className="mt-3 text-sm font-medium">Add friends to compare usage</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Find someone by their exact Pulpo username.</p>
                  <Button className="mt-4" size="sm" variant="outline" onClick={() => usernameInputRef.current?.focus()}><UserRoundPlus />Find friends</Button>
                </div>}

                {data.outgoing.length > 0 && <CollapsibleSection title="Sent requests" count={data.outgoing.length} open={outgoingOpen} onToggle={() => setOutgoingOpen((value) => !value)}>
                  {data.outgoing.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} detail={`Sent ${friendRequestAge(connection.requestedAt)}`} actions={<Button size="sm" variant="ghost" disabled={actionIds.has(`cancel:${connection.requestId}`)} onClick={() => void act(`cancel:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}`, { method: 'DELETE' }), `Request to ${connection.profile.displayName} canceled.`)}>{actionIds.has(`cancel:${connection.requestId}`) ? 'Canceling…' : 'Cancel'}</Button>} />)}
                </CollapsibleSection>}

                {data.blocked.length > 0 && <CollapsibleSection title="Blocked users" count={data.blocked.length} open={blockedOpen} onToggle={() => setBlockedOpen((value) => !value)}>
                  {data.blocked.map((profile) => <div key={profile.id} className="flex items-center justify-between gap-3 px-4 py-3"><ProfileIdentity profile={profile} /><Button size="sm" variant="outline" disabled={actionIds.has(`unblock:${profile.id}`)} onClick={() => void act(`unblock:${profile.id}`, () => apiRequest(`/api/friends/blocks/${profile.id}`, { method: 'DELETE' }), `${profile.displayName} was unblocked.`)}>{actionIds.has(`unblock:${profile.id}`) ? 'Unblocking…' : 'Unblock'}</Button></div>)}
                </CollapsibleSection>}
              </div>}
        </div>
      </div>
    </div>
  )
}
