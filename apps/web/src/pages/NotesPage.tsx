import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Cloud, CloudOff, Code2, Loader2, MoreHorizontal, RotateCcw, Share2, Trash2, UserMinus } from 'lucide-react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { FriendsList, NoteDetail, NoteRole, NoteSummary } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { ApiError } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'
import {
  acquireSourceLock, getFriends, getNote, listNotes, notesQueryKey, permanentlyDeleteNote, releaseSourceLock,
  removeNoteMember, renewSourceLock, restoreNote, trashOrLeaveNote, updateNoteMember,
} from '@/features/notes/api'
import { NoteEditor, type NoteEditorHandle } from '@/features/notes/NoteEditor'
import { useNoteCollaboration } from '@/features/notes/useNoteCollaboration'

function ShareDialog({ note, open, onOpenChange }: { note: NoteDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const userId = useAuth((state) => state.user?.id)
  const friends = useQuery({ queryKey: ['friends', userId], queryFn: getFriends, enabled: open && note.role === 'owner' })
  const [role, setRole] = useState<Exclude<NoteRole, 'owner'>>('editor')
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['note', userId, note.id] }),
      queryClient.invalidateQueries({ queryKey: ['notes', userId] }),
    ])
  }
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    try { await action(); await refresh() } finally { setBusy(null) }
  }
  const memberIds = new Set(note.members.map((member) => member.profile.id))
  const available = (friends.data as FriendsList | undefined)?.friends.filter((friend) => !memberIds.has(friend.profile.id)) ?? []
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{ui('Share note')}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        {note.role === 'owner' && available.length > 0 && <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{ui('Add a friend')}</p>
          <div className="space-y-2">{available.map((friend) => <div key={friend.profile.id} className="flex items-center gap-2 rounded-lg border p-2">
            <ProfileAvatar name={friend.profile.displayName} avatarUrl={friend.profile.avatarUrl} className="size-8" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{friend.profile.displayName}</p><p className="truncate text-xs text-muted-foreground">@{friend.profile.username}</p></div>
            <select aria-label={ui('Role')} value={role} onChange={(event) => setRole(event.target.value as Exclude<NoteRole, 'owner'>)} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="editor">{ui('Editor')}</option><option value="viewer">{ui('Viewer')}</option></select>
            <Button size="sm" disabled={Boolean(busy)} onClick={() => void run(`add:${friend.profile.id}`, () => updateNoteMember(note.id, friend.profile.id, role))}>{ui('Add')}</Button>
          </div>)}</div>
        </div>}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{ui('People with access')}</p>
          <div className="divide-y rounded-lg border">{note.members.map((member) => <div key={member.profile.id} className="flex items-center gap-2 p-2.5">
            <ProfileAvatar name={member.profile.displayName} avatarUrl={member.profile.avatarUrl} className="size-8" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.profile.displayName}</p><p className="truncate text-xs text-muted-foreground">@{member.profile.username}</p></div>
            {note.role === 'owner' && member.role !== 'owner' ? <>
              <select aria-label={ui('Role')} value={member.role} disabled={Boolean(busy)} onChange={(event) => void run(`role:${member.profile.id}`, () => updateNoteMember(note.id, member.profile.id, event.target.value as 'editor' | 'viewer'))} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="editor">{ui('Editor')}</option><option value="viewer">{ui('Viewer')}</option></select>
              <Button variant="ghost" size="icon-sm" aria-label={ui('Remove access')} disabled={Boolean(busy)} onClick={() => void run(`remove:${member.profile.id}`, () => removeNoteMember(note.id, member.profile.id))}><UserMinus /></Button>
            </> : <span className="rounded-full bg-muted px-2 py-1 text-[11px] capitalize text-muted-foreground">{member.role}</span>}
          </div>)}</div>
        </div>
        {note.role === 'owner' && available.length === 0 && note.members.length === 1 && <p className="text-xs text-muted-foreground">{ui('Add friends from the Friends page before sharing a note.')}</p>}
      </div>
    </DialogContent>
  </Dialog>
}

function ActiveNote({ noteId }: { noteId: string }) {
  const navigate = useNavigate()
  const user = useAuth((state) => state.user)
  const noteQuery = useQuery({
    queryKey: ['note', user?.id, noteId],
    queryFn: () => getNote(noteId),
    enabled: Boolean(user?.id),
    retry: false,
    refetchInterval: (query) => query.state.data?.sourceLock ? 10_000 : false,
  })
  const collaboration = useNoteCollaboration(noteId)
  const editorRef = useRef<NoteEditorHandle>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [lockToken, setLockToken] = useState<string | null>(null)
  const [lockError, setLockError] = useState('')
  const note = noteQuery.data
  const ownLock = Boolean(note?.sourceLock && note.sourceLock.userId === user?.id && note.sourceLock.sessionId === collaboration.sessionId)
  const remotelyLocked = Boolean(note?.sourceLock && !ownLock)

  useEffect(() => {
    if (!lockToken || !sourceMode) return
    const heartbeat = window.setInterval(() => {
      void renewSourceLock(noteId, collaboration.sessionId, lockToken).catch(() => {
        setLockToken(null)
        setSourceMode(false)
        setLockError(ui('The source lock expired. Your draft was not applied.'))
      })
    }, 10_000)
    return () => window.clearInterval(heartbeat)
  }, [collaboration.sessionId, lockToken, noteId, sourceMode])

  const releaseLock = useCallback(async () => {
    const token = lockToken
    setLockToken(null)
    setSourceMode(false)
    if (token) await releaseSourceLock(noteId, collaboration.sessionId, token).catch(() => undefined)
    await queryClient.invalidateQueries({ queryKey: ['note', user?.id, noteId] })
  }, [collaboration.sessionId, lockToken, noteId, user?.id])

  useEffect(() => () => { if (lockToken) void releaseSourceLock(noteId, collaboration.sessionId, lockToken) }, [collaboration.sessionId, lockToken, noteId])

  if (noteQuery.isLoading || !collaboration.document || !collaboration.provider) return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  if (noteQuery.error instanceof ApiError && noteQuery.error.status === 404) return <Navigate to="/notes" replace />
  if (!note) return <div className="grid h-full place-items-center p-6 text-sm text-destructive">{ui('This note could not be loaded.')}</div>

  const enterSource = async () => {
    setLockError('')
    if (!navigator.onLine || collaboration.status !== 'connected' || !collaboration.synced || collaboration.unsyncedChanges > 0) {
      setLockError(ui('Markdown source requires an online, fully synced note.'))
      return
    }
    try {
      const lock = await acquireSourceLock(noteId, collaboration.sessionId)
      setLockToken(lock.token)
      setSourceDraft(editorRef.current?.getMarkdown() ?? '')
      setSourceMode(true)
      await queryClient.invalidateQueries({ queryKey: ['note', user?.id, noteId] })
    } catch (error) {
      setLockError(error instanceof Error ? error.message : ui('Markdown source is locked by another session.'))
    }
  }
  const trashOrLeave = async () => {
    const message = note.role === 'owner' ? ui('Move this note to Trash?') : ui('Leave this shared note?')
    if (!window.confirm(message)) return
    await trashOrLeaveNote(noteId)
    await queryClient.invalidateQueries({ queryKey: ['notes', user?.id] })
    navigate('/notes')
  }
  const applySource = async () => {
    editorRef.current?.applyMarkdown(sourceDraft)
    collaboration.provider!.flushPendingUpdates()
    const deadline = Date.now() + 4_000
    while (collaboration.provider!.hasUnsyncedChanges && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    await releaseLock()
  }
  const statusLabel = collaboration.accessRejected ? ui('Access revoked') : collaboration.status === 'connected' && collaboration.synced && collaboration.unsyncedChanges === 0 ? ui('Synced') : collaboration.status === 'disconnected' ? ui('Offline — changes saved locally') : ui('Syncing…')

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex min-h-14 items-center gap-3 border-b px-4 pl-12 sm:pl-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{collaboration.status === 'connected' ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}{statusLabel}</span>
        {note.role !== 'owner' && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">{note.role}</span>}
      </div>
      <div className="flex -space-x-2" aria-label={ui('Active collaborators')}>{collaboration.presence.slice(0, 5).map((person) => <div key={`${person.id}:${person.sessionId}`} title={`${person.name} · ${person.sessionId.slice(0, 6)}`} className="rounded-full border-2 border-background" style={{ boxShadow: `0 0 0 1px ${person.color}` }}><ProfileAvatar name={person.name} avatarUrl={person.avatarUrl} className="size-7" /></div>)}</div>
      <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}><Share2 />{ui('Share')}</Button>
      <Button size="sm" variant={sourceMode ? 'secondary' : 'outline'} disabled={note.role === 'viewer' || remotelyLocked} onClick={() => void (sourceMode ? releaseLock() : enterSource())}><Code2 />{ui('Markdown')}</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={ui('Note actions')}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void trashOrLeave()}><Trash2 />{note.role === 'owner' ? ui('Move to Trash') : ui('Leave note')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </header>
    {(lockError || remotelyLocked) && <div className="border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">{lockError || ui('Another session is editing Markdown source. This note is temporarily read-only.')}</div>}
    <NoteEditor ref={editorRef} noteId={noteId} document={collaboration.document} provider={collaboration.provider} role={note.role} sourceMode={sourceMode} readOnly={remotelyLocked} onSourceChanged={sourceMode ? setSourceDraft : undefined} />
    {sourceMode && <div className="flex min-h-0 flex-1 flex-col">
      <textarea aria-label={ui('Markdown source')} value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} className="min-h-0 flex-1 resize-none bg-muted/20 p-6 font-mono text-sm leading-6 outline-none" spellCheck={false} />
      <div className="flex justify-end gap-2 border-t p-3"><Button variant="outline" onClick={() => void releaseLock()}>{ui('Cancel')}</Button><Button onClick={() => void applySource()}><Check />{ui('Apply')}</Button></div>
    </div>}
    <ShareDialog note={note} open={shareOpen} onOpenChange={setShareOpen} />
  </div>
}

function TrashView() {
  const userId = useAuth((state) => state.user?.id)
  const navigate = useNavigate()
  const notes = useQuery({ queryKey: notesQueryKey(userId, true), queryFn: () => listNotes(true), enabled: Boolean(userId) })
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id)
    try { await action(); await queryClient.invalidateQueries({ queryKey: ['notes', userId] }) } finally { setBusy(null) }
  }
  return <div className="h-full overflow-y-auto p-6 pl-12 sm:pl-8"><div className="mx-auto max-w-3xl"><div className="mb-6"><h1 className="text-2xl font-semibold">{ui('Notes Trash')}</h1><p className="mt-1 text-sm text-muted-foreground">{ui('Restore notes or permanently delete them. Trash retention follows your account setting.')}</p></div>
    {notes.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
    <div className="space-y-2">{notes.data?.map((note: NoteSummary) => <div key={note.id} className="flex items-center gap-3 rounded-xl border p-4"><div className="min-w-0 flex-1"><p className="truncate font-medium">{note.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{note.excerpt || ui('Empty note')}</p></div><Button size="sm" variant="outline" disabled={busy === note.id} onClick={() => void act(note.id, () => restoreNote(note.id).then(() => navigate(`/notes/${note.id}`)))}><RotateCcw />{ui('Restore')}</Button><Button size="sm" variant="destructive" disabled={busy === note.id} onClick={() => { if (window.confirm(ui('Permanently delete this note? This cannot be undone.'))) void act(note.id, () => permanentlyDeleteNote(note.id)) }}><Trash2 />{ui('Delete')}</Button></div>)}</div>
    {!notes.isLoading && notes.data?.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{ui('Trash is empty')}</div>}
  </div></div>
}

export function NotesPage() {
  const { noteId } = useParams()
  const location = useLocation()
  if (location.pathname === '/notes/trash') return <TrashView />
  if (noteId) return <ActiveNote noteId={noteId} />
  return <div className="grid h-full place-items-center p-6"><div className="max-w-sm text-center"><Code2 className="mx-auto mb-4 size-10 text-muted-foreground/50" /><h1 className="text-lg font-semibold">{ui('Notes')}</h1><p className="mt-1 text-sm text-muted-foreground">{ui('Create a note or select one from the sidebar. Changes sync live and remain available offline.')}</p></div></div>
}
