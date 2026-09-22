import { X } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { Markdown } from './Markdown'

export function ModelWarningNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm text-foreground/80 [&_p]:leading-6">
      <div className="min-w-0 flex-1">
        <Markdown content={message} />
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label={ui("Dismiss warning")}
          onClick={onDismiss}
          className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
