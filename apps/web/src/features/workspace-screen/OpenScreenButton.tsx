import { useState } from 'react'
import { Monitor, MonitorOff } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { refreshWorkspaceScreenPresence, useWorkspaceScreenPresence } from './presence'
import { WorkspaceScreenDialog } from './WorkspaceScreenDialog'

/** A reply in the chat is at work; a reply only ever runs at the end of the chat. */
function useChatBusy(chatId: string): boolean {
  return useChat((state) => {
    const last = state.chats.find((chat) => chat.id === chatId)?.messages.at(-1)
    return last?.role === 'assistant' && !last.done
  })
}

/**
 * The screen as offered from the newest reply that used it: Open screen while the workspace is
 * there (and while the reply itself is still at work), and a muted note once it has shut down.
 * Before the first answer it offers the screen; the viewer explains itself if the workspace is gone.
 */
export function WorkspaceScreenOffer({ chatId, running, className }: { chatId: string; running: boolean; className?: string }) {
  const busy = useChatBusy(chatId)
  const presence = useWorkspaceScreenPresence(chatId, busy)
  const [open, setOpen] = useState(false)
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    // Watching moves the workspace's expiry on.
    if (!next) refreshWorkspaceScreenPresence(chatId)
  }
  if (!running && !open && presence?.live === false) return <ScreenClosed className={className} />
  return <OpenScreenButton chatId={chatId} open={open} onOpenChange={onOpenChange} className={className} />
}

/** Opens the chat's workspace screen from a reply whose agent used it. */
export function OpenScreenButton({ chatId, open, onOpenChange, className }: {
  chatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className={cn('inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        <Monitor className="size-3.5" />
        {ui("Open screen")}
      </button>
      {open && <WorkspaceScreenDialog chatId={chatId} open={open} onOpenChange={onOpenChange} />}
    </>
  )
}

/** In the button's place once the workspace has gone: nothing to press, just why. */
function ScreenClosed({ className }: { className?: string }) {
  const explanation = ui("The workspace shut down after sitting idle. Send another message to start a new one.")
  return (
    <span
      title={explanation}
      className={cn('inline-flex shrink-0 cursor-default items-center gap-1 text-xs font-medium text-muted-foreground/60 select-none', className)}
    >
      <MonitorOff aria-hidden="true" className="size-3.5" />
      {ui("Screen closed")}
      <span className="sr-only">. {explanation}</span>
    </span>
  )
}
