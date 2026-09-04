import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, Loader2, Pin, PinOff, Plus, Search, Trash2, Users } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { NoteSummary } from '@pulpo/contracts'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { queryClient } from '@/lib/query-client'
import { ui } from '@/i18n/ui'
import { createNote, listNotes, notesQueryKey, pinNote } from './api'

function NoteRow({ note, active, trash, onNavigate }: { note: NoteSummary; active: boolean; trash: boolean; onNavigate: () => void }) {
  const navigate = useNavigate()
  const userId = useAuth((state) => state.user?.id)
  const pin = useMutation({
    mutationFn: () => pinNote(note.id, !note.pinned),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['notes', userId] }),
  })
  return (
    <div className={cn('group relative rounded-lg', active && 'bg-sidebar-accent')}>
      <button
        className="flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 pr-8 text-left hover:bg-sidebar-accent/70"
        onClick={() => { if (!trash) { navigate(`/notes/${note.id}`); onNavigate() } }}
      >
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-sidebar-foreground">{note.title || ui('Untitled note')}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {note.role !== 'owner' ? `${note.owner.displayName} · ${note.role}` : note.excerpt || ui('Empty note')}
          </span>
        </span>
        {note.collaboratorCount > 0 && <Users className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
      </button>
      <button
        className="invisible absolute right-1 top-1 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground group-hover:visible focus-visible:visible"
        aria-label={note.pinned ? ui('Unpin note') : ui('Pin note')}
        onClick={() => pin.mutate()}
        disabled={pin.isPending}
      >
        {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
    </div>
  )
}

export function NotesSidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const userId = useAuth((state) => state.user?.id)
  const location = useLocation()
  const navigate = useNavigate()
  const { noteId } = useParams()
  const trash = location.pathname === '/notes/trash'
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const notes = useQuery({
    queryKey: notesQueryKey(userId, trash, query),
    queryFn: () => listNotes(trash, query),
    enabled: Boolean(userId),
    staleTime: 0,
  })
  const create = useMutation({
    mutationFn: createNote,
    onSuccess: async (note) => {
      await queryClient.invalidateQueries({ queryKey: ['notes', userId] })
      navigate(`/notes/${note.id}`)
      onNavigate()
    },
  })
  const pinned = notes.data?.filter((note) => note.pinned) ?? []
  const remaining = notes.data?.filter((note) => !note.pinned) ?? []

  return (
    <div className="px-2 pb-4 pt-2">
      <button
        className="mb-2 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground/90 hover:bg-sidebar-accent/70 disabled:opacity-60"
        onClick={() => create.mutate()}
        disabled={create.isPending}
      >
        {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {ui('New note')}
      </button>
      <label className="mb-3 flex h-8 items-center gap-2 rounded-lg border border-sidebar-border bg-background/45 px-2 focus-within:ring-1 focus-within:ring-ring">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={ui('Search notes')}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </label>
      {notes.isLoading && <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
      {notes.isError && <p className="px-2 py-4 text-xs text-destructive">{ui('Notes could not be loaded.')}</p>}
      {pinned.length > 0 && <section className="mb-3">
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{ui('Pinned')}</div>
        <div className="space-y-0.5">{pinned.map((note) => <NoteRow key={note.id} note={note} active={note.id === noteId} trash={trash} onNavigate={onNavigate} />)}</div>
      </section>}
      {remaining.length > 0 && <section>
        <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{trash ? ui('Trash') : ui('Recent')}</div>
        <div className="space-y-0.5">{remaining.map((note) => <NoteRow key={note.id} note={note} active={note.id === noteId} trash={trash} onNavigate={onNavigate} />)}</div>
      </section>}
      {!notes.isLoading && !notes.isError && notes.data?.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">{query ? ui('No matching notes') : trash ? ui('Trash is empty') : ui('No notes yet')}</p>
      )}
      <button
        className={cn('mt-4 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground', trash && 'bg-sidebar-accent text-foreground')}
        onClick={() => { navigate(trash ? '/notes' : '/notes/trash'); onNavigate() }}
      >
        <Trash2 className="size-3.5" /> {trash ? ui('Back to notes') : ui('Trash')}
      </button>
    </div>
  )
}
