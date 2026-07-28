import { cn } from '@/lib/utils'
import type { Model } from '@/lib/types'

/**
 * Square, theme-aware model avatar (chat-deathgrips style):
 * brutalist square corners, color swaps between light and dark themes.
 */
export function ModelIcon({
  model,
  className,
  textClassName,
}: {
  model: Model
  className?: string
  textClassName?: string
}) {
  const initial = model.name.charAt(0)
  return (
    <div
      className={cn(
        'relative flex size-6 shrink-0 select-none items-center justify-center overflow-hidden rounded-[3px]',
        className
      )}
      aria-hidden
    >
      <div
        className="absolute inset-0 dark:hidden"
        style={{ backgroundColor: model.iconLight }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{ backgroundColor: model.iconDark }}
      />
      <span
        className={cn(
          'relative text-[11px] font-semibold leading-none text-white mix-blend-difference',
          textClassName
        )}
      >
        {initial}
      </span>
    </div>
  )
}
