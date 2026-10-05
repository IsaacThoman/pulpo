import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, MessageSquare, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyTextButton, PreviewBody } from '@/components/chat/AttachmentPreview'
import { AttachmentSaveMenu } from '@/components/chat/SaveToFiles'
import { attachmentDescription, usePreviewContent } from '@/components/chat/use-attachment-preview-content'
import { attachmentQueryKey, downloadChatAttachment, fetchAttachment, type ChatAttachment } from '@/components/chat/attachment-actions'
import { ui } from '@/i18n/ui'
import { attachmentPreviewKind } from '@/lib/attachment-previews'
import { formatBytes } from '@/lib/attachments'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useChat } from '@/stores/chat'
import { SplitViewButton } from '@/features/side-panel/AgentActions'
import { PanelWindowButtons } from '@/features/side-panel/PanelControls'
import { useSidePanel, type PanelContent } from '@/features/side-panel/store'

/** The chat an attachment was sent in, when it is one of this account's chats. */
function ChatLink({ chatId }: { chatId: string | null | undefined }) {
  const title = useChat((state) => chatId ? state.chats.find((chat) => chat.id === chatId)?.title : undefined)
  if (!chatId || title === undefined) return <div className="h-4" />
  return (
    <Link to={`/c/${chatId}`} className="flex min-w-0 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground">
      <MessageSquare className="size-3 shrink-0" />
      <span className="truncate">{title || ui("Untitled chat")}</span>
    </Link>
  )
}

function AttachmentView({ attachment, inPanel }: { attachment: ChatAttachment; inPanel: boolean }) {
  const kind = attachmentPreviewKind(attachment.name, attachment.mimeType)
  const content = usePreviewContent(attachment, kind, true)
  const view = useMemo<PanelContent>(() => ({ kind: 'attachment', id: attachment.id }), [attachment.id])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className={cn('flex items-center gap-1.5 border-b px-4 py-1.5', inPanel ? 'side-panel-header' : 'mobile-page-content')}>
        <div className="min-w-0 flex-1">
          <ChatLink chatId={attachment.chatId} />
          <h1 className="truncate px-1.5 py-0.5 text-lg font-semibold tracking-tight">{attachment.name}</h1>
        </div>
        <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline">
          {kind ? attachmentDescription(attachment, kind) : formatBytes(attachment.size)}
        </span>
        {/* Truncated previews only hold the start of the file, so copying would silently drop the rest. */}
        {content.status === 'ready' && content.text !== null && !content.textTruncated && <CopyTextButton text={content.text} />}
        <AttachmentSaveMenu
          attachment={attachment}
          onDownload={() => downloadChatAttachment(attachment)}
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {inPanel ? <PanelWindowButtons content={view} /> : <SplitViewButton view={view} />}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/25">
        {kind
          ? <PreviewBody attachment={attachment} kind={kind} content={content} />
          : <p className="p-8 text-center text-sm text-muted-foreground">{ui("No preview is available for this file. Download it to open it.")}</p>}
      </div>
    </div>
  )
}

function AttachmentRoute({ attachmentId, inPanel }: { attachmentId: string; inPanel: boolean }) {
  const userId = useAuth((state) => state.user?.id)
  const query = useQuery<ChatAttachment>({
    queryKey: attachmentQueryKey(userId, attachmentId),
    queryFn: () => fetchAttachment(attachmentId),
    enabled: Boolean(userId),
  })
  if (query.data) return <AttachmentView key={attachmentId} attachment={query.data} inPanel={inPanel} />
  if (query.isPending) return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md rounded-xl border p-6 text-center">
        <TriangleAlert className="mx-auto size-8 text-amber-500" />
        <p className="mt-3 text-sm text-muted-foreground">{ui("This attachment could not be found. It may have been deleted with its chat.")}</p>
        {inPanel
          ? <Button variant="outline" size="sm" className="mt-4" onClick={() => useSidePanel.getState().close()}>{ui("Close")}</Button>
          : <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/">{ui("New chat")}</Link></Button>}
      </div>
    </div>
  )
}

export function AttachmentPage() {
  const { attachmentId } = useParams()
  // Opening the side panel's attachment full page moves it here instead of showing it twice.
  useEffect(() => {
    const shown = useSidePanel.getState().content
    if (attachmentId && shown?.kind === 'attachment' && shown.id === attachmentId) useSidePanel.getState().close()
  }, [attachmentId])
  if (!attachmentId) return null
  return <AttachmentRoute key={attachmentId} attachmentId={attachmentId} inPanel={false} />
}

/** The side panel's content: an attachment from a chat, beside it. */
export function AttachmentPanelView({ attachmentId }: { attachmentId: string }) {
  return <AttachmentRoute key={attachmentId} attachmentId={attachmentId} inPanel />
}
