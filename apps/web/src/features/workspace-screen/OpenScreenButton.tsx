import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { WorkspaceScreenDialog } from './WorkspaceScreenDialog'

/** Opens the chat's workspace screen from a reply whose agent used it. */
export function OpenScreenButton({ chatId, className }: { chatId: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        <Monitor className="size-3.5" />
        {ui("Open screen")}
      </button>
      {open && <WorkspaceScreenDialog chatId={chatId} open={open} onOpenChange={setOpen} />}
    </>
  )
}
