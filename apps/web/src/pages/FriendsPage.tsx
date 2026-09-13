import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, FriendSearchResponse, FriendSearchResult, FriendsList, PoolSummary } from '@pulpo/contracts'
import { Check, ChevronDown, ChevronRight, Copy, LoaderCircle, MoreHorizontal, Search, UserRoundPlus, UsersRound } from 'lucide-react'
import { ApiError, apiRequest, isNetworkError } from '@/lib/api'
import { nextFriendSearchIndex, normalizedFriendSearchQuery, shouldSearchFriends } from '@/lib/friend-search'
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
import { ProfileIdentity } from '@/components/FriendIdentity'
import { PoolSection } from '@/components/PoolSection'
import { InviteCodesCard } from '@/components/InviteCodesCard'
import { ui, uit } from '@/i18n/ui'

export function FriendsHandle({ username }: { username: string }) {
  const [copied, setCopied] = useState(false)
  const copyHandle = async () => {
    await navigator.clipboard.writeText(username)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>{ui("Your handle is")}</span>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1"
        onClick={() => void copyHandle()}
        aria-label={uit`Copy @${username}`}
        title={copied ? ui("Copied") : ui("Copy handle")}
      >
        <span>@{username}</span>
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? ui("Handle copied") : ''}</span>
    </p>
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
  const user = useAuth((state) => state.user)
  const userId = user?.id
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const [searchDismissed, setSearchDismissed] = useState(false)
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  const [actionIds, setActionIds] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [outgoingOpen, setOutgoingOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<FriendProfile | null>(null)
  const inviteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const activeActions = useRef(new Set<string>())
  const poolQuery = useQuery({
    queryKey: ['pool', userId],
    queryFn: () => apiRequest<PoolSummary>('/api/pools/me'),
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
  const searchQuery = useMemo(() => normalizedFriendSearchQuery(searchInput), [searchInput])
  const searchReady = shouldSearchFriends(searchInput)
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

  useEffect(() => {
    if (!searchReady) {
      setSearchResults([])
      setSearchState('idle')
      setSearchError('')
      setActiveSearchIndex(-1)
      return
    }

    const controller = new AbortController()
    setSearchResults([])
    setActiveSearchIndex(-1)
    setSearchState('loading')
    setSearchError('')
    const timer = window.setTimeout(() => {
      void apiRequest<FriendSearchResponse>(`/api/friends/search?q=${encodeURIComponent(searchQuery)}`, { signal: controller.signal })
        .then((response) => {
          setSearchResults(response.results)
          setActiveSearchIndex(response.results.length ? 0 : -1)
          setSearchState('success')
        })
        .catch((cause) => {
          if (controller.signal.aborted) return
          setSearchResults([])
          setActiveSearchIndex(-1)
          setSearchState('error')
          setSearchError(cause instanceof ApiError && cause.status === 429
            ? 'Too many searches. Wait a moment and try again.'
            : isNetworkError(cause)
              ? 'You appear to be offline. Reconnect to search for friends.'
              : 'Could not search for friends. Try again.')
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery, searchReady])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['friends', userId] }),
      queryClient.invalidateQueries({ queryKey: ['friends-pending-count'] }),
      queryClient.invalidateQueries({ queryKey: ['friends-usage'] }),
      ...['pool', 'pool-pending-count', 'pool-usage', 'usage', 'billing'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, userId] })),
    ])
  }

  const act = async <T,>(key: string, operation: () => Promise<T>, message: string, onSuccess?: (result: T) => void) => {
    if (activeActions.current.has(key)) return
    activeActions.current.add(key)
    setActionIds((current) => new Set(current).add(key))
    setActionError('')
    setActionMessage('')
    try {
      const result = await operation()
      onSuccess?.(result)
      setActionMessage(message)
      await refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update friends')
    } finally {
      activeActions.current.delete(key)
      setActionIds((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const updateSearchResult = (profileId: string, update: Partial<FriendSearchResult>) => {
    setSearchResults((results) => results.map((result) => result.profile.id === profileId ? { ...result, ...update } : result))
  }

  const sendSearchRequest = (result: FriendSearchResult) => {
    void act(
      `request:${result.profile.id}`,
      () => apiRequest<{ requestId: string; status: 'pending' | 'accepted' }>('/api/friends/requests', { method: 'POST', body: { userId: result.profile.id } }),
      '',
      (response) => updateSearchResult(result.profile.id, {
        relationship: response.status === 'accepted' ? 'friends' : 'outgoing',
        requestId: response.requestId,
      }),
    )
  }

  const acceptSearchRequest = (result: FriendSearchResult) => {
    if (!result.requestId) return
    void act(
      `accept:${result.requestId}`,
      () => apiRequest(`/api/friends/requests/${result.requestId}/accept`, { method: 'POST' }),
      `${result.profile.displayName} is now your friend.`,
      () => updateSearchResult(result.profile.id, { relationship: 'friends' }),
    )
  }

  const activateSearchResult = (result: FriendSearchResult) => {
    if (result.relationship === 'none') sendSearchRequest(result)
    else if (result.relationship === 'incoming') acceptSearchRequest(result)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSearchDismissed(true)
      setActiveSearchIndex(-1)
      return
    }
    if (!searchResults.length || searchDismissed) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSearchIndex((index) => nextFriendSearchIndex(index, event.key === 'ArrowDown' ? 1 : -1, searchResults.length))
      return
    }
    if (event.key === 'Enter' && activeSearchIndex >= 0) {
      event.preventDefault()
      activateSearchResult(searchResults[activeSearchIndex]!)
    }
  }

  const block = (profile: FriendProfile) => {
    if (!confirm(uit`Block ${profile.displayName}? Any friendship or pending request will be removed.`)) return
    void act(`block:${profile.id}`, () => apiRequest('/api/friends/blocks', { method: 'POST', body: { userId: profile.id } }), uit`${profile.displayName} was blocked.`, () => {
      setSearchResults((results) => results.filter((result) => result.profile.id !== profile.id))
    })
  }

  const removeFriend = (profile: FriendProfile) => {
    if (!confirm(uit`Remove ${profile.displayName} from your friends?`)) return
    void act(`unfriend:${profile.id}`, () => apiRequest(`/api/friends/${profile.id}`, { method: 'DELETE' }), uit`${profile.displayName} was removed from your friends.`)
  }
  const friendActions = (profile: FriendProfile) => <>
    <DropdownMenuItem disabled={actionIds.size > 0} onClick={() => removeFriend(profile)}>{ui("Remove friend")}</DropdownMenuItem>
    <DropdownMenuItem disabled={actionIds.size > 0} variant="destructive" onClick={() => block(profile)}>{ui("Block")}</DropdownMenuItem>
  </>
  const data = listQuery.data
  const pool = poolQuery.data?.pool
  const memberIds = new Set(pool?.members.map((member) => member.profile.id))
  const pendingIds = new Set(pool?.pendingInvitations.map((invite) => invite.invitee.id))
  const friends = (data?.friends ?? []).filter((friend) => !memberIds.has(friend.profile.id))
  const canInvite = poolQuery.isSuccess && (!pool || pool.ownerUserId === userId)
  const poolFull = Boolean(pool && pool.members.length + pool.pendingInvitations.length >= 6)
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-5"><h1 className="text-sm font-semibold">{ui("Friends")}</h1></header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
          <div>
            <h2 className="text-lg font-medium">{ui("Find your friends")}</h2>
            {user && <FriendsHandle username={user.username} />}
          </div>
          <InviteCodesCard />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={usernameInputRef}
              value={searchInput}
              onChange={(event) => { setSearchInput(event.target.value); setSearchDismissed(false); setActionMessage('') }}
              onFocus={() => setSearchDismissed(false)}
              onKeyDown={handleSearchKeyDown}
              className="px-9"
              placeholder={ui("Name or username")}
              maxLength={120}
              aria-label={ui("Search friends")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchReady && !searchDismissed}
              aria-controls="friend-search-results"
              aria-activedescendant={activeSearchIndex >= 0 ? `friend-search-result-${activeSearchIndex}` : undefined}
            />
            {searchState === 'loading' && <LoaderCircle className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label={ui("Searching")} />}
          </div>
          {searchReady && !searchDismissed && <div id="friend-search-results" role="listbox" aria-label={ui("Friend search results")} className="overflow-hidden rounded-xl border">
            {searchState === 'loading' ? <div className="px-4 py-5 text-center text-sm text-muted-foreground">{ui("Searching people…")}</div>
              : searchState === 'error' ? <div className="px-4 py-5 text-center text-sm text-muted-foreground">{searchError}</div>
              : searchState === 'success' && !searchResults.length ? <div className="px-4 py-5 text-center text-sm text-muted-foreground">{ui("No people found for “")}{searchInput.trim()}”</div>
                : searchResults.map((result, index) => <div
                  id={`friend-search-result-${index}`}
                  key={result.profile.id}
                  role="option"
                  aria-selected={activeSearchIndex === index}
                  className={`flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 ${activeSearchIndex === index ? 'bg-accent/50' : ''}`}
                  onMouseEnter={() => setActiveSearchIndex(index)}
                >
                  <ProfileIdentity profile={result.profile} query={searchQuery} matchedOn={result.matchedOn} />
                  <div className="flex shrink-0 items-center gap-2">
                    {result.relationship === 'none' && <Button size="sm" disabled={actionIds.has(`request:${result.profile.id}`)} onClick={() => sendSearchRequest(result)}><UserRoundPlus />{actionIds.has(`request:${result.profile.id}`) ? ui("Sending…") : ui("Add friend")}</Button>}
                    {result.relationship === 'incoming' && <Button size="sm" disabled={actionIds.has(`accept:${result.requestId}`)} onClick={() => acceptSearchRequest(result)}>{actionIds.has(`accept:${result.requestId}`) ? ui("Accepting…") : ui("Accept")}</Button>}
                    {result.relationship === 'outgoing' && <span className="text-sm text-muted-foreground">{ui("Request sent")}</span>}
                    {result.relationship === 'friends' && <span className="flex items-center gap-1.5 text-sm text-emerald-500"><Check className="size-4" aria-hidden />{ui("Already friends")}</span>}
                    {result.relationship === 'self' && <span className="text-sm text-muted-foreground">{ui("You")}</span>}
                  </div>
                </div>)}
          </div>}
          {(actionError || actionMessage) && <p role="status" className={actionError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{actionError || actionMessage}</p>}

          {listQuery.isLoading ? <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">{ui("Loading friends…")}</div>
            : listQuery.error ? <div className="rounded-xl border py-12 text-center"><p className="text-sm text-muted-foreground">{listQuery.error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void listQuery.refetch()}>{ui("Try again")}</Button></div>
              : null}
          {data && data.incoming.length > 0 && <Section title={ui("Friend requests")} count={data.incoming.length}>
            {data.incoming.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} detail={`Requested ${friendRequestAge(connection.requestedAt)}`} actions={<>
              <Button size="sm" disabled={actionIds.has(`accept:${connection.requestId}`)} onClick={() => void act(`accept:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}/accept`, { method: 'POST' }), `${connection.profile.displayName} is now your friend.`)}>{actionIds.has(`accept:${connection.requestId}`) ? ui("Accepting…") : ui("Accept")}</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={uit`More options for ${connection.profile.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void act(`decline:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}`, { method: 'DELETE' }), `Request from ${connection.profile.displayName} declined.`)}>{ui("Decline request")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => block(connection.profile)}>{ui("Block")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>} />)}
          </Section>}

          {userId && <PoolSection
            query={poolQuery}
            currentUserId={userId}
            friends={data?.friends ?? []}
            busy={actionIds.size > 0}
            act={act}
            inviteTarget={inviteTarget}
            inviteTriggerRef={inviteTriggerRef}
            onInviteClose={() => setInviteTarget(null)}
            friendActions={friendActions}
          />}
          {data && <>
            {friends.length > 0 ? <Section title={ui("Friends")} count={friends.length}>
              {friends.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} detail={pendingIds.has(connection.profile.id) ? ui("Invitation sent") : undefined} actions={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" disabled={actionIds.size > 0} onFocus={(event) => { inviteTriggerRef.current = event.currentTarget }} aria-label={uit`More options for ${connection.profile.displayName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canInvite && !pendingIds.has(connection.profile.id) &&
                      <DropdownMenuItem disabled={poolFull || actionIds.size > 0} onSelect={() => setInviteTarget(connection.profile)}>{poolFull ? ui("Pool full") : ui("Invite to Pool")}</DropdownMenuItem>
                    }
                    {friendActions(connection.profile)}
                  </DropdownMenuContent>
                </DropdownMenu>
              } />)}
            </Section> : data.friends.length > 0 ? <Section title={ui("Friends")} count={0} empty={ui("All your friends are in your Pool.")}>{null}</Section> : <div className="rounded-xl border px-6 py-10 text-center">
              <UsersRound className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-medium">{ui("Add friends")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{ui("Find someone by their name or Pulpo username.")}</p>
            </div>}

            {data.outgoing.length > 0 && <CollapsibleSection title={ui("Sent requests")} count={data.outgoing.length} open={outgoingOpen} onToggle={() => setOutgoingOpen((value) => !value)}>
              {data.outgoing.map((connection) => <ConnectionRow key={connection.requestId} connection={connection} detail={`Sent ${friendRequestAge(connection.requestedAt)}`} actions={<Button size="sm" variant="ghost" disabled={actionIds.has(`cancel:${connection.requestId}`)} onClick={() => void act(`cancel:${connection.requestId}`, () => apiRequest(`/api/friends/requests/${connection.requestId}`, { method: 'DELETE' }), `Request to ${connection.profile.displayName} canceled.`)}>{actionIds.has(`cancel:${connection.requestId}`) ? ui("Canceling…") : ui("Cancel")}</Button>} />)}
            </CollapsibleSection>}

            {data.blocked.length > 0 && <CollapsibleSection title={ui("Blocked users")} count={data.blocked.length} open={blockedOpen} onToggle={() => setBlockedOpen((value) => !value)}>
              {data.blocked.map((profile) => <div key={profile.id} className="flex items-center justify-between gap-3 px-4 py-3"><ProfileIdentity profile={profile} /><Button size="sm" variant="outline" disabled={actionIds.has(`unblock:${profile.id}`)} onClick={() => void act(`unblock:${profile.id}`, () => apiRequest(`/api/friends/blocks/${profile.id}`, { method: 'DELETE' }), `${profile.displayName} was unblocked.`)}>{actionIds.has(`unblock:${profile.id}`) ? ui("Unblocking…") : ui("Unblock")}</Button></div>)}
            </CollapsibleSection>}
          </>}
        </div>
      </div>
    </div>
  )
}
