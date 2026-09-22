import { useMemo } from 'react'
import { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown'
import { modelLinkTarget } from '@pulpo/client-core'
import { X } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { Markdown } from './Markdown'

// react-markdown strips unknown protocols; keep `model:` links for the notice to handle.
const keepModelLinks: UrlTransform = (url) => modelLinkTarget(url) ? url : defaultUrlTransform(url)
const noModelsAvailable = () => false

export function ModelWarningNotice({
  message,
  onDismiss,
  onSelectModel,
  isModelAvailable = noModelsAvailable,
}: {
  message: string
  onDismiss?: () => void
  /** Switches the composer when a `model:` link is chosen. */
  onSelectModel?: (modelId: string) => void
  isModelAvailable?: (modelId: string) => boolean
}) {
  const components = useMemo<Components>(() => ({
    a: ({ children, href }) => {
      const target = modelLinkTarget(href)
      if (!target) {
        return (
          <a href={href} target="_blank" rel="noreferrer" className="font-medium [overflow-wrap:anywhere] underline underline-offset-2 hover:text-muted-foreground">
            {children}
          </a>
        )
      }
      // Unavailable targets degrade to plain text rather than a dead control.
      if (!onSelectModel || !isModelAvailable(target)) return <span>{children}</span>
      return (
        <button
          type="button"
          onClick={() => onSelectModel(target)}
          className="cursor-pointer font-medium [overflow-wrap:anywhere] underline underline-offset-2 hover:text-muted-foreground"
        >
          {children}
        </button>
      )
    },
  }), [isModelAvailable, onSelectModel])
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm text-foreground/80 [&_p]:leading-6">
      <div className="min-w-0 flex-1">
        <Markdown content={message} components={components} urlTransform={keepModelLinks} />
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
