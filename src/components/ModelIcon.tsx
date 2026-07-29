import type { Model } from '@/lib/types'
import { ProviderLogo } from '@/components/ProviderLogo'
import { cn } from '@/lib/utils'

/**
 * Theme-aware model avatar using real provider marks (from ai-icons).
 * variant filled = solid mark; outline = softer inactive look.
 */
export function ModelIcon({
  model,
  className,
  variant = 'filled',
  boxed = true,
}: {
  model: Model
  className?: string
  /** filled solid mark vs softer outline look */
  variant?: 'filled' | 'outline'
  /** wrap in a subtle square plate (message avatars) */
  boxed?: boolean
  /** @deprecated unused — kept so callers with textClassName don't break */
  textClassName?: string
}) {
  const logo = (
    <ProviderLogo
      provider={model.provider}
      variant={variant}
      className={cn(boxed ? 'size-[65%]' : 'size-full', !boxed && className)}
    />
  )

  if (!boxed) return logo

  return (
    <div
      className={cn(
        'relative flex size-6 shrink-0 select-none items-center justify-center overflow-hidden rounded-[4px]',
        'bg-muted text-foreground dark:bg-muted/80',
        className
      )}
      aria-hidden
      title={model.provider}
    >
      {logo}
    </div>
  )
}
