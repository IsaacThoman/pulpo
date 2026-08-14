import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FriendConnection, FriendProfile, FriendSearchResponse, FriendSearchResult, FriendsList } from '@pulpo/contracts'
import { BarChart3, Check, ChevronDown, ChevronRight, Copy, LoaderCircle, MoreHorizontal, Search, UserRoundPlus, UsersRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError, apiRequest, isNetworkError } from '@/lib/api'
import { friendSearchHighlight, nextFriendSearchIndex, normalizedFriendSearchQuery, shouldSearchFriends } from '@/lib/friend-search'
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

export function FriendsHandle({ username }: { username: string }) {
  const [copied, setCopied] = useState(false)
  const copyHandle = async () => {
    await navigator.clipboard.writeText(`@${username}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>Your handle is</span>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1"
        onClick={() => void copyHandle()}
        aria-label={`Copy @${username}`}
        title={copied ? 'Copied' : 'Copy handle'}
      >
        <span>@{username}</span>
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? 'Handle copied' : ''}</span>
    </p>
  )
}

function HighlightedText({ value, query }: { value: string; query: string }) {
  return friendSearchHighlight(value, query).map((part, index) => part.match
    ? <mark key={index} className="bg-transparent font-semibold text-foreground">{part.text}</mark>
    : <span key={index}>{part.text}</span>)
}

function ProfileIdentity({ profile, detail, query, matchedOn }: {
  profile: FriendProfile
  detail?: string
  query?: string
  matchedOn?: FriendSearchResult['matchedOn']
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProfileAvatar name={profile.displayName} avatarUrl={profile.avatarUrl} className="size-10" fallbackClassName="text-xs" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{query && matchedOn === 'displayName' ? <HighlightedText value={profile.displayName} query={query} /> : profile.displayName}</div>
        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {profile.username && <span className="truncate">@{query && matchedOn === 'username' ? <HighlightedText value={profile.username} query={query} /> : profile.username}</span>}
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
  const user = useAuth((state) => state.user)
  const userId = user?.id
  const navigate = useNavigate()
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
    ])
  }

  const act = async <T,>(key: string, operation: () => Promise<T>, message: string, onSuccess?: (result: T) => void) => {
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
      `Friend request sent to ${result.profile.displayName}.`,
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
    else if (result.relationship === 'friends') navigate('/usage/friends')
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
    if (!confirm(`Block ${profile.displayName}? Any friendship or pending request will be removed.`)) return
    void act(`block:${profile.id}`, () => apiRequest('/api/friends/blocks', { method: 'POST', body: { userId: profile.id } }), `${profile.displayName} was blocked.`, () => {
      setSearchResults((results) => results.filter((result) => result.profile.id !== profile.id))
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
            {user && <FriendsHandle username={user.username} />}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={usernameInputRef}
              value={searchInput}
              onChange={(event) => { setSearchInput(event.target.value); setSearchDismissed(false); setActionMessage('') }}
              onFocus={() => setSearchDismissed(false)}
              onKeyDown={handleSearchKeyDown}
              className="px-9"
              placeholder="Name or username"
              maxLength={120}
              aria-label="Search friends"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchReady && !searchDismissed}
              aria-controls="friend-search-results"
              aria-activedescendant={activeSearchIndex >= 0 ? `friend-search-result-${activeSearchIndex}` : undefined}
            />
            {searchState === 'loading' && <LoaderCircle className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />}
          </div>
          {searchReady && !searchDismissed && <div id="friend-search-results" role="listbox" aria-label="Friend search results" className="overflow-hidden rounded-xl border">
            {searchState === 'loading' ? <div className="px-4 py-5 text-center text-sm text-muted-foreground">Searching people…</div>
              : searchState === 'error' ? <div className="px-4 py-5 text-center text-sm text-muted-foreground">{searchError}</div>
              : searchState === 'success' && !searchResults.length ? <div className="px-4 py-5 text-center text-sm text-muted-foreground">No people found for “{searchInput.trim()}”</div>
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
                    {result.relationship === 'none' && <Button size="sm" disabled={actionIds.has(`request:${result.profile.id}`)} onClick={() => sendSearchRequest(result)}><UserRoundPlus />{actionIds.has(`request:${result.profile.id}`) ? 'Sending…' : 'Add friend'}</Button>}
                    {result.relationship === 'incoming' && <Button size="sm" disabled={actionIds.has(`accept:${result.requestId}`)} onClick={() => acceptSearchRequest(result)}>{actionIds.has(`accept:${result.requestId}`) ? 'Accepting…' : 'Accept'}</Button>}
                    {result.relationship === 'outgoing' && <span className="text-sm text-muted-foreground">Request sent</span>}
                    {result.relationship === 'friends' && <Button size="sm" variant="outline" onClick={() => navigate('/usage/friends')}><BarChart3 />View usage</Button>}
                    {result.relationship === 'self' && <span className="text-sm text-muted-foreground">You</span>}
                  </div>
                </div>)}
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
                  <h2 className="mt-3 text-sm font-medium">Add friends</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Find someone by their name or Pulpo username.</p>
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
