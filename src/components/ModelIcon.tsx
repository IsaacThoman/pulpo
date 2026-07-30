import type { Model } from '@/lib/types'
import { AiLogo } from '@/components/ProviderLogo'
import { cn } from '@/lib/utils'

/**
 * Model/product avatar. Provider/lab marks intentionally live in ProviderLogo.
 */
export function ModelIcon({
  model,
  className,
  variant = 'filled',
  boxed = false,
}: {
  model: Model
  className?: string
  /** filled solid mark vs softer outline look */
  variant?: 'filled' | 'outline'
  /** optionally wrap in a subtle square plate */
  boxed?: boolean
  /** @deprecated unused — kept so callers with textClassName don't break */
  textClassName?: string
}) {
  const logo = (
    <AiLogo
      icon={model.modelLogo}
      muted={variant === 'outline'}
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
      title={model.name}
    >
      {logo}
    </div>
  )
}
