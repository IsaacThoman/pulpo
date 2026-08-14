import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Loader2, LockKeyhole } from 'lucide-react'
import type { ChatShareSnapshot, ChatShareSnapshotModel } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import type { Chat, Model } from '@/lib/types'
import { messagesFromResponses, type ChatResponseDto } from '@/lib/chat-messages'
import { MessageItem } from '@/components/chat/MessageItem'
import type { MessageAttachmentAccess } from '@/components/chat/AttachmentImage'
import { TooltipProvider } from '@/components/ui/tooltip'

type PublicSharedChat = ChatShareSnapshot & { id: string }

function snapshotModel(model: ChatShareSnapshotModel): Model {
  return {
    ...model,
    description: '',
    contextWindow: 0,
    tags: [],
    inputPrice: 0,
    outputPrice: 0,
    perMessagePrice: 0,
    enabled: false,
    agentEnabled: false,
    pinned: false,
    presets: [],
  }
}

function sharedChat(data: PublicSharedChat): Chat {
  const responses: ChatResponseDto[] = data.responses.map((response) => ({
    ...response,
    error: response.error && typeof response.error === 'object'
      ? response.error as { message?: string }
      : response.error ? { message: String(response.error) } : null,
  }))
  return {
    id: data.chat.id,
    title: data.chat.title,
    modelId: data.chat.modelId,
    messages: messagesFromResponses(responses, data.attachments),
    createdAt: Date.parse(data.chat.createdAt),
    updatedAt: Date.parse(data.sharedAt),
    pinned: false,
    folderId: null,
    sortOrder: 0,
    tags: [],
    temporary: false,
    expiresAt: null,
    expired: false,
    shared: true,
  }
}

export function SharedChatPage() {
  const { token = '' } = useParams()
  const [share, setShare] = useState<PublicSharedChat | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setShare(null)
    setError('')
    void apiRequest<PublicSharedChat>(`/api/shares/${encodeURIComponent(token)}`)
      .then((result) => { if (!cancelled) setShare(result) })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load this shared chat')
      })
    return () => { cancelled = true }
  }, [token])

  const chat = useMemo(() => share ? sharedChat(share) : null, [share])
  const modelById = useMemo(() => new Map(share?.models.map((model) => [model.id, snapshotModel(model)]) ?? []), [share])
  const resolveModel = useCallback((id: string): Model => modelById.get(id) ?? {
    id,
    name: id || 'Unknown model',
    providerGroupId: 'internal',
    provider: 'Pulpo',
    inferenceProvider: 'Pulpo',
    description: '',
    contextWindow: 0,
    tags: [],
    labLogo: 'pulpo',
    modelLogo: 'pulpo',
    labCustomIcon: null,
    modelCustomIcon: null,
    iconLight: '#18181b',
    iconDark: '#fafafa',
    inputPrice: 0,
    outputPrice: 0,
    perMessagePrice: 0,
    enabled: false,
    agentEnabled: false,
    presets: [],
  }, [modelById])
  const attachmentAccess = useMemo<MessageAttachmentAccess>(() => {
    const base = `/api/shares/${encodeURIComponent(token)}/attachments`
    return {
      contentUrl: (attachment) => `${base}/${encodeURIComponent(attachment.id)}/content`,
      thumbnailUrl: (attachment) => `${base}/${encodeURIComponent(attachment.id)}/thumbnail`,
      downloadUrl: (attachment) => `${base}/${encodeURIComponent(attachment.id)}/download`,
    }
  }, [token])

  return (
    <TooltipProvider delayDuration={1000}>
      <main className="flex min-h-dvh flex-col bg-background text-foreground">
        <header className="sticky top-0 z-20 shrink-0 border-b bg-background/90 backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-2 px-4">
            <Link to="/" className="flex items-center gap-2 rounded-lg font-semibold hover:opacity-80">
              <img src="/pulpo-smiley.png" alt="Pulpo" className="size-6" />
              <span className="hidden sm:inline">Pulpo</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{share?.chat.title ?? 'Shared chat'}</div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <LockKeyhole className="size-3" /> Read-only snapshot
            </span>
            <Link className="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:block" to="/">Open Pulpo</Link>
          </div>
        </header>

        {!share && !error && (
          <div role="status" className="grid flex-1 place-items-center px-6 py-16 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading shared chat…</span>
          </div>
        )}
        {error && (
          <div className="grid flex-1 place-items-center px-6 py-16 text-center">
            <div className="max-w-sm">
              <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertCircle className="size-5" /></span>
              <h1 className="mt-4 text-lg font-semibold">Shared chat unavailable</h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{error}</p>
              <Link to="/" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">Open Pulpo</Link>
            </div>
          </div>
        )}
        {share && chat && (
          <>
            <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-4 py-6">
              {chat.messages.map((message) => (
                <MessageItem
                  key={message.id}
                  chat={chat}
                  message={message}
                  streaming={false}
                  activeModelId={chat.modelId}
                  readOnly
                  forceShowReasoning
                  attachmentAccess={attachmentAccess}
                  modelResolver={resolveModel}
                />
              ))}
              {chat.messages.length === 0 && (
                <div className="grid flex-1 place-items-center py-24 text-sm text-muted-foreground">This snapshot has no messages.</div>
              )}
            </section>
            <footer className="border-t bg-muted/20 px-4 py-4 text-center text-xs text-muted-foreground">
              Shared {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(share.sharedAt))}. Future chat changes are not included.
            </footer>
          </>
        )}
      </main>
    </TooltipProvider>
  )
}
