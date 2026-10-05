import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { filesErrorMessage } from '../file-display'
import { useFileToasts, type FileToast } from './toasts'

const TOAST_DURATION_MS = 6_000

function ToastItem({ toast }: { toast: FileToast }) {
  const dismiss = useFileToasts((state) => state.dismiss)
  const show = useFileToasts((state) => state.show)
  const [undoing, setUndoing] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (hovered || undoing) return
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [dismiss, hovered, toast.id, undoing])

  const undo = async () => {
    if (!toast.undo) return
    setUndoing(true)
    try {
      await toast.undo()
      dismiss(toast.id)
    } catch (cause) {
      dismiss(toast.id)
      show({ message: filesErrorMessage(cause), tone: 'error' })
    }
  }

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'pointer-events-auto flex min-w-0 items-center gap-3 rounded-lg border bg-popover py-2 pr-2 pl-4 text-sm text-popover-foreground shadow-lg',
        toast.tone === 'error' && 'border-destructive/40 text-destructive',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => { toast.action!.run(); dismiss(toast.id) }}
          className="shrink-0 cursor-pointer rounded-md px-2 py-1 font-medium text-primary hover:bg-accent dark:text-sky-400"
        >
          {toast.action.label}
        </button>
      )}
      {toast.undo && (
        <button
          type="button"
          disabled={undoing}
          onClick={() => void undo()}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-medium text-primary hover:bg-accent disabled:opacity-60 dark:text-sky-400"
        >
          {undoing && <Loader2 className="size-3.5 animate-spin" />}
          {ui("Undo")}
        </button>
      )}
      <button type="button" aria-label={ui("Dismiss")} onClick={() => dismiss(toast.id)} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  )
}

/** Bottom-centre stack of action confirmations with Undo. */
export function FileToasts() {
  const toasts = useFileToasts((state) => state.toasts)
  if (!toasts.length) return null
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => <div key={toast.id} className="w-full max-w-md"><ToastItem toast={toast} /></div>)}
    </div>
  )
}
