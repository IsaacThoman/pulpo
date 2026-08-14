import { useEffect, useMemo, useState } from 'react'
import type { ChatShareSummary } from '@pulpo/contracts'
import { Check, Copy, ExternalLink, Link2, Loader2, Plus, Trash2 } from 'lucide-react'
import type { Chat } from '@/lib/types'
import { apiRequest } from '@/lib/api'
import { addCreatedShare, publicShareUrl, removeRevokedShare } from '@/lib/sharing'
import { useChat } from '@/stores/chat'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function shareUrl(token: string): string {
  return publicShareUrl(location.origin, token)
}

function setChatShared(chatId: string, shared: boolean) {
  useChat.setState((state) => ({
    chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, shared } : chat),
  }))
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('Clipboard access is unavailable. Select and copy the link manually.')
  await navigator.clipboard.writeText(value)
}

export function ShareManagementDialog({ chat, open, onOpenChange }: {
  chat: Chat
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [shares, setShares] = useState<ChatShareSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ChatShareSummary | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const generationActive = useMemo(
    () => chat.messages.some((message) => message.role === 'assistant' && !message.done),
    [chat.messages],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    void apiRequest<{ data: ChatShareSummary[] }>(`/api/chat-shares?chatId=${encodeURIComponent(chat.id)}`)
      .then((result) => {
        if (cancelled) return
        setShares(result.data)
        setChatShared(chat.id, result.data.length > 0)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load sharing settings')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chat.id, open])

  const markCopied = (id: string) => {
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1600)
  }

  const copyShare = async (share: ChatShareSummary) => {
    setError('')
    try {
      await copyText(shareUrl(share.token))
      markCopied(share.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to copy the share link')
    }
  }

  const createShare = async () => {
    if (generationActive || creating) return
    setCreating(true)
    setError('')
    try {
      const created = await apiRequest<ChatShareSummary>('/api/chat-shares', {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
        body: { chatId: chat.id, expiresAt: null },
      })
      setShares((current) => addCreatedShare(current, created))
      setChatShared(chat.id, true)
      try {
        await copyText(shareUrl(created.token))
        markCopied(created.id)
      } catch {
        setError('Snapshot created. Use Copy link to copy its URL.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create a share snapshot')
    } finally {
      setCreating(false)
    }
  }

  const revokeShare = async () => {
    if (!revokeTarget || revoking) return
    const target = revokeTarget
    setRevoking(target.id)
    setError('')
    try {
      await apiRequest(`/api/chat-shares/${target.id}`, { method: 'DELETE' })
      setShares((current) => {
        const next = removeRevokedShare(current, target.id)
        setChatShared(chat.id, next.length > 0)
        return next
      })
      setRevokeTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke this snapshot')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" onClick={(event) => event.stopPropagation()}>
          <DialogHeader className="border-b px-5 py-4 text-left">
            <DialogTitle>Share “{chat.title}”</DialogTitle>
            <DialogDescription className="leading-5">
              Each link is an immutable public snapshot. It includes thoughts, tool details, and downloadable attachments visible in the selected branch.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {error && (
              <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            {generationActive && (
              <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                Wait for the active response to finish before creating a snapshot.
              </div>
            )}
            {loading ? (
              <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading snapshots…
              </div>
            ) : shares.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-9 text-center">
                <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Link2 className="size-5" /></span>
                <p className="text-sm font-medium">This chat is not shared</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Create a snapshot to share the current finished branch without exposing future changes.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shares.map((share, index) => (
                  <div key={share.id} className="flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Link2 className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{index === 0 ? 'Latest snapshot' : 'Share snapshot'}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(share.createdAt))}
                        {' · '}{share.responseCount} {share.responseCount === 1 ? 'response' : 'responses'}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label="Copy share link" onClick={() => void copyShare(share)}>
                      {copiedId === share.id ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Preview snapshot" onClick={() => window.open(shareUrl(share.token), '_blank', 'noopener,noreferrer')}>
                      <ExternalLink className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Revoke snapshot" className="text-muted-foreground hover:text-destructive" onClick={() => setRevokeTarget(share)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-5 py-4 sm:justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
            <Button onClick={() => void createShare()} disabled={generationActive || creating || loading}>
              {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              {shares.length ? 'Create another snapshot' : 'Create share snapshot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(value) => { if (!value && !revoking) setRevokeTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke this snapshot?</DialogTitle>
            <DialogDescription>The public link and every attachment accessed through it will stop working immediately.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={Boolean(revoking)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void revokeShare()} disabled={Boolean(revoking)}>
              {revoking ? <Loader2 className="animate-spin" /> : null} Revoke snapshot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
