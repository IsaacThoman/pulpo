import { Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import type { BannerType } from '@pulpo/contracts'
import { cn } from '@/lib/utils'
import { ui } from '@/i18n/ui'
import { bannerSegments } from './banner-links'

// Opaque surfaces tinted from the theme card color so page content never shows through.
const TONES: Record<BannerType, { icon: LucideIcon; card: string; badge: string }> = {
  info: {
    icon: Info,
    card: 'border-border bg-card',
    badge: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  },
  warning: {
    icon: TriangleAlert,
    card: 'border-amber-500/30 bg-[color-mix(in_oklab,var(--color-amber-500)_9%,var(--card))]',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  error: {
    icon: OctagonAlert,
    card: 'border-destructive/30 bg-[color-mix(in_oklab,var(--destructive)_9%,var(--card))]',
    badge: 'bg-destructive/12 text-destructive dark:text-red-400',
  },
}

/** One admin banner: a tinted card with a tone icon, linkified copy, and an optional dismiss control. */
export function BannerCard({ type, content, onDismiss, className }: {
  type: BannerType
  content: string
  onDismiss?: () => void
  className?: string
}) {
  const tone = TONES[type]
  const Icon = tone.icon
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={cn('flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm', tone.card, className)}
    >
      <span className={cn('mt-px flex size-5 shrink-0 items-center justify-center rounded-full', tone.badge)}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 whitespace-pre-line leading-[1.375rem] text-foreground/90 [overflow-wrap:anywhere]">
        {bannerSegments(content).map((segment, index) => segment.kind === 'link'
          ? <a key={index} href={segment.href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground">{segment.text}</a>
          : <span key={index}>{segment.text}</span>)}
      </p>
      {onDismiss && (
        <button
          type="button"
          aria-label={ui("Dismiss banner")}
          onClick={onDismiss}
          className="-my-1 -mr-1.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
