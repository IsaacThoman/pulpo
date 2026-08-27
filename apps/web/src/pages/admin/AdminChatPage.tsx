import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@pulpo/contracts'
import { Copy, DoorOpen, Loader2, Pin, PinOff, Share2, Trash2 } from 'lucide-react'
import { ChatPage } from '@/pages/ChatPage'
import { apiRequest, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { queryClient } from '@/lib/query-client'
import { isDesktopRuntime, runtimeInstanceUrl, runtimeSessionToken } from '@/lib/runtime'
import { useChat, type ServerChat, type ServerFolder } from '@/stores/chat'
import { useUploadOutbox } from '@/stores/upload-outbox'
import {
  clearAdminChatGrant,
  getAdminChatGrant,
  setAdminChatGrant,
  type AdminChatGrant,
} from '@/features/admin-chat/access'
import { ui } from '@/i18n/ui'

interface AccessResponse extends Omit<AdminChatGrant, 'chatId'> {
  chat: { id: string; title: string; temporary: boolean; deletedAt: string | null; expiresAt: string | null }
}

type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>

function discardAdminChatOutbox(): void {
  useUploadOutbox.setState({ preservedDrafts: {} })
  for (const submission of useUploadOutbox.getState().submissions) {
    useUploadOutbox.getState().discardSubmission(submission.id)
  }
  for (const localId of Object.keys(useUploadOutbox.getState().uploads)) {
    useUploadOutbox.getState().removeUpload(localId)
  }
}

function AccessGate({ chatId, notice, onGranted }: { chatId: string; notice?: string | null; onGranted: (grant: AdminChatGrant, chat: AccessResponse['chat']) => void }) {
  const [reason, setReason] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setLoading(true); setError(null)
    try {
      const result = await apiRequest<AccessResponse>(`/api/admin/chats/${chatId}/access`, {
        method: 'POST', body: { reason, verificationCode },
      })
      const grant: AdminChatGrant = { ...result, chatId, owner: result.owner }
      setAdminChatGrant(grant)
      onGranted(grant, result.chat)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui('Unable to open this chat.'))
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="grid h-full place-items-center p-6">
      <form className="w-full max-w-xl space-y-5 rounded-xl border bg-card p-6 shadow-sm" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div>
          <h2 className="text-xl font-semibold">{ui('Open private user chat?')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{ui('This chat may contain private user content. Your access and every action will be audited. Changes affect the owner immediately, while generated usage is charged to your administrator account.')}</p>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{chatId}</p>
        </div>
        {notice && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{notice}</p>}
        <div className="space-y-2">
          <Label htmlFor="admin-chat-reason">{ui('Support or operational reason')}</Label>
          <Textarea id="admin-chat-reason" value={reason} minLength={10} maxLength={500} required onChange={(event) => setReason(event.target.value)} placeholder={ui('Describe why access is necessary…')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="admin-chat-code">{ui('Authenticator or recovery code')}</Label>
          <Input id="admin-chat-code" value={verificationCode} minLength={6} maxLength={32} required autoComplete="one-time-code" className="font-mono" onChange={(event) => setVerificationCode(event.target.value.toUpperCase())} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading || reason.trim().length < 10 || verificationCode.trim().length < 6}>
          {loading && <Loader2 className="animate-spin" />}{ui('Confirm and open chat')}
        </Button>
      </form>
    </div>
  )
}

export function AdminChatPage() {
  const { chatId = '' } = useParams()
  const navigate = useNavigate()
  const initialGrant = getAdminChatGrant()
  const [grant, setGrant] = useState<AdminChatGrant | null>(initialGrant?.chatId === chatId ? initialGrant : null)
  const [chatStatus, setChatStatus] = useState<AccessResponse['chat'] | null>(null)
  const [loading, setLoading] = useState(Boolean(grant))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [gateNotice, setGateNotice] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [rename, setRename] = useState('')
  const [shareIds, setShareIds] = useState<string[]>([])
  const savedState = useRef<ReturnType<typeof useChat.getState> | null>(null)
  const savedUploadState = useRef<ReturnType<typeof useUploadOutbox.getState> | null>(null)
  const cleanupTimer = useRef<number | null>(null)
  const socketRef = useRef<PulpoSocket | null>(null)
  const chat = useChat((state) => state.chats.find((item) => item.id === chatId) ?? null)
  const folders = useChat((state) => state.folders)
  const streamingIds = useChat((state) => state.streamingIds)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [detail, folderResult, shareResult] = await Promise.all([
        apiRequest<ServerChat & { deletedAt?: string | null }>(`/api/chats/${chatId}?format=compact&scope=active`),
        apiRequest<{ data: ServerFolder[] }>('/api/folders'),
        apiRequest<{ data: Array<{ share: { id: string; revokedAt: string | null } }> }>(`/api/chat-shares?chatId=${chatId}`),
      ])
      useChat.getState().replaceFolders(folderResult.data.map((folder) => ({ ...folder, pinned: false, sortOrder: folder.sortOrder ?? 0 })))
      useChat.getState().setDetailedChat(detail)
      useChat.getState().setActive(chatId)
      setRename(detail.title)
      setShareIds(shareResult.data.filter((row) => !row.share.revokedAt).map((row) => row.share.id))
      setChatStatus((current) => ({
        id: chatId,
        title: detail.title,
        temporary: Boolean(detail.temporary),
        deletedAt: detail.deletedAt ?? current?.deletedAt ?? null,
        expiresAt: detail.expiresAt ?? null,
      }))
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'admin_chat_access_invalid') {
        clearAdminChatGrant(); setGrant(null)
      } else setError(cause instanceof Error ? cause.message : ui('Unable to load this chat.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!grant) return
    if (cleanupTimer.current !== null) window.clearTimeout(cleanupTimer.current)
    cleanupTimer.current = null
    savedState.current ??= useChat.getState()
    savedUploadState.current ??= useUploadOutbox.getState()
    useChat.setState({ chats: [], folders: [], activeChatId: null, activeTemporaryChatId: null, streamingIds: [], responseSequences: {}, responseChatIds: {} })
    useUploadOutbox.setState({ uploads: {}, submissions: [], preservedDrafts: {} })
    void load()
    return () => {
      cleanupTimer.current = window.setTimeout(() => {
        socketRef.current?.disconnect()
        socketRef.current = null
        const accountKey = `admin-chat:${grant.accessId}`
        queryClient.removeQueries({ queryKey: ['chat', accountKey] })
        queryClient.removeQueries({ queryKey: ['chats', accountKey] })
        if (savedState.current) useChat.setState(savedState.current, true)
        if (savedUploadState.current) useUploadOutbox.setState(savedUploadState.current, true)
        savedState.current = null
        savedUploadState.current = null
        clearAdminChatGrant()
      }, 0)
    }
    // oxlint-disable-next-line react/exhaustive-deps -- the grant represents one immutable access session
  }, [grant?.accessId])

  useEffect(() => {
    if (!grant) return
    const socket: PulpoSocket = io(isDesktopRuntime() ? runtimeInstanceUrl() : undefined, {
      path: '/socket.io', withCredentials: !isDesktopRuntime(),
      auth: { ...(isDesktopRuntime() ? { sessionToken: runtimeSessionToken() } : {}), adminChatAccessToken: grant.accessToken },
    })
    socketRef.current = socket
    socket.on('connect', () => socket.emit('chat.subscribe', { chatId }))
    socket.on('response.event', (event) => { useChat.getState().applyResponseEvents([event]) })
    socket.on('response.snapshot', (snapshot) => { useChat.getState().applyResponseSnapshot(snapshot) })
    socket.on('chat.changed', ({ chatId: changed }) => { if (changed === chatId) void load() })
    return () => { socket.disconnect(); if (socketRef.current === socket) socketRef.current = null }
    // oxlint-disable-next-line react/exhaustive-deps -- socket lifetime is tied to the immutable access id
  }, [grant?.accessId, chatId])

  useEffect(() => {
    if (!grant) return
    const expiresAt = Date.parse(grant.expiresAt)
    const expire = () => {
      discardAdminChatOutbox()
      clearAdminChatGrant()
      setGateNotice(ui('Administrator chat access expired. Complete the warning and verification again to continue.'))
      setGrant(null)
    }
    const expiryTimer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()))
    const clockTimer = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => { window.clearTimeout(expiryTimer); window.clearInterval(clockTimer) }
  }, [grant])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return
    for (const responseId of streamingIds) socket.emit('response.subscribe', { responseId, afterSequence: 0 })
  }, [streamingIds])

  const exit = async () => {
    discardAdminChatOutbox()
    if (grant) await apiRequest(`/api/admin/chats/${chatId}/access`, { method: 'DELETE', headers: { 'x-pulpo-admin-chat-access': grant.accessToken } }).catch(() => undefined)
    clearAdminChatGrant(); setGrant(null); navigate('/admin/chats', { replace: true })
  }
  const patchChat = async (body: Record<string, unknown>) => { await apiRequest(`/api/chats/${chatId}`, { method: 'PATCH', body }); await load() }
  const duplicate = async () => {
    const copy = await apiRequest<{ id: string }>(`/api/chats/${chatId}/duplicate`, { method: 'POST' })
    setNotice(ui('Chat duplicated as {{chatId}}. Opening the copy requires a new access session.', { chatId: copy.id }))
  }
  const share = async () => {
    if (!confirm(ui('Create a public link to this user chat? Anyone with the link can view the shared content.'))) return
    const result = await apiRequest<{ token: string }>('/api/chat-shares', { method: 'POST', body: { chatId, expiresAt: null }, idempotencyKey: crypto.randomUUID() })
    const url = `${location.origin}/share/${result.token}`
    await navigator.clipboard?.writeText(url)
    setNotice(ui('Public share link copied.'))
    await load()
  }
  const revokeShares = async () => {
    if (!confirm(ui('Revoke all public links for this user chat?'))) return
    await Promise.all(shareIds.map((id) => apiRequest(`/api/chat-shares/${id}`, { method: 'DELETE' })))
    setNotice(ui('Public share links revoked.'))
    await load()
  }
  const expiresIn = grant ? Math.max(0, Math.ceil((Date.parse(grant.expiresAt) - clock) / 60_000)) : 0

  if (!grant) return <AccessGate chatId={chatId} notice={gateNotice} onGranted={(next, status) => { setGateNotice(null); setGrant(next); setChatStatus(status) }} />
  if (loading && !chat) return <div className="grid h-full place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline animate-spin" />{ui('Opening user chat…')}</div>
  if (error && !chat) return <div className="grid h-full place-items-center p-6"><div className="space-y-3 text-center"><p className="text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>{ui('Try again')}</Button></div></div>

  const deleted = Boolean(chatStatus?.deletedAt)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong>{ui('Admin chat access')}</strong>
          <span className="text-muted-foreground">{grant.owner.name} · {grant.owner.email} · {ui('{{minutes}}m', { minutes: expiresIn })}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={grant.reason}>{grant.reason}</span>
          {!deleted && chat && <>
            {chatStatus?.temporary && <Button size="sm" variant="outline" onClick={() => void apiRequest(`/api/chats/${chatId}/persist`, { method: 'POST' }).then(load)}>{ui('Make permanent')}</Button>}
            <Input aria-label={ui('Chat title')} className="h-8 w-48" value={rename} onChange={(event) => setRename(event.target.value)} onBlur={() => { if (rename.trim() && rename.trim() !== chat.title) void patchChat({ title: rename.trim() }) }} />
            <Button size="icon-sm" variant="ghost" aria-label={chat.pinned ? ui('Unpin') : ui('Pin')} onClick={() => void patchChat({ pinned: !chat.pinned })}>{chat.pinned ? <PinOff /> : <Pin />}</Button>
            <select className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs" aria-label={ui('Move to folder')} value={chat.folderId ?? ''} onChange={(event) => void patchChat({ folderId: event.target.value || null })}>
              <option value="">{ui('No folder')}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <Button size="icon-sm" variant="ghost" aria-label={ui('Copy public share link')} onClick={() => void share()}><Share2 /></Button>
            {shareIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => void revokeShares()}>{ui('Revoke shares')} ({shareIds.length})</Button>}
            <Button size="icon-sm" variant="ghost" aria-label={ui('Duplicate chat')} onClick={() => void duplicate()}><Copy /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={ui('Move chat to trash')} onClick={() => { if (confirm(ui('Move this user chat to trash?'))) void apiRequest(`/api/chats/${chatId}`, { method: 'DELETE' }).then(() => setChatStatus((current) => current ? { ...current, deletedAt: new Date().toISOString() } : current)) }}><Trash2 /></Button>
          </>}
          <Button size="sm" variant="outline" onClick={() => void exit()}><DoorOpen />{ui('Exit')}</Button>
        </div>
        {notice && <p role="status" className="mt-1 text-xs text-muted-foreground">{notice}</p>}
      </div>
      {deleted ? <div className="grid min-h-0 flex-1 place-items-center p-6"><div className="space-y-4 text-center"><h2 className="text-lg font-semibold">{ui('This chat is in Trash')}</h2><div className="flex gap-2"><Button onClick={() => void apiRequest(`/api/chats/${chatId}/recover`, { method: 'POST' }).then(() => { setChatStatus((current) => current ? { ...current, deletedAt: null } : current); return load() })}>{ui('Recover')}</Button><Button variant="destructive" onClick={() => { if (confirm(ui('Permanently delete this user chat? This cannot be undone.'))) void apiRequest(`/api/chats/${chatId}/permanent`, { method: 'DELETE' }).then(exit) }}>{ui('Delete permanently')}</Button></div></div></div>
        : <div className="min-h-0 flex-1"><ChatPage adminMode /></div>}
    </div>
  )
}
